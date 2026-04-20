/**
 * Cloudflare Worker — Proxy de Cotações (Yahoo Finance)
 * Versão 2.1 — fallbacks extra para tickers difíceis
 */

const CACHE_TTL = 300; // 5 minutos

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

function normCcy(price, ccy) {
  // Normalise subunit currencies (GBp=pence, not pounds)
  if (ccy === "GBp" || ccy === "GBX") return { price: price / 100, ccy: "GBP" };
  return { price, ccy: ccy || "USD" };
}

async function fetchYahooQuote(ticker, ctx) {
  const cacheKey = `quote2:${ticker.toUpperCase()}`;
  const cache = caches.default;
  const cacheUrl = `https://cache.internal/${cacheKey}`;

  const cached = await cache.match(cacheUrl);
  if (cached) {
    const data = await cached.json();
    data._cached = true;
    return data;
  }

  // Primary: v7 — returns sector, country, industry, exchange
  const v7url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
  let resp;
  try {
    resp = await fetch(v7url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
  } catch(e) { resp = null; }

  if (resp && resp.ok) {
    const d = await resp.json();
    const q = d?.quoteResponse?.result?.[0];
    if (q && q.regularMarketPrice) {
      const { price, ccy } = normCcy(q.regularMarketPrice, q.currency);
      const result = {
        ticker: ticker.toUpperCase(),
        price,
        currency: ccy,
        name: q.shortName || q.longName || ticker,
        change_pct: q.regularMarketChangePercent || 0,
        sector: q.sector || "",
        industry: q.industry || "",
        country: q.country || "",
        exchange: q.exchange || q.fullExchangeName || "",
        quote_type: q.quoteType || "",
        updated: new Date().toISOString(),
      };
      if (!Number.isFinite(result.price) || result.price <= 0)
        throw new Error(`Preço inválido para ${ticker}`);
      ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
      })));
      return result;
    }
  }

  // Fallback: v8 chart API
  const v8url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    resp = await fetch(v8url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: false },
    });
  } catch(e) { throw new Error(`Falha de rede: ${e.message}`); }

  if (resp && resp.ok) {
    const json = await resp.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta) {
      const { price, ccy } = normCcy(meta.regularMarketPrice || meta.previousClose, meta.currency);
      const result = {
        ticker: ticker.toUpperCase(),
        price,
        currency: ccy,
        name: meta.shortName || meta.symbol || ticker,
        change_pct: meta.regularMarketPrice && meta.previousClose
          ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0,
        sector: "",
        industry: "",
        country: "",
        exchange: meta.exchangeName || "",
        quote_type: meta.instrumentType || "",
        updated: new Date().toISOString(),
      };

      if (Number.isFinite(result.price) && result.price > 0) {
        ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` }
        })));
        return result;
      }
    }
  }

  // Extra fallback: quoteSummary price module (alguns tickers europeus só respondem aqui)
  const qsUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`;
  try {
    const qsResp = await fetch(qsUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (qsResp.ok) {
      const qsJson = await qsResp.json();
      const priceNode = qsJson?.quoteSummary?.result?.[0]?.price;
      const rawPrice = priceNode?.regularMarketPrice?.raw ?? priceNode?.regularMarketPreviousClose?.raw;
      if (Number.isFinite(rawPrice) && rawPrice > 0) {
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
    }
  } catch (_) {}

  throw new Error(`Sem dados para ${ticker}`);
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
          service: "Património Familiar — Quote Proxy v2",
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
