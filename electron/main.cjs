const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');
const XLSX = require('xlsx');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity,CalculateNativeWinOcclusion');

let mainWindow = null;

function normalizeStockCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isValidStockCode(value) {
  return /^\d{4,5}[A-Z]?$/.test(normalizeStockCode(value));
}

function getRuntimeDirectory() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;

  if (portableDir) {
    return portableDir;
  }

  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }

  return process.cwd();
}

function getStocksFilePath() {
  return path.join(getRuntimeDirectory(), 'Stocks.xls');
}

function ensureStocksFile() {
  const filePath = getStocksFilePath();

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([], {
    header: ['股票代碼', '購入股數']
  });

  XLSX.utils.book_append_sheet(workbook, sheet, 'Stocks');
  XLSX.writeFile(workbook, filePath, { bookType: 'xls' });
  return filePath;
}

function readStocks() {
  const filePath = ensureStocksFile();
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return [];
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows
    .map((row) => ({
      stockCode: normalizeStockCode(row['股票代碼']),
      shares: Number(row['購入股數'] ?? 0)
    }))
    .filter((row) => isValidStockCode(row.stockCode) && Number.isFinite(row.shares) && row.shares > 0);
}

function writeStocks(rows) {
  const normalizedRows = rows.map((row) => ({
    股票代碼: normalizeStockCode(row.stockCode),
    購入股數: Number(row.shares)
  }));

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: ['股票代碼', '購入股數']
  });

  XLSX.utils.book_append_sheet(workbook, sheet, 'Stocks');
  XLSX.writeFile(workbook, getStocksFilePath(), { bookType: 'xls' });
}

function parseQuoteNumber(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim().replace(/,/g, '');
  if (!normalized || normalized === '--' || normalized === '---') {
    return null;
  }

  const matched = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

function parseClosePrice(value) {
  const parsed = parseQuoteNumber(value);
  return parsed == null ? null : Number(parsed);
}

function getObjectValueByPatterns(row, patterns) {
  const entries = Object.entries(row ?? {});
  for (const [key, value] of entries) {
    if (patterns.some((pattern) => pattern.test(key))) {
      return value;
    }
  }
  return null;
}

function formatDateToken(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0'
        }
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (response.statusCode !== 200) {
            reject(new Error(`TWSE HTTP ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error('TWSE 回傳資料格式無法解析'));
          }
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

async function fetchTwseSnapshotForDate(dateToken) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateToken}&type=ALLBUT0999&response=json`;
  const json = await fetchJson(url);

  if (!json || json.stat !== 'OK') {
    throw new Error(json?.stat || 'TWSE 無法提供資料');
  }

  return json;
}

async function fetchStockDayAllSnapshot() {
  const url = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json';
  const json = await fetchJson(url);

  if (!json || json.stat !== 'OK') {
    throw new Error(json?.stat || 'TWSE 無法提供資料');
  }

  return json;
}

async function fetchTpexMainboardSnapshot() {
  const url = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
  const json = await fetchJson(url);

  if (!Array.isArray(json)) {
    throw new Error('TPEX 無法提供資料');
  }

  return json;
}

async function fetchTpexWebSnapshot() {
  const url = 'https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json';
  const json = await fetchJson(url);

  if (!json || (!Array.isArray(json.aaData) && !Array.isArray(json.mmData))) {
    throw new Error('TPEX 網頁版資料異常');
  }

  return json;
}

function extractStockDayAllQuotes(snapshot) {
  const fields = Array.isArray(snapshot?.fields) ? snapshot.fields : [];
  const data = Array.isArray(snapshot?.data) ? snapshot.data : [];
  const codeIndex = fields.findIndex((field) => /證券代號|股票代號|代號/.test(field));
  const nameIndex = fields.findIndex((field) => /證券名稱|名稱/.test(field));
  const closeIndex = fields.findIndex((field) => /收盤價|收盤/.test(field));
  const changeIndex = fields.findIndex((field) => /漲跌價差|漲跌/.test(field));

  if (codeIndex < 0 || nameIndex < 0 || closeIndex < 0 || changeIndex < 0) {
    return [];
  }

  return data
    .map((row) => {
      const stockCode = normalizeStockCode(row[codeIndex]);
      const stockName = String(row[nameIndex] ?? '').trim();
      const closePrice = parseClosePrice(row[closeIndex]);
      const rawChangeText = String(row[changeIndex] ?? '').trim();
      const change = parseQuoteNumber(rawChangeText);

      if (!isValidStockCode(stockCode) || !stockName || closePrice == null || change == null) {
        return null;
      }

      return {
        stockCode,
        stockName,
        closePrice,
        change,
        rawChangeText
      };
    })
    .filter(Boolean);
}

function extractTwseQuotes(snapshot) {
  const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  let bestRows = [];

  for (const table of tables) {
    const fields = Array.isArray(table.fields) ? table.fields : [];
    const codeIndex = fields.findIndex((field) => /證券代號|股票代號|代號/.test(field));
    const nameIndex = fields.findIndex((field) => /證券名稱|名稱/.test(field));
    const closeIndex = fields.findIndex((field) => /收盤價|收盤/.test(field));
    const changeIndex = fields.findIndex((field) => /漲跌價差|漲跌/.test(field));

    if (codeIndex < 0 || nameIndex < 0 || closeIndex < 0 || changeIndex < 0) {
      continue;
    }

    const data = Array.isArray(table.data) ? table.data : [];
    const rows = data
      .map((row) => {
        const code = normalizeStockCode(row[codeIndex]);
        const stockName = String(row[nameIndex] ?? '').trim();
        const closePrice = parseClosePrice(row[closeIndex]);
        const rawChangeText = `${String(row[changeIndex - 1] ?? '').replace(/<[^>]*>/g, '').trim()}${String(row[changeIndex] ?? '').trim()}`;
        const change = parseQuoteNumber(rawChangeText || row[changeIndex]);

        if (!isValidStockCode(code) || !stockName || closePrice == null || change == null) {
          return null;
        }

        return {
          stockCode: code,
          stockName,
          closePrice,
          change,
          rawChangeText
        };
      })
      .filter(Boolean);

    if (rows.length > bestRows.length) {
      bestRows = rows;
    }
  }

  return bestRows;
}

function extractTpexQuotes(snapshot) {
  return snapshot
    .map((row) => {
      const stockCode = normalizeStockCode(
        row.SecuritiesCompanyCode ??
        row.StockCode ??
        getObjectValueByPatterns(row, [/代號/, /Code/i])
      );
      const stockName = String(
        row.CompanyName ??
        row.CompanyShortName ??
        row.StockName ??
        getObjectValueByPatterns(row, [/名稱/, /Name/i]) ??
        ''
      ).trim();
      const closePrice = parseClosePrice(
        row.Close ??
        row.ClosePrice ??
        getObjectValueByPatterns(row, [/收盤/, /Close/i])
      );
      const rawChangeText = String(
        row.Change ??
        row.PriceChange ??
        getObjectValueByPatterns(row, [/漲跌/, /Change/i]) ??
        ''
      ).trim();
      const change = parseQuoteNumber(rawChangeText);
      const dateText = String(row.Date ?? '').trim();

      if (!isValidStockCode(stockCode) || !stockName || closePrice == null) {
        return null;
      }

      return {
        stockCode,
        stockName,
        closePrice,
        change,
        rawChangeText,
        source: 'TPEX',
        dateText
      };
    })
    .filter(Boolean);
}

function extractTpexWebQuotes(snapshot) {
  const rows = Array.isArray(snapshot?.aaData) ? snapshot.aaData : Array.isArray(snapshot?.mmData) ? snapshot.mmData : [];

  return rows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 3) {
        return null;
      }

      const stockCode = normalizeStockCode(row[0]);
      const stockName = String(row[1] ?? '').trim();
      const closePrice = parseClosePrice(row[2]);
      const rawChangeText = `${String(row[3] ?? '').replace(/<[^>]*>/g, '').trim()}${String(row[4] ?? '').trim()}`;
      const change = parseQuoteNumber(rawChangeText || row[4]);

      if (!isValidStockCode(stockCode) || !stockName || closePrice == null) {
        return null;
      }

      return {
        stockCode,
        stockName,
        closePrice,
        change,
        rawChangeText,
        source: 'TPEX_WEB'
      };
    })
    .filter(Boolean);
}

async function fetchLatestMarketQuotes() {
  const quoteMap = new Map();
  let tradingDate = null;

  const mergeRows = (rows) => {
    for (const row of rows) {
      const existing = quoteMap.get(row.stockCode);
      if (!existing || existing.change == null) {
        quoteMap.set(row.stockCode, row);
      }
    }
  };

  try {
    const snapshot = await fetchStockDayAllSnapshot();
    const rows = extractStockDayAllQuotes(snapshot);

    if (rows.length > 0) {
      tradingDate = snapshot.date || tradingDate;
      mergeRows(rows);
    }
  } catch (error) {
    // Fall back to MI_INDEX if STOCK_DAY_ALL is unavailable.
  }

  try {
    const snapshot = await fetchTpexMainboardSnapshot();
    const rows = extractTpexQuotes(snapshot);

    if (rows.length > 0) {
      tradingDate = tradingDate || rows[0].dateText || null;
      mergeRows(rows);
    }
  } catch (error) {
    // TPEX may be temporarily unavailable; keep TWSE quotes if present.
  }

  try {
    const snapshot = await fetchTpexWebSnapshot();
    const rows = extractTpexWebQuotes(snapshot);

    if (rows.length > 0) {
      mergeRows(rows);
    }
  } catch (error) {
    // TPEX web fallback may be unavailable.
  }

  const mergedRows = Array.from(quoteMap.values());

  if (mergedRows.length > 0) {
    return {
      tradingDate,
      rows: mergedRows
    };
  }

  return fetchLatestTwseQuotes();
}

async function fetchLatestTwseQuotes() {
  const fallbackRows = [];
  let fallbackTradingDate = null;

  const today = new Date();
  let lastError = null;

  for (let offset = 0; offset < 15; offset += 1) {
    const probeDate = new Date(today);
    probeDate.setDate(today.getDate() - offset);

    try {
      const dateToken = formatDateToken(probeDate);
      const snapshot = await fetchTwseSnapshotForDate(dateToken);
      const rows = extractTwseQuotes(snapshot);

      if (rows.length > 0) {
        fallbackTradingDate = dateToken;
        fallbackRows.push(...rows);
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (fallbackRows.length > 0) {
    return {
      tradingDate: fallbackTradingDate,
      rows: fallbackRows
    };
  }

  throw lastError || new Error('無法取得最近交易日收盤資料');
}

async function fetchRecentCloseDifference(stockCode, tradingDate) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${tradingDate || formatDateToken(new Date())}&stockNo=${stockCode}&response=json`;
  const json = await fetchJson(url);

  if (!json || json.stat !== 'OK' || !Array.isArray(json.data) || json.data.length < 2) {
    return null;
  }

  const rows = json.data.slice(-2);
  const previousClose = parseClosePrice(rows[0][6]);
  const currentClose = parseClosePrice(rows[1][6]);

  if (previousClose == null || currentClose == null) {
    return null;
  }

  return Number((currentClose - previousClose).toFixed(2));
}

async function calculateSummary() {
  const stocks = readStocks();

  if (stocks.length === 0) {
    return {
      items: [],
      totalProfit: 0,
      tradingDate: null,
      message: 'Stocks.xls 目前沒有任何庫存資料。'
    };
  }

  const snapshot = await fetchLatestMarketQuotes();
  const quoteMap = new Map(snapshot.rows.map((row) => [row.stockCode, row]));
  const specialChangeCache = new Map();

  const items = await Promise.all(stocks.map(async (stock) => {
    const quote = quoteMap.get(stock.stockCode);
    if (!quote) {
      return {
        stockCode: stock.stockCode,
        stockName: '查無資料',
        shares: stock.shares,
        closePrice: null,
        change: null,
        profit: null
      };
    }

    let change = quote.change;

    if (typeof quote.rawChangeText === 'string' && /^X/i.test(quote.rawChangeText)) {
      if (!specialChangeCache.has(stock.stockCode)) {
        specialChangeCache.set(
          stock.stockCode,
          fetchRecentCloseDifference(stock.stockCode, snapshot.tradingDate).catch(() => null)
        );
      }

      const inferredChange = await specialChangeCache.get(stock.stockCode);
      if (inferredChange != null) {
        change = inferredChange;
      }
    }

    return {
      stockCode: stock.stockCode,
      stockName: quote.stockName,
      shares: stock.shares,
      closePrice: quote.closePrice,
      change,
      profit: Number((change * stock.shares).toFixed(2))
    };
  }));

  items.sort((left, right) => {
    const leftProfit = left.profit ?? Number.NEGATIVE_INFINITY;
    const rightProfit = right.profit ?? Number.NEGATIVE_INFINITY;
    if (rightProfit !== leftProfit) {
      return rightProfit - leftProfit;
    }
    return left.stockCode.localeCompare(right.stockCode);
  });

  const totalProfit = Number(
    items
      .filter((item) => item.profit != null)
      .reduce((sum, item) => sum + item.profit, 0)
      .toFixed(2)
  );

  return {
    items,
    totalProfit,
    tradingDate: snapshot.tradingDate,
    message: `已取得 ${snapshot.tradingDate} 的最新收盤資料。`
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 700,
    show: false,
    backgroundColor: '#f6f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('app:get-stock-file-path', async () => {
  return getStocksFilePath();
});

ipcMain.handle('stocks:save', async (_event, payload) => {
  const stockCode = normalizeStockCode(payload?.stockCode);
  const shares = Number(payload?.shares ?? 0);

  if (!isValidStockCode(stockCode)) {
    return {
      ok: false,
      message: '股票代碼格式必須為 4 到 5 碼數字，後面可加 1 個英文字母。'
    };
  }

  if (!Number.isInteger(shares) || shares <= 0) {
    return {
      ok: false,
      message: '購入股數必須是大於 0 的整數。'
    };
  }

  const stocks = readStocks();
  const existingIndex = stocks.findIndex((row) => row.stockCode === stockCode);

  if (existingIndex >= 0) {
    stocks[existingIndex].shares = shares;
  } else {
    stocks.push({ stockCode, shares });
  }

  writeStocks(stocks);

  const savedStocks = readStocks();
  const savedRow = savedStocks.find((row) => row.stockCode === stockCode);

  if (!savedRow || savedRow.shares !== shares) {
    return {
      ok: false,
      message: '檔案已建立，但回讀驗證失敗，請重新嘗試。'
    };
  }

  return {
    ok: true,
    message: existingIndex >= 0
      ? `已更新 ${stockCode} 的股數為 ${shares}。`
      : `已新增 ${stockCode}，股數為 ${shares}。`
  };
});

ipcMain.handle('stocks:remove', async (_event, payload) => {
  const stockCode = normalizeStockCode(payload?.stockCode);

  if (!isValidStockCode(stockCode)) {
    return {
      ok: false,
      message: '股票代碼格式必須為 4 到 5 碼數字，後面可加 1 個英文字母。'
    };
  }

  const stocks = readStocks();
  const filteredStocks = stocks.filter((row) => row.stockCode !== stockCode);

  if (filteredStocks.length === stocks.length) {
    return {
      ok: false,
      message: `Stocks.xls 內找不到 ${stockCode}。`
    };
  }

  writeStocks(filteredStocks);

  const verifyStocks = readStocks();
  const stillExists = verifyStocks.some((row) => row.stockCode === stockCode);

  if (stillExists) {
    return {
      ok: false,
      message: '刪除後回讀驗證失敗，請重新嘗試。'
    };
  }

  return {
    ok: true,
    message: `已移除 ${stockCode} 的庫存資料。`
  };
});

ipcMain.handle('stocks:summary', async () => {
  try {
    const result = await calculateSummary();
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || '統計損益失敗。'
    };
  }
});

app.whenReady().then(() => {
  ensureStocksFile();
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
