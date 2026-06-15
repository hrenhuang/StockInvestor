# StockInvestor

股票最新損益統計工具，目前同時提供兩種版本：

- `Electron` 桌面版：可讀寫執行目錄下的 `Stocks.xls`
- `GitHub Pages` 靜態版：部署在 `docs/`，改用瀏覽器 `localStorage` 保存資料，股價透過 `Cloudflare Workers + Yahoo` 代理取得

## 功能

- 新增庫存股票
- 移除個股庫存
- 自動統計個股損益與庫存總損益
- 支援上市、上櫃與英數混合代碼，例如 `00878`、`00991A`
- 漲跌顏色採台股習慣：漲紅、跌綠

## 專案結構

- [electron/main.cjs](/d:/AI_WorkSpace/StockInvestor/electron/main.cjs)：Electron 主程序、Excel 讀寫、行情統計
- [electron/preload.cjs](/d:/AI_WorkSpace/StockInvestor/electron/preload.cjs)：Renderer 可呼叫的 API
- [electron/ensure-electron-dist.cjs](/d:/AI_WorkSpace/StockInvestor/electron/ensure-electron-dist.cjs)：Electron runtime 自動修復腳本
- [renderer/index.html](/d:/AI_WorkSpace/StockInvestor/renderer/index.html)：Electron 版畫面
- [renderer/styles.css](/d:/AI_WorkSpace/StockInvestor/renderer/styles.css)：Electron 版樣式
- [renderer/renderer.js](/d:/AI_WorkSpace/StockInvestor/renderer/renderer.js)：Electron 版互動邏輯
- [docs/index.html](/d:/AI_WorkSpace/StockInvestor/docs/index.html)：GitHub Pages 版首頁
- [docs/config.js](/d:/AI_WorkSpace/StockInvestor/docs/config.js)：GitHub Pages 版 Worker URL 設定
- [docs/styles.css](/d:/AI_WorkSpace/StockInvestor/docs/styles.css)：GitHub Pages 版樣式
- [docs/app.js](/d:/AI_WorkSpace/StockInvestor/docs/app.js)：GitHub Pages 版邏輯
- [worker/wrangler.toml](/d:/AI_WorkSpace/StockInvestor/worker/wrangler.toml)：Cloudflare Worker 設定
- [worker/src/index.js](/d:/AI_WorkSpace/StockInvestor/worker/src/index.js)：Cloudflare Worker Yahoo 代理

## Electron 版

### 開發與執行

```powershell
npm install
npm run start
```

### 打包 portable `.exe`

```powershell
npm install
npm run dist
```

輸出檔案位於：

- `dist/StockInvestor-1.0.0.exe`

### 資料檔

- Electron 版預設使用執行目錄下的 `Stocks.xls`
- 若 `Stocks.xls` 不存在，首次新增庫存時會自動建立

## GitHub Pages 版

### 設計差異

GitHub Pages 是純靜態網站，不適合直接讀寫本機 `Stocks.xls`，因此 web 版做了這些調整：

- 改用瀏覽器 `localStorage` 保存庫存資料
- 提供 `匯出資料`，可下載 `Stocks.json`
- 提供 `匯入資料`，可重新載回 `Stocks.json`
- 改用 `Cloudflare Workers + Yahoo` 代理報價
- 新增 `資料來源診斷` 區塊，可直接顯示 Worker / Yahoo 抓取成功或失敗原因

### GitHub Pages 部署方式

1. 將專案推到 GitHub
2. 到 GitHub Repository `Settings`
3. 找到 `Pages`
4. Source 選擇 `Deploy from a branch`
5. Branch 選擇主分支，例如 `main`
6. Folder 選擇 `/docs`

部署後，GitHub Pages 會直接使用：

- [docs/index.html](/d:/AI_WorkSpace/StockInvestor/docs/index.html)

### Cloudflare Worker 部署方式

1. 安裝 Wrangler

```powershell
npm install -g wrangler
```

2. 登入 Cloudflare

```powershell
wrangler login
```

3. 進入 Worker 目錄

```powershell
cd worker
```

4. 部署 Worker

```powershell
wrangler deploy
```

5. 部署完成後，Wrangler 會提供一個 URL，格式通常像：

```text
https://stockinvestor-yahoo-proxy.<subdomain>.workers.dev
```

6. 打開 [docs/config.js](/d:/AI_WorkSpace/StockInvestor/docs/config.js)，將：

```js
quoteProxyUrl: 'https://your-stockinvestor-proxy.workers.dev/api/quotes'
```

改成你的實際 Worker API URL，例如：

```js
quoteProxyUrl: 'https://stockinvestor-yahoo-proxy.example.workers.dev/api/quotes'
```

7. 重新 `git commit` 與 `git push`

8. 等 GitHub Pages 重新部署後再重新整理頁面

### GitHub Pages 版注意事項

- GitHub Pages 版資料只存在當前瀏覽器
- 換電腦、換瀏覽器、清除瀏覽資料後，`localStorage` 內容會消失
- 若要長期保存，建議定期匯出 `Stocks.json`
- 若 Worker URL 沒設定好，頁面會在 `資料來源診斷` 顯示 `docs/config.js 尚未填入真正的 Cloudflare Worker URL`

## 最小化保存建議

### 1. 保留可繼續開發的最小原始碼專案

建議保留：

- `electron/`
- `renderer/`
- `docs/`
- `worker/`
- `package.json`
- `package-lock.json`
- `.npmrc`
- `.gitignore`
- `README.md`
- `AGENTS.md`

可移除：

- `node_modules/`
- `dist/`
- `Stocks.xls`

恢復方式：

```powershell
npm install
npm run start
```

### 2. 只保留 GitHub Pages 版本

若只想保留可部署到 GitHub Pages 的版本，建議保留：

- `docs/`
- `worker/`
- `.gitignore`
- `README.md`

如果只是部署網站，不再需要：

- `electron/`
- `renderer/`
- `node_modules/`
- `dist/`
- `package.json`
- `package-lock.json`
- `.npmrc`
- `Stocks.xls`

## `.gitignore` 說明

目前已忽略這些常見不需要進 Git 的檔案：

- `node_modules/`
- `dist/`
- `Stocks.xls`
- `.vscode/`
- `.idea/`
- `*.log`
- `coverage/`
- `out/`
- `release/`
- `tmp/`
- `temp/`
- `.wrangler/`
- `Thumbs.db`
- `.DS_Store`

這次 GitHub 上傳過大，通常最大宗會是：

1. `node_modules/`
2. `dist/`
3. 本機產生的資料檔，例如 `Stocks.xls`

## 開發中問題與解法

- `npm install` 曾遇到憑證驗證問題，出現 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
  - 解法：加入 `.npmrc` 的 `strict-ssl=false`
- 桌面版在部分 Windows / Node 環境中，直接呼叫 TWSE / TPEX 可能遇到 TLS 憑證驗證錯誤，導致上櫃股票例如 `4979`、`8299` 顯示查無資料
  - 解法：Electron 主程序的行情請求改使用自訂 `https.Agent({ rejectUnauthorized: false })`
- GitHub Pages 純前端版直接呼叫 TPEX 時，瀏覽器可能因 CORS 或遠端限制而擋下請求，導致上櫃股票無法顯示
  - 解法：改成 `Cloudflare Workers + Yahoo` 代理架構，由 Worker 對 Yahoo 取資料，再回傳給 GitHub Pages
- Yahoo `v7/finance/quote` 在 Cloudflare Workers 環境中可能回傳 `401`
  - 解法：Worker 先試 `v7/finance/quote`，若收到 `401`，自動 fallback 到 `v8/finance/chart`
- Yahoo `v8/finance/chart` 備援模式有時只給最新價，未直接附上漲跌值
  - 解法：Worker 會改用最近兩個有效收盤價自動回推 `change`
- 若需要精準判讀 Yahoo `v8/finance/chart` 算出的 `change` 是否正確
  - 解法：Worker 回傳的每筆 item 內會附帶 `debug` 欄位，可直接看到 `previousCloseFromMeta`、`previousCloseFromSeries`、`latestCloseFromSeries`、`computedClosePrice`、`computedChange`
- Electron 在部分 Windows 環境曾出現啟動後 crash
  - 解法：改用 `electron 22.3.27`，並加入穩定化啟動參數
- Electron `dist/` 曾解壓不完整，導致 `Electron failed to install correctly`
  - 解法：新增 [electron/ensure-electron-dist.cjs](/d:/AI_WorkSpace/StockInvestor/electron/ensure-electron-dist.cjs)，於 `postinstall`、`prestart`、`predev` 自動修復 `dist-fixed`
- portable `.exe` 一度誤抓暫存目錄內的 `Stocks.xls`
  - 解法：優先使用 `PORTABLE_EXECUTABLE_DIR`，讓 portable 模式固定讀取 `.exe` 同目錄的 `Stocks.xls`
- `2330` 曾出現 `X0.00` 導致漲跌值判斷錯誤
  - 解法：額外抓取最近交易資料，以最新收盤價與前一日收盤價重新計算漲跌值
