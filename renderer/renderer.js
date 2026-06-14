const stockCodeInput = document.getElementById('stockCode');
const sharesInput = document.getElementById('shares');
const saveButton = document.getElementById('saveButton');
const removeButton = document.getElementById('removeButton');
const summaryButton = document.getElementById('summaryButton');
const filePathEl = document.getElementById('filePath');
const currentPriceBody = document.getElementById('currentPriceBody');
const profitBody = document.getElementById('profitBody');
const totalProfitEl = document.getElementById('totalProfit');
const summaryMetaEl = document.getElementById('summaryMeta');
const statusTextEl = document.getElementById('statusText');

function normalizeStockCode(value) {
  return String(value ?? '').trim().toUpperCase();
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

function renderSummary(result) {
  if (!result.ok) {
    setStatus(result.message || '操作失敗');
    return;
  }

  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) {
    renderEmptyState(result.message || '沒有可顯示的資料');
    setStatus(result.message || '完成');
    return;
  }

  currentPriceBody.innerHTML = items
    .map((item) => `
      <tr>
        <td>${item.stockCode}</td>
        <td>${item.stockName}</td>
        <td>${item.shares}</td>
        <td>${formatMoney(item.closePrice)}</td>
      </tr>
    `)
    .join('');

  profitBody.innerHTML = items
    .map((item) => `
      <tr class="${getValueClass(item.profit)}">
        <td>${item.stockCode}</td>
        <td>${formatChange(item.change)}</td>
        <td>${formatMoney(item.profit)}</td>
      </tr>
    `)
    .join('');

  totalProfitEl.textContent = formatMoney(result.totalProfit);
  totalProfitEl.className = `summary-value ${getValueClass(result.totalProfit)}`;
  summaryMetaEl.textContent = result.tradingDate ? `最新交易日：${result.tradingDate}` : '無法取得交易日';
  setStatus(result.message || '統計完成');
}

async function init() {
  renderEmptyState('等待統計');
  const filePath = await window.stockInvestor.getStockFilePath();
  filePathEl.textContent = filePath;
  await refreshSummaryAfterSave();
}

async function refreshSummaryAfterSave() {
  setStatus('正在統計損益，請稍候...');
  const summaryResult = await window.stockInvestor.calculateSummary();
  renderSummary(summaryResult);
}

saveButton.addEventListener('click', async () => {
  const stockCode = normalizeStockCode(stockCodeInput.value);
  const shares = Number(sharesInput.value);
  stockCodeInput.value = stockCode;

  setStatus('正在更新庫存股票...');
  const result = await window.stockInvestor.saveStock({ stockCode, shares });
  setStatus(result.message || '已完成');

  if (result.ok) {
    stockCodeInput.focus();
    stockCodeInput.select();
    await refreshSummaryAfterSave();
  }
});

removeButton.addEventListener('click', async () => {
  const stockCode = normalizeStockCode(stockCodeInput.value);
  stockCodeInput.value = stockCode;

  setStatus('正在移除個股庫存...');
  const result = await window.stockInvestor.removeStock({ stockCode });
  setStatus(result.message || '已完成');

  if (result.ok) {
    stockCodeInput.focus();
    stockCodeInput.select();
    await refreshSummaryAfterSave();
  }
});

summaryButton.addEventListener('click', async () => {
  await refreshSummaryAfterSave();
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

init().catch((error) => {
  setStatus(error?.message || '初始化失敗');
});
