// Shared read-only client for Cloudflare D1 over the REST API.
// Zero dependencies: Node >= 22 built-in fetch.
//
// Config (env or .env in repo root):
//   CF_API_TOKEN        Bearer token with Account/D1/Read. In a Claude Code
//                       cloud session leave it unset: the proxy injects it.
//   CF_ACCOUNT_ID       32-hex account id.
//   CF_D1_DATABASE_ID   D1 database uuid.
//
// Safety: only SELECT / WITH / PRAGMA / EXPLAIN single statements are sent.
// Anything else throws before touching the network.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- .env loading (no dotenv dependency) ----------
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

// ---------- proxy support ----------
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set
// at process start. In a proxied environment (Claude Code cloud session) we
// re-exec ourselves once with that flag so the caller does not have to know.
export function ensureProxyAwareFetch() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY) return;
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

export const config = {
  token: process.env.CF_API_TOKEN || "proxy-injected",
  accountId: process.env.CF_ACCOUNT_ID || "ca104cafaabba123030f6b1916bb5153",
  databaseId: process.env.CF_D1_DATABASE_ID || "709ff200-b8b6-42dc-bc4b-9fb58af84197",
  base: "https://api.cloudflare.com/client/v4",
};

// ---------- read-only guard ----------
const READ_ONLY_KEYWORDS = new Set(["SELECT", "WITH", "PRAGMA", "EXPLAIN"]);

export function assertReadOnly(sql) {
  if (typeof sql !== "string" || !sql.trim()) throw new Error("Empty SQL");
  // strip leading comments and whitespace
  let s = sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/g, "");
  const first = (s.match(/^[A-Za-z]+/) || [""])[0].toUpperCase();
  if (!READ_ONLY_KEYWORDS.has(first)) {
    throw new Error(`Refused: only read-only statements are allowed (got "${first || sql.slice(0, 20)}")`);
  }
  // reject multiple statements: a ';' followed by anything other than whitespace
  const body = s.replace(/'(?:[^']|'')*'/g, "''"); // blank out string literals
  if (/;\s*\S/.test(body)) throw new Error("Refused: multiple statements are not allowed");
  // defense in depth: no write keywords anywhere outside strings
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(body)) {
    throw new Error("Refused: write keyword found in a read-only query");
  }
  return s;
}

// ---------- API calls ----------
async function cf(pathname, init = {}) {
  const res = await fetch(`${config.base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Cloudflare API ${res.status}: non-JSON response`);
  }
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    const err = new Error(`Cloudflare API error: ${msg}`);
    err.status = res.status;
    err.errors = json.errors;
    throw err;
  }
  return json;
}

/** Run one read-only SQL statement. Returns an array of row objects. */
export async function query(sql, params = []) {
  const safe = assertReadOnly(sql);
  const json = await cf(`/accounts/${config.accountId}/d1/database/${config.databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql: safe, params }),
  });
  const r = json.result?.[0];
  if (r && r.success === false) throw new Error(`D1 query failed: ${JSON.stringify(r)}`);
  return r?.results ?? [];
}

/** Run several read-only statements sequentially. Returns array of result arrays. */
export async function queryAll(statements) {
  const out = [];
  for (const s of statements) out.push(await query(s.sql ?? s, s.params ?? []));
  return out;
}

export async function listDatabases() {
  const json = await cf(`/accounts/${config.accountId}/d1/database`, { method: "GET" });
  return json.result ?? [];
}

export async function verifyToken() {
  const json = await cf(`/user/tokens/verify`, { method: "GET" });
  return json.result;
}

// ---------- small helpers ----------
export function pct(x, digits = 1) {
  return x == null || Number.isNaN(x) ? "-" : `${(x * 100).toFixed(digits)}%`;
}
export function num(x, digits = 0) {
  return x == null || Number.isNaN(x) ? "-" : Number(x).toLocaleString("en-US", { maximumFractionDigits: digits });
}
export function mdTable(rows, columns) {
  if (!rows.length) return "_(no rows)_\n";
  const head = columns.map((c) => c.label ?? c.key);
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) {
    lines.push(`| ${columns.map((c) => String((c.fmt ? c.fmt(r[c.key], r) : r[c.key]) ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}
export function taipeiTimestamp(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().replace("T", " ").slice(0, 16) + " (Asia/Taipei)";
}
export function fileStamp(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
}
