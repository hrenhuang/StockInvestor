const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...(init.headers || {})
    }
  });
}

function normalizeStockCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isValidStockCode(value) {
  return /^\d{4,5}[A-Z]?$/.test(normalizeStockCode(value));
}

function parseYahooNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getTradingDate(results) {
  const timestamps = results
    .map((item) => Number(item.regularMarketTime || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (timestamps.length === 0) {
    return null;
  }

  const latest = new Date(Math.max(...timestamps) * 1000);
  return latest.toISOString().slice(0, 10);
}

function toTradingDateFromTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function getLastTwoValidCloses(result) {
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) {
    return { previousClose: null, latestClose: null };
  }

  const valid = closes
    .map((value) => parseYahooNumber(value))
    .filter((value) => value != null);

  if (valid.length === 0) {
    return { previousClose: null, latestClose: null };
  }

  if (valid.length === 1) {
    return { previousClose: null, latestClose: valid[0] };
  }

  return {
    previousClose: valid[valid.length - 2],
    latestClose: valid[valid.length - 1]
  };
}

function buildCandidateSymbols(stockCode) {
  return [`${stockCode}.TW`, `${stockCode}.TWO`];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 StockInvestor/1.0',
      accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 StockInvestor/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchTwseNameMap() {
  const json = await fetchJson('https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json');
  const fields = Array.isArray(json?.fields) ? json.fields : [];
  const data = Array.isArray(json?.data) ? json.data : [];
  const codeIndex = fields.findIndex((field) => /證券代號|股票代號|代號/.test(field));
  const nameIndex = fields.findIndex((field) => /證券名稱|股票名稱|名稱/.test(field));
  const nameMap = new Map();

  if (codeIndex < 0 || nameIndex < 0) {
    return nameMap;
  }

  for (const row of data) {
    const stockCode = normalizeStockCode(row?.[codeIndex]);
    const stockName = String(row?.[nameIndex] ?? '').trim();
    if (isValidStockCode(stockCode) && stockName) {
      nameMap.set(stockCode, stockName);
    }
  }

  return nameMap;
}

async function fetchTpexNameMap() {
  const json = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
  const rows = Array.isArray(json) ? json : [];
  const nameMap = new Map();

  for (const row of rows) {
    const stockCode = normalizeStockCode(row?.SecuritiesCompanyCode);
    const stockName = String(row?.CompanyName ?? '').trim();
    if (isValidStockCode(stockCode) && stockName) {
      nameMap.set(stockCode, stockName);
    }
  }

  return nameMap;
}

function buildMisChannel(item) {
  const symbol = String(item.marketSymbol || '').toUpperCase();
  if (symbol.endsWith('.TW')) {
    return `tse_${item.stockCode}.tw`;
  }
  if (symbol.endsWith('.TWO')) {
    return `otc_${item.stockCode}.tw`;
  }
  return null;
}

async function fetchMisNameMap(items) {
  const channels = items
    .map(buildMisChannel)
    .filter(Boolean);

  if (channels.length === 0) {
    return new Map();
  }

  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join('|'))}&json=1&delay=0`;
  const json = await fetchJson(url);
  const rows = Array.isArray(json?.msgArray) ? json.msgArray : [];
  const nameMap = new Map();

  for (const row of rows) {
    const stockCode = normalizeStockCode(row?.c);
    const stockName = String(row?.n ?? '').trim();
    if (isValidStockCode(stockCode) && stockName) {
      nameMap.set(stockCode, stockName);
    }
  }

  return nameMap;
}

async function fetchChineseNameMap() {
  const [twseResult, tpexResult] = await Promise.allSettled([
    fetchTwseNameMap(),
    fetchTpexNameMap()
  ]);

  const nameMap = new Map();

  if (twseResult.status === 'fulfilled') {
    for (const [stockCode, stockName] of twseResult.value.entries()) {
      nameMap.set(stockCode, stockName);
    }
  }

  if (tpexResult.status === 'fulfilled') {
    for (const [stockCode, stockName] of tpexResult.value.entries()) {
      nameMap.set(stockCode, stockName);
    }
  }

  return nameMap;
}

function parseYahooTaiwanChineseName(stockCode, html) {
  const ignoreNames = new Set(['Yahoo股市', 'Yahoo奇摩股市', 'Yahoo']);

  const extractCandidate = (text) => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    const stockCodeIndex = normalized.indexOf(stockCode);
    if (stockCodeIndex >= 0) {
      const afterCode = normalized.slice(stockCodeIndex + stockCode.length).trim();
      const cleaned = afterCode
        .replace(/^[\-－:：\s]+/, '')
        .replace(/\s*[-－|｜].*$/, '')
        .replace(/\s*Yahoo.*$/i, '')
        .trim();

      if (cleaned && /[\u4e00-\u9fff]/.test(cleaned) && !ignoreNames.has(cleaned)) {
        return cleaned;
      }
    }

    return null;
  };

  const strongPatterns = [
    /"shortName"\s*:\s*"([^"]+)"/i,
    /"longName"\s*:\s*"([^"]+)"/i,
    /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i,
    /<title>\s*([^<]+?)\s*<\/title>/i
  ];

  for (const pattern of strongPatterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const candidate = extractCandidate(match[1]);
    if (candidate) {
      return candidate;
    }
  }

  const metaPattern = new RegExp(`${stockCode}[^\\u4e00-\\u9fff]{0,10}([\\u4e00-\\u9fffA-Za-z0-9（）()\\-]{2,30})`, 'g');
  let metaMatch = metaPattern.exec(html);
  while (metaMatch) {
    const candidate = String(metaMatch[1] || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*Yahoo.*$/i, '')
      .trim();
    if (candidate && /[\u4e00-\u9fff]/.test(candidate) && !ignoreNames.has(candidate)) {
      return candidate;
    }
    metaMatch = metaPattern.exec(html);
  }

  return null;
}

async function fetchYahooTaiwanChineseName(stockCode, symbol) {
  const targets = [];

  if (symbol) {
    targets.push(symbol);
  }
  targets.push(stockCode);

  for (const target of targets) {
    try {
      const html = await fetchText(`https://tw.stock.yahoo.com/quote/${encodeURIComponent(target)}`);
      const chineseName = parseYahooTaiwanChineseName(stockCode, html);
      if (chineseName) {
        return chineseName;
      }
    } catch (error) {
      // Try next target.
    }
  }

  return null;
}

async function enrichItemsWithChineseNames(items, nameMap) {
  let misNameMap = new Map();

  try {
    misNameMap = await fetchMisNameMap(items);
  } catch (error) {
    // Ignore MIS failure and continue with other sources.
  }

  const enrichedItems = [];

  for (const item of items) {
    // Keep names dynamic: official lists first, then MIS, then Yahoo Taiwan page fallback.
    const officialName = nameMap.get(item.stockCode);
    if (officialName) {
      enrichedItems.push({
        ...item,
        stockName: officialName
      });
      continue;
    }

    const misName = misNameMap.get(item.stockCode);
    if (misName) {
      enrichedItems.push({
        ...item,
        stockName: misName
      });
      continue;
    }

    const yahooChineseName = await fetchYahooTaiwanChineseName(item.stockCode, item.marketSymbol);
    if (yahooChineseName) {
      enrichedItems.push({
        ...item,
        stockName: yahooChineseName
      });
      continue;
    }

    enrichedItems.push(item);
  }

  return enrichedItems;
}

function mapYahooQuote(stockCode, quotes) {
  const matches = quotes.filter((item) => {
    const symbol = String(item.symbol || '').toUpperCase();
    return symbol === `${stockCode}.TW` || symbol === `${stockCode}.TWO`;
  });

  if (matches.length === 0) {
    return null;
  }

  const preferred = matches.find((item) => parseYahooNumber(item.regularMarketPrice) != null) || matches[0];
  const closePrice = parseYahooNumber(preferred.regularMarketPrice);
  const change = parseYahooNumber(preferred.regularMarketChange);

  if (closePrice == null) {
    return null;
  }

  return {
    stockCode,
    stockName: String(preferred.longName || preferred.shortName || stockCode).trim(),
    closePrice,
    change,
    source: 'YAHOO_WORKER',
    marketSymbol: preferred.symbol || null
  };
}

async function fetchYahooQuotes(codes) {
  const symbols = codes.flatMap(buildCandidateSymbols);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 StockInvestor/1.0',
      accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }

  const json = await response.json();
  const results = Array.isArray(json?.quoteResponse?.result) ? json.quoteResponse.result : [];
  const items = codes
    .map((stockCode) => mapYahooQuote(stockCode, results))
    .filter(Boolean);

  return {
    tradingDate: getTradingDate(results),
    items,
    missingCodes: codes.filter((code) => !items.some((item) => item.stockCode === code)),
    provider: 'YAHOO_V7_QUOTE'
  };
}

function mapYahooChartQuote(stockCode, symbol, json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) {
    return null;
  }

  const { previousClose: closeSeriesPrevious, latestClose: closeSeriesLatest } = getLastTwoValidCloses(result);
  const closePrice = parseYahooNumber(meta.regularMarketPrice) ?? closeSeriesLatest;
  if (closePrice == null) {
    return null;
  }

  const previousClose = parseYahooNumber(meta.previousClose) ?? closeSeriesPrevious;
  const change = previousClose == null ? null : Number((closePrice - previousClose).toFixed(2));
  const tradingDate = toTradingDateFromTimestamp(Number(meta.regularMarketTime || 0));
  const debug = {
    method: 'YAHOO_V8_CHART',
    symbol,
    regularMarketPrice: parseYahooNumber(meta.regularMarketPrice),
    previousCloseFromMeta: parseYahooNumber(meta.previousClose),
    previousCloseFromSeries: closeSeriesPrevious,
    latestCloseFromSeries: closeSeriesLatest,
    computedClosePrice: closePrice,
    computedChange: change
  };

  return {
    item: {
      stockCode,
      stockName: String(meta.instrumentType || stockCode).trim() === stockCode
        ? stockCode
        : String(meta.shortName || meta.longName || stockCode).trim(),
      closePrice,
      change,
      source: 'YAHOO_WORKER_CHART',
      marketSymbol: symbol,
      debug
    },
    tradingDate
  };
}

async function fetchYahooChartForSymbol(stockCode, symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 StockInvestor/1.0',
      accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo chart HTTP ${response.status}`);
  }

  const json = await response.json();
  return mapYahooChartQuote(stockCode, symbol, json);
}

async function fetchYahooQuotesByChart(codes) {
  const items = [];
  const dates = [];
  const missingCodes = [];

  for (const stockCode of codes) {
    const candidates = buildCandidateSymbols(stockCode);
    let resolved = null;

    for (const symbol of candidates) {
      try {
        const result = await fetchYahooChartForSymbol(stockCode, symbol);
        if (result?.item) {
          resolved = result;
          break;
        }
      } catch (error) {
        // Try next candidate symbol.
      }
    }

    if (resolved?.item) {
      items.push(resolved.item);
      if (resolved.tradingDate) {
        dates.push(resolved.tradingDate);
      }
    } else {
      missingCodes.push(stockCode);
    }
  }

  return {
    tradingDate: dates.sort().slice(-1)[0] || null,
    items,
    missingCodes,
    provider: 'YAHOO_V8_CHART'
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname !== '/api/quotes') {
      return jsonResponse({
        ok: true,
        message: 'StockInvestor Yahoo proxy is running.'
      });
    }

    const rawCodes = url.searchParams.get('codes') || '';
    const codes = rawCodes
      .split(',')
      .map(normalizeStockCode)
      .filter((code, index, array) => isValidStockCode(code) && array.indexOf(code) === index);

    if (codes.length === 0) {
      return jsonResponse({
        ok: false,
        message: '請在 query string 傳入 codes=2330,8299'
      }, { status: 400 });
    }

    try {
      let result;
      const chineseNameMap = await fetchChineseNameMap();

      try {
        result = await fetchYahooQuotes(codes);
      } catch (error) {
        if (!/Yahoo HTTP 401/.test(String(error?.message || ''))) {
          throw error;
        }

        result = await fetchYahooQuotesByChart(codes);
      }

      result.items = await enrichItemsWithChineseNames(result.items, chineseNameMap);

      return jsonResponse({
        ok: true,
        ...result
      });
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error?.message || 'Yahoo proxy failed'
      }, { status: 502 });
    }
  }
};
