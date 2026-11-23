# ADreinforcement

唯讀連接 Cloudflare D1 資料庫 `youfu-ads-analysis`（WooLA 蝦皮廣告純利分析），
並用 **LLM Council**（5 位 AI 顧問獨立分析 → 匿名互評 → 主席裁決）做「自我強化」的分析迴圈。

- 資料庫**只讀不寫**。`scripts/d1.mjs` 會擋掉所有非 SELECT 的 SQL。
- 「學習」發生在這個 repo：`council/memory.md` 累積教訓與待驗證假設，每一輪 council 都先回顧上一輪的預測對不對，再給新建議。
- 顧問由 Claude Code 的子代理執行，不需要另外的 Anthropic API Key。

## 目錄

```
scripts/d1.mjs              共用唯讀 D1 client（REST API，零依賴）
scripts/d1-schema.mjs       列出所有表、欄位、筆數        → npm run d1:schema
scripts/d1-query.mjs        臨時唯讀查詢                   → npm run d1:query -- "SELECT …"
scripts/d1-snapshot.mjs     產生 council 用的資料快照      → npm run d1:snapshot
council/data/latest.md      最新快照（會進 git）；*.json 原始資料不進 git
council/memory.md           滾動式教訓／假設清單（學習迴圈的記憶）
council/transcripts/        每一輪 council 的完整逐字稿
.claude/skills/llm-council/ council skill（在 Claude Code 說「council this: …」觸發）
```

## 第一次設定

### 1. 取得 Cloudflare API Token（只要 D1 讀取權限）

1. 登入 https://dash.cloudflare.com ，打開 https://dash.cloudflare.com/profile/api-tokens
2. 點 **Create Token** → 最底下 **Custom token / Start from scratch**
3. 彈出選單選 **Start with an Account policy**
4. Account resources：**Include** → 選你的帳號
5. Permissions：搜尋 `D1` → 勾 **D1 · Read**（只要 Read）
6. **Continue to summary** → **Create Token** → 按 **Copy**（只會顯示一次）

### 2. 把 Token 交給程式

- **在 Claude Code 雲端 session**：不要把 Token 貼進對話。跟 Claude 說「Token 建好了」，它會彈出安全表單，
  貼進去即可。Token 會存在你的環境設定，由代理伺服器自動注入 `api.cloudflare.com` 的請求。
- **在自己的電腦**：

  ```bash
  cp .env.example .env
  ```

  用編輯器打開 `.env`，把 Token 貼在 `CF_API_TOKEN=` 後面。`.env` 已在 `.gitignore`，不會被 commit。

### 3. 測試連線

```bash
npm run d1:schema
```

看到 `# D1 database: youfu-ads-analysis` 與各表筆數就成功了。

## 日常使用

### 查資料

```bash
npm run d1:query -- "SELECT period_id, COUNT(*) n, SUM(sales) sales FROM period_rows GROUP BY period_id"
```

```bash
npm run d1:query -- "SELECT id, rule_text FROM rules ORDER BY id DESC LIMIT 5" --json
```

寫入類語句（INSERT / UPDATE / DELETE / DROP …）會直接被擋下。

### 產生快照

```bash
npm run d1:snapshot
```

預設比較「最新一期 vs 前一期」。也可以指定：

```bash
npm run d1:snapshot -- 261109~261122 261016~261030
```

快照內容：各期總表、情境矩陣、銷售前 15、廣告花費前 12、純利 <25% 且花費 ≥500 的商品、
預期調整方向分布、**上一期改動商品在本期的結果（依複審規則推導加碼／換方法／退一步／回復）**、
reviews 表、最新規則、playbook 索引。

### 召開 council

在 Claude Code 對話裡說：

- 「council this: 本期的預期調整方向，哪些最可能賠錢？」
- 「pressure-test this: 規則 41 的 K≤12 不往實際靠近，資料支持嗎？」
- 「這期要怎麼調：保冷袋 43802546963 該漲價還是降 ROAS？」

流程：跑快照 → 讀 memory 與上一輪逐字稿 → 5 顧問並行 → 5 匿名互評 → 主席裁決（含「上輪預測對照」）→
結論貼在對話 → 逐字稿寫到 `council/transcripts/`、教訓寫進 `council/memory.md`。

## 安全邊界

- 本 repo 不含任何 Token。`.env` 不進 git。
- 只讀 D1；不改廣告後台、不改試算表、不改 `rules`／`playbook` 表。council 的建議由 MM／佳茵決定要不要採用。
- 不碰另一個資料庫 `youfuint-sku-db`。
