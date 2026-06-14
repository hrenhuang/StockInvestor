const STORAGE_KEY = 'stockinvestor-stocks-v1';

const stockCodeInput = document.getElementById('stockCode');
const sharesInput = document.getElementById('shares');
const saveButton = document.getElementById('saveButton');
const removeButton = document.getElementById('removeButton');
const summaryButton = document.getElementById('summaryButton');
const exportButton = document.getElementById('exportButton');
const clearButton = document.getElementById('clearButton');
const importFileInput = document.getElementById('importFile');
const currentPriceBody = document.getElementById('currentPriceBody');
const profitBody = document.getElementById('profitBody');
const totalProfitEl = document.getElementById('totalProfit');
const summaryMetaEl = document.getElementById('summaryMeta');
const statusTextEl = document.getElementById('statusText');

function normalizeStockCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isValidStockCode(value) {
  return /^\d{4,5}[A-Z]?$/.test(normalizeStockCode(value));
}

function setStatus(message) {
  statusTextEl.textContent = message;
}

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatChange(value) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  const amount = formatMoney(Math.abs(value));
  return value > 0 ? `+${amount}` : value < 0 ? `-${amount}` : amount;
}

function getValueClass(value) {
  if (value == null || Number.isNaN(value)) {
    return 'neutral';
  }

  if (value > 0) {
    return 'profit-up';
  }

  if (value < 0) {
    return 'profit-down';
  }

  return 'neutral';
}

function renderEmptyState(message) {
  currentPriceBody.innerHTML = '<tr class="empty-row"><td colspan="4">尚未統計。</td></tr>';
  profitBody.innerHTML = '<tr class="empty-row"><td colspan="3">尚未統計。</td></tr>';
  totalProfitEl.textContent = '0.00';
  totalProfitEl.className = 'summary-value neutral';
  summaryMetaEl.textContent = message || '等待統計';
}

function readStocks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((row) => ({
        stockCode: normalizeStockCode(row.stockCode),
        shares: Number(row.shares)
      }))
      .filter((row) => isValidStockCode(row.stockCode) && Number.isFinite(row.shares) && row.shares > 0);
  } catch {
    return [];
  }
}

function writeStocks(rows) {
  const normalized = rows.map((row) => ({
    stockCode: normalizeStockCode(row.stockCode),
    shares: Number(row.shares)
  }));

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchTwseSnapshotForDate(dateToken) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateToken}&type=ALLBUT0999&response=json`;
  const json = await fetchJson(url);

  if (!json || json.stat !== 'OK') {
    throw new Error(json?.stat || 'TWSE 回傳資料異常');
  }

  return json;
}

async function fetchStockDayAllSnapshot() {
  const url = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json';
  const json = await fetchJson(url);

  if (!json || json.stat !== 'OK') {
    throw new Error(json?.stat || 'TWSE 回傳資料異常');
  }

  return json;
}

async function fetchTpexMainboardSnapshot() {
  const url = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
  const json = await fetchJson(url);

  if (!Array.isArray(json)) {
    throw new Error('TPEX 回傳資料異常');
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
  const nameIndex = fields.findIndex((field) => /證券名稱|股票名稱|名稱/.test(field));
  const closeIndex = fields.findIndex((field) => /收盤價/.test(field));
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
    const nameIndex = fields.findIndex((field) => /證券名稱|股票名稱|名稱/.test(field));
    const closeIndex = fields.findIndex((field) => /收盤價/.test(field));
    const changeIndex = fields.findIndex((field) => /漲跌價差|漲跌/.test(field));

    if (codeIndex < 0 || nameIndex < 0 || closeIndex < 0 || changeIndex < 0) {
      continue;
    }

    const data = Array.isArray(table.data) ? table.data : [];
    const rows = data
      .map((row) => {
        const stockCode = normalizeStockCode(row[codeIndex]);
        const stockName = String(row[nameIndex] ?? '').trim();
        const closePrice = parseClosePrice(row[closeIndex]);
        const changePrefix = String(row[changeIndex - 1] ?? '').replace(/<[^>]*>/g, '').trim();
        const rawChangeText = `${changePrefix}${String(row[changeIndex] ?? '').trim()}`;
        const change = parseQuoteNumber(rawChangeText || row[changeIndex]);

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

  throw lastError || new Error('無法取得最新股價資料');
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
    // Use fallback later.
  }

  try {
    const snapshot = await fetchTpexMainboardSnapshot();
    const rows = extractTpexQuotes(snapshot);

    if (rows.length > 0) {
      tradingDate = tradingDate || rows[0].dateText || null;
      mergeRows(rows);
    }
  } catch (error) {
    // Keep TWSE data if available.
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
      message: '目前沒有任何庫存資料'
    };
  }

  const snapshot = await fetchLatestMarketQuotes();
  const quoteMap = new Map(snapshot.rows.map((row) => [row.stockCode, row]));
  const specialChangeCache = new Map();

  const items = await Promise.all(
    stocks.map(async (stock) => {
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
    })
  );

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
    message: `已完成 ${snapshot.tradingDate || '最新'} 資料統計`
  };
}

function renderSummary(result) {
  if (!result.ok) {
    setStatus(result.message || '統計失敗');
    return;
  }

  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) {
    renderEmptyState(result.message || '目前沒有任何庫存資料');
    setStatus(result.message || '目前沒有任何庫存資料');
    return;
  }

  currentPriceBody.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${item.stockCode}</td>
          <td>${item.stockName}</td>
          <td>${item.shares}</td>
          <td>${formatMoney(item.closePrice)}</td>
        </tr>
      `
    )
    .join('');

  profitBody.innerHTML = items
    .map(
      (item) => `
        <tr class="${getValueClass(item.profit)}">
          <td>${item.stockCode}</td>
          <td>${formatChange(item.change)}</td>
          <td>${formatMoney(item.profit)}</td>
        </tr>
      `
    )
    .join('');

  totalProfitEl.textContent = formatMoney(result.totalProfit);
  totalProfitEl.className = `summary-value ${getValueClass(result.totalProfit)}`;
  summaryMetaEl.textContent = result.tradingDate ? `資料日期：${result.tradingDate}` : '資料日期：最新';
  setStatus(result.message || '統計完成');
}

async function refreshSummary() {
  setStatus('正在讀取最新股價並統計...');

  try {
    const summaryResult = await calculateSummary();
    renderSummary({ ok: true, ...summaryResult });
  } catch (error) {
    setStatus(error?.message || '統計失敗，請稍後再試');
  }
}

function saveStock() {
  const stockCode = normalizeStockCode(stockCodeInput.value);
  const shares = Number(sharesInput.value);

  stockCodeInput.value = stockCode;

  if (!isValidStockCode(stockCode)) {
    setStatus('股票代碼格式錯誤，請輸入 4 到 5 碼數字，或最後 1 碼英文字母');
    return false;
  }

  if (!Number.isInteger(shares) || shares <= 0) {
    setStatus('股數必須是大於 0 的整數');
    return false;
  }

  const stocks = readStocks();
  const existingIndex = stocks.findIndex((row) => row.stockCode === stockCode);

  if (existingIndex >= 0) {
    stocks[existingIndex].shares = shares;
  } else {
    stocks.push({ stockCode, shares });
  }

  writeStocks(stocks);
  setStatus(existingIndex >= 0 ? `已更新 ${stockCode} 股數為 ${shares}` : `已新增 ${stockCode}，股數 ${shares}`);
  return true;
}

function removeStock() {
  const stockCode = normalizeStockCode(stockCodeInput.value);
  stockCodeInput.value = stockCode;

  if (!isValidStockCode(stockCode)) {
    setStatus('股票代碼格式錯誤，請重新輸入');
    return false;
  }

  const stocks = readStocks();
  const filteredStocks = stocks.filter((row) => row.stockCode !== stockCode);

  if (filteredStocks.length === stocks.length) {
    setStatus(`目前庫存中找不到 ${stockCode}`);
    return false;
  }

  writeStocks(filteredStocks);
  setStatus(`已移除 ${stockCode} 庫存`);
  return true;
}

function exportStocks() {
  const stocks = readStocks();
  const blob = new Blob([JSON.stringify(stocks, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = 'Stocks.json';
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
  setStatus('已匯出 Stocks.json');
}

async function importStocks(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('匯入檔案格式錯誤');
  }

  const normalized = parsed
    .map((row) => ({
      stockCode: normalizeStockCode(row.stockCode),
      shares: Number(row.shares)
    }))
    .filter((row) => isValidStockCode(row.stockCode) && Number.isFinite(row.shares) && row.shares > 0);

  writeStocks(normalized);
  setStatus(`已匯入 ${normalized.length} 筆庫存資料`);
}

function clearStocks() {
  localStorage.removeItem(STORAGE_KEY);
  renderEmptyState('資料已清空');
  setStatus('已清空目前瀏覽器內的庫存資料');
}

saveButton.addEventListener('click', async () => {
  if (saveStock()) {
    stockCodeInput.focus();
    stockCodeInput.select();
    await refreshSummary();
  }
});

removeButton.addEventListener('click', async () => {
  if (removeStock()) {
    stockCodeInput.focus();
    stockCodeInput.select();
    await refreshSummary();
  }
});

summaryButton.addEventListener('click', async () => {
  await refreshSummary();
});

exportButton.addEventListener('click', () => {
  exportStocks();
});

clearButton.addEventListener('click', () => {
  clearStocks();
});

importFileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    await importStocks(file);
    await refreshSummary();
  } catch (error) {
    setStatus(error?.message || '匯入失敗');
  } finally {
    importFileInput.value = '';
  }
});

stockCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sharesInput.focus();
  }
});

sharesInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    saveButton.click();
  }
});

renderEmptyState('等待統計');
refreshSummary().catch((error) => {
  setStatus(error?.message || '初始化失敗');
});
