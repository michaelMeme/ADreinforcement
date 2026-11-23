// Build a read-only analysis snapshot of youfu-ads-analysis for the LLM Council.
// Writes council/data/snapshot-<stamp>.md (+ .json) and council/data/latest.md
//
//   npm run d1:snapshot              -> latest period vs the one before it
//   npm run d1:snapshot -- 261109~261122 261101~261115   (explicit this / baseline)
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProxyAwareFetch, query, pct, num, mdTable, taipeiTimestamp, fileStamp } from "./d1.mjs";
ensureProxyAwareFetch();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "council", "data");
mkdirSync(OUT, { recursive: true });

const [argThis, argBase] = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// ---------- periods ----------
const periods = await query("SELECT period_id, start_date, end_date FROM periods ORDER BY start_date, period_id");
if (!periods.length) throw new Error("No periods in database");
const thisId = argThis ?? periods.at(-1).period_id;
const idx = periods.findIndex((p) => p.period_id === thisId);
if (idx < 0) throw new Error(`Unknown period ${thisId}`);
const baseId = argBase ?? periods[idx - 1]?.period_id ?? null;

// ---------- per-period aggregates ----------
const perPeriod = await query(`
  SELECT period_id,
         COUNT(*) AS rows,
         SUM(sales) AS sales, SUM(ad_spend) AS ad_spend, SUM(total_cost) AS total_cost,
         CASE WHEN SUM(sales) > 0 THEN SUM(ad_spend) * 1.0 / SUM(sales) END AS ad_share_overall,
         CASE WHEN SUM(CASE WHEN profit_rate IS NOT NULL THEN sales END) > 0
              THEN SUM(CASE WHEN profit_rate IS NOT NULL THEN sales * profit_rate END) * 1.0
                   / SUM(CASE WHEN profit_rate IS NOT NULL THEN sales END) END AS profit_rate_weighted,
         AVG(profit_rate) AS profit_rate_avg,
         SUM(CASE WHEN profit_rate > 0.30 THEN 1 ELSE 0 END) AS n_profit_high,
         SUM(CASE WHEN profit_rate >= 0.25 AND profit_rate <= 0.30 THEN 1 ELSE 0 END) AS n_profit_mid,
         SUM(CASE WHEN profit_rate < 0.25 THEN 1 ELSE 0 END) AS n_profit_low,
         SUM(CASE WHEN profit_rate < 0 THEN 1 ELSE 0 END) AS n_profit_negative,
         SUM(COALESCE(this_changed,0)) AS n_this_changed,
         SUM(COALESCE(prev_changed,0)) AS n_prev_changed,
         SUM(COALESCE(reviewed,0)) AS n_reviewed,
         SUM(CASE WHEN actual_adjustment IS NOT NULL AND TRIM(actual_adjustment) <> '' THEN 1 ELSE 0 END) AS n_actual_adjustment,
         SUM(CASE WHEN expected_roas IN ('出清不分析','促銷期不分析') THEN 1 ELSE 0 END) AS n_skipped
  FROM period_rows GROUP BY period_id ORDER BY period_id`);

// ---------- this period: tiers ----------
const rowsThis = await query(
  `SELECT product_id, product_name, sheet_row, sales, total_cost, ad_spend, ad_share, profit_rate,
          daily_budget, daily_budget_raw, target_roas, target_roas_raw,
          expected_roas, expected_price, expected_budget, expected_page,
          revised_roas, revised_price, revised_budget, revised_page,
          other_note, actual_adjustment, prev_changed, this_changed, reviewed, h_sales, h_profit_rate
   FROM period_rows WHERE period_id = ? ORDER BY sales DESC`,
  [thisId],
);
const nRows = rowsThis.length;
const topN = Math.ceil(nRows * 0.2);
const salesCut = rowsThis[topN - 1]?.sales ?? 0;
const tier = {
  sales: (r) => (r.sales != null && r.sales >= salesCut && salesCut > 0 ? "高" : "低"),
  share: (r) => (r.ad_share == null ? "?" : r.ad_share < 0.10 ? "低" : r.ad_share > 0.15 ? "高" : "中"),
  profit: (r) => (r.profit_rate == null ? "?" : r.profit_rate < 0.25 ? "低" : r.profit_rate > 0.30 ? "高" : "中"),
  spend: (r) => (r.ad_spend == null ? "?" : r.ad_spend < 500 ? "低" : r.ad_spend > 1500 ? "高" : "中"),
};
const matrix = {};
for (const r of rowsThis) {
  const k = `銷${tier.sales(r)}/佔${tier.share(r)}/純${tier.profit(r)}`;
  matrix[k] = (matrix[k] || 0) + 1;
}
const matrixRows = Object.entries(matrix).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ combo: k, n }));

const top15 = rowsThis.slice(0, 15);
const bigSpend = [...rowsThis].filter((r) => r.ad_spend != null).sort((a, b) => b.ad_spend - a.ad_spend).slice(0, 12);
const bleeding = rowsThis
  .filter((r) => r.profit_rate != null && r.profit_rate < 0.25 && (r.ad_spend ?? 0) >= 500)
  .sort((a, b) => a.profit_rate - b.profit_rate)
  .slice(0, 15);

const countBy = (key) => {
  const m = {};
  for (const r of rowsThis) {
    const v = (r[key] ?? "").toString().trim() || "(空)";
    m[v] = (m[v] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => ({ value: v, n }));
};
const expectedDist = { roas: countBy("expected_roas"), budget: countBy("expected_budget"), price: countBy("expected_price"), page: countBy("expected_page") };

// ---------- baseline vs this: did the last adjustments work? ----------
let compare = [];
if (baseId) {
  compare = await query(
    `SELECT a.product_id, COALESCE(b.product_name, a.product_name) AS product_name,
            a.sales AS sales_before, b.sales AS sales_after,
            a.profit_rate AS profit_before, b.profit_rate AS profit_after,
            a.ad_spend AS spend_before, b.ad_spend AS spend_after,
            a.this_changed AS changed_in_baseline, a.actual_adjustment AS adj_baseline,
            a.expected_roas AS exp_roas, a.expected_price AS exp_price, a.expected_budget AS exp_budget, a.expected_page AS exp_page,
            a.revised_roas AS rev_roas, a.revised_price AS rev_price, a.revised_budget AS rev_budget, a.revised_page AS rev_page,
            b.other_note AS review_note_this
     FROM period_rows a JOIN period_rows b ON a.product_id = b.product_id AND b.period_id = ?
     WHERE a.period_id = ?
       AND (a.this_changed = 1 OR (a.actual_adjustment IS NOT NULL AND TRIM(a.actual_adjustment) <> ''))
     ORDER BY a.sales DESC`,
    [thisId, baseId],
  );
  for (const r of compare) {
    const d = r.sales_before ? (r.sales_after - r.sales_before) / r.sales_before : null;
    r.sales_delta = d;
    const trend = d == null ? "?" : d >= 0.05 ? "上升" : d < -0.05 ? "下降" : "持平";
    const ok = r.profit_after != null && r.profit_after >= 0.25;
    r.derived_verdict =
      r.profit_after == null ? "?" : ok && trend === "上升" ? "加碼" : ok ? "換方法" : trend === "上升" ? "退一步" : "回復";
    r.sales_trend = trend;
  }
}
const verdictCounts = {};
for (const r of compare) verdictCounts[r.derived_verdict] = (verdictCounts[r.derived_verdict] || 0) + 1;

// ---------- reviews, rules, playbook ----------
const reviews = await query(
  `SELECT r.id, r.product_id, p.product_name, r.baseline_period_id, r.review_date,
          r.profit_rate_before, r.profit_rate_after, r.sales_before, r.sales_after, r.verdict, r.note
   FROM reviews r LEFT JOIN products p ON p.product_id = r.product_id ORDER BY r.id`,
);
const reviewVerdicts = {};
for (const r of reviews) reviewVerdicts[r.verdict ?? "?"] = (reviewVerdicts[r.verdict ?? "?"] || 0) + 1;
const rulesRecent = await query("SELECT id, date_learned, substr(rule_text,1,220) AS preview FROM rules ORDER BY id DESC LIMIT 12");
const [{ n: rulesCount }] = await query("SELECT COUNT(*) AS n FROM rules");
const playbookIdx = await query("SELECT section, topic, applies_to, updated_at FROM playbook ORDER BY section, topic");

// ---------- write ----------
const stamp = fileStamp();
const generated = taipeiTimestamp();
const P = (x) => pct(x, 1);
const N = (x) => num(x, 0);
const short = (s, n = 38) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "");

const md = `# D1 snapshot — youfu-ads-analysis (WooLA)

Generated ${generated}. Read-only. This period **${thisId}**${baseId ? `, baseline **${baseId}**` : ""}.
Tiers follow playbook 05-分析規則/01: sales high = top 20% (cut at NT$${N(salesCut)}, n=${topN}/${nRows}); ad share 低<10% 中10–15% 高>15%; profit 低<25% 中25–30% 高>30%; spend 低<500 高>1500.

## 1. Periods
${mdTable(periods, [{ key: "period_id" }, { key: "start_date" }, { key: "end_date" }])}
## 2. Per-period totals
${mdTable(perPeriod, [
  { key: "period_id", label: "period" }, { key: "rows" },
  { key: "sales", label: "sales NT$", fmt: N }, { key: "ad_spend", label: "ad spend", fmt: N },
  { key: "ad_share_overall", label: "ad share", fmt: P },
  { key: "profit_rate_weighted", label: "profit (sales-wtd)", fmt: P }, { key: "profit_rate_avg", label: "profit (avg)", fmt: P },
  { key: "n_profit_high", label: "純高" }, { key: "n_profit_mid", label: "純中" }, { key: "n_profit_low", label: "純低" }, { key: "n_profit_negative", label: "負" },
  { key: "n_this_changed", label: "本次改動" }, { key: "n_actual_adjustment", label: "有實際調整" }, { key: "n_reviewed", label: "已審核" }, { key: "n_skipped", label: "出清/促銷跳過" },
])}
## 3. ${thisId}: scenario matrix (銷售/廣告佔比/純利率)
${mdTable(matrixRows, [{ key: "combo" }, { key: "n" }])}
## 4. ${thisId}: top 15 by sales
${mdTable(top15, [
  { key: "product_id", label: "id" }, { key: "product_name", label: "name", fmt: (v) => short(v, 30) },
  { key: "sales", fmt: N }, { key: "ad_spend", label: "ad", fmt: N }, { key: "ad_share", label: "share", fmt: P }, { key: "profit_rate", label: "profit", fmt: P },
  { key: "target_roas_raw", label: "K" }, { key: "daily_budget_raw", label: "budget" },
  { key: "expected_roas", label: "exp ROAS", fmt: (v) => short(v, 18) }, { key: "expected_budget", label: "exp budget", fmt: (v) => short(v, 14) }, { key: "expected_page", label: "exp page", fmt: (v) => short(v, 18) },
])}
## 5. ${thisId}: biggest ad spenders
${mdTable(bigSpend, [
  { key: "product_id", label: "id" }, { key: "product_name", label: "name", fmt: (v) => short(v, 30) },
  { key: "ad_spend", label: "ad", fmt: N }, { key: "sales", fmt: N }, { key: "ad_share", label: "share", fmt: P }, { key: "profit_rate", label: "profit", fmt: P },
  { key: "target_roas_raw", label: "K" }, { key: "expected_roas", label: "exp ROAS", fmt: (v) => short(v, 18) }, { key: "expected_page", label: "exp page", fmt: (v) => short(v, 18) },
])}
## 6. ${thisId}: profit < 25% with ad spend ≥ 500 (worst first)
${mdTable(bleeding, [
  { key: "product_id", label: "id" }, { key: "product_name", label: "name", fmt: (v) => short(v, 30) },
  { key: "sales", fmt: N }, { key: "ad_spend", label: "ad", fmt: N }, { key: "ad_share", label: "share", fmt: P }, { key: "profit_rate", label: "profit", fmt: P },
  { key: "target_roas_raw", label: "K" }, { key: "expected_roas", label: "exp ROAS", fmt: (v) => short(v, 18) }, { key: "expected_price", label: "exp price", fmt: (v) => short(v, 14) }, { key: "expected_page", label: "exp page", fmt: (v) => short(v, 18) },
])}
## 7. ${thisId}: distribution of expected adjustments
- ROAS: ${expectedDist.roas.map((x) => `${x.value} (${x.n})`).join("; ")}
- Budget: ${expectedDist.budget.map((x) => `${x.value} (${x.n})`).join("; ")}
- Price: ${expectedDist.price.map((x) => `${x.value} (${x.n})`).join("; ")}
- Page: ${expectedDist.page.map((x) => `${x.value} (${x.n})`).join("; ")}

## 8. Outcome of ${baseId ?? "(no baseline)"} adjustments seen in ${thisId}
Products whose baseline row had 本次改動=1 or an actual adjustment. Derived verdict uses playbook 05/07 (profit ≥25%? sales ±5%): ${Object.entries(verdictCounts).map(([k, n]) => `${k} ${n}`).join(", ") || "n/a"}.
${mdTable(compare.slice(0, 40), [
  { key: "product_id", label: "id" }, { key: "product_name", label: "name", fmt: (v) => short(v, 26) },
  { key: "sales_before", label: "sales→", fmt: N }, { key: "sales_after", label: "sales now", fmt: N }, { key: "sales_delta", label: "Δ", fmt: P },
  { key: "profit_before", label: "profit→", fmt: P }, { key: "profit_after", label: "profit now", fmt: P },
  { key: "adj_baseline", label: "actual adjustment", fmt: (v) => short(v, 40) }, { key: "derived_verdict", label: "verdict" },
])}${compare.length > 40 ? `_(${compare.length - 40} more rows in the JSON file)_\n` : ""}
## 9. Reviews table (${reviews.length} rows; ${Object.entries(reviewVerdicts).map(([k, n]) => `${k} ${n}`).join(", ")})
${mdTable(reviews, [
  { key: "id" }, { key: "product_id", label: "product" }, { key: "product_name", label: "name", fmt: (v) => short(v, 24) }, { key: "baseline_period_id", label: "baseline" },
  { key: "sales_before", label: "sales→", fmt: N }, { key: "sales_after", label: "now", fmt: N }, { key: "profit_rate_before", label: "profit→", fmt: P }, { key: "profit_rate_after", label: "now", fmt: P },
  { key: "verdict" }, { key: "note", fmt: (v) => short(v, 60) },
])}
## 10. Rules (${rulesCount} total; newest 12, full text via \`npm run d1:query -- "SELECT * FROM rules ORDER BY id"\`)
${rulesRecent.map((r) => `- **${r.id}** (${r.date_learned ?? "?"}) ${r.preview.replace(/\n/g, " ")}`).join("\n")}

## 11. Playbook index (${playbookIdx.length} entries)
${playbookIdx.map((p) => `- ${p.section} / ${p.topic} [${p.applies_to}]`).join("\n")}
`;

const json = { generated, thisId, baseId, salesCut, topN, nRows, periods, perPeriod, matrix: matrixRows, rowsThis, compare, reviews, rulesRecent, rulesCount, playbookIdx, expectedDist };
writeFileSync(path.join(OUT, `snapshot-${stamp}.md`), md);
writeFileSync(path.join(OUT, `snapshot-${stamp}.json`), JSON.stringify(json, null, 1));
writeFileSync(path.join(OUT, "latest.md"), md);
console.log(`wrote council/data/snapshot-${stamp}.md (+.json) and council/data/latest.md`);
console.log(`this=${thisId} baseline=${baseId} rows=${nRows} compare=${compare.length} reviews=${reviews.length}`);
