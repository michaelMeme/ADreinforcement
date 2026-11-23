# Council memory — youfu-ads-analysis (WooLA)

Rolling lessons from every council round. The chairman appends to this file in Step 6 of
the llm-council skill. Format: 教訓（已驗證）／假設（待驗證）／作廢. Read top to bottom before
every round; the newest section is at the bottom.

## Standing facts (from the database, 2026-11-23)

- Three periods so far: 261016~261030, 261101~261115, 261109~261122 (the last two overlap by one week).
- Goal per playbook: profit rate 25–30% with sales as high as possible. Tiers: sales high = top 20%;
  ad share 低<10% 中10–15% 高>15%; profit 低<25% 中25–30% 高>30%; spend 低<500 高>1500.
- 261016 period's expected_* columns hold the *actual* adjustments made then (e.g. 「調降 11.5->7」), not targets.
- `reviews` (13 rows) all use 261016 as baseline. Period-to-period comparison in the snapshot (section 8)
  uses the immediately preceding period instead, so the two verdict sets are not directly comparable.
- Hard limits: read-only; never fabricate; the council recommends, MM／佳茵 decide (rule 34).

## 待驗證 (open hypotheses)

- 表 6 的 6 個 id（43802546963、44804673421、56000062836、29331715058、43714467214、25494020353）本期填入「調整商品頁」並執行且記錄，則 261123 起的下一期至少 3 個純利率 ≥25%；若仍空白，≤1 個達標。 （round 1, 2026-11-23）
- 下期全店廣告佔比 ≥12% 時，銷售額 ≥950,000 且銷售加權純利 ≥26%；須注意下期不含 11/11，若銷售未達但純利達標，先歸因季節而非規則。 （round 1, 2026-11-23）
- 若對規則 17 的 123 列做半數對照，K−2 組下期銷售相對 ROAS-10 組 ≥ +5% 且純利 ≥25%，則降 ROAS 槓桿成立。 （round 1, 2026-11-23）

## 已驗證 (confirmed lessons)

- 複審對象多未執行——261101 期 107 改動／20 實際／0 審核，表 6 最差 6 列三欄空白；上期 25% 成功率不可解讀。 （round 1）
- 規則 24 的固定加碼對大基準無效——53207737994 日預算 500000→502000，廣告費僅 3,689。 （round 1）

## 2026-11-23 — round 1: 規則問題 vs 執行問題

- Verdict: 執行問題為主（107 改動／20 實際調整／0 審核），規則問題為次（規則 35 不扣大盤、規則 24 對大基準空轉）。
- One thing first: 佳茵／MM 先審核並填寫表 6 的 6 列（43802546963 起），並在「實際調整」欄留下紀錄。
- Proposals for MM／佳茵 (not applied): 規則 35 改相對全店；規則 24/25/43 大基準寫「預算非約束」；規則 33 加審核 SLA；規則 17 做半數對照組；規則 41 先毛利檢核。
- Rejected this round: 純高商品一律 K−2 全面放寬（倖存者偏差，反例 46409669818）。
- Transcript: council/transcripts/council-transcript-20261123-2345.md
