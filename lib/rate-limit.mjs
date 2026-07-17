// Shared rate limiting for multi-instance deploys.
//
// Modes:
// 1) memory  — default, per-process (single pod)
// 2) redis   — when REDIS_URL is set and ioredis is installed (shared across pods)
// 3) upstash — when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (HTTP)

import { createMemoryRateLimiter } from "./safe-json-store.mjs";

function redisKey(name) {
  return `sandfest:rl:${name}`;
}

async function createRedisLimiter({ windowMs }) {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  let Redis;
  try {
    ({ default: Redis } = await import("ioredis"));
  } catch {
    console.warn("[rate-limit] REDIS_URL set but ioredis is not installed; using memory limiter.");
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true
  });
  try {
    await client.connect?.();
  } catch {
    // ioredis connects lazily by default in some versions
  }
  try {
    await client.ping();
  } catch (error) {
    console.warn(`[rate-limit] Redis ping failed (${error.message}); using memory limiter.`);
    try { client.disconnect(); } catch { /* ignore */ }
    return null;
  }

  return {
    kind: "redis",
    async check(key, limit) {
      const rk = redisKey(key);
      const count = await client.incr(rk);
      if (count === 1) await client.pexpire(rk, windowMs);
      const ttl = await client.pttl(rk);
      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;
      return {
        allowed,
        remaining,
        resetAt: Date.now() + Math.max(ttl, 0),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(Math.max(ttl, 0) / 1000))
      };
    },
    prune() {},
    async close() {
      await client.quit().catch(() => client.disconnect());
    }
  };
}

async function createUpstashLimiter({ windowMs }) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return null;

  async function cmd(...args) {
    const res = await fetch(`${base.replace(/\/$/, "")}/${args.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const data = await res.json();
    return data.result;
  }

  return {
    kind: "upstash",
    async check(key, limit) {
      const rk = redisKey(key);
      const count = Number(await cmd("incr", rk));
      if (count === 1) await cmd("pexpire", rk, String(windowMs));
      const ttl = Number(await cmd("pttl", rk));
      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;
      return {
        allowed,
        remaining,
        resetAt: Date.now() + Math.max(ttl, 0),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(Math.max(ttl, 0) / 1000))
      };
    },
    prune() {},
    async close() {}
  };
}

export async function createRateLimiter({ windowMs = 60_000 } = {}) {
  const upstash = await createUpstashLimiter({ windowMs }).catch(err => {
    console.warn(`[rate-limit] Upstash unavailable: ${err.message}`);
    return null;
  });
  if (upstash) {
    console.log("[rate-limit] using Upstash Redis REST");
    return upstash;
  }

  const redis = await createRedisLimiter({ windowMs }).catch(err => {
    console.warn(`[rate-limit] Redis unavailable: ${err.message}`);
    return null;
  });
  if (redis) {
    console.log("[rate-limit] using Redis");
    return redis;
  }

  const memory = createMemoryRateLimiter({ windowMs });
  return {
    kind: "memory",
    async check(key, limit) {
      return memory.check(key, limit);
    },
    prune: () => memory.prune(),
    async close() {}
  };
}
