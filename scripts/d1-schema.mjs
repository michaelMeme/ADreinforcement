// Print every table/view/index in the D1 database with columns and row counts.
import { ensureProxyAwareFetch, query, config, listDatabases } from "./d1.mjs";
ensureProxyAwareFetch();

const dbs = await listDatabases();
const me = dbs.find((d) => d.uuid === config.databaseId);
console.log(`# D1 database: ${me?.name ?? "(unknown)"} (${config.databaseId})\n`);

const objs = await query(
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type DESC, name",
);
for (const o of objs.filter((x) => x.type === "table")) {
  const cols = await query(`PRAGMA table_info("${o.name.replace(/"/g, '""')}")`);
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM "${o.name.replace(/"/g, '""')}"`);
  console.log(`## table ${o.name}  (${n} rows)`);
  for (const c of cols) console.log(`  - ${c.name} ${c.type}${c.pk ? " PK" : ""}${c.notnull ? " NOT NULL" : ""}`);
  console.log();
}
const rest = objs.filter((x) => x.type !== "table");
if (rest.length) {
  console.log("## views / indexes");
  for (const o of rest) console.log(`  - ${o.type} ${o.name}`);
}
