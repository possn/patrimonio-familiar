/**
 * Cloudflare Worker — Proxy de Cotações (Yahoo Finance)
 * Versão 3.0 — aliases canónicos + fallbacks mais tolerantes
 */

const CACHE_TTL = 300; // 5 minutos

const TICKER_ALIASES = {
  "MPW.US": "MPW",
  "MPW": "MPW",
  "UNA": "UNA.AS",
  "UNA.L": "UNA.AS",
  "UNA.DE": "UNA.AS",
  "UNA.PA": "UNA.AS",
  "UNA.AS": "UNA.AS",
  "UNA.MC": "UNA.AS",
  "UNA.MI": "UNA.AS",
  "UNA.TO": "UNA.AS",
  "CRSP.SW": "CRSP",
  "CRSP": "CRSP",
};

function corsHeaders(origin) {
  const allowed = !origin || origin.includes("github.io") ||
    origin.includes("pages.dev") || origin.includes("localhost");
  return {
    "Access-Control-Allow-Origin": allowed ? (origin || "*") : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function normalizeInputTicker(raw) {
  const t = String(raw || "").trim().toUpperCase();
  return TICKER_ALIASES[t] || t;
}

function normCcy(price, ccy) {
  if (ccy === "GBp" || ccy === "GBX") return { price: price / 100, ccy: "GBP" };
  return { price, ccy: ccy || "USD" };
}

function firstFinite(...vals) {
  for (const v of vals) {
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`Yahoo Finance: HTTP ${resp.status} para ${url.split('/').pop().split('?')[0] || url}`);
  return resp.json();
}

async function fetchYahooQuoteCore(ticker, ctx) {
  const cacheKey = `quote3:${ticker.toUpperCase()}`;
  const cache = caches.default;
  const cacheUrl = `https://cache.internal/${cacheKey}`;

  const cached = await cache.match(cacheUrl);
  if (cached) {
    const data = await cached.json();
    data._cached = true;
    return data;
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9"
  };

  // 1) v7 quote API
  try {
    const d = await fetchJSON(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`, { headers });
    const q = d?.quoteResponse?.result?.[0];
    if (q) {
      const rawPrice = firstFinite(
        q.regularMarketPrice,
        q.postMarketPrice,
        q.preMarketPrice,
        q.regularMarketPreviousClose,
        q.regularMarketOpen,
        q.bid,
        q.ask
      );
      if (rawPrice) {
        const { price, ccy } = normCcy(rawPrice, q.currency);
        const result = {
          ticker: ticker.toUpperCase(),
          price,
          currency: ccy,
          name: q.shortName || q.longName || ticker,
          change_pct: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : 0,
          sector: q.sector || "",
          industry: q.industry || "",
          country: q.country || "",
          exchange: q.exchange || q.fullExchangeName || "",
          quote_type: q.quoteType || "",
          updated: new Date().toISOString(),
        };
        ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
        })));
        return result;
      }
    }
  } catch (_) {}

  // 2) v8 chart API
  try {
    const json = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, {
      headers,
      cf: { cacheTtl: CACHE_TTL, cacheEverything: false },
    });
    const result0 = json?.chart?.result?.[0];
    const meta = result0?.meta;
    const closes = result0?.indicators?.quote?.[0]?.close || [];
    const lastClose = [...closes].reverse().find(v => Number.isFinite(v) && v > 0);
    const rawPrice = firstFinite(meta?.regularMarketPrice, meta?.previousClose, lastClose);
    if (meta && rawPrice) {
      const { price, ccy } = normCcy(rawPrice, meta.currency);
      const result = {
        ticker: ticker.toUpperCase(),
        price,
        currency: ccy,
        name: meta.shortName || meta.symbol || ticker,
        change_pct: (Number.isFinite(meta.regularMarketPrice) && Number.isFinite(meta.previousClose) && meta.previousClose > 0)
          ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0,
        sector: "",
        industry: "",
        country: "",
        exchange: meta.exchangeName || "",
        quote_type: meta.instrumentType || "",
        updated: new Date().toISOString(),
      };
      ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
      })));
      return result;
    }
  } catch (_) {}

  // 3) quoteSummary price module
  try {
    const qsJson = await fetchJSON(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`, { headers });
    const priceNode = qsJson?.quoteSummary?.result?.[0]?.price;
    const rawPrice = firstFinite(
      priceNode?.regularMarketPrice?.raw,
      priceNode?.regularMarketPreviousClose?.raw,
      priceNode?.postMarketPrice?.raw,
      priceNode?.preMarketPrice?.raw
    );
    if (rawPrice) {
      const { price, ccy } = normCcy(rawPrice, priceNode?.currency);
      const result = {
        ticker: ticker.toUpperCase(),
        price,
        currency: ccy,
        name: priceNode?.shortName || priceNode?.longName || ticker,
        change_pct: Number.isFinite(priceNode?.regularMarketChangePercent?.raw) ? priceNode.regularMarketChangePercent.raw : 0,
        sector: "",
        industry: "",
        country: "",
        exchange: priceNode?.exchangeName || priceNode?.exchange || "",
        quote_type: priceNode?.quoteType || "",
        updated: new Date().toISOString(),
      };
      ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
      })));
      return result;
    }
  } catch (_) {}

  // 4) spark API
  try {
    const spark = await fetchJSON(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(ticker)}&range=1d&interval=1d`, { headers });
    const node = spark?.spark?.result?.[0]?.response?.[0];
    const meta = node?.meta || {};
    const closes = node?.indicators?.quote?.[0]?.close || [];
    const lastClose = [...closes].reverse().find(v => Number.isFinite(v) && v > 0);
    const rawPrice = firstFinite(meta.regularMarketPrice, meta.previousClose, lastClose);
    if (rawPrice) {
      const { price, ccy } = normCcy(rawPrice, meta.currency);
      const result = {
        ticker: ticker.toUpperCase(),
        price,
        currency: ccy,
        name: meta.shortName || meta.symbol || ticker,
        change_pct: 0,
        sector: "",
        industry: "",
        country: "",
        exchange: meta.exchangeName || "",
        quote_type: meta.instrumentType || "",
        updated: new Date().toISOString(),
      };
      ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
      })));
      return result;
    }
  } catch (_) {}

  throw new Error(`Sem dados para ${ticker}`);
}

async function fetchYahooQuote(ticker, ctx) {
  const canonical = normalizeInputTicker(ticker);
  const candidates = [...new Set([canonical, String(ticker || "").trim().toUpperCase()].filter(Boolean))];
  let lastErr = null;
  for (const tk of candidates) {
    try {
      return await fetchYahooQuoteCore(tk, ctx);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Sem dados para ${canonical || ticker}`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET")
      return new Response(JSON.stringify({ error: "Método não suportado" }),
        { status: 405, headers: { ...cors, "Content-Type": "application/json" } });

    try {
      if (url.pathname === "/quote") {
        const ticker = url.searchParams.get("ticker");
        if (!ticker) return new Response(JSON.stringify({ error: "ticker obrigatório" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const data = await fetchYahooQuote(ticker.trim().toUpperCase(), ctx);
        return new Response(JSON.stringify(data),
          { headers: { ...cors, "Content-Type": "application/json" } });
      }

      if (url.pathname === "/quotes") {
        const tickers = (url.searchParams.get("tickers") || "")
          .split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);
        if (!tickers.length) return new Response(JSON.stringify({ error: "tickers obrigatório" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const results = await Promise.allSettled(tickers.map(t => fetchYahooQuote(t, ctx)));
        const out = {};
        results.forEach((r, i) => {
          out[tickers[i]] = r.status === "fulfilled" ? r.value
            : { ticker: tickers[i], error: r.reason?.message || "Erro" };
        });
        return new Response(JSON.stringify(out),
          { headers: { ...cors, "Content-Type": "application/json" } });
      }

      if (url.pathname === "/" || url.pathname === "") {
        return new Response(JSON.stringify({
          service: "Património Familiar — Quote Proxy v3",
          endpoints: ["/quote?ticker=VWCE.DE", "/quotes?tickers=VWCE.DE,IWDA.L"]
        }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Endpoint não encontrado" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    } catch(e) {
      return new Response(JSON.stringify({ error: e.message || "Erro interno" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
