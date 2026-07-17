import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, "schema.sql");

let poolPromise = null;
let schemaPromise = null;

export async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const url = process.env.SANDFEST_DATABASE_URL;
      if (!url) {
        throw new Error("SANDFEST_DATABASE_URL is not set; getPool() should not be called in file-storage mode.");
      }
      let pg;
      try {
        pg = await import("pg");
      } catch (error) {
        throw new Error(`SANDFEST_DATABASE_URL is set but the 'pg' package is not installed. Run \`npm install pg\`. (${error.message})`);
      }
      const Pool = pg.default?.Pool ?? pg.Pool;
      const ssl = process.env.SANDFEST_DATABASE_SSL === "false"
        ? false
        : process.env.SANDFEST_DATABASE_SSL === "no-verify"
          ? { rejectUnauthorized: false }
          : url.includes("sslmode=disable")
            ? false
            : { rejectUnauthorized: false };
      return new Pool({
        connectionString: url,
        ssl,
        // Event-day default pool is larger; override with SANDFEST_DATABASE_POOL_MAX.
        max: Number(process.env.SANDFEST_DATABASE_POOL_MAX || 40),
        idleTimeoutMillis: Number(process.env.SANDFEST_DATABASE_IDLE_MS || 30_000),
        connectionTimeoutMillis: Number(process.env.SANDFEST_DATABASE_CONNECT_MS || 5_000)
      });
    })();
  }
  return poolPromise;
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const pool = await getPool();
      const sql = await readFile(SCHEMA_PATH, "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["texas-sandfest:schema"]);
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }
  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

export async function closePool() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  schemaPromise = null;
  await pool.end();
}
