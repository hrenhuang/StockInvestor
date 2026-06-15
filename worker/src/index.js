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

  return {
    item: {
      stockCode,
      stockName: String(meta.instrumentType || stockCode).trim() === stockCode
        ? stockCode
        : String(meta.shortName || meta.longName || stockCode).trim(),
      closePrice,
      change,
      source: 'YAHOO_WORKER_CHART',
      marketSymbol: symbol
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

      try {
        result = await fetchYahooQuotes(codes);
      } catch (error) {
        if (!/Yahoo HTTP 401/.test(String(error?.message || ''))) {
          throw error;
        }

        result = await fetchYahooQuotesByChart(codes);
      }

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
