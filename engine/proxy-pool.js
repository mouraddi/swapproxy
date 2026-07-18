const axios = require("axios");

// ---------------------------------------------------------------------------
// PROXY POOL – fetches from multiple free sources, health-checks & scores
// ---------------------------------------------------------------------------

const SOURCES = [
  {
    name: "scylla",
    url: process.env.SCYLLA_API_URL || "http://scylla:8899/api/v1/proxies",
    params: { type: "http", status: "alive", anonymity: "high", limit: 100 },
    parser: (data) => {
      if (!Array.isArray(data)) return [];
      return data.map((p) => ({
        host: p.ip || p.host,
        port: p.port,
        protocol: p.protocol || "http",
      }));
    },
    timeout: 8000,
  },
  {
    name: "geonode",
    url: "https://proxylist.geonode.com/api/proxy-list",
    params: {
      protocol: "http",
      limit: 50,
      page: 1,
      sort_by: "lastChecked",
      sort_type: "desc",
      speed: "fast",
    },
    parser: (data) => {
      if (!data || !data.data) return [];
      return data.data.map((p) => ({
        host: p.ip,
        port: parseInt(p.port, 10),
        protocol: p.protocol || "http",
      }));
    },
    timeout: 8000,
  },
  {
    name: "proxyscrape",
    url: "https://api.proxyscrape.com/v3/free-proxy-list/get",
    params: {
      request: "getproxies",
      protocol: "http",
      proxy_format: "ipport",
      format: "json",
      timeout: 5000,
    },
    parser: (data) => {
      if (!data || !data.proxies) return [];
      return data.proxies
        .filter((p) => p.protocol === "http" || p.protocol === "https")
        .map((p) => {
          const [host, port] = p.proxy.split(":");
          return { host, port: parseInt(port, 10), protocol: "http" };
        });
    },
    timeout: 8000,
  },
];

// ---------------------------------------------------------------------------
// In-memory pool with scoring
// ---------------------------------------------------------------------------
let pool = [];
let poolStats = { total: 0, alive: 0, avgSpeed: 0 };

function getPool() {
  return { proxies: pool, stats: poolStats };
}

function getRandomProxy() {
  if (pool.length === 0) return null;
  // Weighted random by score (higher score = more likely)
  const totalWeight = pool.reduce((s, p) => s + p.score, 0);
  if (totalWeight <= 0) return pool[Math.floor(Math.random() * pool.length)];

  let r = Math.random() * totalWeight;
  for (const p of pool) {
    r -= p.score;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Single proxy health check
// ---------------------------------------------------------------------------
async function checkProxy(proxy) {
  const start = Date.now();
  const testUrl = "http://httpbin.org/ip";
  try {
    const resp = await axios.get(testUrl, {
      proxy: { host: proxy.host, port: proxy.port, protocol: "http" },
      timeout: 5000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const latency = Date.now() - start;
    return {
      alive: resp.status === 200,
      latency,
      externalIp: resp.data?.origin || "",
    };
  } catch {
    return { alive: false, latency: 9999, externalIp: "" };
  }
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------
function calculateScore(alive, latency, ageMinutes) {
  if (!alive) return 0;
  const latencyScore = Math.max(0, 100 - latency / 10);
  const ageScore = Math.min(20, ageMinutes / 3);
  return Math.round(Math.min(100, latencyScore + ageScore));
}

// ---------------------------------------------------------------------------
// Background pool maintenance
// ---------------------------------------------------------------------------
async function refreshPool() {
  const fresh = [];

  for (const source of SOURCES) {
    try {
      const resp = await axios.get(source.url, {
        params: source.params,
        timeout: source.timeout,
      });
      const parsed = source.parser(resp.data);
      fresh.push(...parsed.map((p) => ({ ...p, source: source.name })));
      console.log(
        `[pool] ${source.name}: fetched ${parsed.length} proxies`
      );
    } catch (err) {
      console.warn(`[pool] ${source.name} failed: ${err.message}`);
    }
  }

  // Remove duplicates
  const seen = new Set();
  const unique = fresh.filter((p) => {
    const key = `${p.host}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[pool] Unique proxies before health check: ${unique.length}`);

  // Health-check in parallel (max 20 concurrent)
  const BATCH = 20;
  const checked = [];
  const now = Date.now();

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (proxy) => {
        const result = await checkProxy(proxy);
        return { ...proxy, ...result, lastCheck: now };
      })
    );
    checked.push(...results);
  }

  const alive = checked.filter((p) => p.alive);
  const avgLatency =
    alive.length > 0
      ? Math.round(alive.reduce((s, p) => s + p.latency, 0) / alive.length)
      : 0;

  pool = alive.map((p) => ({
    host: p.host,
    port: p.port,
    protocol: p.protocol,
    source: p.source,
    latency: p.latency,
    externalIp: p.externalIp,
    score: calculateScore(p.alive, p.latency, 0),
    lastCheck: p.lastCheck,
  }));

  poolStats = {
    total: unique.length,
    alive: alive.length,
    avgSpeed: avgLatency,
    updatedAt: new Date().toISOString(),
  };

  console.log(
    `[pool] Health check done: ${alive.length}/${unique.length} alive, avg ${avgLatency}ms`
  );
}

// ---------------------------------------------------------------------------
// Start periodic refresh
// ---------------------------------------------------------------------------
let intervalHandle = null;

function startPool(intervalMs = 60000) {
  // Initial fetch
  refreshPool().catch((err) =>
    console.error("[pool] Initial refresh failed:", err.message)
  );
  // Periodic
  intervalHandle = setInterval(() => {
    refreshPool().catch((err) =>
      console.error("[pool] Periodic refresh failed:", err.message)
    );
  }, intervalMs);
  console.log(`[pool] Background refresh every ${intervalMs / 1000}s`);
}

function stopPool() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = {
  startPool,
  stopPool,
  getPool,
  getRandomProxy,
  refreshPool,
};
