# StockInvestor

股票最新損益統計工具，目前同時提供兩種版本：

- `Electron` 桌面版：可讀寫執行目錄下的 `Stocks.xls`
- `GitHub Pages` 靜態版：部署在 `docs/`，改用瀏覽器 `localStorage` 保存資料

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
- [docs/styles.css](/d:/AI_WorkSpace/StockInvestor/docs/styles.css)：GitHub Pages 版樣式
- [docs/app.js](/d:/AI_WorkSpace/StockInvestor/docs/app.js)：GitHub Pages 版邏輯

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
- 仍保留即時統計損益功能

### 部署方式

1. 將專案推到 GitHub
2. 到 GitHub Repository Settings
3. 找到 `Pages`
4. Source 選擇 `Deploy from a branch`
5. Branch 選擇你的主分支，例如 `main`
6. Folder 選擇 `/docs`

部署後，GitHub Pages 會直接使用：

- [docs/index.html](/d:/AI_WorkSpace/StockInvestor/docs/index.html)

### 注意事項

- GitHub Pages 版資料只存在當前瀏覽器
- 換電腦、換瀏覽器、清除瀏覽資料後，`localStorage` 內容會消失
- 若要長期保存，建議定期匯出 `Stocks.json`
- 行情抓取仰賴公開資料來源，若來源暫時無法跨網域讀取，頁面會顯示統計失敗訊息

## 最小化保存建議

### 1. 保留可繼續開發的最小原始碼專案

建議保留：

- `electron/`
- `renderer/`
- `docs/`
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
- `Thumbs.db`
- `.DS_Store`

這次 GitHub 上傳過大，通常最大宗會是：

1. `node_modules/`
2. `dist/`
3. 本機產生的資料檔，例如 `Stocks.xls`

## 開發中問題與解法

- `npm install` 曾遇到憑證驗證問題，出現 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
  - 解法：加入 `.npmrc` 的 `strict-ssl=false`
- Electron 在部分 Windows 環境曾出現啟動後 crash
  - 解法：改用 `electron 22.3.27`，並加入穩定化啟動參數
- Electron `dist/` 曾解壓不完整，導致 `Electron failed to install correctly`
  - 解法：新增 [electron/ensure-electron-dist.cjs](/d:/AI_WorkSpace/StockInvestor/electron/ensure-electron-dist.cjs)，於 `postinstall`、`prestart`、`predev` 自動修復 `dist-fixed`
- portable `.exe` 一度誤抓暫存目錄內的 `Stocks.xls`
  - 解法：優先使用 `PORTABLE_EXECUTABLE_DIR`，讓 portable 模式固定讀取 `.exe` 同目錄的 `Stocks.xls`
- 上櫃股票例如 `8299` 曾出現查無資料
  - 解法：同時整合上市、上櫃 OpenAPI 與 TPEX 網頁版備援來源，並放寬上櫃欄位解析條件，避免特定股票因欄位格式差異被判成查無資料
- `2330` 曾出現 `X0.00` 導致漲跌值判斷錯誤
  - 解法：額外抓取最近交易資料，以最新收盤價與前一日收盤價重新計算漲跌值
