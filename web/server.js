const express = require("express");
const session = require("express-session");
const Redis = require("ioredis");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.WEB_PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const PROXY_DOMAIN = process.env.PROXY_DOMAIN || "swapproxy.fly.dev";
const PROXY_PORT = process.env.PROXY_PORT || "3128";

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) { return Math.min(times * 200, 2000); },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: "swapproxy-secret-key-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}

// API: Register
app.post("/api/register", async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email) {
    return res.json({ ok: false, error: "All fields required" });
  }
  if (await redis.exists(`user:${username}`)) {
    return res.json({ ok: false, error: "Username already taken" });
  }
  await redis.hset(`user:${username}`, {
    password, email, created: Date.now(),
    bandwidth_limit_gb: 1, // free tier
  });
  // Also add to proxy auth list
  const authKey = `proxy:users`;
  await redis.hset(authKey, username, password);
  await redis.set(`bw:${username}:used`, "0");
  await redis.set(`bw:${username}:reset`, String(Date.now()));
  req.session.user = username;
  res.json({ ok: true });
});

// API: Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const stored = await redis.hgetall(`user:${username}`);
  if (!stored || stored.password !== password) {
    return res.json({ ok: false, error: "Invalid credentials" });
  }
  req.session.user = username;
  res.json({ ok: true });
});

// API: Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// API: Dashboard stats
app.get("/api/stats", requireAuth, async (req, res) => {
  const user = req.session.user;
  const stored = await redis.hgetall(`user:${user}`);
  const used = parseInt(await redis.get(`bw:${user}:used`) || "0", 10);
  const limit = (parseInt(stored?.bandwidth_limit_gb || "1")) * 1024 * 1024 * 1024;
  res.json({
    username: user,
    email: stored?.email || "",
    proxy: `${user}:${stored?.password || ""}@${PROXY_DOMAIN}:${PROXY_PORT}`,
    proxy_host: PROXY_DOMAIN,
    proxy_port: parseInt(PROXY_PORT),
    proxy_user: user,
    proxy_pass: stored?.password || "",
    bandwidth_used: used,
    bandwidth_limit: limit,
    bandwidth_limit_gb: parseInt(stored?.bandwidth_limit_gb || "1"),
    created: stored?.created || 0,
  });
});

// API: Proxy auth — called by engine to verify users
app.get("/api/auth/:user/:pass", async (req, res) => {
  const { user, pass } = req.params;
  const stored = await redis.hgetall(`user:${user}`);
  if (stored && stored.password === pass) {
    return res.json({ ok: true, bandwidth_limit_gb: parseInt(stored.bandwidth_limit_gb || "1") });
  }
  res.json({ ok: false });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[web] Server on 0.0.0.0:${PORT}`);
});
