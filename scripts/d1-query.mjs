// Ad-hoc read-only query:  npm run d1:query -- "SELECT ... "  [--json]
import { ensureProxyAwareFetch, query, mdTable } from "./d1.mjs";
ensureProxyAwareFetch();

const args = process.argv.slice(2);
const json = args.includes("--json");
const sql = args.filter((a) => a !== "--json").join(" ").trim();
if (!sql) {
  console.error('usage: npm run d1:query -- "SELECT * FROM periods" [--json]');
  process.exit(2);
}
try {
  const rows = await query(sql);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else if (!rows.length) console.log("(no rows)");
  else console.log(mdTable(rows, Object.keys(rows[0]).map((k) => ({ key: k }))));
  console.error(`${rows.length} row(s)`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
