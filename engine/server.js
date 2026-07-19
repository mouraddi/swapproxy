const http = require("http");
const net = require("net");
const url = require("url");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Redis = require("ioredis");

const proxyPool = require("./proxy-pool");
const { forgeHeaders } = require("./anti-detect");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PROXY_PORT || "3128", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const USERS_PATH =
  process.env.USERS_PATH || path.join(__dirname, "..", "config", "users.json");
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || "30000",
  10
);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const BANDWIDTH_RESET_DAYS = parseInt(
  process.env.BANDWIDTH_RESET_DAYS || "30",
  10
);

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
let authorizedUsers = [];

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_PATH, "utf-8");
    authorizedUsers = JSON.parse(raw).users || [];
    console.log(`[auth] Loaded ${authorizedUsers.length} user(s)`);
  } catch (err) {
    console.error(`[auth] Failed to load users: ${err.message}`);
  }
}
loadUsers();
process.on("SIGHUP", loadUsers);

function findUser(username, password) {
  const local = authorizedUsers.find(
    (u) => u.username === username && u.password === password
  );
  if (local) return local;
  return null; // Redis users handled in authenticate()
}

// ---------------------------------------------------------------------------
// REDIS – bandwidth tracking
// ---------------------------------------------------------------------------
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
});
redis.on("error", (err) => console.error("[redis]", err.message));
redis.on("connect", () => console.log("[redis] Connected"));

function bwKey(user) {
  return `bw:${user}:used`;
}
function bwResetKey(user) {
  return `bw:${user}:reset`;
}

async function checkAndResetBandwidth(username) {
  const resetAt = await redis.get(bwResetKey(username));
  const now = Date.now();
  if (!resetAt || now - parseInt(resetAt, 10) > BANDWIDTH_RESET_DAYS * 86400000) {
    await redis.set(bwKey(username), "0");
    await redis.set(bwResetKey(username), String(now));
    return 0;
  }
  return parseInt((await redis.get(bwKey(username))) || "0", 10);
}

async function addBandwidth(username, bytes) {
  await redis.incrby(bwKey(username), bytes);
}

async function enforceBandwidth(user) {
  const used = await checkAndResetBandwidth(user.username);
  const limit = user.bandwidth_limit_gb * 1024 * 1024 * 1024;
  if (used >= limit) {
    throw new Error(
      `Bandwidth limit (${user.bandwidth_limit_gb}GB) exceeded for "${user.username}"`
    );
  }
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
function authenticate(req, callback) {
  const header = req.headers["proxy-authorization"];
  if (!header) return callback(null, "Missing Proxy-Authorization");

  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "basic") {
    return callback(null, "Must use Basic auth");
  }

  let decoded;
  try {
    decoded = Buffer.from(parts[1], "base64").toString("utf-8");
  } catch {
    return callback(null, "Invalid base64");
  }

  const idx = decoded.indexOf(":");
  if (idx === -1) return callback(null, "Expected username:password");

  const username = decoded.substring(0, idx);
  const password = decoded.substring(idx + 1);

  let user = findUser(username, password);
  if (user) return callback(user);

  // Check Redis for web-registered users
  redis.hgetall(`user:${username}`).then((stored) => {
    if (stored && stored.password === password) {
      callback({ username, password, bandwidth_limit_gb: parseInt(stored.bandwidth_limit_gb || "1") });
    } else {
      callback(null, "Invalid credentials");
    }
  }).catch(() => callback(null, "Auth error"));
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
function handleHttp(clientReq, clientRes) {
  const parts = url.parse(clientReq.url);
  const targetHost = parts.hostname;
  const targetPort = parseInt(parts.port || 80, 10);
  const targetPath = parts.path || "/";
  const isHttps = parts.protocol === "https:";

  const chunks = [];
  clientReq.on("data", (c) => chunks.push(c));
  clientReq.on("end", async () => {
    const body = Buffer.concat(chunks);

    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const proxy = proxyPool.getRandomProxy();
      if (!proxy) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        return clientRes.end("No healthy proxy available");
      }

      try {
        const scheme = isHttps ? "https" : "http";
        const urlStr = `${scheme}://${targetHost}:${targetPort}${targetPath}`;

        const upRes = await axios({
          method: clientReq.method || "GET",
          url: urlStr,
          headers: forgeHeaders(clientReq.headers),
          data: body.length > 0 ? body : undefined,
          proxy: { host: proxy.host, port: proxy.port, protocol: "http" },
          timeout: REQUEST_TIMEOUT_MS,
          responseType: "stream",
          validateStatus: () => true,
        });

        const cl = parseInt(upRes.headers["content-length"] || "0", 10);
        if (cl > 0) addBandwidth(clientReq.authUser.username, cl).catch(() => {});

        clientRes.writeHead(upRes.status, upRes.statusText, upRes.headers);
        upRes.data.pipe(clientRes);
        return;
      } catch (err) {
        lastErr = err;
        console.warn(
          `[http] Attempt ${attempt + 1} failed (${proxy.host}:${proxy.port}): ${err.message}`
        );
      }
    }

    console.error("[http] All retries exhausted");
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
      clientRes.end("Upstream proxy failed after retries");
    }
  });
}

// ---------------------------------------------------------------------------
// CONNECT handler with retry
// ---------------------------------------------------------------------------
function handleConnect(req, clientSocket, head) {
  let currentUpstream = null;

  function cleanup() {
    if (currentUpstream && !currentUpstream.destroyed) {
      currentUpstream.removeAllListeners();
      currentUpstream.destroy();
      currentUpstream = null;
    }
  }

  (async function tryConnect(attempt) {
    if (attempt >= MAX_RETRIES) {
      if (!clientSocket.destroyed) {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.end();
      }
      return;
    }

    const proxy = proxyPool.getRandomProxy();
    if (!proxy) {
      if (!clientSocket.destroyed) {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.end();
      }
      return;
    }

    cleanup();
    currentUpstream = new net.Socket();
    currentUpstream.setTimeout(REQUEST_TIMEOUT_MS);

    currentUpstream.on("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) currentUpstream.write(head);
      clientSocket.pipe(currentUpstream);
      currentUpstream.pipe(clientSocket);
    });

    currentUpstream.on("error", (err) => {
      console.warn(`[connect] Attempt ${attempt + 1} (${proxy.host}:${proxy.port}): ${err.message}`);
      cleanup();
      tryConnect(attempt + 1);
    });

    currentUpstream.on("timeout", () => {
      console.warn(`[connect] Timeout attempt ${attempt + 1} (${proxy.host}:${proxy.port})`);
      cleanup();
      tryConnect(attempt + 1);
    });

    currentUpstream.connect(proxy.port, proxy.host);
  })(0);
}

// ---------------------------------------------------------------------------
// SERVER
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  authenticate(req, (user, errMsg) => {
    if (!user) {
      res.writeHead(407, {
        "Proxy-Authenticate": 'Basic realm="SwapProxy"',
        "Content-Type": "text/plain",
      });
      return res.end(`Auth required: ${errMsg}`);
    }

    req.authUser = user;

    enforceBandwidth(user)
      .then(() => handleHttp(req, res))
      .catch((err) => {
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end(err.message);
      });
  });
});

server.on("connect", (req, socket, head) => {
  authenticate(req, (user, errMsg) => {
    if (!user) {
      socket.write(
        'HTTP/1.1 407 Proxy Auth Required\r\nProxy-Authenticate: Basic realm="SwapProxy"\r\n\r\n'
      );
      return socket.end();
    }
    req.authUser = user;

    enforceBandwidth(user)
      .then(() => handleConnect(req, socket, head))
      .catch((err) => {
        if (!socket.destroyed) {
          socket.write(`HTTP/1.1 429 Too Many Requests\r\n\r\n${err.message}`);
          socket.end();
        }
      });
  });
});

server.on("error", (err) => {
  console.error("[server] Fatal:", err.message);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------
// Start proxy pool background refresh
proxyPool.startPool(parseInt(process.env.POOL_REFRESH_MS || "60000", 10));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] SwapProxy v2 listening on 0.0.0.0:${PORT}`);
  console.log(`[server] Pool refresh every ${parseInt(process.env.POOL_REFRESH_MS || "60000", 10) / 1000}s`);
});
