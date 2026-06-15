const STORAGE_KEY = 'stockinvestor-stocks-v1';
const CONFIG = window.STOCKINVESTOR_CONFIG || {};
const PROXY_URL = String(CONFIG.quoteProxyUrl || '').trim();

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
const diagnosticsGridEl = document.getElementById('diagnosticsGrid');

const diagnosticsState = {
  proxyConfig: { label: 'Proxy 設定', status: 'neutral', detail: '尚未檢查。' },
  workerFetch: { label: 'Cloudflare Worker', status: 'neutral', detail: '尚未發出請求。' },
  yahooResult: { label: 'Yahoo 回傳', status: 'neutral', detail: '尚未發出請求。' }
};

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

function summarizeError(error) {
  if (!error) {
    return '未知錯誤';
  }

  const message = String(error.message || error);
  if (/Failed to fetch/i.test(message)) {
    return '瀏覽器無法連到 Worker，請檢查 URL、CORS、Worker 是否已部署。';
  }
  return message;
}

function diagnosticStatusText(status) {
  if (status === 'ok') {
    return '成功';
  }
  if (status === 'error') {
    return '失敗';
  }
  if (status === 'warn') {
    return '提醒';
  }
  return '等待統計';
}

function renderDiagnostics() {
  diagnosticsGridEl.innerHTML = Object.values(diagnosticsState)
    .map(
      (item) => `
        <article class="diag-card">
          <h3>${item.label}</h3>
          <p class="diag-state ${item.status}">${diagnosticStatusText(item.status)}</p>
          <p class="diag-detail">${item.detail}</p>
        </article>
      `
    )
    .join('');
}

function setDiagnostic(key, status, detail) {
  diagnosticsState[key] = {
    ...diagnosticsState[key],
    status,
    detail
  };
  renderDiagnostics();
}

function resetDiagnostics() {
  Object.keys(diagnosticsState).forEach((key) => {
    diagnosticsState[key] = {
      ...diagnosticsState[key],
      status: 'neutral',
      detail: key === 'proxyConfig' ? '尚未檢查。' : '尚未發出請求。'
    };
  });
  renderDiagnostics();
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

function getProxyEndpoint(codes) {
  const baseUrl = PROXY_URL.replace(/\/+$/, '');
  return `${baseUrl}?codes=${encodeURIComponent(codes.join(','))}`;
}

async function fetchProxyQuotes(codes) {
  if (!PROXY_URL || PROXY_URL.includes('your-stockinvestor-proxy')) {
    setDiagnostic('proxyConfig', 'error', 'docs/config.js 尚未填入真正的 Cloudflare Worker URL。');
    throw new Error('請先在 docs/config.js 設定 Cloudflare Worker URL');
  }

  setDiagnostic('proxyConfig', 'ok', `目前使用：${PROXY_URL}`);

  const response = await fetch(getProxyEndpoint(codes), {
    headers: {
      accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Worker HTTP ${response.status}`);
  }

  const json = await response.json();
  if (!json || !json.ok) {
    throw new Error(json?.message || 'Worker 回傳失敗');
  }

  return json;
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

  const codes = stocks.map((stock) => stock.stockCode);
  const quoteResult = await fetchProxyQuotes(codes);

  setDiagnostic('workerFetch', 'ok', `Worker 成功回傳 ${quoteResult.items.length} 筆資料。`);

  if (quoteResult.provider) {
    setDiagnostic('yahooResult', 'ok', `目前使用 ${quoteResult.provider}。`);
  }

  if (Array.isArray(quoteResult.missingCodes) && quoteResult.missingCodes.length > 0) {
    setDiagnostic(
      'yahooResult',
      'warn',
      `${quoteResult.provider || 'Yahoo'} 未回傳：${quoteResult.missingCodes.join(', ')}`
    );
  } else if (!quoteResult.provider) {
    setDiagnostic('yahooResult', 'ok', 'Yahoo 已回傳全部查詢股票資料。');
  }

  const quoteMap = new Map((quoteResult.items || []).map((row) => [row.stockCode, row]));

  const items = stocks.map((stock) => {
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

    const change = Number.isFinite(Number(quote.change)) ? Number(quote.change) : null;

    return {
      stockCode: stock.stockCode,
      stockName: quote.stockName,
      shares: stock.shares,
      closePrice: Number(quote.closePrice),
      change,
      profit: change == null ? null : Number((change * stock.shares).toFixed(2))
    };
  });

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
    tradingDate: quoteResult.tradingDate,
    message: `已完成 ${quoteResult.tradingDate || '最新'} 資料統計`
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
  resetDiagnostics();
  setStatus('正在透過 Cloudflare Worker 讀取 Yahoo 資料...');

  try {
    const summaryResult = await calculateSummary();
    renderSummary({ ok: true, ...summaryResult });
  } catch (error) {
    setDiagnostic('workerFetch', 'error', summarizeError(error));
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

renderDiagnostics();
renderEmptyState('等待統計');
refreshSummary().catch((error) => {
  setStatus(error?.message || '初始化失敗');
});
