---
name: llm-council
description: "Run a decision or analysis question about the WooLA Shopee ad profit data (Cloudflare D1 `youfu-ads-analysis`) through a council of 5 AI advisors who independently analyze it with the live data, peer-review each other anonymously, and synthesize a final verdict. Adapted from Karpathy's LLM Council. Read-only against D1; the learning loop lives in council/memory.md and council/transcripts/. MANDATORY TRIGGERS: 'council this', 'run the council', 'war room this', 'pressure-test this', 'stress-test this', 'debate this', '開會', '召開會議', '跑 council', '分析資料庫', '這輪數據怎麼樣', '這期要怎麼調'. STRONG TRIGGERS (when paired with a real decision or tradeoff about ads, rules, budgets, ROAS, pricing or product pages): 'should I X or Y', 'which option', 'is this the right move', 'validate this', '該不該', '要不要改規則', '哪個比較好'. Do NOT trigger on simple factual lookups of the database (use `npm run d1:query` directly) or on tasks with one right answer."
---

# LLM Council for youfu-ads-analysis

Five advisors with different thinking styles read the **same live snapshot** of the D1
database, answer independently, review each other anonymously, and a chairman synthesizes
a verdict. Every round first reads what earlier rounds concluded and checks those
predictions against the new numbers. That retrospective is the reinforcement signal:
lessons that survive go into `council/memory.md`, lessons that failed get marked so.

The database is **never written**. The council only reads D1 and writes files in this repo.

---

## Hard rules (inherited from the playbook, non-negotiable)

1. **Read-only.** All D1 access goes through `scripts/d1.mjs`, which refuses anything but
   SELECT / WITH / PRAGMA / EXPLAIN. Never call the Cloudflare API any other way.
2. **Only real data.** If a number is not in the snapshot or a query, say "not in data".
   Never invent sales, profit rates, ROAS, or outcomes. The playbook says
   「只寫真實查到的資料，不要編造」.
3. **The council recommends; it does not act.** Nothing here changes ads, budgets, bids,
   prices, product pages, the Google Sheet, or the `rules`/`playbook` tables. Recommendations
   are for MM (Michael) and 佳茵 to decide. If a verdict implies a rule change, phrase it as
   「建議向 MM／佳茵提出」.
4. **Respect the existing rule system.** Advisors may challenge a rule, but the chairman must
   cite the rule id (from the `rules` table) being challenged and the data behind the challenge.
5. **Taipei time** in all outputs (`Asia/Taipei`, UTC+8).

---

## The five advisors

Thinking styles, not job titles. They create three tensions: Contrarian vs Expansionist
(downside vs upside), First Principles vs Executor (rethink vs just do it), with the
Outsider keeping everyone honest.

1. **The Contrarian** — assumes the current plan has a fatal flaw and hunts for it in the
   numbers: products where the rule-driven recommendation will lose money, periods where
   last round's "加碼" verdicts collapsed, metrics that are being gamed.
2. **The First Principles Thinker** — asks what the shop is actually optimizing (profit rate
   25–30% *and* sales), strips away the scenario taxonomy, rebuilds the decision from
   unit economics: contribution per ad dollar, not profit-rate tiers.
3. **The Expansionist** — looks for upside everyone else is ignoring: products with high
   profit and low ad share that could absorb much more budget, categories that scale,
   rules that are too conservative.
4. **The Outsider** — gets the data but **not** `council/memory.md` or past transcripts, and
   is told nothing about rule numbers or scenario names. Reacts purely to what the numbers
   say. Catches curse-of-knowledge errors in the rule system.
5. **The Executor** — only cares about Monday morning: given 佳茵's time and the rules she
   has already approved, what is the shortest list of concrete actions, which products,
   which numbers, in what order.

---

## How a council session works

### Step 0: pull the data and the memory (always)

1. Run the snapshot (this is the only network step):

   ```bash
   npm run d1:snapshot
   ```

   It writes `council/data/latest.md` (committed) and a `snapshot-<stamp>.json` (ignored).
   If it fails with 401/403 or "no rule allows host", the Cloudflare token is missing: tell
   the user to follow README.md 「取得 Cloudflare API Token」 and stop. Do not fabricate data.
2. Read `council/data/latest.md` in full.
3. Read `council/memory.md` (lessons, open hypotheses, predictions to verify).
4. Read the most recent 1–2 files in `council/transcripts/` (skip if none).
5. If the question needs more detail than the snapshot has (one product's history, full
   rule text, a playbook entry), run targeted queries, for example:

   ```bash
   npm run d1:query -- "SELECT id, rule_text FROM rules WHERE id IN (24,39,40,41,42,43)"
   npm run d1:query -- "SELECT period_id, sales, profit_rate, ad_share, target_roas_raw, expected_roas, expected_budget, expected_page, actual_adjustment FROM period_rows WHERE product_id='43802546963' ORDER BY period_id"
   npm run d1:query -- "SELECT content FROM playbook WHERE section='05-分析規則' AND topic='03-情境總覽'"
   ```

   Keep the extra context under ~3,000 words; put the rest in the transcript appendix.

### Step 1: frame the question

Rewrite the user's question as one neutral prompt all five advisors receive. It must contain:

1. The decision or question (one or two sentences).
2. **Data block**: paste the relevant sections of `latest.md` verbatim (at minimum: per-period
   totals, scenario matrix, section 8 "outcome of last adjustments", and whatever product
   tables the question touches). Numbers, not adjectives.
3. **Rule block**: the rule ids and text that govern this decision (only for advisors 1, 2,
   3, 5; the Outsider gets the data block only).
4. **Memory block**: from `council/memory.md`, the lessons and open predictions relevant to
   this question, plus what the previous council recommended (only for advisors 1, 2, 3, 5).
5. What is at stake (NT$ per period, number of products affected).

Do not add your own opinion. If the question is too vague (「council this: 我的廣告」), ask
exactly one clarifying question, then proceed.

### Step 2: convene the council (5 Agent sub-agents in parallel)

Spawn all five at once in a single message. Each advisor gets its identity, the framed
question, and this instruction: *respond independently; do not hedge; lean fully into your
angle; cite product ids and numbers from the data block; 150–300 words; no preamble.*

Prompt template:

```
You are [Advisor Name] on an LLM Council reviewing a Shopee shop's ad profit data.

Your thinking style: [advisor description]

Hard constraints: use only numbers present in the data below; say "not in data" otherwise.
You recommend, you do not act. Write in Traditional Chinese (繁體中文); keep product ids as-is.

A user has brought this question to the council:
---
[framed question with data / rule / memory blocks as applicable]
---

Respond from your perspective. Be direct and specific. Don't hedge or try to be balanced.
The other advisors will cover the angles you're not covering.
Keep your response between 150-300 words. No preamble. Go straight into your analysis.
```

### Step 3: anonymous peer review (5 Agent sub-agents in parallel)

Shuffle the five responses and label them Response A–E (record the mapping for the
transcript). Spawn five reviewers; each sees the framed question and all five anonymized
responses and answers, in under 200 words, in Traditional Chinese:

1. Which response is the strongest and why?
2. Which response has the biggest blind spot, and what is it?
3. What did ALL five miss that the council should consider?

### Step 4: chairman synthesis (1 Agent sub-agent)

The chairman gets: the framed question, the five responses **de-anonymized**, the five
reviews, and `council/memory.md`. It must produce exactly this structure, in Traditional
Chinese:

```
## Retrospective（上輪預測對照）
[For each prediction / recommendation in memory.md marked 待驗證: did the new data confirm
it, refute it, or is it still open? Quote the numbers. If there is no prior round, say so.]

## Where the Council Agrees
## Where the Council Clashes
## Blind Spots the Council Caught
## The Recommendation
[Clear, direct, with product ids and numbers. Not "it depends". May side with a minority.]

## The One Thing to Do First
[One concrete action for 佳茵 / MM. One.]

## Lessons for memory
[3–6 bullets. Each bullet is one of:
 - 教訓（已驗證）: a lesson the data supports, with the evidence.
 - 假設（待驗證）: a prediction to check next period, with the metric and threshold.
 - 作廢: a previous memory item the data refuted.]
```

The chairman may disagree with the majority if one advisor's reasoning is stronger.

### Step 5: present the verdict in chat

Post the chairman's output in chat as markdown under `## Council Verdict: {short topic}`.
No HTML, no slides. Keep it scannable.

### Step 6: persist the learning loop (always, not optional)

1. Write `council/transcripts/council-transcript-<YYYYMMDD-HHMM>.md` (Taipei time) with:
   framed question, snapshot filename used, the five advisor responses (named), the A–E
   mapping, the five reviews, and the chairman verdict.
2. Update `council/memory.md`:
   - Append the chairman's 「Lessons for memory」 under a new `## <date> — <topic>` heading.
   - Move anything the Retrospective confirmed from 「待驗證」 to 「已驗證」, and strike through
     (`~~…~~`) anything it refuted with a one-line reason.
   - Keep the file under ~300 lines; fold old confirmed lessons into one-liners.
3. Tell the user the two file paths. Commit only if the user asks.

---

## Good council questions for this database

- 「council this: 本期 261109~261122 的預期調整方向，哪些最可能賠錢？」
- 「pressure-test this: 規則 41 的 K≤12 不往實際靠近，資料支持嗎？」
- 「這期要怎麼調：保冷袋 43802546963 純利 22.7%、佔比 10.9%，該漲價還是降 ROAS？」
- 「debate this: 上一期 113 個改動只有 28 個加碼，是規則問題還是執行問題？」

Bad council questions (answer directly instead):

- 「上期銷售總額多少」 → `npm run d1:query`.
- 「規則 24 全文」 → `npm run d1:query -- "SELECT rule_text FROM rules WHERE id=24"`.

---

## Important notes

- **Always spawn the five advisors in parallel**, then the five reviewers in parallel.
- **Always anonymize for peer review.**
- **The Outsider never sees memory or rule numbers.** That is the point of the Outsider.
- **Retrospective before recommendation.** A round that skips checking last round's
  predictions is not reinforcement learning, it is just another opinion.
- **Transcripts and memory are the memory.** The database is not written. Ever.
