/**
 * Cloudflare Worker — Proxy de Cotações (Yahoo Finance)
 * ======================================================
 * Repositório: deploy este ficheiro no Cloudflare Workers
 *
 * DEPLOY RÁPIDO:
 *   1. Vai a https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Cola este código e clica em Deploy
 *   3. Copia o URL (ex: https://patrimonio-quotes.SEU-NOME.workers.dev)
 *   4. Cola-o nas Definições da app (Settings → Worker URL)
 *
 * ENDPOINTS:
 *   GET /quote?ticker=VWCE.DE          → preço único
 *   GET /quotes?tickers=VWCE.DE,IWDA.L → múltiplos preços (separados por vírgula)
 *
 * RESPOSTA:
 *   { ticker, price, currency, name, change_pct, updated }
 *
 * RATE LIMITS: Yahoo Finance permite ~2000 pedidos/hora por IP.
 * O Worker usa cache de 5 minutos para reduzir pedidos.
 */

const CACHE_TTL = 300; // segundos (5 minutos)

// Origens permitidas — adiciona o teu domínio GitHub Pages aqui
const ALLOWED_ORIGINS = [
  "https://localhost",
  "http://localhost",
  // Adiciona o teu domínio:
  // "https://SEU-UTILIZADOR.github.io",
];

function corsHeaders(origin) {
  const allowed =
    !origin ||
    ALLOWED_ORIGINS.some((o) => origin.startsWith(o)) ||
    origin.includes("github.io") ||
    origin.includes("pages.dev") ||
    origin.includes("localhost");

  return {
    "Access-Control-Allow-Origin": allowed ? (origin || "*") : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

async function fetchYahooQuote(ticker, ctx) {
  const cacheKey = `quote:${ticker.toUpperCase()}`;
  const cache = caches.default;

  // Check Cloudflare cache
  const cacheUrl = `https://cache.internal/${cacheKey}`;
  const cached = await cache.match(cacheUrl);
  if (cached) {
    const data = await cached.json();
    data._cached = true;
    return data;
  }

  // Fetch from Yahoo Finance v8 API
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: false },
    });
  } catch (e) {
    throw new Error(`Falha de rede: ${e.message}`);
  }

  if (!resp.ok) {
    // Try v7 fallback
    const url2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
    resp = await fetch(url2, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!resp.ok) throw new Error(`Yahoo Finance: HTTP ${resp.status} para ${ticker}`);

    const d2 = await resp.json();
    const q = d2?.quoteResponse?.result?.[0];
    if (!q) throw new Error(`Ticker não encontrado: ${ticker}`);

    let _p2 = q.regularMarketPrice;
    let _c2 = q.currency || "USD";
    if (_c2 === "GBp" || _c2 === "GBX") { _p2 /= 100; _c2 = "GBP"; }

    const result = {
      ticker: ticker.toUpperCase(),
      price: _p2,
      currency: _c2,
      name: q.shortName || q.longName || ticker,
      change_pct: q.regularMarketChangePercent || 0,
      updated: new Date().toISOString(),
    };

    // Store in cache
    ctx.waitUntil(
      cache.put(
        cacheUrl,
        new Response(JSON.stringify(result), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_TTL}`,
          },
        })
      )
    );
    return result;
  }

  const json = await resp.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Sem dados para ${ticker}`);

  // Normalise subunit currencies: Yahoo quotes UK stocks in GBp (pence), not GBP
  let _price = meta.regularMarketPrice || meta.previousClose;
  let _ccy   = meta.currency || "USD";
  if (_ccy === "GBp" || _ccy === "GBX") { _price /= 100; _ccy = "GBP"; }

  const result = {
    ticker: ticker.toUpperCase(),
    price: _price,
    currency: _ccy,
    name: meta.shortName || meta.symbol || ticker,
    change_pct:
      meta.regularMarketPrice && meta.previousClose
        ? ((meta.regularMarketPrice - meta.previousClose) /
            meta.previousClose) *
          100
        : 0,
    updated: new Date().toISOString(),
  };

  if (!Number.isFinite(result.price) || result.price <= 0) {
    throw new Error(`Preço inválido para ${ticker}: ${result.price}`);
  }

  // Cache the result
  ctx.waitUntil(
    cache.put(
      cacheUrl,
      new Response(JSON.stringify(result), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
        },
      })
    )
  );

  return result;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Método não suportado" }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    try {
      // GET /quote?ticker=VWCE.DE
      if (url.pathname === "/quote") {
        const ticker = url.searchParams.get("ticker");
        if (!ticker) {
          return new Response(
            JSON.stringify({ error: "Parâmetro 'ticker' obrigatório" }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
        const data = await fetchYahooQuote(ticker.trim().toUpperCase(), ctx);
        return new Response(JSON.stringify(data), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // GET /quotes?tickers=VWCE.DE,IWDA.L,AAPL
      if (url.pathname === "/quotes") {
        const tickersParam = url.searchParams.get("tickers") || "";
        const tickers = tickersParam
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 20); // max 20 tickers por pedido

        if (!tickers.length) {
          return new Response(
            JSON.stringify({ error: "Parâmetro 'tickers' obrigatório" }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }

        const results = await Promise.allSettled(
          tickers.map((t) => fetchYahooQuote(t, ctx))
        );

        const out = {};
        results.forEach((r, i) => {
          out[tickers[i]] =
            r.status === "fulfilled"
              ? r.value
              : { ticker: tickers[i], error: r.reason?.message || "Erro" };
        });

        return new Response(JSON.stringify(out), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // GET / — health check / info
      if (url.pathname === "/" || url.pathname === "") {
        return new Response(
          JSON.stringify({
            service: "Patrimônio Familiar — Quote Proxy",
            version: "1.0",
            endpoints: [
              "/quote?ticker=VWCE.DE",
              "/quotes?tickers=VWCE.DE,IWDA.L,AAPL",
            ],
            cache_ttl_seconds: CACHE_TTL,
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: "Endpoint não encontrado" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message || "Erro interno" }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }
  },
};
