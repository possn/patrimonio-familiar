/* Património Familiar — v8 FINAL
   + Objetivo de rendimento passivo com barra de progresso
   + Alertas de vencimentos próximos (30 dias)
   + Editar/apagar movimentos de cashflow
   + Categorias de despesa com gráfico de pizza
   + Taxa de poupança mensal com barra visual
   + Pesquisa global (ativos, movimentos, dividendos)
*/
"use strict";

/* ─── PWA ─────────────────────────────────────────────────── */
try {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js?v=20260503").catch(() => {});
    });
  }
} catch (_) {}

/* ─── UTILS ───────────────────────────────────────────────── */
const normStr = (s) => String(s || "")
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ").trim();

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g,
    c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }

function isoToday() { return new Date().toISOString().slice(0, 10); }

function safeClone(obj) {
  try { if (typeof structuredClone === "function") return structuredClone(obj); } catch (_) {}
  return JSON.parse(JSON.stringify(obj));
}

function parseNum(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  let s = String(x).trim().replace(/\u00A0/g, " ").replace(/\s+/g, " ");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  let t = s.replace(/[^0-9,.\-]+/g, "").replace(/\s/g, "");
  const hasComma = t.includes(","), hasDot = t.includes(".");
  if (hasComma && hasDot) {
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g,"").replace(/,/g,".");
    else t = t.replace(/,/g,"");
  } else if (hasComma && !hasDot) {
    t = /,[0-9]{1,2}$/.test(t) ? t.replace(/,/g,".") : t.replace(/,/g,"");
  } else if (!hasComma && hasDot) {
    const parts = t.split(".");
    if (parts.length > 2 && !/\.[0-9]{1,2}$/.test(t)) t = t.replace(/\./g,"");
  }
  const n = Number(t);
  return neg ? -(Number.isFinite(n) ? n : 0) : (Number.isFinite(n) ? n : 0);
}

function fmtEUR(n) {
  const cur = (state.settings && state.settings.currency) || "EUR";
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);
  } catch { return Math.round(v) + " " + cur; }
}

function fmtEUR2(n) {
  const cur = (state.settings && state.settings.currency) || "EUR";
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(v);
  } catch { return v.toFixed(2) + " " + cur; }
}

function fmt(n, maxFrac = 4) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 }).format(v);
}

function fmtPct(n) { return fmt(n, 2) + "%"; }

function normalizeDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[\/\-\.]/).filter(Boolean);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (c > 1000) return `${c}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}`;
    if (a > 1000) return `${a}-${String(b).padStart(2,"0")}-${String(c).padStart(2,"0")}`;
  }
  return null;
}

function normalizeClassName(s) {
  const map = {
    "stock":"Ações/ETFs","etf":"Ações/ETFs","equity":"Ações/ETFs","fund":"Fundos",
    "crypto":"Cripto","gold":"Ouro","silver":"Prata","real estate":"Imobiliário",
    "deposit":"Depósitos","cash":"Liquidez","ppr":"PPR","debt":"Dívida"
  };
  const n = normStr(s || "");
  for (const [k,v] of Object.entries(map)) { if (n.includes(k)) return v; }
  return s || "Outros";
}

function normalizeYieldType(s) {
  const n = normStr(s || "");
  if (n.includes("pct") || n.includes("%") || n.includes("percent")) return "yield_pct";
  if (n.includes("eur") || n.includes("year") || n.includes("annual")) return "yield_eur_year";
  if (n.includes("rent") || n.includes("month")) return "rent_month";
  return "none";
}

/* ─── INFO TIPS (explicações contextuais) ─────────────────── */
const TIPS = {
  compound: {
    title: "O que é o Juro Composto?",
    body: `O juro composto é o fenómeno em que os juros gerados também geram juros.<br><br>
<b>Exemplo:</b> 10.000€ a 5%/ano:<br>
• Juro simples: +500€/ano → 15.000€ em 10 anos<br>
• Juro composto: +500€ no ano 1, +525€ no ano 2… → 16.289€ em 10 anos<br><br>
A diferença cresce exponencialmente com o tempo — por isso Einstein terá dito que o juro composto é "a oitava maravilha do mundo".`
  },
  yieldPct: {
    title: "O que é o Yield?",
    body: `O <b>yield</b> (rendimento) é a percentagem de retorno anual de um ativo.<br><br>
<b>Exemplos:</b><br>
• ETF VWCE: yield dividendo ≈ 1.5–2%/ano<br>
• Certificados de aforro: taxa fixa definida pelo Estado<br>
• Depósito a prazo: taxa acordada com o banco<br>
• Imobiliário: renda mensal / valor do imóvel × 12<br><br>
Na app, o yield ponderado da carteira é calculado automaticamente com base nos yields individuais de cada ativo.`
  },
  passiveIncome: {
    title: "Rendimento Passivo",
    body: `O <b>rendimento passivo</b> é o dinheiro que a tua carteira gera automaticamente, sem trabalho ativo.<br><br>
<b>Fontes:</b><br>
• Dividendos de ações/ETFs<br>
• Juros de depósitos e obrigações<br>
• Rendas de imóveis<br>
• Juros de PPR e fundos<br><br>
A app calcula dois valores:<br>
• <b>Teórico</b>: baseado nos yields que introduziste<br>
• <b>Real</b>: baseado nos dividendos que registaste (mais preciso)`
  },
  fire: {
    title: "O que é FIRE?",
    body: `<b>FIRE</b> = Financial Independence, Retire Early.<br><br>
O objetivo é acumular capital suficiente para que os rendimentos passivos cubram as despesas, tornando o trabalho opcional.<br><br>
<b>Regra dos 4% (SWR):</b><br>
Se retirares 4% do teu portfólio por ano, historicamente o capital dura mais de 30 anos. Isso significa que precisas de 25× as tuas despesas anuais.<br><br>
<b>Exemplo:</b> Despesas de 2.000€/mês = 24.000€/ano → precisas de 600.000€ investidos.`
  },
  weightedYield: {
    title: "Yield Médio Ponderado",
    body: `O <b>yield médio ponderado</b> é a taxa de retorno média da carteira, tendo em conta o peso de cada ativo.<br><br>
<b>Exemplo:</b><br>
• 80.000€ em ETFs com 5% → contribui 4.000€/ano<br>
• 20.000€ em depósitos com 3% → contribui 600€/ano<br>
• Total: 100.000€ → 4.600€/ano → yield ponderado = 4,6%<br><br>
É mais preciso do que fazer a média simples dos yields porque tem em conta o tamanho de cada posição.`
  },
  savingsRate: {
    title: "Taxa de Poupança",
    body: `A <b>taxa de poupança</b> é a percentagem do rendimento que guardas (não gastas).<br><br>
<b>Fórmula:</b> (Entradas − Saídas) / Entradas × 100<br><br>
<b>Referências:</b><br>
• < 10%: baixa — difícil acumular capital<br>
• 10–20%: razoável<br>
• 20–40%: boa — acelera a independência financeira<br>
• > 50%: excelente — caminho rápido para FIRE<br><br>
Com 50% de taxa de poupança, podes reformar-te em ~17 anos (partindo do zero).`
  },
  netWorth: {
    title: "Património Líquido",
    body: `O <b>património líquido</b> (net worth) é a diferença entre tudo o que tens e tudo o que deves.<br><br>
<b>Fórmula:</b> Ativos − Passivos<br><br>
<b>Ativos:</b> imóveis, ações, depósitos, cripto, ouro…<br>
<b>Passivos:</b> crédito habitação, crédito pessoal, cartões…<br><br>
É a métrica mais importante para medir a saúde financeira. O objetivo é aumentá-lo todos os meses através de poupança e valorização dos ativos.`
  },
  diversification: {
    title: "Diversificação",
    body: `A <b>diversificação</b> consiste em distribuir o capital por diferentes tipos de ativos para reduzir o risco.<br><br>
<b>Princípio:</b> "Não coloques todos os ovos no mesmo cesto."<br><br>
<b>Dimensões de diversificação:</b><br>
• <b>Geográfica:</b> Portugal, Europa, Mundo<br>
• <b>Classe de ativo:</b> ações, obrigações, imóveis, ouro<br>
• <b>Moeda:</b> EUR, USD, GBP<br>
• <b>Temporal:</b> investir regularmente (DCA)<br><br>
Um ETF global (ex: VWCE) oferece diversificação em mais de 3.000 empresas de uma vez.`
  },
  dividends: {
    title: "Dividendos YTD",
    body: `Os <b>dividendos</b> são pagamentos em dinheiro feitos pelas empresas aos seus acionistas, normalmente trimestrais ou anuais.<br><br>
<b>YTD</b> (Year To Date) = total recebido desde o início do ano corrente.<br><br>
<b>Como registar:</b><br>
• Vai ao separador <b>Divid.</b> e usa o botão +<br>
• Ou importa o extrato da corretora (CSV/Excel)<br><br>
O valor mostrado aqui é o líquido (já descontada a retenção na fonte).`
  },
  divSummary: {
    title: "Resumo Anual de Dividendos",
    body: `O <b>resumo anual</b> permite introduzir os totais de dividendos do ano diretamente — útil se tens o extrato anual da corretora.<br><br>
<b>Campos:</b><br>
• <b>Bruto:</b> total recebido antes de impostos<br>
• <b>Retenção:</b> imposto retido na fonte pela corretora<br>
• <b>Líquido:</b> o que efectivamente recebeste (Bruto − Retenção)<br>
• <b>Yield:</b> dividendos / valor da carteira × 100<br><br>
Este valor é usado como fonte principal no cálculo do Rendimento Passivo.`
  },
  forecast: {
    title: "Previsão de Rentabilidade",
    body: `A <b>previsão</b> estima o valor futuro de cada ativo com base no seu yield configurado.<br><br>
<b>Como funciona:</b><br>
• Aplica o yield % de cada ativo ao seu valor actual<br>
• Projeta para o horizonte temporal escolhido<br>
• Assume reinvestimento dos rendimentos (juro composto)<br><br>
<b>Nota:</b> É uma estimativa — os retornos reais dependem das condições de mercado.`
  },
  compare: {
    title: "Comparação de Períodos",
    body: `Compara a evolução do teu património entre diferentes períodos.<br><br>
<b>MoM</b> (Month over Month): variação mês a mês<br>
<b>YoY</b> (Year over Year): variação ano a ano<br><br>
Os dados são baseados nos <b>snapshots</b> que guardas usando o botão <b>"Registar mês"</b> no Dashboard.<br><br>
Regista um snapshot no fim de cada mês para teres um historial completo.`
  }
};

function openTip(key) {
  const tip = TIPS[key];
  if (!tip) return;
  const el = document.getElementById("tipModal");
  const titleEl = document.getElementById("tipTitle");
  const bodyEl = document.getElementById("tipBody");
  if (!el || !titleEl || !bodyEl) return;
  titleEl.textContent = tip.title;
  bodyEl.innerHTML = tip.body;
  openModal("tipModal");
}

// Helper to create an info button
function infoBtn(key) {
  return `<button class="info-btn" onclick="openTip('${key}')" title="Saber mais">ℹ️</button>`;
}
function toast(msg, duration = 3000) {
  let el = document.getElementById("toastEl");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastEl";
    el.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 20px;border-radius:20px;font-weight:700;font-size:14px;z-index:999;max-width:90vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .3s";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = "0"; }, duration);
}

/* ─── PERSISTENCE (IndexedDB + localStorage fallback) ─────── */
const STORAGE_KEY = "PF_STATE_V6";
const DB_NAME = "pf_v6", DB_STORE = "kv", DB_KEY = "state";

function idbAvailable() { return typeof indexedDB !== "undefined" && indexedDB; }

function idbOpen() {
  return new Promise((res, rej) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    } catch (e) { rej(e); }
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => { db.close(); res(req.result); };
    req.onerror = () => { db.close(); rej(req.error); };
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); res(true); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}

async function idbDel(key) {
  const db = await idbOpen();
  return new Promise(res => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => { db.close(); res(true); };
    tx.onerror = () => { db.close(); res(false); };
  });
}

async function requestPersistentStorage() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
}

async function storageGet() {
  if (idbAvailable()) { try { const v = await idbGet(DB_KEY); if (v) return v; } catch (_) {} }
  try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
}

async function storageSet(raw) {
  if (idbAvailable()) { try { await idbSet(DB_KEY, raw); return; } catch (_) {} }
  try { localStorage.setItem(STORAGE_KEY, raw); } catch (_) {}
}

async function storageClear() {
  if (idbAvailable()) await idbDel(DB_KEY);
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ─── STATE ───────────────────────────────────────────────── */
const DEFAULT_STATE = {
  settings: { currency: "EUR", goalMonthly: 0 },
  assets: [],
  liabilities: [],
  transactions: [],
  dividends: [],
  divSummaries: [], // {id, year, gross, tax, yieldPct, notes}
  history: []
};

let state = safeClone(DEFAULT_STATE);
let currentView = "dashboard";
let showingLiabs = false;
let summaryExpanded = false;
let txExpanded = false;
let distDetailExpanded = false;
let editingItemId = null;
let bankCsvSelectedFile = null;

// Chart instances
let distChart = null, trendChart = null, fireChart = null, compoundChart = null, forecastChart = null, compareChart = null;

/* ─── DOM HELPER ──────────────────────────────────────────── */
const NOOP_EL = {
  _missing: true, addEventListener(){}, removeEventListener(){},
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, getAttribute(){ return null; },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  appendChild(){}, remove(){}, style: {}, value: "", checked: false,
  files: null, innerHTML: "", textContent: "", focus(){}, disabled: false
};

function $(id) { return document.getElementById(id) || NOOP_EL; }

/* ─── SAVE / LOAD ─────────────────────────────────────────── */
async function loadStateAsync() {
  try {
    const raw = await storageGet();
    if (!raw) return safeClone(DEFAULT_STATE);
    const p = JSON.parse(raw);
    return {
      settings: { currency: "EUR", goalMonthly: 0, ...( p.settings || {}) },
      assets: Array.isArray(p.assets) ? p.assets : [],
      liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
      transactions: Array.isArray(p.transactions) ? p.transactions : [],
      dividends: Array.isArray(p.dividends) ? p.dividends : [],
      divSummaries: Array.isArray(p.divSummaries) ? p.divSummaries : [],
      history: Array.isArray(p.history) ? p.history : []
    };
  } catch { return safeClone(DEFAULT_STATE); }
}

function saveState() { return storageSet(JSON.stringify(state)); }
async function saveStateAsync() { await storageSet(JSON.stringify(state)); }

/* ─── TOTALS ──────────────────────────────────────────────── */
function passiveFromItem(it) {
  const v = parseNum(it.value), yv = parseNum(it.yieldValue), yt = it.yieldType || "none";
  if (yt === "yield_pct") return v * (yv / 100);
  if (yt === "yield_eur_year") return yv;
  if (yt === "rent_month") return yv * 12;
  return 0;
}

function calcTotals() {
  const assetsTotal = state.assets.reduce((a, x) => a + parseNum(x.value), 0);
  const liabsTotal = state.liabilities.reduce((a, x) => a + parseNum(x.value), 0);
  const net = assetsTotal - liabsTotal;
  const theoreticalPassive = state.assets.reduce((a, x) => a + passiveFromItem(x), 0);

  const now = new Date();
  const currentYear = now.getFullYear();
  const cutoff12m = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0,10);

  // From annual summaries (net = gross - tax) — prefer most recent year
  const latestSummary = (state.divSummaries || [])
    .filter(s => s.year >= currentYear - 1)
    .sort((a, b) => b.year - a.year)[0];
  const summaryNet = latestSummary
    ? parseNum(latestSummary.gross) - parseNum(latestSummary.tax)
    : 0;

  // From individual dividends (last 12 months)
  const realDividends12m = (state.dividends || [])
    .filter(d => d.date >= cutoff12m)
    .reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);

  // ── Passive income calculation ────────────────────────────────────────────
  // Strategy: ADDITIVE, not MAX. Each source is counted once, no double-counting.
  //
  // 1. Deposits / PPR / Imóveis / Obrigações: use yield% configured on each asset
  //    (these never have dividend records — safe to use theoretical)
  //
  // 2. ETFs / Stocks / Funds: use REAL dividends if registered, else yield% if set
  //    (avoids double-counting: if user registered dividends AND set yield%, prefer real)
  //
  // 3. Result = sum of (1) + sum of (2)
  // ─────────────────────────────────────────────────────────────────────────

  // Only Ações/ETFs and Cripto use real dividend records as income source.
  // Fundos, Obrigações, PPR, Depósitos use their configured yield% directly.
  function isRealDivClass(a) {
    // Simple robust check — avoid fragile unicode normalization
    const cls = (a.class || "").toLowerCase()
      .replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o")
      .replace(/á|à|â|ä/g,"a").replace(/é|è|ê/g,"e").replace(/í/g,"i").replace(/ó|ô/g,"o").replace(/ú/g,"u");
    return cls === "acoes/etfs" || cls === "cripto";
  }

  // Theoretical from NON-dividend-class assets (deposits, PPR, imóveis, etc.)
  const passiveBreakdown = {};
  let passiveFromNonDiv = 0;
  for (const a of state.assets) {
    if (isRealDivClass(a)) continue; // will be covered by real dividends below
    const p = passiveFromItem(a);
    if (p <= 0) continue;
    passiveFromNonDiv += p;
    const cls = a.class || "Outros";
    passiveBreakdown[cls] = (passiveBreakdown[cls] || 0) + p;
  }

  // From ETF/stock assets: prefer real dividends (annualised) if available, else yield%
  // Annualise real dividends based on months elapsed in current year
  const monthsElapsed = Math.max(1, new Date().getMonth() + 1); // Jan=1 … Dec=12
  const realDividendsCurrentYear = (state.dividends || [])
    .filter(d => String(d.date || "").slice(0, 4) === String(new Date().getFullYear()))
    .reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);

  // Determine dividend income source (priority order):
  // 1. Annual summary (most accurate — user filled in)
  // 2. Last 12 months actual dividends (rolling, stable)
  // 3. YTD annualised (only if > 3 months data, to avoid over-projecting)
  // 4. Yield% configured on ETF/stock assets (fallback)
  let passiveFromDivAssets = 0;
  if (summaryNet > 0) {
    passiveFromDivAssets = summaryNet;
    passiveBreakdown["Dividendos (resumo anual)"] = summaryNet;
  } else if (realDividends12m > 0) {
    // Use rolling 12-month actuals — most stable estimate
    passiveFromDivAssets = realDividends12m;
    passiveBreakdown["Dividendos (últ.12m)"] = realDividends12m;
  } else if (realDividendsCurrentYear > 0 && monthsElapsed >= 3) {
    // Annualise YTD only if we have at least 3 months of data
    const annualised = realDividendsCurrentYear * (12 / monthsElapsed);
    passiveFromDivAssets = annualised;
    passiveBreakdown["Dividendos (anualizados)"] = annualised;
  } else {
    // No real dividend data — fall back to yield% on ETF/stock assets
    for (const a of state.assets) {
      if (!isRealDivClass(a)) continue;
      const p = passiveFromItem(a);
      if (p <= 0) continue;
      passiveFromDivAssets += p;
      const cls = a.class || "Outros";
      passiveBreakdown[cls] = (passiveBreakdown[cls] || 0) + p;
    }
  }

  const passiveAnnual = passiveFromNonDiv + passiveFromDivAssets;

  return { assetsTotal, liabsTotal, net, passiveAnnual, theoreticalPassive: passiveAnnual, realDividends12m, summaryNet, passiveBreakdown };
}

/* ─── COMPOUND INTEREST ENGINE ────────────────────────────── */
// Returns array of {year, value} for n years with compound interest
function compoundGrowth(principal, rateAnnual, years, freq = 12, contributions = 0) {
  const r = rateAnnual / 100;
  const result = [];
  let v = principal;
  for (let y = 0; y <= years; y++) {
    result.push({ year: y, value: v });
    // Compound once per year using the effective annual rate
    // This avoids the bug where freq=1 would apply interest 12 times
    if (freq <= 1) {
      // Annual: apply once, add annual contributions
      v = v * (1 + r) + contributions * 12;
    } else {
      // Sub-annual: apply freq times per year with monthly contributions
      for (let m = 0; m < freq; m++) {
        v = v * (1 + r / freq) + contributions * (12 / freq);
      }
    }
  }
  return result;
}

// Effective annual rate from nominal rate and frequency
function effectiveRate(nominalPct, freq) {
  const r = nominalPct / 100;
  return (Math.pow(1 + r / freq, freq) - 1) * 100;
}

/* ─── NAVIGATION ──────────────────────────────────────────── */
function setView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll(".navbtn").forEach(b => { b.classList.toggle("navbtn--active", b.dataset.view === view); });
  if (view === "dashboard") renderDashboard();
  if (view === "assets") { renderItems(); renderEquityPnL(); }
  if (view === "cashflow") renderCashflow();
  if (view === "analysis") { renderAnalysis(); }
  if (view === "dividends") renderDividends();
  if (view === "import") checkDuplicateWarning();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openModal(id) { $(id).setAttribute("aria-hidden", "false"); }
function closeModal(id) { $(id).setAttribute("aria-hidden", "true"); }

function wireModalClosers() {
  document.body.addEventListener("click", e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const close = t.getAttribute("data-close");
    if (close) closeModal(close);
  });
}

/* ─── RENDER ALL ──────────────────────────────────────────── */

/* ─── SECTOR & GEOGRAPHY CHARTS ──────────────────────────── */

const SECTOR_MAP = {
  "Technology":            "Tecnologia",
  "Financial Services":    "Financials",
  "Healthcare":            "Saúde",
  "Real Estate":           "Imobiliário",
  "Consumer Cyclical":     "Consumo Cíclico",
  "Consumer Defensive":    "Consumo Defensivo",
  "Industrials":           "Industriais",
  "Basic Materials":       "Materiais",
  "Communication Services":"Comunicação",
  "Energy":                "Energia",
  "Utilities":             "Utilities",
};

const EXCHANGE_TO_GEO = {
  // USA
  "NMS":"USA","NYQ":"USA","NGM":"USA","PCX":"USA","ASE":"USA","NCM":"USA","BTS":"USA",
  // Europe
  "GER":"Europa","FRA":"Europa","XET":"Europa","HAM":"Europa","BER":"Europa","MUN":"Europa",
  "LSE":"Europa","IOB":"Europa","ENX":"Europa","PAR":"Europa","AMS":"Europa","BRU":"Europa",
  "MIL":"Europa","MCE":"Europa","VIE":"Europa","STO":"Europa","OSL":"Europa","HEL":"Europa",
  "LIS":"Europa","WSE":"Europa","SWX":"Europa",
  // Asia/Pacific
  "TKS":"Asia","OSA":"Asia","HKG":"Asia","SHH":"Asia","SHZ":"Asia",
  "KSC":"Asia","TAI":"Asia","NSI":"Asia","BSE":"Asia",
  "ASX":"Asia/Pac","NZE":"Asia/Pac",
  // Americas (ex-USA)
  "TSX":"Canadá","MEX":"LatAm","SAO":"LatAm","BUE":"LatAm",
};

const COUNTRY_TO_GEO = {
  "United States":"USA","Canada":"Canadá",
  "United Kingdom":"Europa","Germany":"Europa","France":"Europa","Switzerland":"Europa",
  "Netherlands":"Europa","Spain":"Europa","Italy":"Europa","Belgium":"Europa",
  "Sweden":"Europa","Norway":"Europa","Denmark":"Europa","Finland":"Europa",
  "Austria":"Europa","Portugal":"Europa","Poland":"Europa","Ireland":"Europa",
  "Japan":"Asia","China":"Asia","South Korea":"Asia","Taiwan":"Asia",
  "Hong Kong":"Asia","India":"Asia","Singapore":"Asia","Australia":"Asia/Pac",
  "New Zealand":"Asia/Pac","Brazil":"LatAm","Mexico":"LatAm","Argentina":"LatAm",
};

let sectorChart = null, geoChart = null;

function classifyGeo(asset) {
  const meta = asset.meta || {};
  // 1. country field (most reliable)
  if (meta.country && COUNTRY_TO_GEO[meta.country]) return COUNTRY_TO_GEO[meta.country];
  // 2. exchange field
  const exch = (meta.exchange || "").toUpperCase();
  if (exch && EXCHANGE_TO_GEO[exch]) return EXCHANGE_TO_GEO[exch];
  // 3. ticker suffix heuristic
  const name = (asset.name || "").toUpperCase();
  if (name.endsWith(".L") || name.endsWith(".GB")) return "Europa";
  if (name.endsWith(".DE") || name.endsWith(".FR") || name.endsWith(".PA") ||
      name.endsWith(".AS") || name.endsWith(".MC") || name.endsWith(".MI") ||
      name.endsWith(".LS") || name.endsWith(".PT") || name.endsWith(".WA") ||
      name.endsWith(".SW") || name.endsWith(".CH") || name.endsWith(".CO") ||
      name.endsWith(".DK") || name.endsWith(".ST") || name.endsWith(".SE") ||
      name.endsWith(".OL") || name.endsWith(".HE") || name.endsWith(".BR")) return "Europa";
  if (name.endsWith(".TO") || name.endsWith(".CA")) return "Canadá";
  if (name.endsWith(".AX") || name.endsWith(".AU")) return "Asia/Pac";
  if (name.endsWith("-USD") || name.endsWith(".CC")) return "Cripto";
  // 4. quoteType
  if (meta.quoteType === "CRYPTOCURRENCY") return "Cripto";
  // 5. Default: if no suffix and no data, likely US
  if (!name.includes(".")) return "USA";
  return "Outros";
}

function classifySector(asset) {
  const meta = asset.meta || {};
  // Crypto
  const name = (asset.name || "").toUpperCase();
  if ((name.endsWith("-USD") && !name.includes(".")) || name.endsWith(".CC") ||
      meta.quoteType === "CRYPTOCURRENCY") return "Cripto";
  // ETF — no sector from Yahoo; classify by name/exchange
  if (meta.quoteType === "ETF" || meta.quoteType === "MUTUALFUND") return "ETF / Fundo";
  // Mapped sector
  if (meta.sector && SECTOR_MAP[meta.sector]) return SECTOR_MAP[meta.sector];
  if (meta.sector) return meta.sector; // unmapped sector, use as-is
  // No metadata yet — show as "Sem dados (⟳)"
  return null;
}

function renderSectorChart() {
  const ctx = document.getElementById("sectorChart");
  if (!ctx) return;

  const EQUITY_CLASSES = ["Ações/ETFs","Cripto"];
  const assets = state.assets.filter(a => EQUITY_CLASSES.includes(a.class) && parseNum(a.value) > 0);

  const by = {};
  let noData = 0;
  for (const a of assets) {
    const s = classifySector(a);
    if (!s) { noData += parseNum(a.value); continue; }
    by[s] = (by[s] || 0) + parseNum(a.value);
  }
  if (noData > 0) by["Sem dados (⟳)"] = noData;

  const labels = Object.keys(by).sort((a,b) => by[b]-by[a]);
  const values = labels.map(k => by[k]);
  const total  = values.reduce((a,b) => a+b, 0);

  const PALETTE = ["#5b5ce6","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
                   "#ec4899","#06b6d4","#84cc16","#f97316","#64748b","#0ea5e9",
                   "#a855f7","#14b8a6"];

  if (sectorChart) sectorChart.destroy();
  sectorChart = new Chart(ctx.getContext("2d"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(total>0?c.raw/total*100:0)})` } }
      }
    }
  });

  // Update count label
  const lbl = document.getElementById("sectorChartLabel");
  if (lbl) lbl.textContent = `${assets.length} activos · ${labels.length} sectores`;
}

function renderGeoChart() {
  const ctx = document.getElementById("geoChart");
  if (!ctx) return;

  const EQUITY_CLASSES = ["Ações/ETFs","Cripto"];
  const assets = state.assets.filter(a => EQUITY_CLASSES.includes(a.class) && parseNum(a.value) > 0);

  const by = {};
  for (const a of assets) {
    const g = classifyGeo(a);
    by[g] = (by[g] || 0) + parseNum(a.value);
  }

  const GEO_COLORS = {
    "USA":"#3b82f6","Europa":"#10b981","Asia":"#f59e0b","Asia/Pac":"#f97316",
    "Canadá":"#8b5cf6","LatAm":"#ef4444","Cripto":"#64748b","Outros":"#94a3b8"
  };

  const labels = Object.keys(by).sort((a,b) => by[b]-by[a]);
  const values = labels.map(k => by[k]);
  const colors = labels.map(k => GEO_COLORS[k] || "#94a3b8");
  const total  = values.reduce((a,b) => a+b, 0);

  if (geoChart) geoChart.destroy();
  geoChart = new Chart(ctx.getContext("2d"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(total>0?c.raw/total*100:0)})` } }
      }
    }
  });

  const lbl = document.getElementById("geoChartLabel");
  if (lbl) lbl.textContent = `${assets.length} activos · ${labels.length} regiões`;
}

function renderAll() {
  renderDashboard();
  renderItems();
  renderCashflow();
  renderDividends();
  updatePassiveBar();
  if (currentView === "analysis") { renderSectorChart(); renderGeoChart(); }
}

/* ─── DASHBOARD ───────────────────────────────────────────── */
function updatePassiveBar() {
  const t = calcTotals();
  const barA = document.getElementById("barPassiveAnnual");
  const barM = document.getElementById("barPassiveMonthly");
  if (barA) barA.textContent = fmtEUR(t.passiveAnnual);
  if (barM) barM.textContent = fmtEUR(t.passiveAnnual / 12);
}

/* ─── 1. OBJETIVO DE RENDIMENTO PASSIVO ───────────────────── */
function renderGoal() {
  const goal = parseNum(state.settings.goalMonthly || 0);
  const t = calcTotals();
  const monthly = t.passiveAnnual / 12;
  const subtitle = $("goalSubtitle");
  const wrap = $("goalProgressWrap");
  const fill = $("goalProgressFill");
  const cur = $("goalCurrent");
  const tgt = $("goalTarget");

  if (!goal) {
    if (subtitle) subtitle.textContent = "Define um objetivo mensal de rendimento passivo";
    if (wrap) wrap.style.display = "none";
    return;
  }
  const pct = Math.min(100, (monthly / goal) * 100);
  const done = monthly >= goal;
  if (subtitle) subtitle.textContent = done ? "🎯 Objetivo atingido!" : `${fmtPct(pct)} do objetivo`;
  if (wrap) wrap.style.display = "";
  if (fill) {
    fill.style.width = pct + "%";
    fill.style.background = done ? "#10b981" : "#5b5ce6";
  }
  if (cur) cur.textContent = `${fmtEUR(monthly)}/mês atual`;
  if (tgt) tgt.textContent = `Objetivo: ${fmtEUR(goal)}/mês`;

  // Breakdown: where does the passive income come from?
  const breakEl = document.getElementById("goalBreakdown");
  if (breakEl && t.passiveBreakdown) {
    const entries = Object.entries(t.passiveBreakdown).sort((a,b) => b[1]-a[1]);
    let html = entries.map(([cls, v]) => `${escapeHtml(cls)}: <b>${fmtEUR(v)}</b>`).join(" &nbsp;·&nbsp; ");
    if (t.realDividends12m > 0) {
      html += ` &nbsp;·&nbsp; <span style="color:#059669">Dividendos: <b>${fmtEUR(t.realDividends12m)}</b>/ano</span>`;
    }
    if (html) {
      const totalShown = entries.reduce((s,[,v])=>s+v,0) + (t.realDividends12m > 0 && !entries.find(([k])=>k.includes("Dividendo")) ? t.realDividends12m : 0);
      html += ` &nbsp;·&nbsp; <b>Total: ${fmtEUR(t.passiveAnnual)}/ano</b>`;
    }
    breakEl.innerHTML = html;
    breakEl.style.display = html ? "" : "none";
  }

  // update settings input
  const si = $("settingsGoal");
  if (si && !si.value) si.value = String(goal);
}

function saveGoal(val) {
  const n = parseNum(val);
  if (n < 0) { toast("Valor inválido."); return; }
  state.settings.goalMonthly = n;
  saveState();
  renderGoal();
  closeModal("modalGoal");
  toast(n > 0 ? `Objetivo definido: ${fmtEUR(n)}/mês` : "Objetivo removido.");
}

/* ─── 2. ALERTAS DE VENCIMENTOS ──────────────────────────── */
function renderAlerts() {
  const card = document.getElementById("alertsCard");
  const list = document.getElementById("alertsList");
  if (!card || !list) return;

  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 30);
  const todayISO = today.toISOString().slice(0, 10);
  const soonISO = soon.toISOString().slice(0, 10);

  const alerts = state.assets.filter(a => {
    const m = a.maturityDate;
    return m && m >= todayISO && m <= soonISO;
  }).sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

  if (!alerts.length) { card.style.display = "none"; return; }
  card.style.display = "";
  const cardEl = card.querySelector(".card");
  if (cardEl) { cardEl.style.borderColor = "#f59e0b"; cardEl.style.background = "#fffbeb"; }
  const title = card.querySelector(".card__title");
  if (title) title.textContent = "⚠️ Vencimentos próximos";
  list.innerHTML = alerts.map(a => {
    const days = Math.round((new Date(a.maturityDate) - today) / 86400000);
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(a.name)}</div>
        <div class="item__s">${escapeHtml(a.class)} · Vence em ${days} dia${days !== 1 ? "s" : ""} (${a.maturityDate})</div>
      </div>
      <div class="item__v">${fmtEUR(parseNum(a.value))}</div>
    </div>`;
  }).join("");
}

/* ─── 3. EDITAR / APAGAR MOVIMENTOS ──────────────────────── */
let editingTxId = null;

function openTxModal(txId) {
  editingTxId = txId || null;
  const existing = txId ? state.transactions.find(t => t.id === txId) : null;
  const titleEl = $("modalTxTitle");
  const delBtn = $("btnDeleteTx");

  if (existing) {
    if (titleEl) titleEl.textContent = "Editar movimento";
    if (delBtn) delBtn.style.display = "";
    $("tType").value = existing.type || "in";
    $("tCat").value = existing.category || "";
    $("tAmt").value = String(parseNum(existing.amount));
    $("tDate").value = existing.date || isoToday();
    $("tRec").value = existing.recurring || "none";
    $("tNotes").value = existing.notes || "";
  } else {
    if (titleEl) titleEl.textContent = "Adicionar movimento";
    if (delBtn) delBtn.style.display = "none";
    $("tType").value = "in";
    $("tCat").value = "";
    $("tAmt").value = "";
    $("tDate").value = isoToday();
    $("tRec").value = "none";
    $("tNotes").value = "";
  }
  openModal("modalTx");
}

function saveTxFromModal() {
  const type = $("tType").value;
  const category = ($("tCat").value || "").trim() || "Outros";
  const amount = parseNum($("tAmt").value);
  const date = $("tDate").value;
  const recurring = $("tRec").value || "none";
  const notes = ($("tNotes").value || "").trim();
  if (!amount || amount <= 0) { toast("Valor tem de ser > 0."); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Data inválida."); return; }
  const obj = { id: editingTxId || uid(), type, category, amount, date, recurring, notes };
  const ix = state.transactions.findIndex(t => t.id === obj.id);
  if (ix >= 0) state.transactions[ix] = obj; else state.transactions.push(obj);
  saveState();
  closeModal("modalTx");
  renderCashflow();
  toast(ix >= 0 ? "Movimento atualizado." : "Movimento guardado.");
}

function deleteTxEntry() {
  if (!editingTxId) return;
  if (!confirm("Apagar este movimento?")) return;
  state.transactions = state.transactions.filter(t => t.id !== editingTxId);
  editingTxId = null;
  saveState();
  closeModal("modalTx");
  renderCashflow();
  toast("Movimento apagado.");
}

/* ─── 4. CATEGORIAS DE DESPESA ───────────────────────────── */
let catChart = null;
function renderCatChart() {
  const y = $("cfYear").value;
  const m = String($("cfMonth").value).padStart(2, "0");
  const key = `${y}-${m}`;
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";

  // Aggregate by category for selected period
  let txs;
  const notInternal = t => !isInterAccountTransfer(t);
  const m2 = String($("cfMonth").value).padStart(2, "0");
  const monthKey2 = `${y}-${m2}`;
  if (gran === "year") {
    txs = expandRecurring(state.transactions).filter(t => String(t.date || "").slice(0,4) === y && t.type === "out" && notInternal(t));
  } else if (gran === "all") {
    txs = expandRecurring(state.transactions).filter(t => t.type === "out" && notInternal(t));
  } else {
    // month (default)
    txs = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === monthKey2 && t.type === "out" && notInternal(t));
  }

  const byCat = {};
  for (const t of txs) {
    const k = t.category || "Outros";
    byCat[k] = (byCat[k] || 0) + parseNum(t.amount);
  }
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const ctx = $("catChart") && $("catChart").getContext("2d");
  if (!ctx) return;
  if (catChart) catChart.destroy();

  if (!entries.length) { catChart = null; return; }

  catChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: PALETTE, borderWidth: 0 }]
    },
    options: {
      cutout: "65%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(c.raw / total * 100)})` } }
      }
    }
  });

  const catList = $("catList");
  catList.innerHTML = entries.map(([k, v]) => `
    <div class="item" style="cursor:default">
      <div class="item__l"><div class="item__t">${escapeHtml(k)}</div><div class="item__s">${fmtPct(v / total * 100)} das saídas</div></div>
      <div class="item__v">${fmtEUR(v)}</div>
    </div>`).join("");

  const sub = $("catSubtitle");
  if (sub) sub.textContent = `Saídas por categoria · Total: ${fmtEUR(total)}`;
}

/* ─── 5. TAXA DE POUPANÇA ────────────────────────────────── */
function renderSavingsRate(totalIn, totalOut) {
  const wrap = $("savingsRateWrap");
  const pctEl = $("savingsRatePct");
  const fill = $("savingsRateFill");
  if (!wrap) return;
  if (totalIn <= 0) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  const net = totalIn - totalOut;
  const pct = Math.max(0, (net / totalIn) * 100);
  if (pctEl) {
    pctEl.textContent = fmtPct(pct);
    pctEl.style.color = pct >= 20 ? "#059669" : pct >= 10 ? "#d97706" : "#dc2626";
  }
  if (fill) {
    fill.style.width = Math.min(100, pct) + "%";
    fill.style.background = pct >= 20 ? "#10b981" : pct >= 10 ? "#f59e0b" : "#ef4444";
  }
}

/* ─── 6. PESQUISA GLOBAL ─────────────────────────────────── */
let searchOpen = false;
function toggleSearch() {
  searchOpen = !searchOpen;
  const bar = document.getElementById("searchBar");
  if (!bar) return;
  bar.style.display = searchOpen ? "block" : "none";
  if (searchOpen) {
    const inp = $("globalSearch");
    if (inp) { inp.value = ""; inp.focus(); }
    renderSearchResults("");
  }
}

function renderSearchResults(q) {
  const wrap = document.getElementById("searchResults");
  if (!wrap) return;
  if (!q.trim()) { wrap.innerHTML = ""; return; }
  const ql = q.toLowerCase();
  const results = [];

  // Assets
  for (const a of state.assets) {
    if (`${a.name} ${a.class}`.toLowerCase().includes(ql)) {
      results.push({ type: "Ativo", label: a.name, sub: `${a.class} · ${fmtEUR(parseNum(a.value))}`, action: () => { setView("assets"); editItem(a.id); toggleSearch(); } });
    }
  }
  // Liabilities
  for (const l of state.liabilities) {
    if (`${l.name} ${l.class}`.toLowerCase().includes(ql)) {
      results.push({ type: "Passivo", label: l.name, sub: `${l.class} · ${fmtEUR(parseNum(l.value))}`, action: () => { setView("assets"); setModeLiabs(true); editItem(l.id); toggleSearch(); } });
    }
  }
  // Transactions
  for (const t of state.transactions) {
    if (`${t.category} ${t.notes || ""}`.toLowerCase().includes(ql)) {
      results.push({ type: t.type === "in" ? "Entrada" : "Saída", label: t.category, sub: `${t.date} · ${fmtEUR(parseNum(t.amount))}`, action: () => { setView("cashflow"); openTxModal(t.id); toggleSearch(); } });
    }
  }
  // Dividends
  for (const d of (state.dividends || [])) {
    if (`${d.assetName} ${d.notes || ""}`.toLowerCase().includes(ql)) {
      results.push({ type: "Dividendo", label: d.assetName || "Manual", sub: `${d.date} · ${fmtEUR2(parseNum(d.amount))}`, action: () => { setView("dividends"); openDivModal(d.id); toggleSearch(); } });
    }
  }

  if (!results.length) { wrap.innerHTML = `<div class="item" style="cursor:default"><div class="item__l"><div class="item__t">Sem resultados</div></div></div>`; return; }

  wrap.innerHTML = "";
  for (const r of results.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(r.label)}</div><div class="item__s">${escapeHtml(r.sub)}</div></div><div class="item__v"><span class="badge badge--blue">${escapeHtml(r.type)}</span></div>`;
    row.addEventListener("click", r.action);
    wrap.appendChild(row);
  }
}

function renderDivYTD() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearStart = currentYear + "-01-01";

  // Prefer divSummaries for current year
  const currentSummary = (state.divSummaries || []).find(s => s.year === currentYear);
  const prevSummary = (state.divSummaries || []).find(s => s.year === currentYear - 1);

  let divYTD = 0;
  let label = "";

  if (currentSummary) {
    divYTD = parseNum(currentSummary.gross) - parseNum(currentSummary.tax);
    label = `Yield ${fmtPct(parseNum(currentSummary.yieldPct))} · Resumo ${currentYear} · ${fmtEUR(divYTD)}/ano líquido`;
  } else if (prevSummary) {
    // Use last year as reference
    divYTD = parseNum(prevSummary.gross) - parseNum(prevSummary.tax);
    label = `Ref. ${currentYear - 1} · Atualiza em Dividendos`;
  } else {
    // Fall back to individual dividends
    divYTD = (state.dividends || [])
      .filter(d => d.date >= yearStart)
      .reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);
    const count = (state.dividends || []).filter(d => d.date >= yearStart).length;
    label = count > 0 ? `${count} pagamento${count !== 1 ? "s" : ""} em ${currentYear}` : "";
  }

  const divEl = $("kpiDivYTD");
  if (divEl) divEl.textContent = fmtEUR(divYTD);
  const divCountEl = $("kpiDivCount");
  if (divCountEl) divCountEl.textContent = label;
}

function renderDashboard() {
  const t = calcTotals();

  // ── Hero ──────────────────────────────────────────────────
  $("kpiNet").textContent = fmtEUR(t.net);
  $("kpiAP").textContent = `Ativos ${fmtEUR(t.assetsTotal)} | Passivos ${fmtEUR(t.liabsTotal)}`;

  // Variação MoM e YoY a partir do histórico
  const h = state.history.slice().sort((a,b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const changesEl = document.getElementById("kpiChanges");
  if (changesEl && h.length >= 2) {
    const last = h[h.length-1];
    const prev = h[h.length-2];
    const yearAgo = h.find(x => {
      const d = new Date(x.dateISO), now = new Date(last.dateISO);
      return Math.abs((now - d) / (1000*60*60*24*365) - 1) < 0.15;
    });
    const chips = [];
    const chip = (label, val, ref) => {
      if (ref == null || ref === 0) return "";
      const diff = val - ref, pct = diff / Math.abs(ref) * 100;
      const pos = diff >= 0;
      const color = pos ? "#059669" : "#ef4444";
      const arrow = pos ? "▲" : "▼";
      return `<div style="background:${pos?"#f0fdf4":"#fff1f2"};border-radius:8px;padding:5px 10px;font-size:12px">
        <span style="color:#64748b">${label} </span>
        <span style="color:${color};font-weight:700">${arrow} ${fmtEUR(Math.abs(diff))} (${Math.abs(pct).toFixed(1)}%)</span>
      </div>`;
    };
    if (prev) chips.push(chip("vs mês ant.", t.net, parseNum(prev.net)));
    if (yearAgo) chips.push(chip("vs ano ant.", t.net, parseNum(yearAgo.net)));
    changesEl.innerHTML = chips.join("") || "";
    changesEl.style.display = chips.some(Boolean) ? "flex" : "none";
  } else if (changesEl) {
    changesEl.style.display = "none";
  }

  // ── KPIs secundários ──────────────────────────────────────
  $("kpiPassiveAnnual").textContent = fmtEUR(t.passiveAnnual);
  $("kpiPassiveMonthly").textContent = fmtEUR(t.passiveAnnual / 12);

  const pm2 = document.getElementById("kpiPassiveMonthly2");
  const pa2 = document.getElementById("kpiPassiveAnnualSub");
  if (pm2) pm2.textContent = fmtEUR(t.passiveAnnual / 12);
  if (pa2) pa2.textContent = fmtEUR(t.passiveAnnual) + "/ano";

  // Yield médio carteira
  const yieldEl = document.getElementById("kpiYield");
  if (yieldEl) {
    const y = t.assetsTotal > 0 ? (t.passiveAnnual / t.assetsTotal * 100) : 0;
    yieldEl.textContent = fmtPct(y);
  }

  // Autonomia passiva (rendimento passivo / despesas mensais)
  const autEl = document.getElementById("kpiAutonomy");
  if (autEl) {
    const byMonth = new Map();
    for (const tx of (state.transactions||[])) {
      if (isInterAccountTransfer(tx)) continue;
      const d = (tx.date||"").slice(0,7); if (!d) continue;
      const cur = byMonth.get(d)||{out:0}; if (tx.type==="out") cur.out += parseNum(tx.amount);
      byMonth.set(d, cur);
    }
    const last6 = [...byMonth.keys()].sort().slice(-6);
    const avgOut = last6.length ? last6.reduce((s,k)=>s+(byMonth.get(k).out||0),0)/last6.length : 0;
    const exp12 = avgOut * 12;
    const pct = exp12 > 0 ? Math.min(999, t.passiveAnnual / exp12 * 100) : 0;
    autEl.textContent = pct > 0 ? fmtPct(pct) : "—";
    autEl.style.color = pct >= 100 ? "#059669" : pct >= 50 ? "#f59e0b" : "#8b5cf6";
  }

  updatePassiveBar();
  renderGoal();
  renderAlerts();
  renderDivYTD();
  // Sync secondary DivYTD
  const d2 = document.getElementById("kpiDivYTD2");
  const dc2 = document.getElementById("kpiDivCount2");
  if (d2) d2.textContent = $("kpiDivYTD").textContent;
  if (dc2) dc2.textContent = $("kpiDivCount").textContent;

  renderSummary();
  renderDistChart();
  renderTrendChart();
  // v15
  renderSnapshotTable();
  renderIRSCard();
  renderHealthRatios();
  renderRiskAlerts();
  renderMilestones();
  renderMaturityAlerts();
  renderPortfolioQuality();
  checkNegativeReturn();
}

function renderSummary() {
  const list = $("summaryList");
  list.innerHTML = "";
  const items = [...state.assets].sort((a, b) => parseNum(b.value) - parseNum(a.value));
  if (!items.length) {
    list.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem ativos</div><div class="item__s">Usa o botão + para adicionar.</div></div><div class="item__v">—</div></div>`;
    $("btnSummaryToggle").style.display = "none";
    return;
  }
  const shown = summaryExpanded ? items : items.slice(0, 10);
  for (const it of shown) {
    const row = document.createElement("div");
    row.className = "item";
    const passive = passiveFromItem(it);
    const badge = passive > 0 ? `<span class="badge badge--green">${fmtEUR(passive)}/ano</span>` : "";
    row.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(it.name || "—")} ${badge}</div><div class="item__s">${escapeHtml(it.class || "")}</div></div><div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", () => { setView("assets"); editItem(it.id); });
    list.appendChild(row);
  }
  $("btnSummaryToggle").style.display = items.length > 10 ? "inline-flex" : "none";
  $("btnSummaryToggle").textContent = summaryExpanded ? "Ver menos" : "Ver o resto";
}

const PALETTE = ["#5b5ce6","#3b82f6","#39d6d8","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#64748b"];

function renderDistChart() {
  const by = {};
  for (const a of state.assets) { const k = a.class || "Outros"; by[k] = (by[k] || 0) + parseNum(a.value); }
  const labels = Object.keys(by);
  const values = labels.map(k => by[k]);
  const ctx = $("distChart").getContext("2d");
  if (distChart) distChart.destroy();
  if (!labels.length) {
    distChart = new Chart(ctx, { type: "doughnut", data: { labels: ["Sem dados"], datasets: [{ data: [1], backgroundColor: ["#e6e9f0"] }] }, options: { plugins: { legend: { display: false } }, cutout: "72%" } });
    return;
  }
  distChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 0 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(c.raw / values.reduce((a,b)=>a+b,0)*100)})` } } },
      cutout: "72%"
    }
  });
}

function renderTrendChart() {
  const ctx = $("trendChart").getContext("2d");
  if (trendChart) trendChart.destroy();
  const h = state.history.slice().sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const hint = $("historyHint");
  const snapTable = document.getElementById("snapshotTable");
  const trendSub = document.getElementById("trendSubtitle");

  if (!h.length) {
    if (hint) hint.style.display = "block";
    if (snapTable) snapTable.innerHTML = "";
    trendChart = new Chart(ctx, { type: "line", data: { labels: ["—"], datasets: [{ data: [0], tension: .35, pointRadius: 0 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } } });
    return;
  }
  if (hint) hint.style.display = "none";

  // Update subtitle with count and date range
  if (trendSub) trendSub.textContent = `${h.length} snapshot${h.length!==1?"s":""} · ${h[0].dateISO.slice(0,7)} → ${h[h.length-1].dateISO.slice(0,7)}`;

  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: h.map(x => x.dateISO.slice(0, 7)),
      datasets: [
        { label: "Património líquido", data: h.map(x => parseNum(x.net)), tension: .4, pointRadius: h.length <= 12 ? 4 : 2, borderColor: "#5b5ce6", backgroundColor: "rgba(91,92,230,.08)", fill: true, borderWidth: 2 },
        { label: "Total ativos", data: h.map(x => parseNum(x.assets)), tension: .4, pointRadius: 0, borderDash: [4,4], borderColor: "#39d6d8", borderWidth: 1.5 },
        { label: "Rend. passivo/ano", data: h.map(x => parseNum(x.passiveAnnual||0)), tension: .4, pointRadius: 0, borderColor: "#10b981", borderWidth: 1.5 }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v), font:{size:10} } } }
    }
  });

  // Mini table: last 6 snapshots with MoM change
  if (snapTable) {
    const recent = h.slice(-6).reverse();
    const rows = recent.map((s, i) => {
      const prev = recent[i+1];
      const net = parseNum(s.net);
      const diff = prev ? net - parseNum(prev.net) : null;
      const pct = (diff != null && parseNum(prev.net) !== 0) ? diff / Math.abs(parseNum(prev.net)) * 100 : null;
      const changeHtml = pct != null
        ? `<span style="color:${diff>=0?"#059669":"#ef4444"};font-size:12px">${diff>=0?"▲":"▼"} ${Math.abs(pct).toFixed(1)}%</span>`
        : `<span style="color:#94a3b8;font-size:12px">—</span>`;
      return `<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b;min-width:70px">${s.dateISO.slice(0,7)}</span>
        <span style="flex:1;font-weight:700">${fmtEUR(net)}</span>
        ${changeHtml}
      </div>`;
    }).join("");
    snapTable.innerHTML = rows
      ? `<div style="margin-top:8px"><div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Últimos snapshots</div>${rows}</div>`
      : "";
  }
}

function snapshotMonth() {
  const t = calcTotals();
  const dateISO = isoToday();
  // avoid duplicate same-day snapshot
  const existing = state.history.findIndex(h => h.dateISO === dateISO);
  const snap = { dateISO, net: t.net, assets: t.assetsTotal, liabilities: t.liabsTotal, passiveAnnual: t.passiveAnnual };
  if (existing >= 0) state.history[existing] = snap; else state.history.push(snap);
  saveState();
  renderDashboard();
  toast("Snapshot registado.");
}

/* ─── ASSETS / LIABILITIES VIEW ──────────────────────────── */
const CLASSES_ASSETS = ["Imobiliário","Liquidez","Ações/ETFs","Cripto","Ouro","Prata","Arte","Fundos","PPR","Depósitos","Obrigações","Outros"];
const CLASSES_LIABS  = ["Crédito habitação","Crédito pessoal","Cartão de crédito","Outros"];
const COMPOUND_FREQS = [{ v: 1, l: "Anual" }, { v: 2, l: "Semestral" }, { v: 4, l: "Trimestral" }, { v: 12, l: "Mensal" }, { v: 365, l: "Diária" }];

function setModeLiabs(on) {
  showingLiabs = !!on;
  $("segLiabs").classList.toggle("seg__btn--active", showingLiabs);
  $("segAssets").classList.toggle("seg__btn--active", !showingLiabs);
  $("itemsTitle").textContent = showingLiabs ? "Passivos" : "Ativos";
  $("itemsSub").textContent = showingLiabs ? "Créditos, dívidas, cartões…" : "Imobiliário, liquidez, ações/ETFs, metais, cripto, fundos, PPR, depósitos, obrigações…";
  rebuildClassFilter();
  renderItems();
}

function rebuildClassFilter() {
  const sel = $("qClass");
  const current = sel.value;
  sel.innerHTML = `<option value="">Todas as classes</option>`;
  const src = showingLiabs ? state.liabilities : state.assets;
  const classes = [...new Set(src.map(x => x.class).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt"));
  for (const c of classes) { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); }
  sel.value = current;
}

let itemsExpanded = false;

function renderItems() {
  rebuildClassFilter();
  const list = $("itemsList");
  list.innerHTML = "";
  const q = ($("qSearch").value || "").trim().toLowerCase();
  const cfilter = $("qClass").value || "";
  const sort = $("qSort").value;
  const isSearching = q.length > 0 || cfilter.length > 0;

  let src = showingLiabs ? [...state.liabilities] : [...state.assets];
  src = src.filter(it => {
    const hay = `${it.name || ""} ${it.class || ""}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (cfilter && (it.class || "") !== cfilter) return false;
    return true;
  });

  if (sort === "value_desc") src.sort((a, b) => parseNum(b.value) - parseNum(a.value));
  if (sort === "value_asc") src.sort((a, b) => parseNum(a.value) - parseNum(b.value));
  if (sort === "name_asc") src.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt"));

  if (!src.length) {
    list.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem ${showingLiabs ? "passivos" : "ativos"}</div><div class="item__s">Usa "Adicionar".</div></div><div class="item__v">—</div></div>`;
    const tog = document.getElementById("btnItemsToggle");
    if (tog) tog.style.display = "none";
    return;
  }

  // Mostrar 10 por defeito, excepto se está a pesquisar
  const LIMIT = 10;
  const shown = (itemsExpanded || isSearching) ? src : src.slice(0, LIMIT);

  for (const it of shown) {
    const row = document.createElement("div");
    row.className = "item";
    const badge = !showingLiabs ? yieldBadge(it) : "";
    const gainBadge = !showingLiabs ? renderGainLossBadge(it) : "";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(it.name || "—")}${gainBadge}</div>
      <div class="item__s">${escapeHtml(it.class || "")}${badge}</div>
    </div><div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", () => editItem(it.id));
    list.appendChild(row);
  }

  // Botão Ver todos / Ver menos
  const tog = document.getElementById("btnItemsToggle");
  if (tog) {
    if (src.length > LIMIT && !isSearching) {
      tog.style.display = "";
      tog.textContent = itemsExpanded
        ? "Ver menos"
        : `Ver todos (${src.length})`;
    } else {
      tog.style.display = "none";
    }
  }
}

function yieldBadge(it) {
  const yt = it.yieldType || "none", yv = parseNum(it.yieldValue);
  if (yt === "yield_pct" && yv > 0) return ` · <span class="badge badge--green">${fmtPct(yv)}</span>`;
  if (yt === "yield_eur_year" && yv > 0) return ` · <span class="badge badge--green">${fmtEUR(yv)}/ano</span>`;
  if (yt === "rent_month" && yv > 0) return ` · <span class="badge badge--green">${fmtEUR(yv)}/mês</span>`;
  return "";
}

/* ─── MODAL: ITEM ─────────────────────────────────────────── */
function openItemModal(kind) {
  editingItemId = null;
  $("mId").value = "";
  $("mKind").value = kind;
  $("btnDeleteItem").style.display = "none";
  $("modalItemTitle").textContent = kind === "liab" ? "Adicionar passivo" : "Adicionar ativo";
  buildClassSelect(kind);
  $("mName").value = "";
  $("mValue").value = "";
  $("mYieldType").value = "none";
  $("mYieldValue").value = "";
  $("mMaturity").value = "";
  $("mCompound").value = "12";
  $("mNotes").value = "";
  const _cbEl = document.getElementById("mCostBasis");
  if (_cbEl) _cbEl.value = "";
  toggleYieldFields(kind);
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
}

function buildClassSelect(kind) {
  const sel = $("mClass");
  sel.innerHTML = "";
  const classes = kind === "liab" ? CLASSES_LIABS : CLASSES_ASSETS;
  for (const c of classes) { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); }
}

function toggleYieldFields(kind) {
  const isLiab = kind === "liab";
  $("mYieldType").disabled = isLiab;
  $("mYieldValue").disabled = isLiab;
  $("mMaturity").disabled = isLiab;
  $("mCompound").disabled = isLiab;
  const yieldRow = document.getElementById("yieldRow");
  if (yieldRow) yieldRow.style.display = isLiab ? "none" : "";
}

function editItem(id) {
  const src = showingLiabs ? state.liabilities : state.assets;
  const it = src.find(x => x.id === id);
  if (!it) return;
  editingItemId = id;
  const kind = showingLiabs ? "liab" : "asset";
  $("mId").value = id;
  $("mKind").value = kind;
  $("btnDeleteItem").style.display = "";
  $("modalItemTitle").textContent = showingLiabs ? "Editar passivo" : "Editar ativo";
  buildClassSelect(kind);
  $("mClass").value = it.class || (kind === "liab" ? CLASSES_LIABS[0] : CLASSES_ASSETS[0]);
  $("mName").value = it.name || "";
  $("mValue").value = String(parseNum(it.value) || "");
  $("mNotes").value = it.notes || "";
  toggleYieldFields(kind);
  if (!showingLiabs) {
    $("mYieldType").value = it.yieldType || "none";
    $("mYieldValue").value = it.yieldValue != null ? String(it.yieldValue) : "";
    $("mMaturity").value = it.maturityDate || "";
    $("mCompound").value = String(it.compoundFreq || 12);
    // v15: custo de aquisição
    const cbEl = document.getElementById("mCostBasis");
    if (cbEl) cbEl.value = it.costBasis ? String(it.costBasis) : "";
  } else {
    $("mYieldType").value = "none";
    $("mYieldValue").value = "";
    $("mMaturity").value = "";
    $("mCompound").value = "12";
  }
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
}

function saveItemFromModal() {
  const kind = $("btnSaveItem").dataset.kind;
  const isLiab = kind === "liab";
  const obj = {
    id: editingItemId || uid(),
    class: $("mClass").value || "Outros",
    name: ($("mName").value || "").trim(),
    value: parseNum($("mValue").value),
    notes: ($("mNotes").value || "").trim()
  };
  if (!obj.name) { toast("Nome é obrigatório."); return; }
  if (!isLiab) {
    obj.yieldType = $("mYieldType").value || "none";
    obj.yieldValue = parseNum($("mYieldValue").value);
    obj.maturityDate = $("mMaturity").value || "";
    obj.compoundFreq = parseInt($("mCompound").value) || 12;
    // v15: custo de aquisição para mais-valias
    const cb = parseNum((document.getElementById("mCostBasis") || {}).value || "");
    if (cb > 0) obj.costBasis = cb; else delete obj.costBasis;
  }
  if (isLiab) {
    const ix = state.liabilities.findIndex(x => x.id === obj.id);
    if (ix >= 0) state.liabilities[ix] = obj; else state.liabilities.push(obj);
  } else {
    const ix = state.assets.findIndex(x => x.id === obj.id);
    if (ix >= 0) state.assets[ix] = obj; else state.assets.push(obj);
  }
  saveState();
  closeModal("modalItem");
  renderDashboard();
  renderItems();
}

function deleteCurrentItem() {
  if (!editingItemId) return;
  const kind = $("mKind").value || (showingLiabs ? "liab" : "asset");
  if (!confirm("Apagar este item? Esta ação não pode ser anulada.")) return;
  if (kind === "liab") state.liabilities = state.liabilities.filter(x => x.id !== editingItemId);
  else state.assets = state.assets.filter(x => x.id !== editingItemId);
  editingItemId = null;
  saveState();
  closeModal("modalItem");
  renderAll();
}

/* ─── CASHFLOW ────────────────────────────────────────────── */
const TX_PREVIEW_COUNT = 5;

function ensureMonthYearOptions() {
  const now = new Date(), yearNow = now.getFullYear();
  const years = [];
  for (let y = yearNow - 5; y <= yearNow + 1; y++) years.push(y);
  const curY = $("cfYear").value || String(yearNow);
  const curM = $("cfMonth").value || String(now.getMonth() + 1);
  $("cfYear").innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  $("cfMonth").innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => `<option value="${m}">${String(m).padStart(2, "0")}</option>`).join("");
  $("cfYear").value = curY;
  $("cfMonth").value = curM;
  if (!$("cfYear").value) $("cfYear").value = String(yearNow);
  if (!$("cfMonth").value) $("cfMonth").value = String(now.getMonth() + 1);
  $("tDate").value = isoToday();
}

function monthKeyFromDateISO(d) {
  const s = String(d || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : null;
}

function expandRecurring(tx) {
  const out = [];
  const yearLimit = new Date().getFullYear() + 2;
  for (const t of tx) {
    out.push(t);
    const rec = t.recurring || "none";
    if (rec === "none") continue;
    const d0 = new Date(t.date + "T00:00:00");
    if (isNaN(d0.getTime())) continue;
    for (let i = 1; i <= 48; i++) {
      const d = new Date(d0);
      if (rec === "monthly") d.setMonth(d.getMonth() + i);
      else if (rec === "yearly") d.setFullYear(d.getFullYear() + i);
      if (d.getFullYear() > yearLimit) break;
      out.push({ ...t, id: t.id + "_r" + i, date: d.toISOString().slice(0, 10) });
    }
  }
  return out;
}

// ─── Cashflow granularity: daily / weekly / monthly / annual ─
function cfGranData(granularity) {
  const all = expandRecurring(state.transactions).filter(t => parseNum(t.amount) > 0 && !isInterAccountTransfer(t));
  const bucket = {};
  for (const t of all) {
    let key;
    const d = new Date(t.date + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    if (granularity === "day") key = t.date;
    else if (granularity === "week") {
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      key = `${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
    } else if (granularity === "month") key = t.date.slice(0, 7);
    else key = t.date.slice(0, 4);
    if (!bucket[key]) bucket[key] = { in: 0, out: 0 };
    if (t.type === "in") bucket[key].in += parseNum(t.amount);
    else bucket[key].out += parseNum(t.amount);
  }
  const keys = Object.keys(bucket).sort();
  return { keys, data: keys.map(k => bucket[k]) };
}

function isInterAccountTransfer(t) {
  const cat = normStr(t.category || "");
  const note = normStr(t.notes || "");
  // Categorias explicitamente internas
  const internalCats = [
    "transferencia entre contas",
    "transferencia interna",
    "poupanca propria",
    "constituicao dp",
    "mesada",             // transferência para filho — interno ao agregado
  ];
  if (internalCats.some(k => cat.includes(k))) return true;
  // Detectar por notas/descrição importada
  const internalNoteKw = [
    "transferencia entre contas",
    "constituicao de d.p",
    "constituicao de dp",
    "poupanca noutra",
    "mesada pedro",
    "mesada miudos",
    "trf.imed. p/ pedro nunes",
  ];
  if (internalNoteKw.some(k => note.includes(k))) return true;
  return false;
}

function renderCashflow() {
  ensureMonthYearOptions();
  const y = $("cfYear").value;
  const m = String($("cfMonth").value).padStart(2, "0");
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const monthKey = `${y}-${m}`;

  // Filter transactions by selected period AND exclude internal transfers
  const allExpanded = expandRecurring(state.transactions).filter(t => !isInterAccountTransfer(t));

  let periodTx;
  if (gran === "year") {
    periodTx = allExpanded.filter(t => String(t.date || "").slice(0, 4) === y);
  } else if (gran === "all") {
    periodTx = allExpanded;
  } else {
    // month (default) — or day/week still show monthly summary totals
    periodTx = allExpanded.filter(t => monthKeyFromDateISO(t.date) === monthKey);
  }

  const totalIn  = periodTx.filter(t => t.type === "in" ).reduce((a, t) => a + parseNum(t.amount), 0);
  const totalOut = periodTx.filter(t => t.type === "out").reduce((a, t) => a + parseNum(t.amount), 0);
  const net  = totalIn - totalOut;
  const rate = totalIn > 0 ? (net / totalIn) * 100 : 0;

  $("cfIn").textContent  = fmtEUR(totalIn);
  $("cfOut").textContent = fmtEUR(totalOut);
  $("cfNet").textContent = fmtEUR(net);
  $("cfRate").textContent = `${Math.round(rate)}%`;

  // Period label
  const periodLabel = gran === "year" ? `Ano ${y}` :
                      gran === "all"  ? "Todo o período" :
                      `${m}/${y}`;
  const cfTitle = document.getElementById("cfPeriodLabel");
  if (cfTitle) cfTitle.textContent = periodLabel;

  renderSavingsRate(totalIn, totalOut);
  renderTxList();
  renderCashflowChart();
  renderCatChart();
}

function renderBalance() { renderCashflow(); }

function renderCashflowChart() {
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const { keys, data } = cfGranData(gran);
  const ctx = $("cfChart") && $("cfChart").getContext("2d");
  if (!ctx) return;
  if (window._cfChart) window._cfChart.destroy();
  if (!keys.length) return;
  window._cfChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: keys,
      datasets: [
        { label: "Entradas", data: data.map(d => d.in), backgroundColor: "#10b981" },
        { label: "Saídas", data: data.map(d => d.out), backgroundColor: "#ef4444" }
      ]
    },
    options: {
      plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } } },
      scales: { x: { stacked: false }, y: { ticks: { callback: v => fmtEUR(v) } } }
    }
  });
}

function renderTxList() {
  const wrap = $("txList");
  wrap.innerHTML = "";
  const y = $("cfYear") ? $("cfYear").value : String(new Date().getFullYear());
  const m = $("cfMonth") ? String($("cfMonth").value).padStart(2,"0") : String(new Date().getMonth()+1).padStart(2,"0");
  const key = `${y}-${m}`;

  // Mostrar TODOS os movimentos originais (não expandidos) do mês seleccionado
  const gran2 = ($("cfGranularity") && $("cfGranularity").value) || "month";
  let txFilter;
  if (gran2 === "year") {
    txFilter = t => String(t.date || "").slice(0,4) === y;
  } else if (gran2 === "all") {
    txFilter = t => true;
  } else {
    txFilter = t => monthKeyFromDateISO(t.date) === key;
  }
  const tx = state.transactions
    .filter(t => txFilter(t) && parseNum(t.amount) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!tx.length) {
    wrap.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem movimentos</div><div class="item__s">Importa o extracto ou adiciona manualmente.</div></div><div class="item__v">—</div></div>`;
    $("btnTxToggle").style.display = "none";
    return;
  }

  const shown = txExpanded ? tx : tx.slice(0, TX_PREVIEW_COUNT);
  for (const t of shown) {
    const isTransfer = isInterAccountTransfer(t);
    const sign = isTransfer ? "⇄" : (t.type === "in" ? "+" : "−");
    const signColor = isTransfer ? "#94a3b8" : (t.type === "in" ? "#059669" : "#dc2626");
    const typeLabel = isTransfer ? "⇄ Transf. interna (neutra)" : (t.type === "in" ? "Entrada" : "Saída");
    const notesTxt = t.notes && t.notes !== t.category ? t.notes.slice(0,50) : "";

    const row = document.createElement("div");
    row.className = "item";
    row.style.cssText = "position:relative;overflow:hidden;cursor:pointer;";

    row.innerHTML = `
      <div class="item__l" style="flex:1;min-width:0">
        <div class="item__t" style="color:${signColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${sign} ${escapeHtml(t.category)}
        </div>
        <div class="item__s">${escapeHtml(typeLabel)} · ${escapeHtml(t.date)}${t.recurring !== "none" ? " · ↻" : ""}${notesTxt ? `<br><span style="opacity:.7">${escapeHtml(notesTxt)}</span>` : ""}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div class="item__v" style="color:${signColor}">${fmtEUR(parseNum(t.amount))}</div>
        <button data-txid="${t.id}" class="tx-del-btn" style="
          border:0;background:#fee2e2;color:#dc2626;border-radius:10px;
          padding:6px 10px;font-weight:900;font-size:16px;cursor:pointer;flex-shrink:0
        " title="Apagar">🗑</button>
      </div>`;

    // Clicar na área de texto abre edição
    row.querySelector(".item__l").addEventListener("click", () => openTxModal(t.id));

    // Botão apagar inline — sem modal, com confirmação rápida
    row.querySelector(".tx-del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      if (btn.dataset.confirm === "1") {
        // Segunda vez — apagar
        state.transactions = state.transactions.filter(x => x.id !== t.id);
        saveState();
        renderCashflow();
        toast("Movimento apagado.");
      } else {
        // Primeira vez — pedir confirmação visual
        btn.dataset.confirm = "1";
        btn.textContent = "✓ Confirmar";
        btn.style.background = "#dc2626";
        btn.style.color = "#fff";
        btn.style.padding = "6px 8px";
        btn.style.fontSize = "12px";
        setTimeout(() => {
          if (btn.dataset.confirm === "1") {
            btn.dataset.confirm = "0";
            btn.textContent = "🗑";
            btn.style.background = "#fee2e2";
            btn.style.color = "#dc2626";
            btn.style.padding = "6px 10px";
            btn.style.fontSize = "16px";
          }
        }, 3000);
      }
    });

    wrap.appendChild(row);
  }

  if (tx.length > TX_PREVIEW_COUNT) {
    $("btnTxToggle").style.display = "inline";
    $("btnTxToggle").textContent = txExpanded ? "Ver menos" : `Ver todos (${tx.length})`;
  } else {
    $("btnTxToggle").style.display = "none";
  }
}

/* ─── DIVIDENDOS — MODO RESUMO ANUAL ─────────────────────── */
let divMode = "summary"; // "summary" | "detail"
let editingDivSummaryId = null;
let divProjChart = null;
let divSummaryChart = null;

function initDivSummaryYearSelect() {
  const sel = $("divSummaryYear");
  if (!sel) return;
  const now = new Date().getFullYear();
  sel.innerHTML = "";
  for (let y = now; y >= now - 10; y--) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  }
  // Pre-fill from existing summary for selected year
  sel.addEventListener("change", () => prefillDivSummaryFromYear(parseInt(sel.value)));
  prefillDivSummaryFromYear(now);
}

function prefillDivSummaryFromYear(year) {
  const existing = (state.divSummaries || []).find(s => s.year === year);
  const delBtn = document.getElementById("btnDeleteDivSummary");
  const saveBtn = $("btnSaveDivSummary");

  if (existing) {
    const radio = document.querySelector('input[name="divInputMode"][value="gross_tax"]');
    if (radio) { radio.checked = true; showDivFields("gross_tax"); }
    $("divSummaryGross").value = String(parseNum(existing.gross) || "");
    $("divSummaryTax").value = String(parseNum(existing.tax) || "");
    const yv = String(parseNum(existing.yieldPct) || "");
    ["divSummaryYield_gt","divSummaryYield_net","divSummaryYield_py","divSummaryYield_yo"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = yv;
    });
    $("divSummaryNotes").value = existing.notes || "";
    editingDivSummaryId = existing.id;
    if (saveBtn) saveBtn.textContent = `Atualizar ${year}`;
    if (delBtn) delBtn.style.display = "";
    updateDivSummaryLive();
  } else {
    $("divSummaryGross").value = "";
    $("divSummaryTax").value = "";
    $("divSummaryNet").value = "";
    const prevSummary = (state.divSummaries || [])
      .filter(s => s.year < year).sort((a, b) => b.year - a.year)[0];
    const yieldVal = prevSummary
      ? String(parseNum(prevSummary.yieldPct))
      : (calcPortfolioYield().weightedYield > 0 ? fmt(calcPortfolioYield().weightedYield, 2) : "");
    ["divSummaryYield_gt","divSummaryYield_net","divSummaryYield_py","divSummaryYield_yo"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = yieldVal;
    });
    $("divSummaryNotes").value = "";
    editingDivSummaryId = null;
    if (saveBtn) saveBtn.textContent = `Guardar resumo ${year}`;
    if (delBtn) delBtn.style.display = "none";
    const liveEl = document.getElementById("divSummaryLive");
    if (liveEl) liveEl.style.display = "none";
  }
  const pEl = $("divProjYield");
  if (pEl && !pEl.value && existing) pEl.value = String(parseNum(existing.yieldPct));
}

function getDivInputMode() {
  const checked = document.querySelector('input[name="divInputMode"]:checked');
  return checked ? checked.value : "gross_tax";
}

function showDivFields(mode) {
  ["gross_tax","net_only","portfolio_yield","yield_only"].forEach(m => {
    const el = document.getElementById("divFields_" + m);
    if (el) el.style.display = m === mode ? "" : "none";
  });
  // Update portfolio value display for yield_only mode
  if (mode === "yield_only") {
    const divData = calcDividendYield();
    const el = document.getElementById("divYoPortfolioVal");
    if (el) {
      const src = divData.source === "summary" ? " (via resumo anual)" :
                  divData.source === "individual" ? " (via dividendos registados)" : " (via yields dos ativos)";
      el.textContent = divData.divPortfolioVal > 0
        ? fmtEUR(divData.divPortfolioVal) + src
        : "Sem ativos com yield %";
    }
  }
}

function calcDivFromInputs() {
  const mode = getDivInputMode();
  let gross = 0, tax = 0, net = 0, yieldPct = 0;

  if (mode === "gross_tax") {
    gross = parseNum($("divSummaryGross").value);
    tax = parseNum($("divSummaryTax").value);
    net = gross - tax;
    yieldPct = parseNum($("divSummaryYield_gt").value);

  } else if (mode === "net_only") {
    net = parseNum($("divSummaryNet").value);
    const retRate = parseNum($("divSummaryRetRate").value) || 0;
    gross = retRate > 0 ? net / (1 - retRate / 100) : net;
    tax = gross - net;
    yieldPct = parseNum($("divSummaryYield_net").value);

  } else if (mode === "portfolio_yield") {
    const portfolio = parseNum($("divSummaryPortfolio").value);
    yieldPct = parseNum($("divSummaryYield_py").value);
    const retRate = parseNum($("divSummaryRetRate_py").value) || 28;
    gross = portfolio * (yieldPct / 100);
    tax = gross * (retRate / 100);
    net = gross - tax;

  } else if (mode === "yield_only") {
    // Usa só os ativos com yield_pct (ações/ETFs que pagam dividendos)
    const divData = calcDividendYield();
    const portfolioDiv = divData.divPortfolioVal;
    yieldPct = parseNum($("divSummaryYield_yo").value);
    const retRate = parseNum($("divSummaryRetRate_yo").value) || 28;
    gross = portfolioDiv * (yieldPct / 100);
    tax = gross * (retRate / 100);
    net = gross - tax;
  }

  return { gross, tax, net, yieldPct };
}

function updateDivSummaryLive() {
  const { gross, tax, net, yieldPct } = calcDivFromInputs();
  const liveEl = document.getElementById("divSummaryLive");
  if (!liveEl) return;
  if (!gross && !net) { liveEl.style.display = "none"; return; }
  liveEl.style.display = "";
  const retPct = gross > 0 ? (tax / gross * 100) : 0;
  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT("divSummaryLiveGross", fmtEUR2(gross));
  setT("divSummaryLiveNet", fmtEUR2(net));
  setT("divSummaryLiveMth", fmtEUR2(net / 12));
  setT("divSummaryLiveRet", tax > 0 ? `${fmtEUR2(tax)} (${fmtPct(retPct)})` : "Sem retenção");
}

function deleteDivSummary() {
  if (!editingDivSummaryId) return;
  const s = (state.divSummaries || []).find(x => x.id === editingDivSummaryId);
  if (!s) return;
  if (!confirm(`Apagar resumo de ${s.year}?`)) return;
  state.divSummaries = state.divSummaries.filter(x => x.id !== editingDivSummaryId);
  editingDivSummaryId = null;
  saveState();
  renderDividends();
  renderDashboard();
  initDivSummaryYearSelect();
  toast("Resumo apagado.");
}

function saveDivSummary() {
  const year = parseInt($("divSummaryYear").value);
  const { gross, tax, net, yieldPct } = calcDivFromInputs();
  const notes = ($("divSummaryNotes").value || "").trim();

  if (!gross || gross <= 0) { toast("Não foi possível calcular o bruto. Verifica os valores."); return; }
  if (!yieldPct || yieldPct <= 0) { toast("Introduz o Dividend Yield da corretora."); return; }

  if (!Array.isArray(state.divSummaries)) state.divSummaries = [];

  const obj = { id: editingDivSummaryId || uid(), year, gross, tax: tax || 0, yieldPct, notes };
  const ix = state.divSummaries.findIndex(s => s.id === obj.id || s.year === year);
  if (ix >= 0) state.divSummaries[ix] = obj;
  else state.divSummaries.push(obj);

  saveState();
  renderDividends();
  renderDashboard();
  // Auto-fill projection yield field
  const projYieldEl = $("divProjYield");
  if (projYieldEl && !projYieldEl.value) projYieldEl.value = String(yieldPct);
  toast(`Resumo ${year} guardado. Líquido: ${fmtEUR2(net)}`);
}

function renderDivSummaryKPIs() {
  const el = $("divSummaryKPIs");
  if (!el) return;
  const summaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  if (!summaries.length) { el.innerHTML = ""; return; }

  const latest = summaries[0];
  const net = parseNum(latest.gross) - parseNum(latest.tax);
  const divData = calcDividendYield();
  const divPortfolioVal = divData.divPortfolioVal;

  // Yield implícito: bruto / valor carteira de DIVIDENDOS (não carteira total)
  const impliedYield = divPortfolioVal > 0
    ? (parseNum(latest.gross) / divPortfolioVal * 100)
    : parseNum(latest.yieldPct);

  // Crescimento YoY
  let yoyGrowth = null;
  if (summaries.length >= 2) {
    const prev = summaries[1];
    yoyGrowth = ((parseNum(latest.gross) - parseNum(prev.gross)) / Math.max(1, parseNum(prev.gross))) * 100;
  }

  el.innerHTML = `
    <div class="kpiRow" style="margin-top:0">
      <div class="kpi kpi--in">
        <div class="kpi__k">Recebido ${latest.year} (líquido)</div>
        <div class="kpi__v">${fmtEUR2(net)}</div>
        <div class="kpi__s">Bruto ${fmtEUR2(parseNum(latest.gross))}</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Yield médio (corretora)</div>
        <div class="kpi__v">${fmtPct(parseNum(latest.yieldPct))}</div>
        <div class="kpi__s">Implícito: ${fmtPct(impliedYield)}</div>
      </div>
      <div class="kpi kpi--out">
        <div class="kpi__k">Retenção ${latest.year}</div>
        <div class="kpi__v">${fmtEUR2(parseNum(latest.tax))}</div>
        <div class="kpi__s">${parseNum(latest.gross) > 0 ? fmtPct(parseNum(latest.tax)/parseNum(latest.gross)*100) : "—"} do bruto</div>
      </div>
    </div>
    <div class="kpiRow" style="margin-top:10px">
      <div class="kpi kpi--net">
        <div class="kpi__k">Mensal médio (líquido)</div>
        <div class="kpi__v">${fmtEUR2(net / 12)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Crescimento YoY</div>
        <div class="kpi__v" style="color:${yoyGrowth === null ? '#667085' : yoyGrowth >= 0 ? '#059669' : '#dc2626'}">
          ${yoyGrowth === null ? "—" : (yoyGrowth >= 0 ? "+" : "") + fmtPct(yoyGrowth)}
        </div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Anos registados</div>
        <div class="kpi__v">${summaries.length}</div>
      </div>
    </div>`;
}

function renderDivSummaryList() {
  const list = $("divSummaryList");
  if (!list) return;
  const summaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  if (!summaries.length) {
    list.innerHTML = `<div class="item" style="cursor:default"><div class="item__l"><div class="item__t">Sem resumos registados</div><div class="item__s">Preenche o formulário acima com os dados da corretora.</div></div></div>`;
    return;
  }
  list.innerHTML = summaries.map((s, i) => {
    const net = parseNum(s.gross) - parseNum(s.tax);
    const prev = summaries[i + 1];
    const yoy = prev ? ((parseNum(s.gross) - parseNum(prev.gross)) / Math.max(1, parseNum(prev.gross)) * 100) : null;
    return `<div class="item" data-summary-id="${s.id}" style="cursor:pointer">
      <div class="item__l">
        <div class="item__t">${s.year} ${s.notes ? `· ${escapeHtml(s.notes)}` : ""}</div>
        <div class="item__s">Yield ${fmtPct(parseNum(s.yieldPct))} · Bruto ${fmtEUR2(parseNum(s.gross))}${parseNum(s.tax) > 0 ? ` · Ret. ${fmtEUR2(parseNum(s.tax))}` : ""}${yoy !== null ? ` · YoY ${yoy >= 0 ? "+" : ""}${fmtPct(yoy)}` : ""}</div>
      </div>
      <div class="item__v" style="text-align:right">
        <div>${fmtEUR2(net)}</div>
        <div class="item__s">${fmtEUR2(net/12)}/mês</div>
      </div>
    </div>`;
  }).join("");

  // Click to edit
  list.querySelectorAll(".item[data-summary-id]").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.summaryId;
      const s = (state.divSummaries || []).find(x => x.id === id);
      if (!s) return;
      $("divSummaryYear").value = String(s.year);
      $("divSummaryGross").value = String(parseNum(s.gross));
      $("divSummaryTax").value = String(parseNum(s.tax));
      $("divSummaryYield").value = String(parseNum(s.yieldPct));
      $("divSummaryNotes").value = s.notes || "";
      editingDivSummaryId = s.id;
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast(`A editar ${s.year} — altera e guarda.`);
    });
  });
}

function renderDivSummaryChart() {
  const ctx = $("divSummaryChart") && $("divSummaryChart").getContext("2d");
  if (!ctx) return;
  if (divSummaryChart) divSummaryChart.destroy();

  const summaries = (state.divSummaries || []).slice().sort((a, b) => a.year - b.year);
  if (!summaries.length) return;

  const labels = summaries.map(s => String(s.year));
  const grossData = summaries.map(s => parseNum(s.gross));
  const netData = summaries.map(s => parseNum(s.gross) - parseNum(s.tax));
  const taxData = summaries.map(s => parseNum(s.tax));
  const yieldData = summaries.map(s => parseNum(s.yieldPct));

  divSummaryChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Líquido", data: netData, backgroundColor: "#10b981", stack: "s" },
        { label: "Retenção", data: taxData, backgroundColor: "#f59e0b", stack: "s" },
        {
          label: "Yield (%)",
          data: yieldData,
          type: "line",
          yAxisID: "y2",
          borderColor: "#5b5ce6",
          backgroundColor: "transparent",
          pointRadius: 5,
          pointBackgroundColor: "#5b5ce6",
          borderWidth: 2,
          tension: 0.3
        }
      ]
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => c.dataset.yAxisID === "y2"
              ? `${c.dataset.label}: ${fmtPct(c.raw)}`
              : `${c.dataset.label}: ${fmtEUR2(c.raw)}`
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmtEUR(v) } },
        y2: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => fmtPct(v) }
        }
      }
    }
  });
}

function renderDivProjection() {
  const summaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  const latest = summaries[0];

  // Get yield from projection field (user can override) or from latest summary
  const projYieldField = parseNum($("divProjYield").value);
  const baseYield = projYieldField > 0 ? projYieldField
    : (latest ? parseNum(latest.yieldPct) : calcPortfolioYield().weightedYield);

  if (!baseYield) { toast("Introduz o Dividend Yield no campo acima."); return; }

  const portfolioGrowth = parseNum($("divProjGrowth").value) || 7;
  const contrib = parseNum($("divProjContrib").value) || 0;
  const years = parseInt($("divProjYears").value) || 20;

  const divData = calcDividendYield();

  let portfolioVal, baseNet, baseGross, effectiveRetRate;

  if (latest) {
    const gross = parseNum(latest.gross);
    const tax = parseNum(latest.tax);
    baseGross = gross;
    baseNet = gross - tax; // líquido REAL do resumo — pode ser igual ao bruto se tax=0
    // Taxa de retenção real do resumo (não o default 28%)
    effectiveRetRate = gross > 0 ? (tax / gross) : 0;
    // Carteira implícita: bruto ÷ yield
    portfolioVal = baseYield > 0 ? gross / (baseYield / 100) : 0;
  } else {
    // Sem resumo: estima
    const userRetRate = parseNum($("divProjRet").value) || 0;
    effectiveRetRate = userRetRate / 100;
    portfolioVal = divData.divPortfolioVal;
    baseGross = divData.gross;
    baseNet = baseGross * (1 - effectiveRetRate);
  }

  if (!portfolioVal || portfolioVal <= 0) {
    toast("Guarda um resumo anual com o bruto e o yield da corretora.");
    return;
  }

  // Usar retenção do campo se preenchida, senão a do resumo
  const userRetField = parseNum($("divProjRet").value);
  const retRate = userRetField > 0 ? (userRetField / 100) : effectiveRetRate;

  // 3 cenários: yield -1%, yield mantido, yield +1%
  const scenarios = [
    { name: "Conservador", yield: Math.max(0.1, baseYield - 1), color: "#f59e0b" },
    { name: "Base (yield mantido)", yield: baseYield, color: "#10b981" },
    { name: "Otimista", yield: baseYield + 1, color: "#5b5ce6" }
  ];

  const allData = scenarios.map(sc => {
    const labels = [], netArr = [], grossArr = [];
    let curPortfolio = portfolioVal;
    for (let y = 0; y <= years; y++) {
      labels.push(y === 0 ? (latest ? String(latest.year) : "Hoje") : `+${y}a`);
      if (y === 0) {
        // Ano 0: valores REAIS do resumo, não calculados
        grossArr.push(baseGross);
        netArr.push(baseNet);
      } else {
        // Anos seguintes: carteira cresce, aplica yield e retenção
        const projGross = curPortfolio * (sc.yield / 100);
        const projNet = projGross * (1 - retRate);
        grossArr.push(projGross);
        netArr.push(projNet);
      }
      curPortfolio = curPortfolio * (1 + portfolioGrowth / 100) + contrib * 12;
    }
    return { ...sc, labels, netArr, grossArr };
  });

  const base = allData[1]; // cenário base
  const finalNet = base.netArr[years];
  const doubleYear = base.netArr.findIndex(v => v >= baseNet * 2);
  const tripleYear = base.netArr.findIndex(v => v >= baseNet * 3);

  // KPIs
  const kpiEl = $("divProjKPIs");
  const scenEl = document.getElementById("divProjScenarios");
  if (kpiEl && scenEl) {
    scenEl.style.display = "";
    kpiEl.innerHTML = `
      <div class="kpi kpi--in">
        <div class="kpi__k">Dividendo anual em ${years}a</div>
        <div class="kpi__v">${fmtEUR2(finalNet)}</div>
        <div class="kpi__s">${fmtEUR2(finalNet/12)}/mês líquido</div>
      </div>
      <div class="kpi kpi--net">
        <div class="kpi__k">Duplica em</div>
        <div class="kpi__v">${doubleYear > 0 ? doubleYear + " anos" : "> " + years + "a"}</div>
        <div class="kpi__s">Yield ${fmtPct(baseYield)} mantido</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Triplica em</div>
        <div class="kpi__v">${tripleYear > 0 ? tripleYear + " anos" : "> " + years + "a"}</div>
        <div class="kpi__s">vs ${fmtEUR2(baseNet)} hoje</div>
      </div>`;
  }

  // Milestones
  const mlEl = document.getElementById("divProjMilestones");
  if (mlEl) {
    const targets = [1,2,5,10,15,20].filter(y => y <= years);
    mlEl.innerHTML = targets.map(y => {
      const net = base.netArr[y];
      const growth = baseNet > 0 ? ((net - baseNet) / baseNet * 100) : 0;
      return `<div class="item" style="cursor:default">
        <div class="item__l">
          <div class="item__t">+${y} ano${y>1?"s":""}</div>
          <div class="item__s">+${fmtPct(growth)} vs hoje · ${fmtEUR2(net/12)}/mês</div>
        </div>
        <div class="item__v">${fmtEUR2(net)}/ano</div>
      </div>`;
    }).join("");
  }

  // Chart — 3 cenários
  const ctx = $("divProjChart") && $("divProjChart").getContext("2d");
  if (!ctx) return;
  if (divProjChart) divProjChart.destroy();

  divProjChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: base.labels,
      datasets: allData.map((sc, i) => ({
        label: `${sc.name} (${fmtPct(sc.yield)})`,
        data: sc.netArr,
        borderColor: sc.color,
        backgroundColor: i === 1 ? "rgba(16,185,129,.07)" : "transparent",
        fill: i === 1,
        tension: .4,
        pointRadius: 0,
        borderWidth: i === 1 ? 2.5 : 1.5,
        borderDash: i === 1 ? [] : [5, 4]
      }))
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${fmtEUR2(c.raw)}/ano (${fmtEUR2(c.raw/12)}/mês)`
          }
        }
      },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
    }
  });
}

function setDivMode(mode) {
  divMode = mode;
  const summary = document.getElementById("paneDivSummary");
  const detail = document.getElementById("paneDivDetail");
  const calendar = document.getElementById("paneDivCalendar");
  const segS = $("segDivSummary");
  const segD = $("segDivDetail");
  const segC = $("segDivCalendar");
  if (summary) summary.style.display = mode === "summary" ? "" : "none";
  if (detail) detail.style.display = mode === "detail" ? "" : "none";
  if (calendar) calendar.style.display = mode === "calendar" ? "" : "none";
  segS.classList.toggle("seg__btn--active", mode === "summary");
  segD.classList.toggle("seg__btn--active", mode === "detail");
  if (segC) segC.classList.toggle("seg__btn--active", mode === "calendar");
  if (mode === "calendar") renderDivCalendar();
  if (mode === "summary") {
    initDivSummaryYearSelect();
    renderDivSummaryKPIs();
    renderDivSummaryList();
    renderDivSummaryChart();
  }
}

/* ─── DIVIDENDOS — MODO INDIVIDUAL (existente) ──────────── */
let divExpanded = false;
let editingDivId = null;

function openDivModal(divId) {
  editingDivId = divId || null;
  const existing = divId ? (state.dividends || []).find(d => d.id === divId) : null;

  // Build asset selector
  const sel = $("dAsset");
  sel.innerHTML = `<option value="">-- Ativo --</option>`;
  for (const a of state.assets) {
    const o = document.createElement("option");
    o.value = a.id; o.textContent = a.name;
    sel.appendChild(o);
  }

  if (existing) {
    $("modalDivTitle").textContent = "Editar dividendo";
    $("dAsset").value = existing.assetId || "";
    $("dAmount").value = String(parseNum(existing.amount));
    $("dTax").value = String(parseNum(existing.taxWithheld) || "");
    $("dDate").value = existing.date || isoToday();
    $("dNotes").value = existing.notes || "";
    $("btnDeleteDiv").style.display = "";
  } else {
    $("modalDivTitle").textContent = "Registar dividendo";
    $("dAsset").value = "";
    $("dAmount").value = "";
    $("dTax").value = "";
    $("dDate").value = isoToday();
    $("dNotes").value = "";
    $("btnDeleteDiv").style.display = "none";
  }
  openModal("modalDiv");
}

function saveDivFromModal() {
  const assetId = $("dAsset").value;
  const assetName = assetId
    ? ((state.assets.find(a => a.id === assetId) || {}).name || "")
    : ($("dNotes").value || "Manual");
  const amount = parseNum($("dAmount").value);
  const taxWithheld = parseNum($("dTax").value);
  const date = $("dDate").value;
  const notes = ($("dNotes").value || "").trim();

  if (!amount || amount <= 0) { toast("Valor tem de ser > 0."); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Data inválida."); return; }

  if (!Array.isArray(state.dividends)) state.dividends = [];

  const obj = { id: editingDivId || uid(), assetId, assetName, amount, taxWithheld, date, notes };
  const ix = state.dividends.findIndex(d => d.id === obj.id);
  if (ix >= 0) state.dividends[ix] = obj; else state.dividends.push(obj);

  saveState();
  closeModal("modalDiv");
  renderDashboard();
  renderDividends();
  toast("Dividendo guardado.");
}

function deleteDivEntry() {
  if (!editingDivId) return;
  if (!confirm("Apagar este dividendo?")) return;
  state.dividends = (state.dividends || []).filter(d => d.id !== editingDivId);
  editingDivId = null;
  saveState();
  closeModal("modalDiv");
  renderDashboard();
  renderDividends();
  toast("Dividendo apagado.");
}

function renderDividends() {
  if (divMode === "summary") {
    initDivSummaryYearSelect();
    renderDivSummaryKPIs();
    renderDivSummaryList();
    renderDivSummaryChart();
    return;
  }
  // Detail mode
  const wrap = $("divList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const divs = (state.dividends || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!divs.length) {
    wrap.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem dividendos registados</div><div class="item__s">Usa "+ Dividendo" para registar.</div></div><div class="item__v">—</div></div>`;
    $("btnDivToggle").style.display = "none";
    return;
  }

  const shown = divExpanded ? divs : divs.slice(0, 8);
  for (const d of shown) {
    const net = parseNum(d.amount) - parseNum(d.taxWithheld || 0);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(d.assetName || "Manual")}</div>
      <div class="item__s">${escapeHtml(d.date)}${parseNum(d.taxWithheld) > 0 ? ` · Ret. ${fmtEUR2(d.taxWithheld)}` : ""}${d.notes ? ` · ${escapeHtml(d.notes)}` : ""}</div>
    </div>
    <div class="item__v" style="text-align:right">
      <div>${fmtEUR2(net)}</div>
      ${parseNum(d.taxWithheld) > 0 ? `<div class="item__s">Bruto ${fmtEUR2(parseNum(d.amount))}</div>` : ""}
    </div>`;
    row.addEventListener("click", () => openDivModal(d.id));
    wrap.appendChild(row);
  }

  if (divs.length > 8) {
    $("btnDivToggle").style.display = "inline";
    $("btnDivToggle").textContent = divExpanded ? "Ver menos" : `Ver todos (${divs.length})`;
  } else {
    $("btnDivToggle").style.display = "none";
  }

  // KPIs por período
  renderDivKPIs(divs);
  renderDivChart(divs);
}

function renderDivKPIs(divs) {
  const now = new Date();
  const yrStart = now.getFullYear() + "-01-01";
  const mStart = now.toISOString().slice(0, 7);

  const ytd = divs.filter(d => d.date >= yrStart).reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);
  const mtd = divs.filter(d => d.date.slice(0, 7) === mStart).reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);
  const total = divs.reduce((a, d) => a + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);
  const taxTotal = divs.reduce((a, d) => a + parseNum(d.taxWithheld || 0), 0);

  // By asset
  const byAsset = {};
  for (const d of divs) {
    const k = d.assetName || "Manual";
    byAsset[k] = (byAsset[k] || 0) + parseNum(d.amount) - parseNum(d.taxWithheld || 0);
  }
  const topAsset = Object.entries(byAsset).sort((a, b) => b[1] - a[1])[0];

  const el = $("divKPIs");
  if (!el) return;
  el.innerHTML = `
    <div class="kpiRow">
      <div class="kpi kpi--in"><div class="kpi__k">YTD (líquido)</div><div class="kpi__v">${fmtEUR2(ytd)}</div></div>
      <div class="kpi"><div class="kpi__k">Este mês</div><div class="kpi__v">${fmtEUR2(mtd)}</div></div>
      <div class="kpi kpi--net"><div class="kpi__k">Total acumulado</div><div class="kpi__v">${fmtEUR2(total)}</div></div>
    </div>
    <div class="kpiRow" style="margin-top:10px">
      <div class="kpi kpi--out"><div class="kpi__k">Retenção total</div><div class="kpi__v">${fmtEUR2(taxTotal)}</div></div>
      <div class="kpi" style="grid-column:span 2"><div class="kpi__k">Top ativo</div><div class="kpi__v" style="font-size:16px">${topAsset ? `${escapeHtml(topAsset[0])} · ${fmtEUR2(topAsset[1])}` : "—"}</div></div>
    </div>`;
}

function renderDivChart(divs) {
  const ctx = $("divChart") && $("divChart").getContext("2d");
  if (!ctx) return;
  if (window._divChart) window._divChart.destroy();
  if (!divs.length) return;

  // Group by month
  const byMonth = {};
  for (const d of divs) {
    const m = d.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { gross: 0, net: 0 };
    byMonth[m].gross += parseNum(d.amount);
    byMonth[m].net += parseNum(d.amount) - parseNum(d.taxWithheld || 0);
  }
  const keys = Object.keys(byMonth).sort().slice(-24);

  window._divChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: keys,
      datasets: [
        { label: "Líquido", data: keys.map(k => byMonth[k].net), backgroundColor: "#10b981" },
        { label: "Retenção", data: keys.map(k => byMonth[k].gross - byMonth[k].net), backgroundColor: "#f59e0b", stack: "g" }
      ]
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR2(c.raw)}` } }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmtEUR(v) } }
      }
    }
  });
}


const DIV_CALENDAR_DB = {
  "AAPL": {freq:"quarterly",months:[2, 5, 8, 11],yield:0.5,name:"Apple"},
  "ABEV": {freq:"semi",months:[4, 9],yield:6.4,name:"Ambev"},
  "ABR": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:13.8,name:"Arbor Realty"},
  "ABT": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.0,name:"Abbott"},
  "ADC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:4.2,name:"Agree Realty"},
  "ADM": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.1,name:"Archer-Daniels"},
  "ADP": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.2,name:"ADP"},
  "AFL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"Aflac"},
  "AGNC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:14.5,name:"AGNC Investment"},
  "AIR.FR": {freq:"annual",months:[4],yield:1.2,name:"Airbus"},
  "ARE": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.1,name:"Alexandria RE"},
  "BAC": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.4,name:"Bank of America"},
  "BAYN.DE": {freq:"annual",months:[5],yield:6.8,name:"Bayer"},
  "BCP.PT": {freq:"annual",months:[5],yield:4.5,name:"BCP"},
  "BEN": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.1,name:"Franklin Templeton"},
  "BMY": {freq:"quarterly",months:[2, 5, 8, 11],yield:5.1,name:"Bristol-Myers Squibb"},
  "BP.GB": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.8,name:"BP"},
  "CB": {freq:"quarterly",months:[1, 4, 7, 10],yield:1.4,name:"Chubb"},
  "CL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.3,name:"Colgate-Palmolive"},
  "CMCSA": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"Comcast"},
  "COR.PT": {freq:"annual",months:[5],yield:3.5,name:"Corticeira Amorim"},
  "CSCO": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"Cisco"},
  "CVX": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.2,name:"Chevron"},
  "EDP.PT": {freq:"annual",months:[5],yield:6.5,name:"EDP"},
  "EMR": {freq:"quarterly",months:[3, 6, 9, 12],yield:1.9,name:"Emerson Electric"},
  "EOG": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"EOG Resources"},
  "EQNR": {freq:"quarterly",months:[2, 5, 8, 11],yield:8.1,name:"Equinor"},
  "FDX": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.1,name:"FedEx"},
  "FMC": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.2,name:"FMC Corp"},
  "GAIN": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:7.1,name:"Gladstone Investment"},
  "GALP.PT": {freq:"semi",months:[5, 10],yield:5.2,name:"Galp"},
  "GD": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.1,name:"General Dynamics"},
  "GILD": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.7,name:"Gilead"},
  "GIS": {freq:"quarterly",months:[2, 5, 8, 11],yield:3.8,name:"General Mills"},
  "GOOD": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:8.2,name:"Gladstone Commercial"},
  "GSK.GB": {freq:"semi",months:[4, 10],yield:4.2,name:"GSK"},
  "GTY": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.5,name:"Getty Realty"},
  "HAL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"Halliburton"},
  "HD": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.5,name:"Home Depot"},
  "HRL": {freq:"quarterly",months:[2, 5, 8, 11],yield:3.8,name:"Hormel"},
  "IBM": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.1,name:"IBM"},
  "IMB.GB": {freq:"semi",months:[4, 10],yield:9.1,name:"Imperial Brands"},
  "INTC": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.2,name:"Intel"},
  "ITW": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.3,name:"Illinois Tool Works"},
  "JMT.PT": {freq:"annual",months:[4],yield:2.1,name:"Jerónimo Martins"},
  "KHC": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.5,name:"Kraft Heinz"},
  "KMB": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.7,name:"Kimberly-Clark"},
  "KO": {freq:"quarterly",months:[4, 7, 10, 12],yield:3.1,name:"Coca-Cola"},
  "KVUE": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.8,name:"Kenvue"},
  "LAND": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.8,name:"Gladstone Land"},
  "LGEN.GB": {freq:"semi",months:[6, 11],yield:8.5,name:"Legal & General"},
  "LMT": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.8,name:"Lockheed Martin"},
  "LTC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:6.1,name:"LTC Properties"},
  "LYB": {freq:"quarterly",months:[3, 6, 9, 12],yield:7.2,name:"LyondellBasell"},
  "MAIN": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.9,name:"Main Street Capital"},
  "MCD": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.3,name:"McDonald\'s"},
  "MDLZ": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.8,name:"Mondelez"},
  "MDT": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.5,name:"Medtronic"},
  "MET": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.2,name:"MetLife"},
  "MMM": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"3M"},
  "MPT": {freq:"quarterly",months:[1, 4, 7, 10],yield:16.0,name:"Medical Properties"},
  "MRK": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.7,name:"Merck"},
  "MSFT": {freq:"quarterly",months:[3, 6, 9, 12],yield:0.8,name:"Microsoft"},
  "NEE": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.3,name:"NextEra Energy"},
  "NESN.CH": {freq:"annual",months:[4],yield:3.1,name:"Nestlé"},
  "NGAS.GB": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.5,name:"National Grid"},
  "NOVO-B.DK": {freq:"semi",months:[3, 8],yield:1.8,name:"Novo Nordisk"},
  "NUE": {freq:"quarterly",months:[2, 5, 8, 11],yield:1.5,name:"Nucor"},
  "O": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.8,name:"Realty Income"},
  "PEP": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.2,name:"PepsiCo"},
  "PFE": {freq:"quarterly",months:[3, 6, 9, 12],yield:6.8,name:"Pfizer"},
  "PG": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.4,name:"Procter & Gamble"},
  "PKN.PL": {freq:"annual",months:[6],yield:8.2,name:"PKN Orlen"},
  "PLD": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.0,name:"Prologis"},
  "PPG": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.2,name:"PPG Industries"},
  "PSEC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:11.2,name:"Prospect Capital"},
  "RENE.PT": {freq:"annual",months:[5],yield:7.2,name:"REN"},
  "REXR": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.9,name:"Rexford Industrial"},
  "RIO": {freq:"semi",months:[3, 9],yield:6.8,name:"Rio Tinto"},
  "SAP.DE": {freq:"annual",months:[5],yield:1.5,name:"SAP"},
  "SBUX": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.1,name:"Starbucks"},
  "SLB": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.5,name:"Schlumberger"},
  "SPGI": {freq:"quarterly",months:[3, 6, 9, 12],yield:0.8,name:"S&P Global"},
  "STAG": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:4.1,name:"STAG Industrial"},
  "SU.FR": {freq:"annual",months:[5],yield:4.5,name:"Schneider Electric"},
  "SWKS": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.2,name:"Skyworks"},
  "SYY": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.8,name:"Sysco"},
  "T": {freq:"quarterly",months:[2, 5, 8, 11],yield:5.6,name:"AT&T"},
  "TGT": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.8,name:"Target"},
  "TROW": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.8,name:"T. Rowe Price"},
  "TTE.FR": {freq:"quarterly",months:[1, 4, 7, 10],yield:4.8,name:"TotalEnergies"},
  "VFC": {freq:"quarterly",months:[3, 6, 9, 12],yield:7.1,name:"VF Corp"},
  "VICI": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.2,name:"VICI Properties"},
  "VOD.GB": {freq:"semi",months:[2, 8],yield:10.2,name:"Vodafone"},
  "VOW.DE": {freq:"annual",months:[5],yield:7.5,name:"Volkswagen"},
  "VZ": {freq:"quarterly",months:[2, 5, 8, 11],yield:6.5,name:"Verizon"},
  "WEN": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.1,name:"Wendy\'s"},
  "XOM": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.5,name:"ExxonMobil"},
};

/* ─── DIVIDEND CALENDAR ──────────────────────────────────────────────────── */

function renderDivCalendar() {
  const container = document.getElementById("divCalendarContent");
  if (!container) return;

  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // Get all equity assets
  const EQUITY_CLS = new Set(["ações/etfs","acoes/etfs"]);
  const equityAssets = state.assets.filter(a => {
    const c = (a.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
    return EQUITY_CLS.has(c) && parseNum(a.value) > 0;
  });

  // Build upcoming payments for next 12 months
  const payments = [];
  for (const asset of equityAssets) {
    const ticker = (asset.name||"").toUpperCase().trim();
    const db = DIV_CALENDAR_DB[ticker];
    if (!db || db.freq === 'none' || !db.months.length) continue;

    const value = parseNum(asset.value);
    // Estimate annual dividend
    // First check if asset has a yield configured
    const configuredYield = asset.yieldType === 'yield_pct' ? parseNum(asset.yieldValue) : 0;
    const yieldPct = configuredYield > 0 ? configuredYield : db.yield;
    const annualDiv = value * (yieldPct / 100);
    const perPayment = annualDiv / db.months.length;

    // Add upcoming payment months
    for (let mi = 0; mi < 12; mi++) {
      let m = currentMonth + mi;
      let y = currentYear;
      if (m > 12) { m -= 12; y++; }
      if (db.months.includes(m)) {
        payments.push({
          ticker, name: db.name, month: m, year: y,
          amount: perPayment, freq: db.freq, yieldPct
        });
      }
    }
  }

  // Sort by year+month
  payments.sort((a,b) => a.year !== b.year ? a.year-b.year : a.month-b.month);

  if (!payments.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b">
      <div style="font-size:32px;margin-bottom:8px">📅</div>
      <div style="font-weight:600">Sem dividendos previstos</div>
      <div style="font-size:13px;margin-top:4px">Importa o CSV do DivTracker para ver o calendário</div>
    </div>`;
    return;
  }

  // Group by month
  const byMonth = {};
  for (const p of payments) {
    const key = `${p.year}-${String(p.month).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = {year:p.year, month:p.month, total:0, items:[]};
    byMonth[key].total += p.amount;
    byMonth[key].items.push(p);
  }

  const MONTHS_PT = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const FREQ_LABEL = {monthly:'Mensal',quarterly:'Trimestral',semi:'Semestral',annual:'Anual'};

  let html = '';
  for (const key of Object.keys(byMonth).sort()) {
    const grp = byMonth[key];
    const isCurrentMonth = grp.month === currentMonth && grp.year === currentYear;
    const headerBg = isCurrentMonth ? '#eef2ff' : '#f8fafc';
    const headerColor = isCurrentMonth ? '#4f46e5' : '#475569';

    html += `<div style="margin-bottom:16px">
      <div style="background:${headerBg};border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:800;font-size:15px;color:${headerColor}">
          ${isCurrentMonth ? '📍 ' : ''}${MONTHS_PT[grp.month]} ${grp.year}
        </div>
        <div style="font-weight:700;font-size:15px;color:#059669">~${fmtEUR(grp.total)}</div>
      </div>`;

    // Sort items by amount desc
    grp.items.sort((a,b) => b.amount-a.amount);
    for (const item of grp.items) {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #f1f5f9">
        <div style="font-weight:700;font-size:13px;font-family:monospace;min-width:80px;color:#0f172a">${escapeHtml(item.ticker)}</div>
        <div style="flex:1;font-size:12px;color:#64748b">${escapeHtml(item.name)} · ${FREQ_LABEL[item.freq]||item.freq}</div>
        <div style="font-weight:600;font-size:13px;color:#059669">~${fmtEUR(item.amount)}</div>
      </div>`;
    }
    html += `</div>`;
  }

  // Summary stats
  const totalAnnual = payments.reduce((s,p) => s + (p.amount * 12 / byMonth[`${p.year}-${String(p.month).padStart(2,'0')}`].items.length), 0);
  const uniqueTickers = [...new Set(payments.map(p=>p.ticker))].length;

  container.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:100px;background:#f0fdf4;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:2px">Próximos 12 meses</div>
        <div style="font-weight:800;font-size:16px;color:#059669">${fmtEUR(payments.reduce((s,p)=>s+p.amount,0))}</div>
      </div>
      <div style="flex:1;min-width:100px;background:#eff6ff;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:2px">Ações com dividendo</div>
        <div style="font-weight:800;font-size:16px;color:#4f46e5">${uniqueTickers}</div>
      </div>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">⚠️ Estimativas baseadas em yields históricos. Datas e valores aproximados.</div>
    ${html}`;
}

const TICKER_DB = {
  "2B76.DE": {s:"Tecnologia",r:"Europa"},
  "2B7D.DE": {s:"ETF",r:"Europa"},
  "3SUE.DE": {s:"ETF",r:"Europa"},
  "4BRZ.DE": {s:"ETF",r:"Europa"},
  "AAKI.DE": {s:"Tecnologia",r:"Europa"},
  "AAPL": {s:"Tecnologia",r:"EUA"},
  "ABEV": {s:"Consumo Básico",r:"Europa"},
  "ABR": {s:"Financeiros",r:"EUA"},
  "ABT": {s:"Saúde",r:"EUA"},
  "ACHR": {s:"Tecnologia",r:"EUA"},
  "ADC": {s:"Imobiliário",r:"EUA"},
  "ADM": {s:"Mat. Básicos",r:"EUA"},
  "AES": {s:"Energia",r:"EUA"},
  "AFL": {s:"Financeiros",r:"EUA"},
  "AGN.NL": {s:"Financeiros",r:"Europa"},
  "AGNC": {s:"Financeiros",r:"EUA"},
  "AGRO": {s:"Industriais",r:"EUA"},
  "AI": {s:"Tecnologia",r:"EUA"},
  "AI.FR": {s:"Tecnologia",r:"Europa"},
  "AIR": {s:"Industriais",r:"EUA"},
  "AIR.FR": {s:"Industriais",r:"Europa"},
  "AKZOF": {s:"Mat. Básicos",r:"EUA"},
  "ALAB": {s:"Tecnologia",r:"EUA"},
  "ALGIL.FR": {s:"Financeiros",r:"Europa"},
  "ALGO.CC": {s:"Cripto",r:"Cripto"},
  "ALUM.IT": {s:"Mat. Básicos",r:"Europa"},
  "AMAT": {s:"Tecnologia",r:"EUA"},
  "AMD": {s:"Tecnologia",r:"EUA"},
  "AMKR": {s:"Tecnologia",r:"EUA"},
  "AMZN": {s:"Tecnologia",r:"EUA"},
  "ANAV.DE": {s:"ETF",r:"Europa"},
  "APT.CC": {s:"Cripto",r:"Cripto"},
  "AR.CC": {s:"Cripto",r:"Cripto"},
  "ARB.CC": {s:"Cripto",r:"Cripto"},
  "ARE": {s:"Imobiliário",r:"EUA"},
  "ARM": {s:"Tecnologia",r:"EUA"},
  "ARRY": {s:"Tecnologia",r:"EUA"},
  "ATKR": {s:"Industriais",r:"EUA"},
  "ATOM.CC": {s:"Cripto",r:"Cripto"},
  "BA.GB": {s:"Industriais",r:"Europa"},
  "BABA": {s:"Consumo Cíclico",r:"Ásia-Pac."},
  "BAC": {s:"Financeiros",r:"EUA"},
  "BAM": {s:"Financeiros",r:"EUA"},
  "BAS.DE": {s:"Mat. Básicos",r:"Europa"},
  "BAYN.DE": {s:"Saúde",r:"Europa"},
  "BBAI": {s:"Tecnologia",r:"EUA"},
  "BCP.PT": {s:"Financeiros",r:"Europa"},
  "BEN": {s:"Financeiros",r:"EUA"},
  "BHP": {s:"Mat. Básicos",r:"EUA"},
  "BKH": {s:"Utilidades",r:"EUA"},
  "BMY": {s:"Saúde",r:"EUA"},
  "BORR": {s:"Energia",r:"EUA"},
  "BOTZ.GB": {s:"Tecnologia",r:"Europa"},
  "BP.GB": {s:"Energia",r:"Europa"},
  "BSX": {s:"Saúde",r:"EUA"},
  "BTC.CC": {s:"Cripto",r:"Cripto"},
  "BULL": {s:"Industriais",r:"EUA"},
  "CB": {s:"Financeiros",r:"EUA"},
  "CE": {s:"Mat. Básicos",r:"EUA"},
  "CEBS.DE": {s:"ETF",r:"Europa"},
  "CHRG.GB": {s:"Energia",r:"Europa"},
  "CL": {s:"Consumo Básico",r:"EUA"},
  "CLNX.ES": {s:"Comunicações",r:"Europa"},
  "CLSK": {s:"Tecnologia",r:"EUA"},
  "CMCSA": {s:"Comunicações",r:"EUA"},
  "COPA.GB": {s:"ETF",r:"Europa"},
  "CRML": {s:"Tecnologia",r:"EUA"},
  "CRSP": {s:"Tecnologia",r:"EUA"},
  "CRWV": {s:"Tecnologia",r:"EUA"},
  "CSAI": {s:"Tecnologia",r:"EUA"},
  "CSCO": {s:"Tecnologia",r:"EUA"},
  "CSG.NL": {s:"Financeiros",r:"Europa"},
  "CVS": {s:"Saúde",r:"EUA"},
  "CVV": {s:"Energia",r:"EUA"},
  "CVX": {s:"Energia",r:"EUA"},
  "DD": {s:"Industriais",r:"EUA"},
  "DHL.DE": {s:"Industriais",r:"Europa"},
  "DIS": {s:"Consumo Cíclico",r:"EUA"},
  "DISH": {s:"Comunicações",r:"EUA"},
  "DNN": {s:"Energia",r:"EUA"},
  "DOT.CC": {s:"Cripto",r:"Cripto"},
  "DPRO": {s:"Tecnologia",r:"EUA"},
  "DSY.FR": {s:"Tecnologia",r:"Europa"},
  "DVN": {s:"Energia",r:"EUA"},
  "EBRO.ES": {s:"Consumo Básico",r:"Europa"},
  "EDP.PT": {s:"Energia",r:"Europa"},
  "EDV.GB": {s:"Energia",r:"Europa"},
  "EGL.PT": {s:"Comunicações",r:"Europa"},
  "EGLN.GB": {s:"Energia",r:"Europa"},
  "ELE.ES": {s:"Comunicações",r:"Europa"},
  "EMR": {s:"Industriais",r:"EUA"},
  "ENS": {s:"Industriais",r:"EUA"},
  "EOG": {s:"Energia",r:"EUA"},
  "EOSE": {s:"Energia",r:"EUA"},
  "EQNR": {s:"Energia",r:"Europa"},
  "EQS.FR": {s:"Financeiros",r:"Europa"},
  "ES": {s:"Utilidades",r:"EUA"},
  "ETH.CC": {s:"Cripto",r:"Cripto"},
  "EVTL": {s:"Tecnologia",r:"EUA"},
  "FAST": {s:"Industriais",r:"EUA"},
  "FDX": {s:"Industriais",r:"EUA"},
  "FET.CC": {s:"Cripto",r:"Cripto"},
  "FIL.CC": {s:"Cripto",r:"Cripto"},
  "FMC": {s:"Mat. Básicos",r:"EUA"},
  "FRU.CA": {s:"Energia",r:"EUA"},
  "FTNT": {s:"Tecnologia",r:"EUA"},
  "FWIA.DE": {s:"ETF",r:"Europa"},
  "G2XJ.DE": {s:"ETF",r:"Europa"},
  "GAIN": {s:"Financeiros",r:"EUA"},
  "GALP.PT": {s:"Energia",r:"Europa"},
  "GCLX.GB": {s:"Energia",r:"Europa"},
  "GCTS": {s:"Tecnologia",r:"EUA"},
  "GD": {s:"Industriais",r:"EUA"},
  "GFC.FR": {s:"Financeiros",r:"Europa"},
  "GFS": {s:"Tecnologia",r:"EUA"},
  "GILD": {s:"Saúde",r:"EUA"},
  "GIS": {s:"Consumo Básico",r:"EUA"},
  "GOOD": {s:"Imobiliário",r:"EUA"},
  "GOOG": {s:"Tecnologia",r:"EUA"},
  "GSK.GB": {s:"Saúde",r:"Europa"},
  "GTY": {s:"Imobiliário",r:"EUA"},
  "GWW": {s:"Industriais",r:"EUA"},
  "HAL": {s:"Energia",r:"EUA"},
  "HBAR.CC": {s:"Cripto",r:"Cripto"},
  "HD": {s:"Consumo Cíclico",r:"EUA"},
  "HIMS": {s:"Consumo Cíclico",r:"EUA"},
  "HIVE.CC": {s:"Cripto",r:"Cripto"},
  "HOLO": {s:"Tecnologia",r:"EUA"},
  "HRL": {s:"Consumo Básico",r:"EUA"},
  "HTOO": {s:"Tecnologia",r:"EUA"},
  "HTWO.GB": {s:"Energia",r:"Europa"},
  "IB1T.DE": {s:"ETF",r:"Europa"},
  "IBM": {s:"Tecnologia",r:"EUA"},
  "IFX.DE": {s:"Tecnologia",r:"Europa"},
  "INDI": {s:"Tecnologia",r:"EUA"},
  "INJ.CC": {s:"Cripto",r:"Cripto"},
  "INTC": {s:"Tecnologia",r:"EUA"},
  "IONQ": {s:"Tecnologia",r:"EUA"},
  "IP": {s:"Industriais",r:"EUA"},
  "IPDM.GB": {s:"Imobiliário",r:"Europa"},
  "IPLT.GB": {s:"ETF",r:"Europa"},
  "ISAG.GB": {s:"ETF",r:"Europa"},
  "ISLN.GB": {s:"Imobiliário",r:"Europa"},
  "ITW": {s:"Industriais",r:"EUA"},
  "KHC": {s:"Consumo Básico",r:"EUA"},
  "KMB": {s:"Consumo Básico",r:"EUA"},
  "KO": {s:"Consumo Básico",r:"EUA"},
  "KVUE": {s:"Consumo Básico",r:"EUA"},
  "KWEB.GB": {s:"ETF",r:"Europa"},
  "LAES": {s:"Tecnologia",r:"EUA"},
  "LAND": {s:"Imobiliário",r:"EUA"},
  "LFWD": {s:"Tecnologia",r:"EUA"},
  "LGEN.GB": {s:"Imobiliário",r:"Europa"},
  "LINE": {s:"Imobiliário",r:"EUA"},
  "LINK.CC": {s:"Cripto",r:"Cripto"},
  "LMT": {s:"Industriais",r:"EUA"},
  "LND": {s:"Imobiliário",r:"EUA"},
  "LPTH": {s:"Tecnologia",r:"EUA"},
  "LRC.CC": {s:"Cripto",r:"Cripto"},
  "LTC": {s:"Imobiliário",r:"EUA"},
  "LW": {s:"Consumo Básico",r:"EUA"},
  "LYB": {s:"Mat. Básicos",r:"EUA"},
  "MAIN": {s:"Financeiros",r:"EUA"},
  "MARA": {s:"Tecnologia",r:"EUA"},
  "MAS": {s:"Industriais",r:"EUA"},
  "MBG.DE": {s:"Consumo Cíclico",r:"Europa"},
  "MBLY": {s:"Tecnologia",r:"EUA"},
  "MCD": {s:"Consumo Cíclico",r:"EUA"},
  "MCHP": {s:"Tecnologia",r:"EUA"},
  "MDLZ": {s:"Consumo Básico",r:"EUA"},
  "MDT": {s:"Saúde",r:"EUA"},
  "MET": {s:"Financeiros",r:"EUA"},
  "MGAM.GB": {s:"ETF",r:"Europa"},
  "MLGO": {s:"Tecnologia",r:"EUA"},
  "MMM": {s:"Industriais",r:"EUA"},
  "MPT": {s:"Imobiliário",r:"EUA"},
  "MRK": {s:"Saúde",r:"EUA"},
  "MRVL": {s:"Tecnologia",r:"EUA"},
  "MSFT": {s:"Tecnologia",r:"EUA"},
  "NBIS": {s:"Tecnologia",r:"EUA"},
  "NEAR.CC": {s:"Cripto",r:"Cripto"},
  "NEE": {s:"Utilidades",r:"EUA"},
  "NESN.CH": {s:"Saúde",r:"Europa"},
  "NET": {s:"Tecnologia",r:"EUA"},
  "NFE": {s:"Energia",r:"EUA"},
  "NFG": {s:"Energia",r:"EUA"},
  "NGAS.GB": {s:"Energia",r:"Europa"},
  "NKE": {s:"Consumo Cíclico",r:"EUA"},
  "NNE": {s:"Energia",r:"EUA"},
  "NONOF": {s:"Saúde",r:"Europa"},
  "NOVO-B.DK": {s:"Saúde",r:"Europa"},
  "NOW": {s:"Tecnologia",r:"EUA"},
  "NUE": {s:"Mat. Básicos",r:"EUA"},
  "NVDA": {s:"Tecnologia",r:"EUA"},
  "NXE": {s:"Energia",r:"EUA"},
  "O": {s:"Imobiliário",r:"EUA"},
  "OC": {s:"Industriais",r:"EUA"},
  "OMV.DE": {s:"Industriais",r:"Europa"},
  "OP.CC": {s:"Cripto",r:"Cripto"},
  "ORCL": {s:"Tecnologia",r:"EUA"},
  "OSCR": {s:"Saúde",r:"EUA"},
  "OTIS": {s:"Industriais",r:"EUA"},
  "OUST": {s:"Tecnologia",r:"EUA"},
  "PANW": {s:"Tecnologia",r:"EUA"},
  "PATH": {s:"Tecnologia",r:"EUA"},
  "PDYN": {s:"Tecnologia",r:"EUA"},
  "PEP": {s:"Consumo Básico",r:"EUA"},
  "PFE": {s:"Saúde",r:"EUA"},
  "PG": {s:"Consumo Básico",r:"EUA"},
  "PGNY": {s:"Saúde",r:"EUA"},
  "PK": {s:"Imobiliário",r:"EUA"},
  "PKN.PL": {s:"Energia",r:"Europa"},
  "PLD": {s:"Imobiliário",r:"EUA"},
  "PNR": {s:"Industriais",r:"EUA"},
  "POET": {s:"Tecnologia",r:"EUA"},
  "POL.CC": {s:"Cripto",r:"Cripto"},
  "PPG": {s:"Mat. Básicos",r:"EUA"},
  "PROP": {s:"Imobiliário",r:"EUA"},
  "PSEC": {s:"Financeiros",r:"EUA"},
  "PSKY": {s:"Tecnologia",r:"EUA"},
  "PYPL": {s:"Consumo Cíclico",r:"EUA"},
  "PYTH.CC": {s:"Cripto",r:"Cripto"},
  "QBTS": {s:"Tecnologia",r:"EUA"},
  "QCOM": {s:"Tecnologia",r:"EUA"},
  "QDV5.DE": {s:"ETF",r:"Europa"},
  "QDVE.DE": {s:"ETF",r:"Europa"},
  "QNT.CC": {s:"Cripto",r:"Cripto"},
  "QSR": {s:"Consumo Cíclico",r:"EUA"},
  "QUBT": {s:"Tecnologia",r:"EUA"},
  "RCAT": {s:"Tecnologia",r:"EUA"},
  "RDW": {s:"Tecnologia",r:"EUA"},
  "RENDER.CC": {s:"Cripto",r:"Cripto"},
  "RENE.PT": {s:"Energia",r:"Europa"},
  "REXR": {s:"Imobiliário",r:"EUA"},
  "RGTI": {s:"Tecnologia",r:"EUA"},
  "RIO": {s:"Mat. Básicos",r:"EUA"},
  "RIO1.DE": {s:"Mat. Básicos",r:"Europa"},
  "RIOT": {s:"Tecnologia",r:"EUA"},
  "ROG.CH": {s:"Saúde",r:"Europa"},
  "ROP": {s:"Financeiros",r:"EUA"},
  "RR.GB": {s:"Industriais",r:"Europa"},
  "RY": {s:"Financeiros",r:"EUA"},
  "S": {s:"Industriais",r:"EUA"},
  "SAP.DE": {s:"Tecnologia",r:"Europa"},
  "SATL": {s:"Tecnologia",r:"EUA"},
  "SBUX": {s:"Consumo Cíclico",r:"EUA"},
  "SEI.CC": {s:"Cripto",r:"Cripto"},
  "SES": {s:"Tecnologia",r:"EUA"},
  "SHA0.DE": {s:"ETF",r:"Europa"},
  "SIDU": {s:"Tecnologia",r:"EUA"},
  "SLB": {s:"Energia",r:"EUA"},
  "SMR": {s:"Energia",r:"EUA"},
  "SNOW": {s:"Tecnologia",r:"EUA"},
  "SOL.CC": {s:"Cripto",r:"Cripto"},
  "SON.PT": {s:"Comunicações",r:"Europa"},
  "SOUN": {s:"Tecnologia",r:"EUA"},
  "SPGI": {s:"Financeiros",r:"EUA"},
  "SPIR": {s:"Tecnologia",r:"EUA"},
  "SPY4.DE": {s:"ETF",r:"Europa"},
  "SPYD.DE": {s:"ETF",r:"Europa"},
  "SPYL.DE": {s:"ETF",r:"Europa"},
  "STAG": {s:"Imobiliário",r:"EUA"},
  "STLA": {s:"Consumo Cíclico",r:"Europa"},
  "STX.CC": {s:"Cripto",r:"Cripto"},
  "SUI.CC": {s:"Cripto",r:"Cripto"},
  "SWKS": {s:"Tecnologia",r:"EUA"},
  "SYY": {s:"Consumo Básico",r:"EUA"},
  "T": {s:"Comunicações",r:"EUA"},
  "TAO.CC": {s:"Cripto",r:"Cripto"},
  "TD": {s:"Financeiros",r:"EUA"},
  "TGT": {s:"Consumo Básico",r:"EUA"},
  "TRAC.CC": {s:"Cripto",r:"Cripto"},
  "TROW": {s:"Financeiros",r:"EUA"},
  "TSLA": {s:"Tecnologia",r:"EUA"},
  "TSSI": {s:"Tecnologia",r:"EUA"},
  "TTE.FR": {s:"Energia",r:"Europa"},
  "UAVS": {s:"Tecnologia",r:"EUA"},
  "UEC": {s:"Energia",r:"EUA"},
  "UMAC": {s:"Tecnologia",r:"EUA"},
  "UNA.NL": {s:"Consumo Básico",r:"Europa"},
  "URNU.DE": {s:"ETF",r:"Europa"},
  "UROY": {s:"Energia",r:"EUA"},
  "USAR": {s:"ETF",r:"Europa"},
  "UUUU": {s:"Energia",r:"EUA"},
  "V60A.DE": {s:"ETF",r:"Europa"},
  "VETH.DE": {s:"ETF",r:"Europa"},
  "VFC": {s:"Consumo Cíclico",r:"EUA"},
  "VGWD.DE": {s:"ETF",r:"Europa"},
  "VIB3.DE": {s:"Financeiros",r:"Europa"},
  "VICI": {s:"Imobiliário",r:"EUA"},
  "VIE.FR": {s:"Energia",r:"Europa"},
  "VOW.DE": {s:"Consumo Cíclico",r:"Europa"},
  "VOW3.DE": {s:"Consumo Cíclico",r:"Europa"},
  "VRLA.FR": {s:"Industriais",r:"Europa"},
  "VUAA.DE": {s:"ETF",r:"Europa"},
  "VUSA.DE": {s:"ETF",r:"Europa"},
  "VVMX.DE": {s:"ETF",r:"Europa"},
  "VVSM.DE": {s:"ETF",r:"Europa"},
  "VWCE.DE": {s:"ETF",r:"Europa"},
  "VZ": {s:"Comunicações",r:"EUA"},
  "WBD": {s:"Comunicações",r:"EUA"},
  "WCP.CA": {s:"Energia",r:"EUA"},
  "WEN": {s:"Consumo Básico",r:"EUA"},
  "WHR": {s:"Consumo Cíclico",r:"EUA"},
  "WTAI.GB": {s:"Tecnologia",r:"Europa"},
  "WULF": {s:"Tecnologia",r:"EUA"},
  "XDC.CC": {s:"Cripto",r:"Cripto"},
  "XDWH.DE": {s:"ETF",r:"Europa"},
  "XMLD.DE": {s:"ETF",r:"Europa"},
  "XOM": {s:"Energia",r:"EUA"},
  "XTZ.CC": {s:"Cripto",r:"Cripto"},
  "XYL": {s:"Industriais",r:"EUA"},
  "ZPRR.DE": {s:"ETF",r:"Europa"},
  "ZS": {s:"Tecnologia",r:"EUA"},
  "ZTS": {s:"Saúde",r:"EUA"},
};

/* ─── PORTFOLIO ANALYSIS: SECTOR + GEOGRAPHY CHARTS ─────────────────────── */

// Sector + region from static DB first, then from meta (⟳ Cotações), then from ticker suffix
function getTickerMeta(asset) {
  const name = (asset.name || "").trim().toUpperCase();
  // 1. Static DB (most comprehensive)
  const db = TICKER_DB[name];
  if (db) return { sector: db.s, region: db.r };

  // 2. meta from ⟳ Cotações
  const meta = asset.meta || {};
  if (meta.sector || meta.quoteType) {
    const SECTOR_PT = {
      "Technology":"Tecnologia","Financial Services":"Financeiros",
      "Healthcare":"Saúde","Consumer Cyclical":"Consumo Cíclico",
      "Consumer Defensive":"Consumo Básico","Industrials":"Industriais",
      "Basic Materials":"Mat. Básicos","Energy":"Energia",
      "Real Estate":"Imobiliário","Utilities":"Utilidades",
      "Communication Services":"Comunicações",
    };
    const qt = (meta.quoteType||"").toUpperCase();
    const s = qt === "CRYPTOCURRENCY" ? "Cripto"
            : qt === "ETF" ? "ETF"
            : (SECTOR_PT[meta.sector] || meta.sector || "");
    const cc = (meta.country||"").toLowerCase();
    const ex = (meta.exchange||"").toUpperCase();
    const r = qt === "CRYPTOCURRENCY" ? "Cripto"
            : cc.includes("united states") ? "EUA"
            : ["united kingdom","germany","france","italy","spain","netherlands",
               "portugal","belgium","sweden","norway","denmark","finland",
               "switzerland","austria","ireland","poland"].some(c=>cc.includes(c)) ? "Europa"
            : ["japan","china","hong kong","south korea","taiwan",
               "singapore","australia","india"].some(c=>cc.includes(c)) ? "Ásia-Pac."
            : cc.includes("brazil")||cc.includes("mexico") ? "Lat. América"
            : cc ? "Outros" : null;
    if (s || r) return { sector: s, region: r };
  }

  // 3. Infer from ticker suffix
  const cls = (asset.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
  if (cls === "cripto") return { sector: "Cripto", region: "Cripto" };
  const suffixes = [[".LS","Europa"],[".L","Europa"],[".DE","Europa"],[".PA","Europa"],
    [".MI","Europa"],[".AS","Europa"],[".MC","Europa"],[".BR","Europa"],
    [".WA","Europa"],[".SW","Europa"],[".ST","Europa"],[".OL","Europa"],
    [".HE","Europa"],[".CO","Europa"],[".AX","Ásia-Pac."],["-USD","Cripto"]];
  for (const [sfx, rgn] of suffixes)
    if (name.endsWith(sfx)) return { sector: name.includes("ETF")||name.length<=6 ? "ETF":"", region: rgn };

  // Plain ticker (no suffix) = US equity
  return { sector: "", region: "EUA" };
}

const SECTOR_PALETTE = [
  "#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#84cc16","#f97316","#ec4899","#64748b","#14b8a6","#a855f7","#f43f5e"
];
const GEO_PALETTE = ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16"];

let sectorChartInst = null, geoChartInst = null;

function makeLegendRow(label, value, total, color) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9">
    <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0"></div>
    <div style="flex:1;font-size:13px;font-weight:600">${escapeHtml(label)}</div>
    <div style="font-size:13px;color:#64748b">${fmtEUR(value)}</div>
    <div style="font-size:12px;font-weight:700;min-width:44px;text-align:right">${pct.toFixed(1)}%</div>
  </div>`;
}

function svgDonut(data, palette, totalLabel) {
  // data = [{label, value, pct}], returns SVG string
  const R = 90, cx = 110, cy = 110, stroke = 22;
  const r = R - stroke / 2;
  const circ = 2 * Math.PI * r;
  let offset = -Math.PI / 2; // start at top
  let paths = '';
  let total = data.reduce((s, d) => s + d.value, 0);

  data.forEach((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(offset);
    const y1 = cy + r * Math.sin(offset);
    const x2 = cx + r * Math.cos(offset + angle - 0.01);
    const y2 = cy + r * Math.sin(offset + angle - 0.01);
    const color = palette[i % palette.length];
    paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}"
      fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="butt"/>`;
    offset += angle;
  });

  return `<svg viewBox="0 0 220 220" style="width:100%;max-width:260px;display:block;margin:0 auto">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${stroke}"/>
    ${paths}
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="10" fill="#94a3b8">Total</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="13" font-weight="800" fill="#0f172a">${totalLabel}</text>
  </svg>`;
}

function legendRow(label, value, pct, color) {
  const bar = Math.round(pct * 1.2); // max ~120px
  return `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
      <span style="width:11px;height:11px;border-radius:2px;background:${color};flex-shrink:0;display:inline-block"></span>
      <span style="flex:1;font-size:13px;font-weight:600">${escapeHtml(label)}</span>
      <span style="font-size:13px;color:#475569">${fmtEUR(value)}</span>
      <span style="font-size:12px;font-weight:700;min-width:40px;text-align:right">${pct.toFixed(1)}%</span>
    </div>
    <div style="height:4px;background:#f1f5f9;border-radius:2px;margin-left:19px">
      <div style="height:4px;width:${Math.min(100,pct)}%;background:${color};border-radius:2px"></div>
    </div>
  </div>`;
}

function renderPortfolioCharts() {
  const EQUITY_CLS = new Set(["ações/etfs","acoes/etfs","cripto"]);
  const equityAssets = state.assets.filter(a => {
    const c = (a.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
    return EQUITY_CLS.has(c) && parseNum(a.value) > 0;
  });

  const sectorWrap = document.getElementById("sectorChartWrap");
  const geoWrap    = document.getElementById("geoChartWrap");
  const sectorND   = document.getElementById("sectorNoData");
  const geoND      = document.getElementById("geoNoData");

  if (!equityAssets.length) {
    if (sectorND) sectorND.style.display = "";
    if (sectorWrap) sectorWrap.style.display = "none";
    if (geoND) geoND.style.display = "";
    if (geoWrap) geoWrap.style.display = "none";
    return;
  }

  if (sectorND) sectorND.style.display = "none";
  if (sectorWrap) sectorWrap.style.display = "";
  if (geoND) geoND.style.display = "none";
  if (geoWrap) geoWrap.style.display = "";

  // ── SECTOR ──────────────────────────────────────
  const bySector = {};
  for (const a of equityAssets) {
    const { sector } = getTickerMeta(a);
    const key = sector || "Outros";
    bySector[key] = (bySector[key] || 0) + parseNum(a.value);
  }
  const sEntries = Object.entries(bySector).sort((a,b) => b[1]-a[1]);
  const sTotal = sEntries.reduce((s,[,v]) => s+v, 0);
  const sData = sEntries.map(([l,v]) => ({label:l, value:v, pct:v/sTotal*100}));

  if (sectorWrap) {
    sectorWrap.innerHTML =
      svgDonut(sData, SECTOR_PALETTE, fmtEUR(sTotal)) +
      '<div style="margin-top:12px">' +
      sData.map((d,i) => legendRow(d.label, d.value, d.pct, SECTOR_PALETTE[i%SECTOR_PALETTE.length])).join("") +
      '</div>';
  }

  // ── GEOGRAPHY ───────────────────────────────────
  const byRegion = {};
  for (const a of equityAssets) {
    const { region } = getTickerMeta(a);
    const key = region || "Outros";
    byRegion[key] = (byRegion[key] || 0) + parseNum(a.value);
  }
  const gEntries = Object.entries(byRegion).sort((a,b) => b[1]-a[1]);
  const gTotal = gEntries.reduce((s,[,v]) => s+v, 0);
  const gData = gEntries.map(([l,v]) => ({label:l, value:v, pct:v/gTotal*100}));

  if (geoWrap) {
    geoWrap.innerHTML =
      svgDonut(gData, GEO_PALETTE, fmtEUR(gTotal)) +
      '<div style="margin-top:12px">' +
      gData.map((d,i) => legendRow(d.label, d.value, d.pct, GEO_PALETTE[i%GEO_PALETTE.length])).join("") +
      '</div>';
  }
}


/* ─── ANALYSIS VIEW ───────────────────────────────────────── */
function renderAnalysis() {
  const tab = ($("analysisTab") && $("analysisTab").value) || "compound";
  document.querySelectorAll(".analysisPanelTab").forEach(p => { p.style.display = "none"; });
  const panel = document.getElementById("analysisPanelTab_" + tab);
  if (panel) panel.style.display = "";
  if (tab === "portfolio") renderPortfolioCharts();
  if (tab === "compound") renderCompoundPanel();
  if (tab === "forecast") renderForecastPanel();
  if (tab === "compare") renderComparePanel();
  if (tab === "fire") renderFire();
  if (tab === "fiscal") renderFiscalPanel();
  if (tab === "performance") { renderBenchmarkComparison(); renderRebalancing(); }
  if (tab === "drawdown") renderDrawdownPanel();
  if (tab === "ai") renderAIHistory();
}

/* ── Compound Interest Panel ── */

// Calcula o yield médio ponderado real da carteira
/* ─── CÁLCULOS DE RENDIMENTO SEPARADOS ────────────────────────
   calcDividendYield()  → só ações/ETFs/Fundos com dividend yield
                          usado na aba Dividendos
   calcPortfolioYield() → TODOS os ativos com rendimento passivo
                          (dividendos + rendas + depósitos + PPR…)
                          usado na aba Análise → Juro Composto
─────────────────────────────────────────────────────────────── */

// Ativo é "dividendo" se for ação/ETF/Fundo/Cripto com yield %
function isDividendAsset(a) {
  const cls = (a.class || "").toLowerCase();
  return ["ações/etfs","acoes/etfs","fundos","cripto","obrigações","obrigacoes"]
    .some(c => cls.includes(c.replace("/etfs","").replace("ç","c").replace("õ","o"))) ||
    cls.includes("a") && (cls.includes("etf") || cls.includes("a\u00e7\u00f5es"));
}

// Rendimento anual de dividendos (bruto) da carteira
// Usa divSummaries se existirem, senão estima pelos yields dos ativos
function calcDividendYield() {
  // 1) Se há resumo anual recente, usa esse
  const now = new Date();
  const latestSummary = (state.divSummaries || [])
    .filter(s => s.year >= now.getFullYear() - 1)
    .sort((a, b) => b.year - a.year)[0];
  if (latestSummary) {
    const gross = parseNum(latestSummary.gross);
    const net = gross - parseNum(latestSummary.tax);
    const yieldPct = parseNum(latestSummary.yieldPct);
    // Estimar valor da carteira de dividendos
    const divAssets = state.assets.filter(a => passiveFromItem(a) > 0 && a.yieldType === "yield_pct");
    const divPortfolioVal = divAssets.reduce((s, a) => s + parseNum(a.value), 0);
    return { gross, net, yieldPct, divPortfolioVal, source: "summary" };
  }

  // 2) Se há dividendos individuais (últimos 12 meses)
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const indivGross = (state.dividends || []).filter(d => d.date >= cutoff).reduce((s, d) => s + parseNum(d.amount), 0);
  const indivNet = (state.dividends || []).filter(d => d.date >= cutoff).reduce((s, d) => s + parseNum(d.amount) - parseNum(d.taxWithheld || 0), 0);
  if (indivGross > 0) {
    const divAssets = state.assets.filter(a => a.yieldType === "yield_pct");
    const divPortfolioVal = divAssets.reduce((s, a) => s + parseNum(a.value), 0);
    const yieldPct = divPortfolioVal > 0 ? (indivGross / divPortfolioVal * 100) : 0;
    return { gross: indivGross, net: indivNet, yieldPct, divPortfolioVal, source: "individual" };
  }

  // 3) Estimativa pelos yields dos ativos com yield_pct (ações/ETFs)
  let divPortfolioVal = 0, estimatedGross = 0;
  for (const a of state.assets) {
    if (a.yieldType !== "yield_pct") continue;
    const v = parseNum(a.value);
    const gross = v * (parseNum(a.yieldValue) / 100);
    divPortfolioVal += v;
    estimatedGross += gross;
  }
  const yieldPct = divPortfolioVal > 0 ? (estimatedGross / divPortfolioVal * 100) : 0;
  return { gross: estimatedGross, net: estimatedGross * 0.72, yieldPct, divPortfolioVal, source: "estimated" };
}

// Rendimento passivo total de TODOS os ativos (dividendos + rendas + depósitos + PPR + obrigações)
// Usado no simulador de Juro Composto
// Separa yield passivo (juros/rendas/dividendos) do retorno total (inclui valorização acções)
function calcPortfolioYield() {
  let totalValue = 0, totalPassive = 0;
  let equityValue = 0, nonEquityWithYieldValue = 0, nonEquityWithYieldPassive = 0;

  const EQUITY_CLS = ["acoes/etfs", "cripto", "fundos"];
  function isEquity(a) {
    const c = (a.class||"").toLowerCase()
      .replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o")
      .replace(/á|à|â/g,"a").replace(/é|è|ê/g,"e").replace(/í/g,"i")
      .replace(/ó|ô/g,"o").replace(/ú/g,"u");
    return EQUITY_CLS.some(e => c.includes(e.split("/")[0]));
  }

  for (const a of state.assets) {
    const v = parseNum(a.value);
    const p = passiveFromItem(a);
    totalValue += v;
    totalPassive += p;
    if (isEquity(a)) {
      equityValue += v;
    } else if (p > 0) {
      nonEquityWithYieldValue += v;
      nonEquityWithYieldPassive += p;
    }
  }

  // yield passivo = apenas rendimentos configurados / total activos
  // (o que o utilizador realmente recebe em cash: juros, rendas, dividendos registados)
  const weightedYield = totalValue > 0 ? (totalPassive / totalValue) * 100 : 0;

  // yield passivo dos activos não-equity com yield configurado (yield "limpo")
  // Ex: depósito 200k@3% + obrigação 100k@3% → yield não-equity = 3%
  const nonEquityYield = nonEquityWithYieldValue > 0
    ? (nonEquityWithYieldPassive / nonEquityWithYieldValue) * 100 : 0;

  // retorno total esperado = yield passivo + retorno de capital das acções
  // Para as acções/ETFs, usar TWR anualizado se disponível, senão estimativa histórica
  const twr = calcTWR ? calcTWR() : null;
  const equityReturnAnnual = (twr && twr.years >= 0.5 && Math.abs(twr.annualised) < 80)
    ? twr.annualised
    : 7; // estimativa histórica conservadora se sem dados

  const equityWeight = totalValue > 0 ? equityValue / totalValue : 0;
  const nonEquityWeight = totalValue > 0 ? (totalValue - equityValue) / totalValue : 1;
  const totalReturnBlended =
    equityWeight * equityReturnAnnual +
    nonEquityWeight * (nonEquityYield > 0 ? nonEquityYield : weightedYield);

  return {
    totalValue, totalPassive, weightedYield,
    nonEquityYield, equityReturnAnnual, equityWeight, nonEquityWeight,
    totalReturnBlended, equityValue,
    twr: twr ? twr.annualised : null
  };
}

// Estima contribuição mensal média dos últimos 6 meses de cashflow
function calcAvgMonthlySavings(months = 6) {
  const now = new Date();
  const byMonth = new Map();
  for (const t of state.transactions) {
    if (isInterAccountTransfer(t)) continue;
    const d = String(t.date || "").slice(0, 7);
    if (!d) continue;
    const cur = byMonth.get(d) || { in: 0, out: 0 };
    if (t.type === "in") cur.in += parseNum(t.amount);
    else cur.out += parseNum(t.amount);
    byMonth.set(d, cur);
  }
  const keys = [...byMonth.keys()].sort().slice(-months);
  if (!keys.length) return 0;
  const totalSaved = keys.reduce((s, k) => {
    const m = byMonth.get(k);
    return s + Math.max(0, m.in - m.out);
  }, 0);
  return totalSaved / keys.length;
}

function renderCompoundPanel() {
  const sel = $("compAsset");
  if (!sel) return;

  const portfolio = calcPortfolioYield();
  const avgSavings = calcAvgMonthlySavings(6);

  const prev = sel.value;
  sel.innerHTML = `<option value="__portfolio__">📊 Carteira completa (automático)</option>
    <option value="__custom__">✏️ Personalizado…</option>`;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const rate = a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
      a.yieldType === "yield_eur_year" ? parseNum(a.yieldValue) / Math.max(1, v) * 100 :
      a.yieldType === "rent_month" ? parseNum(a.yieldValue) * 12 / Math.max(1, v) * 100 : 0;
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.name} · ${fmtPct(rate)} · ${fmtEUR(v)}`;
    sel.appendChild(o);
  }

  const newVal = prev && prev !== "__portfolio__" ? prev : "__portfolio__";
  sel.value = newVal;
  syncCompoundFromAsset(portfolio, avgSavings);

  const note = document.getElementById("compPortfolioNote");
  if (note) {
    if (portfolio.totalValue > 0) {
      note.style.display = "";
      const breakdown = state.assets
        .filter(a => passiveFromItem(a) > 0)
        .map(a => `${a.name} (${fmtPct(
          a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
          a.yieldType === "yield_eur_year" ? parseNum(a.yieldValue)/Math.max(1,parseNum(a.value))*100 :
          a.yieldType === "rent_month" ? parseNum(a.yieldValue)*12/Math.max(1,parseNum(a.value))*100 : 0
        )})`).join(", ");
      note.innerHTML = `📊 <b>Capital total:</b> ${fmtEUR(portfolio.totalValue)} · Retorno blended <b>${fmtPct(portfolio.totalReturnBlended)}</b>
        <span style="font-size:11px;color:var(--muted)">
          (Yield passivo ${fmtPct(portfolio.weightedYield)} + acções ${fmtPct(portfolio.equityReturnAnnual)}${portfolio.twr ? " via TWR" : " estimado"})
        </span>
        · Rendimento passivo anual <b>${fmtEUR(portfolio.totalPassive)}</b><br>
        <span style="font-size:12px;color:#667085">Inclui: ${breakdown || "nenhum ativo com rendimento"}</span>${avgSavings > 0 ? `<br><span style="font-size:12px;color:#667085">Poupança média mensal: <b>${fmtEUR(avgSavings)}</b></span>` : ""}`;
    } else {
      note.style.display = "none";
    }
  }
}

function syncCompoundFromAsset(portfolioData, avgSavings) {
  const sel = $("compAsset");
  if (!sel) return;
  const id = sel.value;

  if (id === "__portfolio__") {
    // Preencher com dados reais da carteira completa
    const p = portfolioData || calcPortfolioYield();
    const s = avgSavings !== undefined ? avgSavings : calcAvgMonthlySavings(6);
    $("compPrincipal").value = String(Math.round(p.totalValue));
    // Usar retorno blended: yield passivo + retorno capital acções ponderado
    $("compRate").value = fmt(p.totalReturnBlended, 2);
    $("compFreq").value = "12"; // mensal por defeito para carteira
    $("compContrib").value = String(Math.round(s));
    return;
  }

  if (id === "__custom__") return; // não tocar nos campos

  // Ativo individual
  const a = state.assets.find(x => x.id === id);
  if (!a) return;
  $("compPrincipal").value = String(Math.round(parseNum(a.value)));
  const rate = a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
    a.yieldType === "yield_eur_year" ? fmt(parseNum(a.yieldValue) / Math.max(1, parseNum(a.value)) * 100, 2) :
    a.yieldType === "rent_month" ? fmt(parseNum(a.yieldValue) * 12 / Math.max(1, parseNum(a.value)) * 100, 2) : "0";
  $("compRate").value = String(rate);
  $("compFreq").value = String(a.compoundFreq || 12);
  $("compContrib").value = "0";
}

/* ─── INTEGRAÇÃO P&L → COMPOUND + FIRE ─────────────────────── */
/* ─── CAGR por posição (retorno anualizado real) ─────────────── */
function calcPositionCAGR(pos, asset) {
  // Usar TWR do portfólio se disponível — é o mais rigoroso
  const twr = calcTWR();
  if (twr && Math.abs(twr.annualised) < 100 && twr.years >= 0.5) {
    return twr.annualised; // já anualizado e time-weighted
  }
  // Fallback: CAGR da posição individual
  // gainPct é ganho total acumulado. Precisa da duração em anos.
  // Temos lastUpdated mas não a data de compra — usar 1 ano como estimativa conservadora
  // se não há data. Isto sub-estima o CAGR (mais conservador que sobre-estimar).
  const years = asset.buyDate
    ? (new Date() - new Date(asset.buyDate)) / (365.25 * 86400000)
    : 1; // conservador: assume 1 ano se sem data
  const yrs = Math.max(years, 0.5); // mínimo 6 meses
  const totalReturn = pos.gainPct / 100;
  const cagr = (Math.pow(1 + totalReturn, 1 / yrs) - 1) * 100;
  return Math.max(-50, Math.min(cagr, 100)); // cap ±100% para segurança
}

function usePnLInCompound() {
  const pnl = calcEquityPortfolioPnL();
  const t   = calcTotals();

  // Capital = net worth total
  $("compPrincipal").value = String(Math.round(t.net));

  // Taxa = TWR anualizado do portfólio (métrica correcta)
  // Fallback em cascata: TWR → CAGR médio ponderado → yield passivo
  const twr = calcTWR();
  let rate, rateSource;

  if (twr && twr.years >= 0.5 && Math.abs(twr.annualised) < 80) {
    // TWR anualizado — elimina efeito dos depósitos/levantamentos
    rate = twr.annualised;
    rateSource = `TWR anualizado (${twr.years} anos)`;
  } else {
    // Sem snapshots suficientes → yield passivo ponderado
    const py = calcPortfolioYield();
    rate = py.weightedYield;
    rateSource = "yield passivo ponderado";
  }

  // Incluir dividend yield nas acções/ETFs (reinvestimento)
  const divYield = calcDividendYield ? calcDividendYield().weightedYield || 0 : 0;
  const totalRate = rate + (divYield > 0 ? divYield * 0.72 : 0); // 72% = após IRS 28%

  $("compRate").value = fmt(Math.max(0.1, Math.min(totalRate, 50)), 2);

  // DCA = poupança mensal + investimento programado
  const savings = calcAvgMonthlySavings(6);
  const monthlyInvest = parseNum((document.getElementById("fireMonthlyInvest")||{}).value || 0);
  $("compContrib").value = String(Math.round(savings + monthlyInvest));

  const sel = $("compAsset");
  if (sel) sel.value = "__portfolio__";

  toast(`✅ Taxa: ${fmt(Math.min(totalRate,50),2)}% (${rateSource}${divYield > 0 ? ` + ${fmt(divYield*0.72,1)}% div líquido` : ""})`);
  calcAndRenderCompound();
  renderCompoundWithDCAPanel();
  renderReturnBreakdown();
}

function usePnLInFIRE() {
  const pnl = calcEquityPortfolioPnL();
  const withLive = pnl.positions.filter(p => p.pos.hasLivePrice);

  // Usar TWR anualizado — a métrica correcta para FIRE
  const twr = calcTWR();
  const retEl = document.getElementById("fireCustomReturn");

  if (twr && twr.years >= 0.5 && Math.abs(twr.annualised) < 80) {
    // TWR anualizado + dividend yield líquido
    const divYield = calcDividendYield ? calcDividendYield().weightedYield || 0 : 0;
    const totalRate = twr.annualised + divYield * 0.72;
    const safeRate = Math.max(0.1, Math.min(totalRate, 50));
    if (retEl) retEl.value = fmt(safeRate, 2);
    toast(`✅ FIRE: ${fmt(safeRate,2)}%/ano (TWR ${twr.years}a${divYield > 0 ? ` + div líq.` : ""})`);
  } else if (withLive.length >= 3) {
    // Fallback: CAGR conservador (assume 1 ano de holding)
    const totalCost = withLive.reduce((s,p) => s + p.pos.costBasis, 0);
    const wReturn   = withLive.reduce((s,p) => s + p.pos.gainPct * (p.pos.costBasis/totalCost), 0);
    // Converter ganho total em CAGR conservador (1 ano) — sub-estima propositadamente
    const conserv   = Math.max(0, Math.min(wReturn, 30));
    if (retEl) retEl.value = fmt(conserv, 2);
    toast(`⚠️ Sem TWR suficiente. Taxa conservadora ${fmt(conserv,2)}% — revê manualmente.`);
  } else {
    toast("⚡ Precisas de pelo menos 2 snapshots para o TWR. Regista o mês no Dashboard.");
    return;
  }

  // Investimento mensal programado → poupança mensal
  const monthlyEl = document.getElementById("fireSaveInput");
  const savings = calcAvgMonthlySavings(6);
  if (monthlyEl && savings > 0) monthlyEl.value = String(Math.round(savings));

  renderFire();
}

function calcAndRenderCompound() {
  const principal = parseNum($("compPrincipal").value);
  const rate = parseNum($("compRate").value);
  const years = parseInt($("compYears").value) || 20;
  const freq = parseInt($("compFreq").value) || 12;
  const contrib = parseNum($("compContrib").value);
  const mode = $("compAsset").value;

  if (principal <= 0 || rate <= 0) { toast("Preenche capital e taxa."); return; }

  const data = compoundGrowth(principal, rate, years, freq, contrib);
  const effRate = effectiveRate(rate, freq);
  const finalVal = data[data.length - 1].value;
  const totalContrib = contrib * 12 * years;
  const totalInterest = finalVal - principal - totalContrib;

  // KPI summary
  const tb = $("compoundTable");
  if (tb) {
    tb.innerHTML = `
    <div class="kpiRow">
      <div class="kpi"><div class="kpi__k">Capital inicial</div><div class="kpi__v">${fmtEUR(principal)}</div></div>
      <div class="kpi kpi--net"><div class="kpi__k">Taxa efetiva anual</div><div class="kpi__v">${fmtPct(effRate)}</div></div>
      <div class="kpi kpi--in"><div class="kpi__k">Valor em ${years}a</div><div class="kpi__v">${fmtEUR(finalVal)}</div></div>
    </div>
    <div class="kpiRow" style="margin-top:10px">
      <div class="kpi kpi--in"><div class="kpi__k">Juros acumulados</div><div class="kpi__v">${fmtEUR(totalInterest)}</div><div class="kpi__s">× ${fmt(finalVal/principal,1)} capital inicial</div></div>
      <div class="kpi"><div class="kpi__k">Contrib. total</div><div class="kpi__v">${fmtEUR(totalContrib)}</div>${contrib > 0 ? `<div class="kpi__s">${fmtEUR(contrib)}/mês</div>` : ""}</div>
      <div class="kpi kpi--net"><div class="kpi__k">Rendimento anual est.</div><div class="kpi__v">${fmtEUR(finalVal * rate / 100)}</div><div class="kpi__s">ao fim de ${years}a</div></div>
    </div>`;

    // Se for modo carteira, mostrar decomposição por ativo
    if (mode === "__portfolio__") {
      const assetsWithYield = state.assets.filter(a => passiveFromItem(a) > 0);
      if (assetsWithYield.length > 0) {
        const rows = assetsWithYield.map(a => {
          const v0 = parseNum(a.value);
          const r = a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
            a.yieldType === "yield_eur_year" ? parseNum(a.yieldValue) / Math.max(1, v0) * 100 :
            a.yieldType === "rent_month" ? parseNum(a.yieldValue) * 12 / Math.max(1, v0) * 100 : 0;
          const fq = a.compoundFreq || 1;
          const vN = compoundGrowth(v0, r, years, fq, 0)[years].value;
          return `<div class="item" style="cursor:default">
            <div class="item__l">
              <div class="item__t">${escapeHtml(a.name)}</div>
              <div class="item__s">${escapeHtml(a.class)} · ${fmtPct(r)}/ano · cap. ${fq}×/ano</div>
            </div>
            <div class="item__v" style="text-align:right">
              <div>${fmtEUR(vN)}</div>
              <div class="item__s" style="color:#059669">+${fmtEUR(vN - v0)}</div>
            </div>
          </div>`;
        }).join("");
        tb.innerHTML += `<div style="margin-top:14px"><div class="card__title" style="font-size:16px;margin-bottom:8px">Decomposição por ativo (${years}a)</div><div class="list">${rows}</div></div>`;
      }
    }
  }

  // Milestones
  const mt = $("compoundMilestones");
  if (mt) {
    const milestones = [1, 2, 3, 5, 10, 15, 20, 25, 30].filter(y => y <= years);
    mt.innerHTML = milestones.map(y => {
      const d = data[y];
      const gain = d.value - principal;
      const annualIncome = d.value * rate / 100;
      return `<div class="item" style="cursor:default">
        <div class="item__l">
          <div class="item__t">Ano ${y}</div>
          <div class="item__s">Ganho: ${fmtEUR(gain)} · Rend. anual est.: ${fmtEUR(annualIncome)}</div>
        </div>
        <div class="item__v">${fmtEUR(d.value)}</div>
      </div>`;
    }).join("");
  }

  // Chart — 3 linhas
  // GARANTIA MATEMÁTICA:
  // Juro composto (freq>1): P*(1+r/n)^(n*t) — exponencial
  // Juro simples: P*(1+r*t) — linear, SEMPRE abaixo do composto para r>0, t>0
  // Só capital: P+C*t — linha recta sem qualquer juro
  const ctx = $("compoundChart") && $("compoundChart").getContext("2d");
  if (!ctx) return;
  if (compoundChart) compoundChart.destroy();

  // Juro simples ANUAL: sempre calculado com taxa efectiva anual sobre capital inicial
  // Fórmula: P*(1 + r*t) + contribuições*t (sem reinvestimento)
  const effRateDecimal = effectiveRate(rate, freq) / 100; // taxa efectiva anual real
  const simpleLine = data.map((_, i) => {
    // Juro simples: juros calculados sobre o principal original × número de anos
    const interest = principal * effRateDecimal * i;
    const contribs = contrib * 12 * i;
    return principal + interest + contribs;
  });

  // Só capital: zero rendimento, apenas principal + contribuições
  const contribLine = data.map((_, i) => principal + contrib * 12 * i);

  // Verificação: se algum ponto do composto ficar abaixo do simples (não devia acontecer),
  // é sinal que a taxa é muito pequena — avisamos no tooltip
  const maxSimple = Math.max(...simpleLine);
  const maxCompound = Math.max(...data.map(d => d.value));

  compoundChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(d => `+${d.year}a`),
      datasets: [
        {
          label: "Juro composto",
          data: data.map(d => d.value),
          tension: .4, borderColor: "#5b5ce6",
          backgroundColor: "rgba(91,92,230,.09)", fill: true,
          pointRadius: 0, borderWidth: 2.5
        },
        {
          label: "Juro simples",
          data: simpleLine,
          tension: 0, borderDash: [6, 4], borderColor: "#f59e0b",
          borderWidth: 1.8, pointRadius: 0, fill: false
        },
        {
          label: "Só capital",
          data: contribLine,
          tension: 0, borderDash: [2, 6], borderColor: "#94a3b8",
          borderWidth: 1.5, pointRadius: 0, fill: false
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { weight: "bold" } } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}`,
            afterBody: (items) => {
              const yr = items[0]?.dataIndex || 0;
              if (yr === 0) return [];
              const comp = data[yr]?.value || 0;
              const simp = simpleLine[yr] || 0;
              const diff = comp - simp;
              if (diff > 1) return [`✅ Vantagem do composto: +${fmtEUR(diff)}`];
              return [];
            }
          }
        }
      },
      scales: {
        y: { ticks: { callback: v => fmtEUR(v) } },
        x: { ticks: { maxTicksLimit: 10 } }
      }
    }
  });
}

/* ── Forecast / Rentabilidade Panel ── */
function renderForecastPanel() {
  const years = parseInt($("forecastYears") && $("forecastYears").value) || 10;
  const t = calcTotals();

  // per-asset forecast
  const rows = state.assets.filter(a => {
    const yt = a.yieldType || "none";
    return yt !== "none" || (a.compoundFreq && parseNum(a.yieldValue) > 0);
  });

  const tbl = $("forecastTable");
  if (tbl) {
    if (!rows.length) {
      tbl.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Nenhum ativo com rendimento configurado</div><div class="item__s">Edita os ativos e define yield/taxa.</div></div><div class="item__v">—</div></div>`;
    } else {
      tbl.innerHTML = rows.map(a => {
        const v0 = parseNum(a.value);
        const rate = a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
          a.yieldType === "yield_eur_year" ? parseNum(a.yieldValue) / Math.max(1, v0) * 100 :
          a.yieldType === "rent_month" ? parseNum(a.yieldValue) * 12 / Math.max(1, v0) * 100 : 0;
        const freq = a.compoundFreq || 1; // default annual for non-compound assets
        const vN = compoundGrowth(v0, rate, years, freq, 0)[years].value;
        const gain = vN - v0;
        return `<div class="item">
          <div class="item__l">
            <div class="item__t">${escapeHtml(a.name)}</div>
            <div class="item__s">${escapeHtml(a.class)} · ${fmtPct(rate)}/ano · freq ${a.compoundFreq || 1}×</div>
          </div>
          <div class="item__v" style="text-align:right">
            <div>${fmtEUR(vN)}</div>
            <div class="item__s">+${fmtEUR(gain)}</div>
          </div>
        </div>`;
      }).join("");
    }
  }

  // Portfolio aggregate chart
  const ctx = $("forecastChart") && $("forecastChart").getContext("2d");
  if (!ctx) return;
  if (forecastChart) forecastChart.destroy();

  // Build aggregate projection for each year
  const aggData = [];
  for (let y = 0; y <= years; y++) {
    let total = 0;
    for (const a of state.assets) {
      const v0 = parseNum(a.value);
      const yt = a.yieldType || "none";
      const rate = yt === "yield_pct" ? parseNum(a.yieldValue) :
        yt === "yield_eur_year" ? parseNum(a.yieldValue) / Math.max(1, v0) * 100 :
        yt === "rent_month" ? parseNum(a.yieldValue) * 12 / Math.max(1, v0) * 100 : 0;
      const freq = a.compoundFreq || 1;
      total += compoundGrowth(v0, rate, y, freq, 0)[y].value;
    }
    aggData.push(total);
  }
  const labels = Array.from({ length: years + 1 }, (_, i) => `+${i}a`);
  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Portfólio projetado", data: aggData, tension: .4, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.08)", fill: true, pointRadius: 0 },
        { label: "Atual (sem crescimento)", data: Array(years + 1).fill(t.assetsTotal), borderDash: [6, 4], borderColor: "#94a3b8", borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: {
      plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } } },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
    }
  });
}

/* ── Compare Panel (YoY / MoM) ── */
function renderComparePanel() {
  const mode = ($("compareMode") && $("compareMode").value) || "yoy";
  const h = state.history.slice().sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));

  const ctx = $("compareChart") && $("compareChart").getContext("2d");
  if (!ctx) return;
  if (compareChart) compareChart.destroy();

  if (h.length < 2) {
    const tbl = $("compareTable");
    if (tbl) tbl.innerHTML = `<div class="note">Precisas de pelo menos 2 snapshots para comparar. Usa "Registar mês" no Dashboard.</div>`;
    return;
  }

  // Build deltas
  const deltas = [];
  for (let i = 1; i < h.length; i++) {
    const prev = h[i - 1], cur = h[i];
    const delta = parseNum(cur.net) - parseNum(prev.net);
    const pct = parseNum(prev.net) !== 0 ? (delta / Math.abs(parseNum(prev.net))) * 100 : 0;
    deltas.push({ label: cur.dateISO.slice(0, 7), prev: parseNum(prev.net), cur: parseNum(cur.net), delta, pct });
  }

  // YoY: group by year
  let displayData = deltas;
  if (mode === "yoy") {
    const byYear = {};
    for (const d of deltas) {
      const y = d.label.slice(0, 4);
      if (!byYear[y]) byYear[y] = { label: y, delta: 0, cur: 0 };
      byYear[y].delta += d.delta;
      byYear[y].cur = d.cur;
    }
    displayData = Object.values(byYear);
  }

  const colors = displayData.map(d => (d.delta || 0) >= 0 ? "#10b981" : "#ef4444");
  compareChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: displayData.map(d => d.label),
      datasets: [{ label: mode === "yoy" ? "Variação anual" : "Variação mensal", data: displayData.map(d => d.delta || 0), backgroundColor: colors }]
    },
    options: {
      plugins: { tooltip: { callbacks: { label: c => `${fmtEUR(c.raw)} (${fmtPct((c.raw / Math.abs(displayData[c.dataIndex].prev || 1)) * 100)})` } } },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
    }
  });

  const tbl = $("compareTable");
  if (tbl) {
    tbl.innerHTML = displayData.slice().reverse().map(d => {
      const sign = (d.delta || 0) >= 0 ? "+" : "";
      const cls = (d.delta || 0) >= 0 ? "kpi--in" : "kpi--out";
      return `<div class="item">
        <div class="item__l"><div class="item__t">${escapeHtml(d.label)}</div><div class="item__s">Valor: ${fmtEUR(d.cur)}</div></div>
        <div class="item__v ${cls}">${sign}${fmtEUR(d.delta || 0)}</div>
      </div>`;
    }).join("");
  }
}

/* ── FIRE Panel ── */
function renderFire() {
  const W = parseInt($("fireWindow").value || "6", 10);
  const H = parseInt($("fireHorizon").value || "30", 10);

  // Capital investível (excluindo habitação própria)
  const isHome = a => {
    const nm = (a.name||"").toLowerCase(), cl = (a.class||"").toLowerCase();
    return cl.includes("imob") && (nm.includes("casa")||nm.includes("habita")||nm.includes("home")||nm.includes("própri"));
  };
  const investible = state.assets.filter(a => !isHome(a)).reduce((s,a) => s + parseNum(a.value), 0);
  const debt = state.liabilities.reduce((s,a) => s + Math.abs(parseNum(a.value)), 0);
  const cap0 = Math.max(0, investible - debt);

  // Cashflow from transactions
  const byMonth = new Map();
  for (const t of (state.transactions||[])) {
    if (isInterAccountTransfer(t)) continue;
    const d = t.date||""; if (d.length < 7) continue;
    const ym = d.slice(0,7);
    const cur = byMonth.get(ym) || {inc:0,out:0};
    const v = parseNum(t.amount);
    if (t.type==="out") cur.out += v; else cur.inc += v;
    byMonth.set(ym, cur);
  }
  const mKeys = [...byMonth.keys()].sort().slice(-W);
  const avg = k => mKeys.length ? mKeys.reduce((s,m) => s + (byMonth.get(m)?.[k]||0), 0) / mKeys.length : 0;

  // Allow manual override
  const expInputVal    = parseNum($("fireExpInput").value);
  const saveInputVal   = parseNum($("fireSaveInput").value);
  const monthlyInvest  = parseNum((document.getElementById("fireMonthlyInvest")||{}).value || 0);
  const outM  = expInputVal  > 0 ? expInputVal  : avg("out");
  // Poupança = campo manual OR automático do balanço + investimento mensal programado
  const saveM = (saveInputVal > 0 ? saveInputVal : Math.max(0, avg("inc") - avg("out"))) + monthlyInvest;

  // Auto-fill inputs if empty
  if (!$("fireExpInput").value  && outM  > 0) $("fireExpInput").placeholder  = fmtEUR(outM).replace("€","").trim() + " (auto)";
  if (!$("fireSaveInput").value && saveM > 0) $("fireSaveInput").placeholder = fmtEUR(saveM).replace("€","").trim() + " (auto)";

  const exp0 = outM * 12;
  const totals = calcTotals();
  const passiveAnnual = totals.passiveAnnual;
  const yieldRate = cap0 > 0 ? passiveAnnual / cap0 : 0;

  // Update KPIs
  $("fireCap").textContent  = fmtEUR(cap0);
  $("fireExp").textContent  = fmtEUR(exp0);
  $("firePass").textContent = fmtEUR(passiveAnnual);
  $("fireSave").textContent = fmtEUR(saveM) + "/mês" + (monthlyInvest > 0 ? ` (incl. ${fmtEUR(monthlyInvest)} DCA)` : "");

  // Progress bars (base scenario FIRE number = exp0 / 0.0375)
  const baseFireNum = exp0 > 0 ? exp0 / 0.0375 : 0;
  const capPct  = baseFireNum > 0 ? Math.min(100, cap0 / baseFireNum * 100) : 0;
  const passPct = exp0 > 0 ? Math.min(100, passiveAnnual / exp0 * 100) : 0;
  $("fireCapPct").textContent  = capPct.toFixed(1) + "%";
  $("firePassPct").textContent = passPct.toFixed(1) + "%";
  const capBar  = document.getElementById("fireCapBar");
  const passBar = document.getElementById("firePassBar");
  if (capBar)  setTimeout(() => capBar.style.width  = capPct  + "%", 50);
  if (passBar) setTimeout(() => passBar.style.width = passPct + "%", 50);

  // Scenarios
  // v15: parâmetros custom opcionais
  const customReturnEl = document.getElementById("fireCustomReturn");
  const customInflEl   = document.getElementById("fireCustomInflation");
  const customR   = customReturnEl ? parseNum(customReturnEl.value) : 0;
  const customInf = customInflEl   ? parseNum(customInflEl.value)   : 0;
  const useR   = r   => customR   > 0 ? customR   / 100 : r;
  const useInf = inf => customInf > 0 ? customInf / 100 : inf;

  const scenarios = [
    { name:"Conservador", emoji:"🐢", r:useR(0.04), inf:useInf(0.03),  swr:0.0325, color:"#f59e0b" },
    { name:"Base",        emoji:"⚖️", r:useR(0.06), inf:useInf(0.025), swr:0.0375, color:"#6366f1" },
    { name:"Optimista",   emoji:"🚀", r:useR(0.08), inf:useInf(0.02),  swr:0.04,   color:"#10b981" },
  ];

  const results = [];
  for (const sc of scenarios) {
    let cap = cap0, exp = exp0, hit = null;
    const fireNum = sc.swr > 0 ? exp0 / sc.swr : Infinity;
    for (let t = 0; t <= H; t++) {
      const pass = yieldRate * cap;
      const fn = sc.swr > 0 ? exp / sc.swr : Infinity;
      if (!hit && cap >= fn && pass >= exp) hit = {t, cap, exp, pass, fireNum: fn};
      if (t < H) {
        cap = cap * (1 + sc.r) + saveM * 12;
        exp = exp * (1 + sc.inf);
      }
    }
    results.push({sc, hit, fireNum});
  }

  // Results list
  const list = $("fireResults");
  list.innerHTML = results.map(r => {
    const hitLabel = r.hit
      ? `<span style="color:#059669;font-weight:700">🎯 FIRE em ${r.hit.t} anos</span><br><span style="font-size:11px;color:#64748b">Capital: ${fmtEUR(r.hit.cap)} · Rend: ${fmtEUR(r.hit.pass)}/ano</span>`
      : `<span style="color:#ef4444;font-weight:600">Não atinge em ${H}a</span>`;
    return `<div style="padding:12px;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:18px">${r.sc.emoji}</span>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${r.sc.name}</div>
          <div style="font-size:11px;color:#94a3b8">Retorno ${fmtPct(r.sc.r*100)} · Inflação ${fmtPct(r.sc.inf*100)} · SWR ${fmtPct(r.sc.swr*100)}</div>
        </div>
        <div style="text-align:right">${hitLabel}</div>
      </div>
      <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden">
        <div style="height:5px;background:${r.sc.color};border-radius:3px;width:${Math.min(100,cap0/r.fireNum*100).toFixed(1)}%"></div>
      </div>
    </div>`;
  }).join("");

  // FIRE numbers card
  const numsEl = document.getElementById("fireNumbers");
  if (numsEl) {
    numsEl.innerHTML = scenarios.map(sc => {
      const fn = sc.swr > 0 ? exp0 / sc.swr : Infinity;
      const gap = Math.max(0, fn - cap0);
      return `<div style="padding:10px;border-bottom:1px solid #f1f5f9">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:600">${sc.emoji} ${sc.name} (SWR ${fmtPct(sc.swr*100)})</div>
          <div style="font-weight:800;color:#0f172a">${fmtEUR(fn)}</div>
        </div>
        <div style="font-size:12px;color:${gap > 0 ? "#ef4444" : "#059669"};margin-top:2px">
          ${gap > 0 ? `Faltam ${fmtEUR(gap)}` : "✅ Já atingiste!"}
        </div>
      </div>`;
    }).join("");
  }

  // Partial independence
  const partialEl = document.getElementById("firePartial");
  if (partialEl && exp0 > 0) {
    const coverPct = Math.min(100, passiveAnnual / exp0 * 100);
    const uncovered = Math.max(0, exp0 - passiveAnnual);
    partialEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px">O teu rendimento passivo cobre</span>
        <span style="font-weight:800;font-size:15px;color:${coverPct>=100?"#059669":"#6366f1"}">${coverPct.toFixed(1)}%</span>
      </div>
      <div style="height:10px;background:#e2e8f0;border-radius:5px;overflow:hidden;margin-bottom:10px">
        <div style="height:10px;background:linear-gradient(90deg,#10b981,#6366f1);border-radius:5px;width:${coverPct}%;transition:width .6s"></div>
      </div>
      <div style="font-size:13px;color:#475569">
        ${coverPct >= 100
          ? "🎉 O teu rendimento passivo já cobre todas as despesas — estás financeiramente independente!"
          : `Faltam <b>${fmtEUR(uncovered)}/ano</b> (${fmtEUR(uncovered/12)}/mês) para cobertura total.`}
      </div>
      <div style="margin-top:10px;font-size:12px;color:#94a3b8">
        💡 Reduzir despesas em ${fmtEUR(uncovered/12)}/mês <b>ou</b> aumentar rendimento passivo ao mesmo valor = independência financeira.
      </div>`;
  }

  // Chart
  const canvas = $("fireChart");
  if (!canvas || !canvas.getContext) return;
  const base = scenarios[1];
  let cap = cap0, exp = exp0;
  const labels = [], capS = [], fireS = [], passS = [], cap2 = [], cap3 = [];
  let cap_cons = cap0, exp_cons = exp0;
  let cap_opt  = cap0, exp_opt  = exp0;
  for (let t = 0; t <= H; t++) {
    labels.push(t === 0 ? "Hoje" : "+" + t + "a");
    capS.push(Math.round(cap));
    fireS.push(base.swr > 0 ? Math.round(exp / base.swr) : null);
    passS.push(Math.round(yieldRate * cap * 1));
    cap2.push(Math.round(cap_cons));
    cap3.push(Math.round(cap_opt));
    if (t < H) {
      cap      = cap      * (1 + base.r)         + saveM * 12; exp      = exp      * (1 + base.inf);
      cap_cons = cap_cons * (1 + scenarios[0].r)  + saveM * 12; exp_cons = exp_cons * (1 + scenarios[0].inf);
      cap_opt  = cap_opt  * (1 + scenarios[2].r)  + saveM * 12; exp_opt  = exp_opt  * (1 + scenarios[2].inf);
    }
  }

  const ctx = canvas.getContext("2d");
  if (fireChart) fireChart.destroy();
  fireChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Capital (Base)", data: capS, tension:.3, borderColor:"#6366f1", backgroundColor:"rgba(99,102,241,.08)", fill:true, pointRadius:0, borderWidth:2 },
        { label: "Capital (Cons.)", data: cap2, tension:.3, borderColor:"#f59e0b", borderDash:[3,3], pointRadius:0, borderWidth:1.5 },
        { label: "Capital (Opt.)",  data: cap3, tension:.3, borderColor:"#10b981", borderDash:[3,3], pointRadius:0, borderWidth:1.5 },
        { label: "FIRE número", data: fireS, tension:.3, borderColor:"#ef4444", borderDash:[8,4], pointRadius:0, borderWidth:2 },
      ]
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v), font:{size:10} } } }
    }
  });
}

/* ─── DISTRIBUTION DETAIL MODAL ───────────────────────────── */
function openDistDetail(keepOpen = false) {
  const by = {};
  for (const a of state.assets) { const k = a.class || "Outros"; by[k] = (by[k] || 0) + parseNum(a.value); }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const list = $("distDetailList"), tog = $("btnDistToggle");
  if (!list) return;

  list.innerHTML = "";
  if (!entries.length) {
    list.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem dados</div></div></div>`;
  } else {
    const shown = distDetailExpanded ? entries : entries.slice(0, 10);
    for (const [cls, val] of shown) {
      const pct = total > 0 ? (val / total * 100) : 0;
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(cls)}</div><div class="item__s">${fmtPct(pct)} do portfólio · Toca para filtrar</div></div><div class="item__v">${fmtEUR(val)}</div>`;
      row.addEventListener("click", () => { setView("assets"); $("qClass").value = cls; renderItems(); closeModal("modalDist"); });
      list.appendChild(row);
    }
  }
  if (tog) {
    tog.style.display = entries.length > 10 ? "" : "none";
    tog.textContent = distDetailExpanded ? "Ver menos" : "Ver o resto";
  }
  if (!keepOpen) openModal("modalDist");
}

/* ─── IMPORT / EXPORT ─────────────────────────────────────── */
function parsePtDate(day, mon, year) {
  const m = normStr(mon).slice(0, 3);
  const map = { jan:1,fev:2,feb:2,mar:3,abr:4,apr:4,mai:5,may:5,jun:6,jul:7,ago:8,aug:8,set:9,sep:9,out:10,oct:10,nov:11,dez:12,dec:12 };
  const mm = map[m], dd = Number(day), yy = Number(year);
  if (!mm || !dd || !yy) return null;
  return `${yy.toString().padStart(4,"0")}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
}

function parseBankCsvLikeText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  const re = /^\s*"?(\d{1,2})\s+([A-Za-zÀ-ÿçÇ]{3})\s+(\d{4})\s+(.*?)\s+([\u2212\-]?\d[\d.]*,\d{2})€?\s+([\u2212\-]?\d[\d.]*,\d{2})€?"?\s*$/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(re);
    if (!m) continue;
    const iso = parsePtDate(m[1], m[2], m[3]);
    if (!iso) continue;
    const desc = String(m[4] || "").replace(/\s+/g, " ").trim();
    let val = null;
    const raw5 = m[5].replace(/\u2212/g, "-").replace(/\./g, "").replace(/,/g, ".");
    const n = Number(raw5);
    if (Number.isFinite(n)) val = n;
    if (val == null) continue;
    out.push({ date: iso, desc, amount: val });
  }
  return out;
}

function splitCSVLine(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; continue; } q = !q; continue; }
    if (!q && ch === delim) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function csvToObjects(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  const headerHints = ["tipo","type","class","classe","nome","name","ticker","symbol","valor","value","market","yield","amount","data","date","categoria","category","shares","qty"];

  function scoreHeader(line, delim) {
    const cols = splitCSVLine(line, delim).map(c => String(c || "").trim().toLowerCase());
    if (cols.length < 2) return -1;
    let hits = 0;
    for (const c of cols) for (const h of headerHints) if (c === h || c.includes(h)) { hits++; break; }
    return hits;
  }

  let bestDelim = ",", bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (!lines[i] || !lines[i].trim()) continue;
      const s = scoreHeader(lines[i], d);
      if (s > bestScore) { bestScore = s; bestDelim = d; }
    }
  }

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    if (scoreHeader(lines[i], bestDelim) >= 1) { headerIdx = i; break; }
  }
  if (headerIdx < 0) headerIdx = 0;

  const header = splitCSVLine(lines[headerIdx], bestDelim).map(h => String(h || "").trim());
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCSVLine(line, bestDelim);
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (cols[j] !== undefined) ? cols[j] : "";
    const any = Object.values(obj).some(v => String(v || "").trim() !== "");
    if (any) out.push(obj);
  }
  return out;
}

function normKey(k) {
  return String(k || "").trim().toLowerCase()
    .replace(/[\u00A0]/g, " ").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

function normalizeRow(obj) {
  const out = {};
  for (const k in (obj || {})) out[normKey(k)] = String(obj[k] ?? "").trim();
  return out;
}

function parseNumberSmart(x) {
  if (x === null || x === undefined) return NaN;
  let s = String(x).trim().replace(/[%€$£]/g, "").replace(/\s/g, "");
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma && !hasDot) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function classifyRow(r) {
  const tipo = (r.tipo || r.type || "").toLowerCase();
  if (["ativo","asset","assets"].includes(tipo)) return "ativo";
  if (["passivo","liability","debt","liabilities"].includes(tipo)) return "passivo";
  if (["movimento","transaction","movement","cashflow","tx","dividend"].includes(tipo)) return "movimento";
  const hasDate = !!(r.data || r.date || r.payment_date || r.trade_date);
  const amount = parseNumberSmart(r.montante || r.amount || r.valor || r.value || r.cash || r.total || r.net);
  const qty = parseNumberSmart(r.qty || r.quantity || r.shares || r.units);
  const mv = parseNumberSmart(r.market_value || r.current_value || r.total_value || r.value || r.valor);
  const hasTicker = !!(r.ticker || r.symbol);
  const cps = parseNumberSmart(r.cost_per_share || r.price || r.preco);
  if (hasTicker && Number.isFinite(qty) && Number.isFinite(cps)) return "trade";
  if (hasDate && Number.isFinite(amount) && Math.abs(amount) > 0) return "movimento";
  const hasId = !!(r.ticker || r.symbol || r.isin || r.nome || r.name);
  if (hasId && Number.isFinite(mv) && mv > 0) return "ativo";
  if (hasId && Number.isFinite(amount) && !hasDate && amount > 0) return "ativo";
  if (Number.isFinite(mv) && mv > 0) return "ativo";
  return "unknown";
}

function importRows(rows) {
  let addedA = 0, addedL = 0, addedT = 0, unknown = 0;
  const posMap = new Map();

  for (const raw of rows) {
    const r = normalizeRow(raw);
    const kind = classifyRow(r);

    if (kind === "trade") {
      const ticker = String(r.ticker || r.symbol || "").trim();
      const qty = parseNumberSmart(r.quantity || r.qty || r.shares || r.units);
      const cps = parseNumberSmart(r.cost_per_share || r.price || r.preco);
      const ccy = String(r.currency || r.ccy || "EUR").trim().toUpperCase();
      const comm = parseNumberSmart(r.commission || r.fee);
      if (!ticker || !Number.isFinite(qty) || !Number.isFinite(cps)) { unknown++; continue; }
      const key = `${ticker}|${ccy}`;
      const prev = posMap.get(key) || { ticker, ccy, qty: 0, cost: 0, comm: 0 };
      if (qty >= 0) { prev.qty += qty; prev.cost += qty * cps; if (Number.isFinite(comm) && comm > 0) prev.comm += comm; }
      else { const avg = prev.qty > 0 ? prev.cost / prev.qty : cps; prev.qty = Math.max(0, prev.qty - Math.abs(qty)); prev.cost = Math.max(0, prev.cost - Math.abs(qty) * avg); }
      posMap.set(key, prev);
      continue;
    }

    if (kind === "movimento") {
      const amtRaw = r.montante || r.amount || r.valor || r.value || r.cash || r.total || r.net;
      const amt = parseNumberSmart(amtRaw);
      if (!Number.isFinite(amt) || Math.abs(amt) < 1e-9) continue;
      const when = (r.data || r.date || r.payment_date || r.trade_date || "").trim();
      const cat = (r.categoria || r.category || r.classe || "Outros").trim() || "Outros";
      state.transactions.push({ id: uid(), date: normalizeDate(when) || isoToday(), type: amt >= 0 ? "in" : "out", category: cat, amount: Math.abs(amt), recurring: "none", notes: "" });
      addedT++;
      continue;
    }

    if (kind === "ativo" || kind === "passivo") {
      const name = (r.nome || r.name || r.instrument || r.security || r.asset || r.description || r.ticker || r.symbol || "Item").trim();
      const className = (r.classe || r.class || r.category || (kind === "passivo" ? "Dívida" : "Outros")).trim();
      const value = parseNumberSmart(r.valor || r.value || r.market_value || r.current_value || r.amount || r.total);
      if (!Number.isFinite(value) || Math.abs(value) < 1e-9) continue;
      const yv = parseNumberSmart(r.yield_valor || r.yield_value || r.yield || r.dividend_yield);
      const item = { id: uid(), class: normalizeClassName(className), name, value: Math.abs(value), yieldType: normalizeYieldType(r.yield_tipo || r.yield_type || ""), yieldValue: Number.isFinite(yv) ? yv : 0, compoundFreq: 12, notes: "" };
      if (kind === "passivo") { state.liabilities.push(item); addedL++; }
      else { state.assets.push(item); addedA++; }
      continue;
    }
    unknown++;
  }

  // Convert trades to assets
  // Step 1: merge multi-currency positions for same ticker into one asset
  const FX_TO_EUR = {
    EUR:1, USD:0.92, GBP:1.17, DKK:0.134, CHF:1.05, PLN:0.23,
    SEK:0.087, NOK:0.085, CAD:0.68, AUD:0.59, JPY:0.006,
    HKD:0.118, SGD:0.68, BRL:0.17, MXN:0.046, ZAR:0.052
  };
  const mergedPos = new Map();
  for (const p of posMap.values()) {
    if (!(p.qty > 0) || !(p.cost > 0)) continue;
    const t = p.ticker;
    if (!mergedPos.has(t)) mergedPos.set(t, { ticker:t, qty:0, cost:0, comm:0, ccys:[] });
    const m = mergedPos.get(t);
    m.qty  += p.qty;
    m.cost += p.cost;
    m.comm += p.comm || 0;
    if (!m.ccys.includes(p.ccy)) m.ccys.push(p.ccy);
  }

  // Step 2: create or update one asset per ticker with FX-converted cost
  for (const p of mergedPos.values()) {
    const upper = String(p.ticker).toUpperCase();
    const isCrypto = upper.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(upper.replace(/\.CC$/, ""));
    const cls = isCrypto ? "Cripto" : "Ações/ETFs";
    const ccyLabel = p.ccys.join("/");

    // Convert cost to EUR — re-iterate posMap to apply per-currency FX
    let costEUR = 0;
    for (const [, pos] of posMap.entries()) {
      if (pos.ticker !== p.ticker || pos.qty <= 0) continue;
      costEUR += pos.cost * (FX_TO_EUR[pos.ccy] || 1);
    }
    costEUR += p.comm || 0;

    const fxNote = p.ccys.some(c => c !== "EUR")
      ? " · ⚠️ Custo histórico (FX aprox.) — actualiza via ⟳ Cotações" : "";
    const notes = `Importado trades. Qty=${String(Math.round(p.qty*1e6)/1e6)} · PM=${p.cost > 0 ? String(Math.round(p.cost/p.qty*1e4)/1e4) : "—"} ${ccyLabel}${fxNote}`;

    const existingIx = state.assets.findIndex(a => (a.name||"").toUpperCase() === upper && a.class === cls);
    const assetObj = {
      id: existingIx >= 0 ? state.assets[existingIx].id : uid(),
      class: cls, name: p.ticker, value: costEUR,
      yieldType: "none", yieldValue: 0, compoundFreq: 12, notes,
      // Campos dedicados para P&L
      qty: p.qty,
      costBasis: costEUR,
      pmOriginal: p.qty > 0 ? p.cost / p.qty : 0,
      pmCcy: p.ccys[0] || "EUR"
    };
    if (existingIx >= 0) {
      state.assets[existingIx] = { ...state.assets[existingIx], ...assetObj };
    } else {
      state.assets.push(assetObj);
      addedA++;
    }
  }

  saveState();
  renderAll();

  const hint = $("importHint");
  if (hint) hint.textContent = addedA + addedL + addedT > 0 ? `Importado: ${addedA} ativos, ${addedL} passivos, ${addedT} movimentos.` : `Nenhum registo reconhecido (${rows.length} linhas).`;

  if (addedA + addedL + addedT === 0) {
    const cols = rows.length ? Object.keys(rows[0] || {}) : [];
    toast(`0 registos reconhecidos. Colunas: ${cols.slice(0,8).join(", ")}`);
  } else {
    toast(`Importado: ${addedA} ativos · ${addedL} passivos · ${addedT} movimentos`);
  }
}

async function fileToText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("Erro a ler ficheiro."));
    r.onload = () => res(String(r.result || ""));
    r.readAsText(file);
  });
}

/* ─── IMPORTAÇÃO UNIVERSAL DE EXTRACTOS ──────────────────────
   Suporta: CSV/TXT · Excel (.xlsx) · PDF
   Detecta formato automaticamente pelo nome/tipo do ficheiro
─────────────────────────────────────────────────────────────── */

/* ─── CATEGORIZAÇÃO AUTOMÁTICA ────────────────────────────────
   Reconhece padrões comuns em descrições de extractos bancários PT
─────────────────────────────────────────────────────────────── */
function autoCategorise(desc, dir) {
  const d = normStr(desc || "");

  // Entradas específicas
  if (dir === "in") {
    if (/salario|vencimento|remuneracao|ordenado/.test(d)) return "Salário";
    if (/subsidio|sub\. ?ferias|sub\. ?natal/.test(d)) return "Subsídio";
    if (/renda|aluguer|arrendamento/.test(d)) return "Renda recebida";
    if (/dividendo|dividend/.test(d)) return "Dividendos";
    if (/reembolso|devolucao|devol\./.test(d)) return "Reembolso";
    if (/transferencia de|trf\. de|trf\.imed\. de|recebido de/.test(d)) return "Transferência recebida";
    if (/mb way/.test(d) && dir === "in") return "MB Way recebido";
    if (/transferencia entre contas/.test(d)) return "Transferência entre contas";
    if (/^poupan|pouoanca|poupanca noutra/.test(d)) return "Poupança própria";
    if (/mesada pedro|mesada miudos/.test(d)) return "Mesada";
    if (/constituicao de d\.p|constituicao de dp/.test(d)) return "Constituição DP";
    if (/irs|at |autoridade tributaria/.test(d)) return "Reembolso IRS";
    if (/seguranca social|seg\. social/.test(d)) return "Segurança Social";
    if (/pensao|reforma/.test(d)) return "Pensão";
  }

  // Saídas — habitação
  if (/hipoteca|credito habitacao|credito \/ habitacao|ch /.test(d)) return "Crédito habitação";
  if (/condominio|cond\./.test(d)) return "Condomínio";
  if (/renda|aluguer/.test(d) && dir === "out") return "Renda";
  if (/agua|aguas de|aguas do/.test(d)) return "Água";
  if (/luz|eletricidade|edp|ibelectra|e\.on/.test(d)) return "Electricidade";
  if (/gas |galp|gas natural/.test(d)) return "Gás";
  if (/internet|meo|nos |vodafone|nowo|altice/.test(d)) return "Telecomunicações";

  // Saídas — seguros
  if (/seguro de vida/.test(d)) return "Seguro de vida";
  if (/seguro multi.riscos|seguro multiriscos/.test(d)) return "Seguro multirriscos";
  if (/seguro |ageas|fidelidade|tranquilidade|zurich|allianz|chubb/.test(d)) return "Seguros";

  // Saídas — transportes
  if (/via verde|autoestrada/.test(d)) return "Via Verde";
  if (/combustivel|galp|bp |repsol|shell/.test(d)) return "Combustível";
  if (/comboio|cp |metro |autocarro|uber|bolt/.test(d)) return "Transportes";
  if (/estacionamento|parque/.test(d)) return "Estacionamento";
  if (/levantamento|atm|multibanco/.test(d)) return "Levantamento";

  // Saídas — alimentação
  if (/continente|pingo doce|lidl|aldi|minipreco|minipreço|mercadona|supermercado/.test(d)) return "Supermercado";
  if (/restaurante|cafe |snack|pizza|mcdonalds|kfc|nandos|sushi/.test(d)) return "Restaurante";
  if (/padaria|pastelaria|confeitaria/.test(d)) return "Padaria";

  // Saídas — saúde
  if (/farmacia|farmácia|medicina|clinica|hospital|dentista|consultorio/.test(d)) return "Saúde";
  if (/ginasio|gym|fitness|coolgym|holmes|virgin/.test(d)) return "Ginásio";

  // Saídas — finanças
  if (/imposto|irs |iva |iuc |imt |at |fisco|tributaria/.test(d)) return "Impostos";
  if (/comissao|comissão|manutencao conta/.test(d)) return "Comissões bancárias";
  if (/deposito a prazo|constituicao de d\.p|dp |d\.p\./.test(d)) return "Constituição DP";
  if (/ppr |plano poupanca|subscricao ppr/.test(d)) return "PPR";
  if (/investimento|subscricao|fundo/.test(d)) return "Investimento";
  // Transferências internas (poupança, entre contas próprias, mesadas)
  if (/^poupan|pouoanca|poupanca noutra/.test(d)) return "Poupança própria";
  if (/mesada pedro|mesada miudos/.test(d)) return "Mesada";
  if (/transferencia entre contas/.test(d)) return "Transferência entre contas";
  if (/cred\.|credito consumo|credito pessoal/.test(d)) return "Crédito pessoal";
  if (/cartao|pagamento de conta cartao/.test(d)) return "Cartão de crédito";

  // Saídas — educação
  if (/escola|colegio|universidade|propina|aulas|explicador/.test(d)) return "Educação";

  // Saídas — lazer
  if (/netflix|spotify|amazon|apple\.com|google|disney|hbo/.test(d)) return "Subscrições";
  if (/cinema|teatro|concerto|bilhete/.test(d)) return "Lazer";

  // Transferências e MB Way genéricos
  if (/mb way para|mb way emitida|trf\. mb way para/.test(d)) return "MB Way enviado";
  if (/transferencia para|trf\. para|transferencia emitida|trf\. emitida/.test(d)) return "Transferência enviada";
  if (/transferencia entre contas/.test(d)) return "Transferência entre contas";

  // Serviços municipais
  if (/servicos municip|camara|municipal/.test(d)) return "Serviços municipais";

  // Fallback
  return dir === "in" ? "Outros recebimentos" : "Outras despesas";
}

async function importBankFile(file) {
  if (!file) throw new Error("Sem ficheiro.");
  const name = file.name.toLowerCase();
  let text = "";

  // Tenta parsers em cascata — do mais específico para o mais genérico
  let parsed = [];

  if (name.endsWith(".pdf")) {
    text = await extractTextFromPDF(file);
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    parsed = await parseXLSXBankRows(file);
    if (!parsed.length) { text = await extractTextFromXLSX(file); }
  } else {
    text = await fileToText(file);
  }

  // v15: detectar banco automaticamente pelo conteúdo
  const bankFmt = detectBankFormat(text || "");
  const bankNames = { cgd:"CGD", millennium:"Millennium BCP", novobanco:"Novo Banco",
    montepio:"Montepio", bpi:"BPI", santander:"Santander", generic:"Genérico" };
  const bankLabel = bankNames[bankFmt] || "Genérico";

  // Parsers específicos por banco detectado
  if (!parsed.length && bankFmt === "millennium")  parsed = parseMillenniumCSV(text);
  if (!parsed.length && bankFmt === "cgd")         parsed = parseCGDCSV(text);
  if (!parsed.length && bankFmt === "novobanco")   parsed = parseNovoBancoCSV(text);
  if (!parsed.length && (bankFmt === "montepio" || bankFmt === "bpi")) parsed = parseMontepioBPI(text);
  // Parsers universais em cascata
  if (!parsed.length) parsed = parseSantanderTabular(text || "");
  if (!parsed.length) parsed = parseSantanderPDF(text || "");
  if (!parsed.length) parsed = parseMillenniumCSV(text || "");
  if (!parsed.length) parsed = parseCGDCSV(text || "");
  if (!parsed.length) parsed = parseNovoBancoCSV(text || "");
  if (!parsed.length) parsed = parseMontepioBPI(text || "");
  if (!parsed.length) parsed = parseBankCsvLikeText(text || "");
  if (!parsed.length) parsed = parseBankCsvGeneric(text || "");

  if (!parsed.length && !text.trim()) {
    showBankResult("error", "Não foi possível extrair texto do ficheiro.");
    return { added: 0, dup: 0, read: 0 };
  }

  if (!parsed.length) {
    const firstLines = (text||"").split("\n").slice(0, 3).join(" | ").slice(0, 300);
    showBankResult("warn", `0 movimentos reconhecidos.<br><small>Banco detectado: <b>${typeof bankLabel !== "undefined" ? bankLabel : "Genérico"}</b><br>Primeiras linhas: ${escapeHtml(firstLines)}</small>`);
    return { added: 0, dup: 0, read: 0 };
  }

  // Deduplica
  // Deduplicação: chave = data|tipo|montante|descrição_original
  // A descrição original fica em notes; category pode ter mudado com auto-categorização
  // Dedup key: date + type + amount + first 30 normalised chars of description
  // Using truncated desc (not full) makes dedup robust across PDF/XLS/CSV variations
  // while still distinguishing legitimate same-day same-amount transactions (e.g. 2x PPR)
  function dedupKey(date, type, amount, desc) {
    const shortDesc = normStr(desc || "").slice(0, 30);
    return `${String(date||"").slice(0,10)}|${type}|${Math.round(Math.abs(amount)*100)}|${shortDesc}`;
  }

  const existing = new Set(state.transactions.map(tx => {
    const origDesc = tx.notes || tx.category || "";
    return dedupKey(tx.date, tx.type, parseNum(tx.amount), origDesc);
  }));

  let added = 0, dup = 0;
  let totalIn = 0, totalOut = 0;
  const newTx = [];

  for (const r of parsed) {
    const dir = r.amount >= 0 ? "in" : "out";
    const amount = Math.abs(r.amount);
    const key = dedupKey(r.date, dir, amount, r.desc);
    if (existing.has(key)) { dup++; continue; }
    existing.add(key);
    const category = autoCategorise(r.desc, dir);
    // Guardar descrição original em notes para deduplicação futura
    const tx = { id: uid(), type: dir, category, amount, date: r.date, recurring: "none", notes: r.desc || "" };
    state.transactions.push(tx);
    newTx.push(tx);
    if (dir === "in") totalIn += amount;
    else totalOut += amount;
    added++;
  }

  saveState();
  renderCashflow();

  // Resumo detalhado
  if (added > 0) {
    // Group by category
    const byCat = {};
    for (const tx of newTx) {
      if (!byCat[tx.category]) byCat[tx.category] = { in: 0, out: 0, n: 0 };
      byCat[tx.category][tx.type] += tx.amount;
      byCat[tx.category].n++;
    }
    const catRows = Object.entries(byCat)
      .sort((a,b) => (b[1].out + b[1].in) - (a[1].out + a[1].in))
      .slice(0, 8)
      .map(([cat, v]) => {
        const net = v.in - v.out;
        const color = net >= 0 ? "#059669" : "#dc2626";
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <span>${escapeHtml(cat)} <span style="color:#94a3b8;font-size:11px">(${v.n})</span></span>
          <span style="color:${color};font-weight:900">${net >= 0 ? "+" : ""}${fmtEUR2(net)}</span>
        </div>`;
      }).join("");

    showBankResult("ok", `
      <div style="margin-bottom:10px">
        ✅ <b>${added}</b> movimento${added!==1?"s":""} importado${added!==1?"s":""}
        ${dup > 0 ? ` · <span style="color:#92400e">${dup} duplicado${dup!==1?"s":""} ignorado${dup!==1?"s":""}</span>` : ""}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:#f0fdf4;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Entradas</div>
          <div style="font-weight:900;color:#059669">${fmtEUR2(totalIn)}</div>
        </div>
        <div style="background:#fef2f2;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Saídas</div>
          <div style="font-weight:900;color:#dc2626">${fmtEUR2(totalOut)}</div>
        </div>
        <div style="background:#f5f3ff;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Saldo</div>
          <div style="font-weight:900;color:${totalIn-totalOut>=0?"#059669":"#dc2626"}">${fmtEUR2(totalIn-totalOut)}</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:#667085;margin-bottom:4px">Por categoria:</div>
      ${catRows}
    `);
  } else {
    showBankResult("info", `ℹ️ 0 novos · ${dup} já existiam · ${parsed.length} lidos`);
  }

  toast(`${added} movimentos importados · Entradas ${fmtEUR2(totalIn)} · Saídas ${fmtEUR2(totalOut)}`);
  return { added, dup, read: parsed.length };
}

function showBankResult(type, html) {
  const el = document.getElementById("bankImportResult");
  if (!el) return;
  el.style.display = "";
  const colors = { ok: "#f0fdf4", warn: "#fffbeb", error: "#fef2f2", info: "#f5f3ff" };
  const borders = { ok: "#86efac", warn: "#fcd34d", error: "#fca5a5", info: "#c4b5fd" };
  el.style.background = colors[type] || "#f5f5f5";
  el.style.border = `1px solid ${borders[type] || "#e5e5e5"}`;
  el.style.borderRadius = "14px";
  el.style.padding = "12px 14px";
  el.style.fontWeight = "700";
  el.style.fontSize = "14px";
  el.innerHTML = html;
}

async function extractTextFromPDF(file) {
  // Tenta pdf.js primeiro (melhor qualidade, preserva estrutura de colunas)
  if (typeof pdfjsLib !== "undefined") {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Agrupar por Y (tolerância 2px), ordenar por X → preserva colunas
        const byY = new Map();
        for (const item of content.items) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] / 2) * 2;
          const x = item.transform[4];
          if (!byY.has(y)) byY.set(y, []);
          byY.get(y).push({ x, str: item.str });
        }
        const sortedYs = [...byY.keys()].sort((a, b) => b - a);
        for (const y of sortedYs) {
          const items = byY.get(y).sort((a, b) => a.x - b.x);
          fullText += items.map(i => i.str).join("\t") + "\n";
        }
      }
      if (fullText.trim()) return fullText;
    } catch(e) {
      console.warn("pdf.js falhou:", e.message);
    }
  }

  // Fallback: descompressão nativa do browser (iOS 16.4+ / Chrome / Firefox)
  console.log("pdf.js não disponível, a usar fallback nativo...");
  return extractPDFRaw(file);
}

async function extractPDFRaw(file) {
  // Fallback para quando pdf.js não está disponível.
  // Descomprime streams FlateDecode e reconstrói linhas usando operadores PDF (Td, TD, Tm, T*)
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const rawStr = new TextDecoder("latin1").decode(bytes);

    async function decompress(data) {
      try {
        // Tenta deflate-raw primeiro, depois deflate
        for (const fmt of ["deflate-raw", "deflate"]) {
          try {
            const ds = new DecompressionStream(fmt);
            const writer = ds.writable.getWriter();
            const reader = ds.readable.getReader();
            writer.write(data).catch(()=>{});
            writer.close().catch(()=>{});
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const total = chunks.reduce((a, c) => a + c.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) { out.set(c, offset); offset += c.length; }
            const text = new TextDecoder("latin1").decode(out);
            if (text.length > 10) return text;
          } catch(e) { continue; }
        }
        return null;
      } catch(e) { return null; }
    }

    // Encontrar todos os streams do PDF
    let allLines = [];
    const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = streamRe.exec(rawStr)) !== null) {
      const startIdx = m.index + m[0].indexOf('\n') + 1;
      const endIdx = m.index + m[0].lastIndexOf('endstream');
      if (endIdx <= startIdx) continue;
      const streamData = bytes.slice(startIdx, endIdx);
      const decompressed = await decompress(streamData);
      if (!decompressed) continue;

      // Processar blocos BT...ET (texto)
      const btBlocks = decompressed.match(/BT[\s\S]*?ET/g) || [];
      for (const block of btBlocks) {
        // Dividir em tokens para processar operadores em sequência
        const tokens = block.match(/\((?:[^)\\]|\\.)*\)|<[0-9A-Fa-f]*>|\[[\s\S]*?\]|[^\s\[\]]+/g) || [];
        const lineItems = []; // itens da linha corrente
        let currentLine = [];
        let lastY = null;

        let i = 0;
        while (i < tokens.length) {
          const tok = tokens[i];

          // String: (texto) ou <hex>
          if (tok.startsWith("(") && tok.endsWith(")")) {
            const str = tok.slice(1,-1)
              .replace(/\\n/g,"\n").replace(/\\r/g,"\r").replace(/\\t/g,"\t")
              .replace(/\\(.)/g,"$1");
            if (str.trim()) currentLine.push(str.trim());

          } else if (tok.startsWith("<") && tok.endsWith(">")) {
            // hex string
            const hex = tok.slice(1,-1);
            let str = "";
            for (let h=0; h<hex.length; h+=2) str += String.fromCharCode(parseInt(hex.slice(h,h+2),16));
            if (str.trim()) currentLine.push(str.trim());

          } else if (tok === "Tj" || tok === "'") {
            // Tj: usa currentLine como está
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            if (tok === "'") { allLines.push(lineItems.join("\t")); lineItems.length = 0; }

          } else if (tok === "TJ") {
            // TJ array — já processado nos tokens anteriores
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }

          } else if (tok === "Td" || tok === "TD") {
            // Mover posição — normalmente nova linha se dy != 0
            // Os dois tokens anteriores são dx dy
            const dy = parseFloat(tokens[i-1]) || 0;
            if (dy !== 0 && currentLine.length) {
              lineItems.push(currentLine.join(""));
              currentLine = [];
            }
            if (dy !== 0 || tok === "TD") {
              allLines.push(lineItems.join("\t"));
              lineItems.length = 0;
            }

          } else if (tok === "T*") {
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            allLines.push(lineItems.join("\t"));
            lineItems.length = 0;

          } else if (tok === "Tm") {
            // Matrix — nova posição absoluta, provavelmente nova linha
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            const newY = parseFloat(tokens[i-2]) || 0;
            if (lastY !== null && Math.abs(newY - lastY) > 2) {
              allLines.push(lineItems.join("\t"));
              lineItems.length = 0;
            }
            lastY = newY;
          }
          i++;
        }
        // Flush remaining
        if (currentLine.length) lineItems.push(currentLine.join(""));
        if (lineItems.length) allLines.push(lineItems.join("\t"));
      }
    }

    return allLines.filter(l => l.trim()).join("\n");
  } catch(e) {
    console.error("extractPDFRaw error:", e);
    return "";
  }
}

// Parser Santander Portugal — estado de máquina sobre sequência de tokens
// Encoding do PDF: "!" = €, '"' (char34) = sinal negativo
// Sequência: data → "D. valor:..." → descrição → ['"'] → valor → "!" → saldo → "!"
function parseSantanderPDF(text) {
  const out = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const monthMap = {
    jan:1,fev:2,feb:2,mar:3,abr:4,apr:4,mai:5,may:5,
    jun:6,jul:7,ago:8,aug:8,set:9,sep:9,out:10,oct:10,nov:11,dez:12,dec:12
  };

  function parsePTDate(s) {
    const m = String(s||"").match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
    if (!m) return null;
    const mon = monthMap[m[2].toLowerCase().slice(0,3)];
    if (!mon) return null;
    return `${m[3]}-${String(mon).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }

  let i = 0;
  while (i < lines.length) {
    const iso = parsePTDate(lines[i]);
    if (!iso) { i++; continue; }

    // Avança sobre linhas "D. valor: ..."
    let j = i + 1;
    while (j < lines.length && /^D[\.\s]?\s*valor/i.test(lines[j])) j++;
    if (j >= lines.length) { i++; continue; }

    const txLine = lines[j];

    // Ignorar cabeçalhos
    if (parsePTDate(txLine) ||
        /titular|conta pt|saldo disponível|movimentos da|página|pesquisas|data da opera/i.test(txLine)) {
      i = j; continue;
    }

    // Encontrar valores monetários — o sinal pode estar separado do valor
    // Ex: "Descrição\t−\t20,00€\t3.009,88€" ou "Descrição\t−20,00€\t3.024,88€"
    // Normalizar: juntar sinal solto ao valor
    const normLine = txLine.replace(/[\u2212\-]\s*(\d)/g, "-$1");

    const moneyRe = /([\-]?\d{1,3}(?:\.\d{3})*,\d{2})€/g;
    const moneyMatches = [...normLine.matchAll(moneyRe)];

    if (moneyMatches.length >= 1) {
      const rawAmt = moneyMatches[0][1].replace(/\./g,"").replace(/,/g,".");
      const amount = Number(rawAmt);
      if (Number.isFinite(amount)) {
        // Descrição: tudo antes do primeiro valor, sem sinais soltos no fim
        const amtIdx = normLine.indexOf(moneyMatches[0][0]);
        const desc = normLine.slice(0, amtIdx)
          .replace(/\t/g," ").replace(/[\u2212\-]\s*$/,"").replace(/\s+/g," ").trim() || "Movimento";
        if (!/^D[\.\s]?\s*valor/i.test(desc)) {
          out.push({ date: iso, desc, amount });
        }
      }
    }
    i = j + 1;
  }
  return out;
}


// Santander variant: text comes out as consecutive items on same line with tabs
// e.g. "13 abr 2026\tD. valor: 13 abr 2026\tTrf.imed. De Filipe...\t15,00€\t3.024,88€"
function parseSantanderTabular(text) {
  const out = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  const monthMap = {
    jan:1, fev:2, feb:2, mar:3, abr:4, apr:4, mai:5, may:5,
    jun:6, jul:7, ago:8, aug:8, set:9, sep:9, out:10, oct:10, nov:11, dez:12, dec:12
  };

  function parsePTDate2(s) {
    const m = String(s||"").trim().match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/);
    if (!m) return null;
    const mon = monthMap[m[2].toLowerCase().slice(0,3)];
    if (!mon) return null;
    return `${m[3]}-${String(mon).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }

  for (const line of lines) {
    // Skip header/footer lines
    if (/titular|conta|saldo|movimentos|página|pesquisas|defeito|documento/i.test(line) &&
        !/\d{1,3}(?:\.\d{3})*,\d{2}€/.test(line)) continue;
    if (/^D[\.\s]?\s*valor/i.test(line)) continue;
    if (/data da opera|opera.+valor.+saldo/i.test(line)) continue;

    const cols = line.split(/\t/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;

    // Find date in first columns
    let iso = null, descStart = 0;
    for (let i = 0; i < Math.min(3, cols.length); i++) {
      iso = parsePTDate2(cols[i]);
      if (iso) { descStart = i + 1; break; }
    }
    if (!iso) continue;

    // Find money values — sign may be a separate tab-column before the number
    // e.g. ["Descrição", "−", "20,00€", "3.009,88€"]
    const moneyRe = /^[\u2212\-]?\d{1,3}(?:\.\d{3})*,\d{2}€?$/;
    const moneyIdxs = cols.map((c, i) => moneyRe.test(c.replace(/\s/g,"")) ? i : -1).filter(i => i >= 0);

    // Also detect a lone sign column immediately before a money column
    const signIdxs = cols.map((c, i) => /^[\u2212\-]$/.test(c.trim()) ? i : -1).filter(i => i >= 0);

    if (!moneyIdxs.length) continue;
    const amtIdx = moneyIdxs[0];

    // Check if there's a lone sign column just before the amount
    const signBefore = signIdxs.find(si => si === amtIdx - 1);
    const rawAmt = cols[amtIdx].replace(/\u2212/g,"-").replace(/€/g,"").replace(/\./g,"").replace(/,/g,".");
    let amount = Number(rawAmt);
    if (!Number.isFinite(amount)) continue;
    if (signBefore !== undefined) amount = -Math.abs(amount);

    // Description: cols between date end and sign/amount
    const descEnd = signBefore !== undefined ? signBefore : amtIdx;
    const desc = cols.slice(descStart, descEnd).join(" ").trim() || "Movimento";
    if (/^D[\.\s]?\s*valor/i.test(desc)) continue;

    out.push({ date: iso, desc, amount });
  }
  return out;
}

async function extractTextFromXLSX(file) {
  try {
    if (typeof XLSX === "undefined") {
      toast("Biblioteca Excel não carregada. Tenta recarregar a página.");
      return "";
    }
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array", dateNF: "yyyy-mm-dd" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });
  } catch (e) {
    console.error("XLSX extraction error:", e);
    return "";
  }
}

// ─── XLSX BANK PARSER: structured row parsing (handles Santander, BCP, CGD…) ───
// Reads XLSX directly as row objects — no lossy text conversion.
// Detects columns by keyword, handles PT number format, separate debit/credit cols.
async function parseXLSXBankRows(file) {
  // Robust XLSX bank parser — uses VALUE PATTERNS not header keywords.
  // Keyword-based detection is unreliable (e.g. "Data valor" matches "valor" = amount keyword).
  // Instead: read raw numeric cells, identify columns by their value characteristics.
  try {
    if (typeof XLSX === "undefined") return [];
    const arrayBuffer = await file.arrayBuffer();
    // raw:true preserves actual numeric values without string formatting
    const wb = XLSX.read(arrayBuffer, { type: "array", raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Get rows with raw values (numbers stay as numbers)
    const jsonRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!jsonRows.length) return [];

    const nCols = Math.max(...jsonRows.map(r => r.length));

    // ── STEP 1: Find the first data row (has a parseable date in col 0 or 1) ──
    let firstDataRow = -1;
    for (let i = 0; i < Math.min(30, jsonRows.length); i++) {
      const row = jsonRows[i];
      for (let j = 0; j < Math.min(3, (row||[]).length); j++) {
        if (parseDateFlexible(String(row[j] || ""))) { firstDataRow = i; break; }
      }
      if (firstDataRow >= 0) break;
    }
    if (firstDataRow < 0) return [];

    // ── STEP 2: Identify columns by value patterns across data rows ──
    // For each column, count: how many numeric values, how many are negative, median magnitude
    const colStats = [];
    const dataRows = jsonRows.slice(firstDataRow);
    for (let j = 0; j < nCols; j++) {
      const nums = [];
      const texts = [];
      const dates = [];
      for (const row of dataRows) {
        if (!row || row[j] == null || row[j] === "") continue;
        const v = row[j];
        if (typeof v === "number") { nums.push(v); continue; }
        const s = String(v).trim();
        if (parseDateFlexible(s)) { dates.push(s); continue; }
        const n = parseEuroNum(s);
        if (n !== null && s.replace(/[€\s,.]/g,"").length > 0) { nums.push(n); continue; }
        if (s) texts.push(s);
      }
      const hasNeg = nums.some(v => v < 0);
      const allPos = nums.length > 0 && nums.every(v => v >= 0);
      const avgMag = nums.length ? nums.reduce((a,b)=>a+Math.abs(b),0)/nums.length : 0;
      colStats.push({ j, nums, texts, dates, hasNeg, allPos, avgMag,
        numCount: nums.length, textCount: texts.length, dateCount: dates.length });
    }

    // Date col: mostly date-formatted text strings
    const dateCol = colStats.reduce((best, c) =>
      c.dateCount > (best ? best.dateCount : -1) ? c : best, null)?.j ?? 0;

    // Amount col: has NEGATIVE values (signed amount), moderate magnitude
    // Balance col: all positive, usually larger running total
    const numericCols = colStats.filter(c => c.numCount > 5);
    let amtCol = -1, balCol = -1;
    if (numericCols.length === 1) {
      amtCol = numericCols[0].j;
    } else if (numericCols.length >= 2) {
      // Amount col has negatives; balance col is all positive with higher avg
      const withNeg = numericCols.filter(c => c.hasNeg);
      const allPos  = numericCols.filter(c => c.allPos);
      if (withNeg.length >= 1) amtCol = withNeg[0].j;
      if (allPos.length >= 1)  balCol = allPos.reduce((a,b) => b.avgMag > a.avgMag ? b : a).j;
      // If no negatives found, pick col with smallest avg magnitude as amount
      if (amtCol < 0 && numericCols.length >= 2) {
        amtCol = numericCols.reduce((a,b) => a.avgMag <= b.avgMag ? a : b).j;
        balCol = numericCols.reduce((a,b) => a.avgMag >= b.avgMag ? a : b).j;
      }
    }

    // Also check for separate Debit/Credit columns (some banks use two cols)
    let debitCol = -1, creditCol = -1;
    if (amtCol < 0 && numericCols.length >= 2) {
      // Try header keywords only as tiebreaker here (already past the detection phase)
      const headerRow = jsonRows[firstDataRow > 0 ? firstDataRow - 1 : 0] || [];
      headerRow.forEach((h, j) => {
        const hl = String(h||"").toLowerCase();
        if (/d[ée]bit|sa[ií]d|out/.test(hl) && debitCol < 0) debitCol = j;
        if (/cr[ée]dit|entrad|in/.test(hl) && creditCol < 0) creditCol = j;
      });
    }

    // Desc col: mostly long text, not dates, not numbers
    const descCol = colStats.reduce((best, c) => {
      if (c.j === dateCol || c.j === amtCol || c.j === balCol) return best;
      if (c.textCount > (best ? best.textCount : -1)) return c;
      return best;
    }, null)?.j ?? -1;

    // ── STEP 3: Parse each data row ──
    const out = [];
    for (const row of dataRows) {
      if (!row || row.every(v => v == null || v === "")) continue;

      // Date
      const rawDate = String(row[dateCol] || "").trim();
      const isoDate = parseDateFlexible(rawDate);
      if (!isoDate) continue;

      // Description
      const desc = descCol >= 0 ? String(row[descCol] || "").trim() : "Movimento";
      if (!desc || /^(data|saldo|balance|descrição|description)/i.test(desc)) continue;

      // Amount — prefer signed single column
      let amount = null;
      if (amtCol >= 0) {
        const v = row[amtCol];
        amount = typeof v === "number" ? v : parseEuroNum(String(v || ""));
      } else if (debitCol >= 0 || creditCol >= 0) {
        const dv = debitCol >= 0 ? (typeof row[debitCol]==="number" ? row[debitCol] : parseEuroNum(String(row[debitCol]||"")) || 0) : 0;
        const cv = creditCol >= 0 ? (typeof row[creditCol]==="number" ? row[creditCol] : parseEuroNum(String(row[creditCol]||"")) || 0) : 0;
        amount = cv - dv;
      }

      // Last-resort: scan numeric cols, skip balance col
      if (amount === null || !Number.isFinite(amount)) {
        for (const c of numericCols) {
          if (c.j === balCol) continue;
          const v = row[c.j];
          const n = typeof v === "number" ? v : parseEuroNum(String(v||""));
          if (n !== null && Number.isFinite(n)) { amount = n; break; }
        }
      }

      if (!Number.isFinite(amount)) continue;
      out.push({ date: isoDate, desc: desc || "Movimento", amount });
    }
    return out;
  } catch (e) {
    console.error("parseXLSXBankRows error:", e);
    return [];
  }
}

// Generic CSV bank parser — handles most Portuguese bank exports
function parseBankCsvGeneric(text) {
  const out = [];
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);

  // Try to find delimiter
  const delims = [";", ",", "\t", "|"];
  let bestDelim = ";";
  let maxCols = 0;
  for (const d of delims) {
    const cols = (lines.find(l => l.trim()) || "").split(d).length;
    if (cols > maxCols) { maxCols = cols; bestDelim = d; }
  }

  // Find header row — look for date/description/amount keywords
  const dateKw = ["data","date","datum","fecha","dt"];
  const descKw = ["descri","movimento","operacao","conceito","narrat","detail","memo","ref"];
  const amtKw  = ["montante","amount","debito","credito","importe","movim"]; // "valor"/"saldo" removed: too ambiguous

  let headerIdx = -1, dateCol = -1, descCol = -1, amtCol = -1, debitCol = -1, creditCol = -1;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const row = splitCSVLine(lines[i], bestDelim).map(c => c.trim().toLowerCase());
    if (row.length < 2) continue;
    let score = 0;
    let di = -1, dsi = -1, ai = -1, dbi = -1, cri = -1;
    row.forEach((c, j) => {
      if (dateKw.some(k => c.includes(k))) { di = j; score++; }
      if (descKw.some(k => c.includes(k))) { dsi = j; score++; }
      if (amtKw.some(k => c.includes(k))) {
        if (c.includes("debito") || c.includes("saida") || c.includes("debit")) dbi = j;
        else if (c.includes("credito") || c.includes("entrada") || c.includes("credit")) cri = j;
        else ai = j;
        score++;
      }
    });
    if (score >= 2) {
      headerIdx = i; dateCol = di; descCol = dsi; amtCol = ai; debitCol = dbi; creditCol = cri;
      break;
    }
  }

  if (headerIdx < 0) return [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCSVLine(line, bestDelim).map(c => c.trim());
    if (cols.length < 2) continue;

    // Date
    const rawDate = dateCol >= 0 ? cols[dateCol] : cols[0];
    const isoDate = parseDateFlexible(rawDate);
    if (!isoDate) continue;

    // Description
    const desc = (descCol >= 0 ? cols[descCol] : cols.slice(1, 3).join(" ")).trim();

    // Amount — try separate debit/credit columns first
    let amount = 0;
    if (debitCol >= 0 || creditCol >= 0) {
      const debit = debitCol >= 0 ? parseEuroNum(cols[debitCol]) : 0;
      const credit = creditCol >= 0 ? parseEuroNum(cols[creditCol]) : 0;
      amount = (credit || 0) - (debit || 0);
    } else if (amtCol >= 0) {
      amount = parseEuroNum(cols[amtCol]);
    } else {
      // Last numeric column
      for (let j = cols.length - 1; j >= 0; j--) {
        const v = parseEuroNum(cols[j]);
        if (v !== null && v !== 0) { amount = v; break; }
      }
    }
    if (amount === null || amount === undefined) continue;

    out.push({ date: isoDate, desc: desc || "Movimento", amount });
  }
  return out;
}

function parseDateFlexible(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/['"]/g, "");
  // ISO: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2,"0"), mo = m1[2].padStart(2,"0");
    const y = m1[3].length === 2 ? "20" + m1[3] : m1[3];
    return `${y}-${mo}-${d}`;
  }
  // MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mo = m2[1].padStart(2,"0"), d = m2[2].padStart(2,"0"), y = m2[3];
    return `${y}-${mo}-${d}`;
  }
  // Portuguese: "15 Jan 2024" or "15 Janeiro 2024"
  const m3 = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
  if (m3) return parsePtDate(m3[1], m3[2], m3[3]);
  return null;
}

function parseEuroNum(s) {
  if (!s) return null;
  const clean = String(s).trim().replace(/[€$£\s]/g, "").replace(/\u2212/g, "-");
  if (!clean || clean === "-" || clean === "—") return null;
  // Handle PT format: 1.234,56 or 1,234.56
  let n;
  if (clean.includes(",") && clean.includes(".")) {
    n = clean.lastIndexOf(",") > clean.lastIndexOf(".")
      ? Number(clean.replace(/\./g,"").replace(",","."))
      : Number(clean.replace(/,/g,""));
  } else if (clean.includes(",")) {
    n = Number(clean.replace(",","."));
  } else {
    n = Number(clean);
  }
  return Number.isFinite(n) ? n : null;
}

// Keep old function for backwards compat
async function importBankMovementsCsv(file) {
  return importBankFile(file);
}

function downloadTemplate() {
  const rows = [
    ["tipo","classe","nome","valor","yield_tipo","yield_valor","data","notas"],
    ["ativo","Ações/ETFs","VWCE",25000,"yield_pct",1.8,"",""],
    ["ativo","Imobiliário","Apartamento Lisboa",280000,"rent_month",900,"",""],
    ["ativo","Depósitos","DP CGD 4.5%",50000,"yield_pct",4.5,"2026-12-31","Capitalização mensal"],
    ["ativo","PPR","PPR Alves Ribeiro",15000,"yield_pct",5.2,"",""],
    ["ativo","Ouro","Ouro físico",8000,"","","",""],
    ["passivo","Crédito habitação","CH Millennium",150000,"","","",""],
    ["movimento","","Salário Pedro",3500,"","",isoToday(),""],
    ["movimento","","Supermercado",200,"","",isoToday(),""]
  ];
  const csv = rows.map(r => r.map(x => String(x)).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "PF_template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `PF_backup_${isoToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJSON(file) {
  const text = await file.text();
  const p = JSON.parse(text);
  state = {
    settings: { currency: "EUR", goalMonthly: 0, ...(p.settings || {}) },
    assets: Array.isArray(p.assets) ? p.assets : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    transactions: Array.isArray(p.transactions) ? p.transactions : [],
    dividends: Array.isArray(p.dividends) ? p.dividends : [],
    divSummaries: Array.isArray(p.divSummaries) ? p.divSummaries : [],
    history: Array.isArray(p.history) ? p.history : []
  };
  saveState();
  renderAll();
  toast("Backup importado com sucesso.");
}

let _resetPending = false;
function resetAll() {
  const btn = document.getElementById("btnReset");
  if (!_resetPending) {
    _resetPending = true;
    if (btn) { btn.textContent = "⚠️ Toca outra vez — apaga TUDO!"; btn.style.background="#7f1d1d"; }
    setTimeout(() => {
      _resetPending = false;
      if (btn) { btn.textContent = "🗑️ Reset total — apaga TUDO incluindo ativos"; btn.style.background=""; }
    }, 4000);
    return;
  }
  _resetPending = false;
  void storageClear();
  state = safeClone(DEFAULT_STATE);
  saveState();
  renderAll();
  toast("Dados apagados.");
}

/* ─── SETTINGS ────────────────────────────────────────────── */
function setSettingsPane(which) {
  const ps = document.getElementById("paneSettings"), pf = document.getElementById("paneFire");
  const bs = $("segSettings"), bf = $("segFire");
  if (!ps || !pf) return;
  const isFire = which === "fire";
  ps.style.display = isFire ? "none" : "";
  pf.style.display = isFire ? "" : "none";
  bs.classList.toggle("seg__btn--active", !isFire);
  bf.classList.toggle("seg__btn--active", isFire);
  if (isFire) renderFire();
}

/* ─── WIRING ──────────────────────────────────────────────── */
function wire() {
  wireModalClosers();

  // Nav
  ["dashboard","assets","import","cashflow","analysis","settings","dividends"].forEach(v => {
    const btn = document.getElementById("nav" + v.charAt(0).toUpperCase() + v.slice(1));
    if (btn) btn.addEventListener("click", () => setView(v));
  });

  // FAB
  $("btnFab").addEventListener("click", () => {
    if (currentView === "cashflow") openTxModal();
    else if (currentView === "dividends") openDivModal(null);
    else if (currentView === "assets") openItemModal(showingLiabs ? "liab" : "asset");
    else if (currentView === "analysis") openTxModal();
    else openItemModal("asset");
  });

  // Dashboard
  $("btnSnapshot").addEventListener("click", snapshotMonth);
  $("btnClearHistory").addEventListener("click", () => {
    if (!confirm("Limpar histórico de snapshots?")) return;
    state.history = []; saveState(); renderDashboard();
  });
  $("btnTrendClear").addEventListener("click", () => {
    if (!confirm("Limpar histórico?")) return;
    state.history = []; saveState(); renderDashboard();
  });
  $("btnSummaryAll").addEventListener("click", () => setView("assets"));
  $("btnSummaryToggle").addEventListener("click", () => { summaryExpanded = !summaryExpanded; renderSummary(); });

  // Distribution detail
  const distBtn = document.getElementById("btnDistDetail");
  if (distBtn) distBtn.addEventListener("click", () => { distDetailExpanded = false; openDistDetail(); });
  const distTog = document.getElementById("btnDistToggle");
  if (distTog) distTog.addEventListener("click", () => { distDetailExpanded = !distDetailExpanded; openDistDetail(true); });

  // Assets
  $("segAssets").addEventListener("click", () => setModeLiabs(false));
  $("segLiabs").addEventListener("click", () => setModeLiabs(true));
  $("qSearch").addEventListener("input", renderItems);
  $("qClass").addEventListener("change", renderItems);
  $("qSort").addEventListener("change", renderItems);
  $("btnAddItem").addEventListener("click", () => openItemModal(showingLiabs ? "liab" : "asset"));
  $("btnSaveItem").addEventListener("click", saveItemFromModal);
  $("btnDeleteItem").addEventListener("click", deleteCurrentItem);

  // Quote refresh button
  const btnRefresh = $("btnRefreshQuotes");
  if (btnRefresh) btnRefresh.addEventListener("click", refreshLiveQuotes);

  // Sync compound fields from asset
  const compAsset = document.getElementById("compAsset");
  if (compAsset) compAsset.addEventListener("change", syncCompoundFromAsset);
  const btnCalcComp = document.getElementById("btnCalcCompound");
  if (btnCalcComp) btnCalcComp.addEventListener("click", calcAndRenderCompound);

  // Analysis tabs
  // Wire das tabs de análise (botões com scroll horizontal)
  document.querySelectorAll(".analysis-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      // Actualizar hidden select (compatibilidade)
      const sel = document.getElementById("analysisTab");
      if (sel) sel.value = tab;
      // Actualizar estado visual dos botões
      document.querySelectorAll(".analysis-tab").forEach(b => b.classList.remove("analysis-tab--active"));
      btn.classList.add("analysis-tab--active");
      // Scroll para o botão activo
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      renderAnalysis();
    });
  });
  // Manter compatibilidade com select hidden
  const analysisTabs = document.getElementById("analysisTab");
  if (analysisTabs) analysisTabs.addEventListener("change", () => {
    const tab = analysisTabs.value;
    document.querySelectorAll(".analysis-tab").forEach(b => {
      b.classList.toggle("analysis-tab--active", b.dataset.tab === tab);
    });
    renderAnalysis();
  });

  // Forecast years
  const fyears = document.getElementById("forecastYears");
  if (fyears) fyears.addEventListener("change", renderForecastPanel);

  // Compare
  const cmode = document.getElementById("compareMode");
  if (cmode) cmode.addEventListener("change", renderComparePanel);

  // FIRE
  const segS = document.getElementById("segSettings"), segF = document.getElementById("segFire");
  if (segS && segF) {
    segS.addEventListener("click", () => setSettingsPane("settings"));
    segF.addEventListener("click", () => setSettingsPane("fire"));
  }
  const recalc = document.getElementById("btnRecalcFire");
  if (recalc) recalc.addEventListener("click", renderFire);
  ["fireWindow","fireHorizon","fireCustomReturn","fireCustomInflation","fireMonthlyInvest"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", renderFire);
  });

  // Cashflow
  $("btnAddTx").addEventListener("click", () => openTxModal(null));
  $("btnSaveTx").addEventListener("click", saveTxFromModal);
  $("cfMonth").addEventListener("change", renderCashflow);
  $("cfYear").addEventListener("change", renderCashflow);
  $("btnTxToggle").addEventListener("click", () => { txExpanded = !txExpanded; renderTxList(); });
  const cfGran = document.getElementById("cfGranularity");
  if (cfGran) cfGran.addEventListener("change", () => {
    const gran = cfGran.value;
    const monthSel = document.getElementById("cfMonth");
    if (monthSel) monthSel.style.opacity = (gran === "year" || gran === "all") ? "0.3" : "1";
    renderCashflow();
  });

  // Import CSV
  $("fileInput").addEventListener("change", () => { $("btnImport").disabled = !($("fileInput").files && $("fileInput").files.length); });
  $("btnImport").addEventListener("click", async () => {
    const f = $("fileInput").files && $("fileInput").files[0];
    if (!f) return;
    try {
      const text = await fileToText(f);
      const rows = csvToObjects(text);
      importRows(rows);
    } catch (e) { toast("Falha no import: " + (e && e.message ? e.message : String(e))); }
  });
  $("btnTemplate").addEventListener("click", downloadTemplate);

  // Importar extracto do banco (universal: CSV, XLSX, PDF)
  const bankFileInput = document.getElementById("bankFile");
  const btnImportBank = document.getElementById("btnImportBank");
  if (bankFileInput && btnImportBank) {
    bankFileInput.addEventListener("change", () => {
      btnImportBank.disabled = !bankFileInput.files?.length;
      const res = document.getElementById("bankImportResult");
      if (res) res.style.display = "none";
    });
    btnImportBank.addEventListener("click", async e => {
      e.preventDefault();
      const f = bankFileInput.files?.[0];
      if (!f) return;
      btnImportBank.disabled = true;
      btnImportBank.textContent = "A importar…";
      try {
        await importBankFile(f);
      } catch (err) {
        showBankResult("error", `Erro: ${escapeHtml(err.message || String(err))}`);
        console.error(err);
      } finally {
        btnImportBank.disabled = false;
        btnImportBank.textContent = "Importar extracto";
      }
    });
  }

  // Bank CSV import (legacy - kept for Import tab)
  (function bindBankCsvImport() {
    const input = $("bankCsvFile"), btn = $("btnImportBankCsv"), nameEl = $("bankCsvName");
    if (!input || !btn) return;
    if (nameEl && nameEl.textContent !== undefined) nameEl.textContent = "";
    btn.disabled = true;
    input.addEventListener("change", () => {
      bankCsvSelectedFile = (input.files && input.files[0]) ? input.files[0] : null;
      if (nameEl && nameEl.textContent !== undefined) nameEl.textContent = bankCsvSelectedFile ? bankCsvSelectedFile.name : "";
      btn.disabled = !bankCsvSelectedFile;
    });
    btn.addEventListener("click", async e => {
      e.preventDefault(); e.stopPropagation();
      try {
        const f = bankCsvSelectedFile || (input.files && input.files[0]) || null;
        if (!f) { toast("Escolhe primeiro o ficheiro CSV do banco."); return; }
        await importBankMovementsCsv(f);
      } catch (err) { toast("Falhou a importação do CSV."); console.error(err); }
    });
  })();

  // JSON backup
  $("btnExportJSON").addEventListener("click", exportJSON);
  $("jsonInput").addEventListener("change", () => { $("btnImportJSON").disabled = !($("jsonInput").files && $("jsonInput").files.length); });
  $("btnImportJSON").addEventListener("click", async () => {
    const f = $("jsonInput").files && $("jsonInput").files[0];
    if (!f) return;
    try { await importJSON(f); } catch (e) { toast("Erro a importar JSON."); }
  });
  $("btnReset").addEventListener("click", resetAll);

  // Clear only transactions (keep assets/liabilities)
  function makeTwoTap(btnId, label, action) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let pending = false;
    btn.addEventListener("click", () => {
      if (!pending) {
        pending = true;
        const orig = btn.textContent;
        btn.textContent = "⚠️ Toca outra vez para confirmar";
        btn.style.background = "#fbbf24"; btn.style.color = "#000";
        setTimeout(() => { pending = false; btn.textContent = orig; btn.style.background=""; btn.style.color=""; }, 4000);
        return;
      }
      pending = false;
      btn.textContent = label; btn.style.background=""; btn.style.color="";
      action(btn);
    });
  }

  makeTwoTap("btnClearTransactions", "🗑️ Limpar movimentos (mantém ativos)", () => {
    const n = state.transactions.length;
    if (!n) { toast("Sem movimentos para limpar."); return; }
    state.transactions = [];
    saveState(); renderAll(); checkDuplicateWarning();
    toast(`🗑️ ${n} movimentos apagados. Reimporta os ficheiros do banco.`, 4000);
  });
  makeTwoTap("btnClearTransactions2", "🗑️ Limpar movimentos e reimportar", () => {
    const n = state.transactions.length;
    if (!n) { toast("Sem movimentos para limpar."); return; }
    state.transactions = [];
    saveState(); renderAll(); checkDuplicateWarning();
    toast(`🗑️ ${n} movimentos apagados. Reimporta os ficheiros do banco.`, 4000);
  });

  // Limpar só Ações/ETFs/Cripto (mantém depósitos, PPR, fundos, movimentos)
  const btnClearEq = document.getElementById("btnClearEquities");
  if (btnClearEq) {
    let _eqPending = false;
    btnClearEq.addEventListener("click", () => {
      const EQ = ["Ações/ETFs", "Cripto"];
      const toRemove = state.assets.filter(a => EQ.includes(a.class));
      if (!toRemove.length) { toast("Sem Ações/ETFs/Cripto para limpar."); return; }
      if (!_eqPending) {
        _eqPending = true;
        btnClearEq.textContent = `⚠️ Confirmar? Apaga ${toRemove.length} activos`;
        btnClearEq.style.background = "#fbbf24"; btnClearEq.style.color = "#000";
        setTimeout(() => { _eqPending = false; btnClearEq.textContent = "🗑️ Limpar Ações / ETFs / Cripto"; btnClearEq.style.background=""; btnClearEq.style.color=""; }, 4000);
        return;
      }
      _eqPending = false;
      state.assets = state.assets.filter(a => !EQ.includes(a.class));
      saveState(); renderAll();
      btnClearEq.textContent = "🗑️ Limpar Ações / ETFs / Cripto";
      btnClearEq.style.background=""; btnClearEq.style.color="";
      toast(`🗑️ ${toRemove.length} activos removidos. Reimporta o CSV do DivTracker.`, 4000);
    });
  }

  // Check on import view open
  checkDuplicateWarning();

  // Settings
  $("baseCurrency").value = state.settings.currency || "EUR";
  $("baseCurrency").addEventListener("change", () => {
    state.settings.currency = $("baseCurrency").value;
    saveState(); renderAll();
  });
  const btnGoImport = document.getElementById("btnGoImport");
  if (btnGoImport) btnGoImport.addEventListener("click", () => setView("import"));

  // Worker URL para cotações
  const workerInput = document.getElementById("settingsWorkerUrl");
  if (workerInput) workerInput.value = state.settings.workerUrl || "";
  const btnSaveWorkerUrl = document.getElementById("btnSaveWorkerUrl");
  if (btnSaveWorkerUrl) btnSaveWorkerUrl.addEventListener("click", () => {
    const val = (document.getElementById("settingsWorkerUrl").value || "").trim();
    if (!state.settings) state.settings = {};
    state.settings.workerUrl = val;
    saveState();
    toast(val ? "✅ Worker URL guardado" : "Worker URL removido");
  });

  // Objetivo de rendimento
  const btnEditGoal = document.getElementById("btnEditGoal");
  if (btnEditGoal) btnEditGoal.addEventListener("click", () => {
    $("goalInput").value = String(state.settings.goalMonthly || "");
    openModal("modalGoal");
  });
  const btnSaveGoalModal = document.getElementById("btnSaveGoalModal");
  if (btnSaveGoalModal) btnSaveGoalModal.addEventListener("click", () => saveGoal($("goalInput").value));
  const btnSaveGoal = document.getElementById("btnSaveGoal");
  if (btnSaveGoal) btnSaveGoal.addEventListener("click", () => saveGoal($("settingsGoal").value));

  // Pesquisa global
  const btnSearch = document.getElementById("btnSearchToggle");
  if (btnSearch) btnSearch.addEventListener("click", toggleSearch);
  const gSearch = document.getElementById("globalSearch");
  if (gSearch) gSearch.addEventListener("input", e => renderSearchResults(e.target.value));

  // Apagar movimento
  const btnDeleteTx = document.getElementById("btnDeleteTx");
  if (btnDeleteTx) btnDeleteTx.addEventListener("click", deleteTxEntry);

  // Dividendos — radio buttons de modo
  document.querySelectorAll('input[name="divInputMode"]').forEach(r => {
    r.addEventListener("change", () => { showDivFields(r.value); updateDivSummaryLive(); });
  });
  // Live calc em todos os campos de input de dividendos
  [
    "divSummaryGross","divSummaryTax",
    "divSummaryNet","divSummaryRetRate",
    "divSummaryPortfolio","divSummaryYield_py","divSummaryRetRate_py",
    "divSummaryYield_yo","divSummaryRetRate_yo",
    "divSummaryYield_gt","divSummaryYield_net"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateDivSummaryLive);
  });

  // Dividendos — modo selector
  const segDivS = document.getElementById("segDivSummary");
  const segDivD = document.getElementById("segDivDetail");
  const segDivC = document.getElementById("segDivCalendar");
  if (segDivS) segDivS.addEventListener("click", () => setDivMode("summary"));
  if (segDivD) segDivD.addEventListener("click", () => setDivMode("detail"));
  if (segDivC) segDivC.addEventListener("click", () => setDivMode("calendar"));
  const btnSaveDivSummary = document.getElementById("btnSaveDivSummary");
  if (btnSaveDivSummary) btnSaveDivSummary.addEventListener("click", saveDivSummary);
  const btnDeleteDivSummary = document.getElementById("btnDeleteDivSummary");
  if (btnDeleteDivSummary) btnDeleteDivSummary.addEventListener("click", deleteDivSummary);
  const btnDivProject = document.getElementById("btnDivProject");
  if (btnDivProject) btnDivProject.addEventListener("click", renderDivProjection);
  // Live calc
  ["divSummaryGross","divSummaryTax"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateDivSummaryLive);
  });

  // Dividendos individuais
  const btnAddDiv = document.getElementById("btnAddDiv");
  if (btnAddDiv) btnAddDiv.addEventListener("click", () => openDivModal(null));
  const btnAddDiv2 = document.getElementById("btnAddDiv2");
  if (btnAddDiv2) btnAddDiv2.addEventListener("click", () => openDivModal(null));
  const btnSaveDiv = document.getElementById("btnSaveDiv");
  if (btnSaveDiv) btnSaveDiv.addEventListener("click", saveDivFromModal);
  const btnDeleteDiv = document.getElementById("btnDeleteDiv");
  if (btnDeleteDiv) btnDeleteDiv.addEventListener("click", deleteDivEntry);
  const btnDivToggle = document.getElementById("btnDivToggle");
  if (btnDivToggle) btnDivToggle.addEventListener("click", () => { divExpanded = !divExpanded; renderDividends(); });

  // Init
  setModeLiabs(false);
  setView("dashboard");
}

/* ─── LIVE QUOTE REFRESH (via Cloudflare Worker proxy) ──────────────────────
   Arquitectura:
     PWA → Cloudflare Worker (worker.patrimonio.pages.dev) → Yahoo Finance API
   O Worker evita restrições CORS do browser.
   URL do worker configurável em Settings > Worker URL.
   Se não configurado, permite edição manual do valor do ativo.
──────────────────────────────────────────────────────────────────────────────*/

// Classes de ativos que têm cotação de mercado (ticker)
const QUOTE_CLASSES = ["Ações/ETFs", "Cripto", "Obrigações"];

function extractTicker(asset) {
  // Tenta extrair ticker do nome ou notas do ativo
  // Exemplos: "VWCE.DE", "Apple (AAPL)", "ETF [IWDA.L]"
  const src = `${asset.name || ""} ${asset.notes || ""}`;
  const m = src.match(/\b([A-Z0-9]{1,6}(?:\.[A-Z]{1,4})?)\b/);
  return m ? m[1] : null;
}

async function fetchQuote(ticker, workerUrl) {
  // Chama o Cloudflare Worker que proxifica Yahoo Finance
  const url = `${workerUrl.replace(/\/$/, "")}/quote?ticker=${encodeURIComponent(ticker)}`;
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(`Worker inacessível: ${e.message || "timeout"}`);
  }
  if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data; // { ticker, price, currency, name, change_pct }
}

async function refreshLiveQuotes() {
  const btn = $("btnRefreshQuotes");
  const workerUrl = (state.settings && state.settings.workerUrl) || "";

  if (!workerUrl) {
    // Sem Worker configurado — mostrar modal de configuração
    const url = prompt(
      "⚙️ Cloudflare Worker URL\n\nIntroduz o URL do teu Worker para actualizar cotações automaticamente.\nEx: https://patrimonio-quotes.SEU-NOME.workers.dev\n\n(Deixa em branco para configurar mais tarde)"
    );
    if (url && url.trim().startsWith("http")) {
      if (!state.settings) state.settings = {};
      state.settings.workerUrl = url.trim();
      saveState();
      toast("✅ Worker URL guardado. A tentar actualizar…");
      return refreshLiveQuotes();
    }
    toast("⚠️ Worker URL não configurado. Ver README para instruções.", 4000);
    return;
  }

  // Identificar ativos com ticker e classe de mercado
  const candidates = state.assets.filter(a => {
    const cls = (a.class || "").trim();
    return QUOTE_CLASSES.some(c => cls === c) || extractTicker(a);
  });

  if (!candidates.length) {
    toast("Sem ativos com ticker detectado em Ações/ETFs/Cripto.", 3000);
    return;
  }

  // UI: spinning button
  if (btn) { btn.disabled = true; btn.textContent = "⟳ A actualizar…"; }

  let updated = 0, failed = 0;
  const errors = [];

  // Convert DivTracker ticker format to Yahoo Finance format
  // Known tickers not on Yahoo Finance — skip them gracefully
  const SKIP_TICKERS = new Set(["WBA","14","DN3.DE","OD7F.DE","U9UA.DE"]);

  function toYahooTicker(raw) {
    const t = (raw||"").trim().toUpperCase();
    if (SKIP_TICKERS.has(t)) return null; // known unavailable
    if (t.endsWith(".CC")) return t.replace(/\.CC$/, "-USD"); // crypto
    const xmap = {".PT":".LS",".GB":".L",".PL":".WA",".CH":".SW",
      ".DK":".CO",".SE":".ST",".NO":".OL",".FI":".HE",
      ".BE":".BR",".IT":".MI",".FR":".PA",".NL":".AS",
      ".ES":".MC",".AU":".AX",".CA":".TO"};
    for (const [from, to] of Object.entries(xmap))
      if (t.endsWith(from)) return t.slice(0,-from.length) + to;
    return t; // US stocks, .DE, etc. already correct
  }

  // Build list: {asset, raw, yahoo}
  const tickerList = candidates.map(asset => {
    const raw = (asset.name && /^[A-Z0-9.\-]{1,12}$/.test(asset.name.trim()))
      ? asset.name.trim() : extractTicker(asset);
    const yahoo = raw ? toYahooTicker(raw) : null;
    return { asset, raw, yahoo };
  }).filter(x => x.yahoo); // null = known skip tickers

  // Fetch all quotes in parallel
  const quoteResults = await Promise.allSettled(
    tickerList.map(x => fetchQuote(x.yahoo, workerUrl))
  );
  const quoteMap = {};
  quoteResults.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) quoteMap[tickerList[i].yahoo] = r.value;
  });

  // Collect currencies needing FX (crypto always USD, others from quote)
  const ccysNeeded = new Set();
  for (const x of tickerList) if (x.yahoo.endsWith("-USD")) ccysNeeded.add("USD");
  for (const q of Object.values(quoteMap)) {
    const c = (q.currency||"EUR").toUpperCase();
    if (c !== "EUR") ccysNeeded.add(c);
  }

  // Fetch FX rates via Worker (EURUSD=X, EURGBP=X, etc.)
  const fxRates = {};
  const FX_FALLBACK = {USD:0.92,GBP:1.17,DKK:0.134,CHF:1.05,PLN:0.23,
    SEK:0.087,NOK:0.085,CAD:0.68,AUD:0.59,JPY:0.006,HKD:0.118};
  await Promise.allSettled([...ccysNeeded].map(async ccy => {
    try {
      const fq = await fetchQuote(`EUR${ccy}=X`, workerUrl);
      if (fq && fq.price > 0) fxRates[ccy] = 1 / fq.price;
    } catch(_) {}
  }));
  for (const c of ccysNeeded) if (!fxRates[c]) fxRates[c] = FX_FALLBACK[c] || 1;

  const today = new Date().toLocaleDateString("pt-PT");
  for (const { asset, raw, yahoo } of tickerList) {
    const q = quoteMap[yahoo];
    if (!q || !Number.isFinite(q.price) || q.price <= 0) {
      failed++; errors.push(raw); continue;
    }
    const ccy = (q.currency||"EUR").toUpperCase();
    const fxToEur = ccy === "EUR" ? 1 : (fxRates[ccy] || FX_FALLBACK[ccy] || 1);
    const priceEur = q.price * fxToEur;

    const qtyMatch = (asset.notes||"").match(/Qty=([\d.,]+)/);
    const qty = qtyMatch ? parseFloat(qtyMatch[1].replace(",", ".")) : null;
    const newValue = qty ? qty * priceEur : priceEur;

    const priceLabel = ccy === "EUR"
      ? fmtEUR2(priceEur)
      : `${fmtEUR2(priceEur)} (${q.price.toFixed(4)} ${ccy})`;

    const noteBase = (asset.notes||"")
      .replace(/\s*·?\s*Preço:[^·]*/g,"")
      .replace(/\s*·?\s*⚠️ Custo histórico[^·]*/g,"").trim();
    asset.value = newValue;
    asset.notes = `${noteBase}${noteBase?" · ":""}Preço: ${priceLabel} (${today})`;
    // Guardar qty e pm como campos dedicados para P&L
    if (qty) asset.qty = qty;
    const pmFromNotes = (asset.notes||"").match(/PM=([\d.,]+)/);
    if (pmFromNotes) asset.pmOriginal = parseNum(pmFromNotes[1]);
    asset.lastPriceEur = priceEur;
    asset.lastUpdated  = today;
    // Save sector/geography metadata for charts
    if (q.sector || q.country || q.exchange) {
      asset.meta = {
        sector:    q.sector    || "",
        industry:  q.industry  || "",
        country:   q.country   || "",
        exchange:  q.exchange  || "",
        quoteType: q.quote_type || "",
      };
    }
    updated++;
  }

  await saveStateAsync();
  renderAll();
  renderEquityPnL();
  // Disparar evento para outros listeners (P&L, price alerts)
  document.dispatchEvent(new CustomEvent("quotesUpdated"));

  if (btn) { btn.disabled = false; btn.textContent = "⟳ Cotações"; }

  if (updated > 0 && !failed) {
    toast(`✅ ${updated} ativo${updated !== 1 ? "s" : ""} actualizado${updated !== 1 ? "s" : ""}`, 3000);
  } else if (updated > 0) {
    // Show clickable toast — tapping opens full error list modal
    showQuoteErrors(updated, failed, errors, updated, failed);
    toastClickable(
      `✅ ${updated} actualizado${updated !== 1 ? "s" : ""} · ⚠️ ${failed} erro${failed !== 1 ? "s" : ""} — toca para ver`,
      () => openModal("modalQuoteErrors"), 8000
    );
  } else {
    showQuoteErrors(0, failed, errors, 0, failed);
    toastClickable(
      `⚠️ ${failed} erro${failed !== 1 ? "s" : ""} — toca para ver detalhes`,
      () => openModal("modalQuoteErrors"), 8000
    );
  }
}

// Populate the quote errors modal
function showQuoteErrors(updated, failed, errors, updatedCount, failedCount) {
  const summary = document.getElementById("quoteErrorsSummary");
  const list = document.getElementById("quoteErrorsList");
  if (!summary || !list) return;
  summary.textContent = `${updatedCount} actualizado${updatedCount !== 1 ? "s" : ""} com sucesso · ${failedCount} erro${failedCount !== 1 ? "s" : ""}`;
  list.innerHTML = errors.map(e => {
    // Try to find asset name for this ticker
    const asset = state.assets.find(a => (a.name||"").toUpperCase() === e.toUpperCase());
    const name = asset ? ` — ${escapeHtml(asset.name)}` : "";
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t" style="font-family:monospace">${escapeHtml(e)}</div>
        <div class="item__s">Não encontrado no Yahoo Finance${name}</div>
      </div>
    </div>`;
  }).join("");
}

// Toast that can be tapped to trigger an action
function toastClickable(msg, onClick, duration = 5000) {
  let el = document.getElementById("toastEl");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastEl";
    el.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 20px;border-radius:20px;font-weight:700;font-size:14px;z-index:999;max-width:90vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .3s;cursor:pointer";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  el.style.cursor = "pointer";
  // Remove old listener and add new
  const newEl = el.cloneNode(true);
  el.parentNode.replaceChild(newEl, el);
  newEl.textContent = msg;
  newEl.style.opacity = "1";
  newEl.style.cursor = "pointer";
  if (onClick) newEl.addEventListener("click", onClick);
  clearTimeout(newEl._t);
  newEl._t = setTimeout(() => { newEl.style.opacity = "0"; }, duration);
}


/* ─── DUPLICATE DETECTION ─────────────────────────────────────────────────── */
function checkDuplicateWarning() {
  const card = document.getElementById("dupWarningCard");
  if (!card) return;
  if (!state.transactions || state.transactions.length < 10) {
    card.style.display = "none";
    return;
  }
  // Detect duplicates: same date + amount appearing 2+ times
  const counts = {};
  for (const tx of state.transactions) {
    const k = `${String(tx.date||"").slice(0,10)}|${Math.round(Math.abs(parseNum(tx.amount))*100)}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  const hasDups = Object.values(counts).some(v => v >= 3);
  card.style.display = hasDups ? "" : "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  await requestPersistentStorage();
  state = await loadStateAsync();
  wire();
  renderAll();
  // v15: auto-snapshot mensal silencioso
  autoSnapshotIfNeeded();
  // v15: verificar vencimentos com notificação
  setTimeout(() => checkAndNotifyMaturities(), 2000);
});

// Guarantee state is saved when app goes to background or is closed
// Critical for iOS PWA where the process can be killed without warning
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveStateAsync();
});
window.addEventListener("pagehide", () => saveStateAsync());
window.addEventListener("beforeunload", () => saveStateAsync());

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 ADDITIONS
   Aplicadas sobre v14 real (5566 linhas)
   ═══════════════════════════════════════════════════════════════ */

/* ─── EXPORT CSV / XLSX ────────────────────────────────────── */
function downloadText(content, filename, mimeType) {
  const BOM = mimeType.includes("csv") ? "\uFEFF" : "";
  const blob = new Blob([BOM + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function exportCashflowCSV() {
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const y = ($("cfYear") && $("cfYear").value) || String(new Date().getFullYear());
  const m = $("cfMonth") ? String($("cfMonth").value).padStart(2,"0") : "01";
  let txs;
  if (gran === "all") txs = state.transactions.slice();
  else if (gran === "year") txs = expandRecurring(state.transactions).filter(t => String(t.date||"").slice(0,4) === y);
  else { const key = `${y}-${m}`; txs = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === key); }
  txs = txs.sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const header = ["Data","Tipo","Categoria","Valor (EUR)","Recorrente","Notas"];
  const rows = txs.map(t => [t.date||"", t.type==="in"?"Entrada":"Saída", t.category||"", parseNum(t.amount).toFixed(2), t.recurring||"none", (t.notes||"").replace(/"/g,"'")]);
  const csv = [header,...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  const label = gran==="all" ? "completo" : gran==="year" ? y : `${y}_${m}`;
  downloadText(csv, `balanco_${label}.csv`, "text/csv;charset=utf-8;");
  toast("CSV exportado.");
}

function exportPortfolioCSV() {
  const header = ["Tipo","Classe","Nome","Valor (EUR)","Tipo Yield","Yield Valor","Capitalização","Vencimento","Custo Aquis.","Notas"];
  const rows = [
    ...state.assets.map(a => ["Ativo", a.class||"", a.name||"", parseNum(a.value).toFixed(2), a.yieldType||"none", parseNum(a.yieldValue).toFixed(4), a.compoundFreq||"", a.maturityDate||"", parseNum(a.costBasis||0).toFixed(2), (a.notes||"").replace(/"/g,"'")]),
    ...state.liabilities.map(l => ["Passivo", l.class||"", l.name||"", parseNum(l.value).toFixed(2), "","","","","", (l.notes||"").replace(/"/g,"'")])
  ];
  const csv = [header,...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  downloadText(csv, `portfolio_${isoToday()}.csv`, "text/csv;charset=utf-8;");
  toast("Portfólio CSV exportado.");
}

function exportPortfolioXLSX() {
  if (typeof XLSX === "undefined") { toast("XLSX não disponível."); return; }
  const t = calcTotals();
  const assetRows = state.assets.map(a => ({ Tipo:"Ativo", Classe:a.class||"", Nome:a.name||"", "Valor EUR":parseNum(a.value), "Tipo Yield":a.yieldType||"none", "Yield Valor":parseNum(a.yieldValue), "Capitalização":a.compoundFreq||"", Vencimento:a.maturityDate||"", "Custo Aquis.":parseNum(a.costBasis||0), "Rend. Anual EUR":passiveFromItem(a), Notas:a.notes||"" }));
  const liabRows = state.liabilities.map(l => ({ Tipo:"Passivo", Classe:l.class||"", Nome:l.name||"", "Valor EUR":parseNum(l.value), "Tipo Yield":"","Yield Valor":"","Capitalização":"",Vencimento:"","Custo Aquis.":0,"Rend. Anual EUR":0, Notas:l.notes||"" }));
  const txRows = state.transactions.map(tx => ({ Data:tx.date||"", Tipo:tx.type==="in"?"Entrada":"Saída", Categoria:tx.category||"", "Valor EUR":parseNum(tx.amount), Recorrente:tx.recurring||"none", Notas:tx.notes||"" }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...assetRows,...liabRows]), "Portfólio");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), "Movimentos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Métrica:"Ativos Total", Valor:t.assetsTotal },
    { Métrica:"Passivos Total", Valor:t.liabsTotal },
    { Métrica:"Património Líquido", Valor:t.net },
    { Métrica:"Rendimento Passivo Anual", Valor:t.passiveAnnual },
    { Métrica:"Data Exportação", Valor:isoToday() }
  ]), "Resumo");
  XLSX.writeFile(wb, `patrimonio_${isoToday()}.xlsx`);
  toast("Excel exportado.");
}

/* ─── AUTO-SNAPSHOT MENSAL ─────────────────────────────────── */
function autoSnapshotIfNeeded() {
  const thisMonth = isoToday().slice(0,7);
  const last = state.history.slice().sort((a,b) => String(b.dateISO).localeCompare(String(a.dateISO)))[0];
  if (last && String(last.dateISO||"").slice(0,7) === thisMonth) return;
  if (!state.assets.length) return;
  const t = calcTotals();
  state.history.push({ dateISO:isoToday(), net:t.net, assets:t.assetsTotal, liabilities:t.liabsTotal, passiveAnnual:t.passiveAnnual, auto:true });
  saveState();
}

/* ─── NOTIFICAÇÕES PUSH ─────────────────────────────────────── */
async function requestNotifications() {
  if (!("Notification" in window)) { toast("Notificações não suportadas."); return; }
  const p = await Notification.requestPermission();
  if (p === "granted") { toast("✅ Notificações ativadas."); checkAndNotifyMaturities(); }
  else toast("❌ Notificações bloqueadas.");
}

function checkAndNotifyMaturities() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = isoToday();
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7ISO = in7.toISOString().slice(0,10);
  state.assets.filter(a => a.maturityDate && a.maturityDate >= today && a.maturityDate <= in7ISO).forEach(a => {
    const days = Math.round((new Date(a.maturityDate) - new Date()) / 86400000);
    new Notification("⏰ Vencimento — Património Familiar", { body:`${a.name}: vence em ${days} dia${days!==1?"s":""} (${a.maturityDate}) · ${fmtEUR(parseNum(a.value))}`, icon:"icon192.png", tag:`mat_${a.id}` });
  });
}

/* ─── PARSERS BANCÁRIOS ADICIONAIS ─────────────────────────── */
function detectBankFormat(text) {
  const h = String(text||"").slice(0,800).toLowerCase();
  if (h.includes("caixa geral") || h.includes("cgd") || h.includes("caixadirecta")) return "cgd";
  if (h.includes("millennium") || h.includes("millenniumbcp")) return "millennium";
  if (h.includes("novo banco") || h.includes("novobanco")) return "novobanco";
  if (h.includes("montepio")) return "montepio";
  if (/\bbpi\b/.test(h)) return "bpi";
  if (h.includes("santander")) return "santander";
  return "generic";
}

function parseMillenniumCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const parts = raw.trim().split(/[;\t]/);
    if (parts.length < 4) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const debit = parseNum(String(parts[2]||"").replace(/\s/g,""));
    const credit = parseNum(String(parts[3]||"").replace(/\s/g,""));
    if (debit > 0) out.push({date:iso, desc, amount:-debit});
    else if (credit > 0) out.push({date:iso, desc, amount:credit});
  }
  return out;
}

function parseCGDCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[;\t]/);
    if (parts.length < 3) continue;
    const dm = String(parts[0]).match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const desc = String(parts[1]||"").trim();
    const val = parseNum(String(parts[2]||"").replace(/\s/g,""));
    if (val !== 0) out.push({date:iso, desc, amount:val});
  }
  return out;
}

function parseNovoBancoCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const parts = raw.trim().split(";");
    if (parts.length < 3) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const val = parseNum(String(parts[2]||"").replace(/\s|\u00A0/g,""));
    if (val !== 0) out.push({date:iso, desc, amount:val});
  }
  return out;
}

function parseMontepioBPI(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    if (!/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/.test(raw)) continue;
    const parts = raw.trim().split(/[;\t]/);
    if (parts.length < 4) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const debit = parseNum(String(parts[2]||"").replace(/\s/g,""));
    const credit = parseNum(String(parts[3]||"").replace(/\s/g,""));
    if (debit > 0) out.push({date:iso, desc, amount:-debit});
    else if (credit > 0) out.push({date:iso, desc, amount:credit});
  }
  return out;
}

/* ─── CUSTO DE AQUISIÇÃO & MAIS-VALIA ───────────────────────── */
function calcGainLoss(asset) {
  const cb = parseNum(asset.costBasis);
  const cur = parseNum(asset.value);
  if (!cb || cb <= 0) return null;
  const gain = cur - cb;
  return { costBasis:cb, currentVal:cur, gain, gainPct:(gain/cb)*100, irsEst:gain>0?gain*0.28:0 };
}

function renderGainLossBadge(asset) {
  const gl = calcGainLoss(asset);
  if (!gl) return "";
  const sign = gl.gain >= 0 ? "+" : "";
  const col = gl.gain >= 0 ? "#059669" : "#dc2626";
  return ` <span style="color:${col};font-size:11px;font-weight:700">${sign}${fmtPct(gl.gainPct)}</span>`;
}

/* ─── IRS ESTIMADO ───────────────────────────────────────────── */
function renderIRSCard() {
  const el = document.getElementById("irsEstCard");
  if (!el) return;
  const now = new Date();
  const yearStart = now.getFullYear() + "-01-01";
  const divYTD = (state.dividends||[]).filter(d=>d.date>=yearStart).reduce((s,d)=>s+parseNum(d.amount),0);
  const rendasYTD = state.assets.filter(a=>a.yieldType==="rent_month").reduce((s,a)=>s+parseNum(a.yieldValue)*now.getMonth(),0);
  const latentGains = state.assets.map(a=>calcGainLoss(a)).filter(Boolean).filter(g=>g.gain>0).reduce((s,g)=>s+g.gain,0);
  const taxDiv = divYTD*0.28, taxRendas = rendasYTD*0.28, taxGains = latentGains*0.28;
  const total = taxDiv + taxRendas;
  if (total < 1 && taxGains < 1) { el.style.display="none"; return; }
  el.style.display="";
  const s = id => { const e=document.getElementById(id); return { set: v => { if(e) e.textContent=v; } }; };
  s("irsEstDiv").set(fmtEUR(taxDiv));
  s("irsEstRendas").set(fmtEUR(taxRendas));
  s("irsEstGains").set(fmtEUR(taxGains));
  s("irsEstTotal").set(fmtEUR(total));
}

/* ─── SNAPSHOT: APAGAR INDIVIDUALMENTE ─────────────────────── */
function deleteSnapshot(dateISO) {
  if (!confirm(`Apagar snapshot de ${dateISO}?`)) return;
  state.history = state.history.filter(h => h.dateISO !== dateISO);
  saveState();
  renderDashboard();
  toast("Snapshot apagado.");
}

function renderSnapshotTable() {
  const el = document.getElementById("snapshotTable");
  if (!el) return;
  const h = state.history.slice().sort((a,b) => String(b.dateISO).localeCompare(String(a.dateISO)));
  if (!h.length) { el.innerHTML=`<div class="item" style="cursor:default"><div class="item__l"><div class="item__t">Sem snapshots</div><div class="item__s">Usa "Registar mês" para criar.</div></div></div>`; return; }
  el.innerHTML = h.slice(0,24).map(s => {
    const auto = s.auto ? `<span class="badge badge--blue" style="font-size:10px">auto</span>` : "";
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(s.dateISO)} ${auto}</div>
        <div class="item__s">Ativos ${fmtEUR(parseNum(s.assets))} · Passivos ${fmtEUR(parseNum(s.liabilities||0))} · Rend. ${fmtEUR(parseNum(s.passiveAnnual||0))}/ano</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item__v">${fmtEUR(parseNum(s.net))}</div>
        <button onclick="deleteSnapshot('${escapeHtml(s.dateISO)}')" style="border:0;background:#fee2e2;color:#dc2626;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:13px;font-weight:700" title="Apagar snapshot">✕</button>
      </div>
    </div>`;
  }).join("");
}

/* ─── TAXA DE JURO REAL (Fisher) ────────────────────────────── */
function realRate(nominalPct, inflationPct) {
  return ((1 + nominalPct/100) / (1 + inflationPct/100) - 1) * 100;
}

/* ─── PRINT / PDF ────────────────────────────────────────────── */
function printDashboard() { window.print(); }

/* ─── WIRE V15: botões extra ────────────────────────────────── */
(function wireV15() {
  // Aguardar DOM pronto
  const init = () => {
    const b = id => document.getElementById(id);
    if (b("btnExportCashflowCSV")) b("btnExportCashflowCSV").addEventListener("click", exportCashflowCSV);
    if (b("btnExportPortfolioCSV")) b("btnExportPortfolioCSV").addEventListener("click", exportPortfolioCSV);
    if (b("btnExportPortfolioXLSX")) b("btnExportPortfolioXLSX").addEventListener("click", exportPortfolioXLSX);
    if (b("btnEnableNotifications")) b("btnEnableNotifications").addEventListener("click", requestNotifications);
    if (b("btnPrintDashboard")) b("btnPrintDashboard").addEventListener("click", printDashboard);
    // Actualizar estado botão notificações
    if (b("btnEnableNotifications") && typeof Notification !== "undefined" && Notification.permission === "granted") {
      b("btnEnableNotifications").textContent = "🔔 Notificações ativas";
      b("btnEnableNotifications").disabled = true;
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 PARTE 2
   Novas funcionalidades: Saúde Financeira, Risco, E-se?, Fiscal
   ═══════════════════════════════════════════════════════════════ */

/* ─── SAÚDE FINANCEIRA (rácios) ─────────────────────────────── */
function renderHealthRatios() {
  const el = document.getElementById("debtRatioContent");
  if (!el) return;

  const t = calcTotals();
  if (t.assetsTotal === 0) { el.innerHTML = "<div class='note'>Sem ativos registados.</div>"; return; }

  const debtRatio = t.liabsTotal / t.assetsTotal * 100;
  const leverageRatio = t.assetsTotal / Math.max(1, t.net);
  const passiveRatio = t.assetsTotal > 0 ? (t.passiveAnnual / t.assetsTotal * 100) : 0;

  // Despesas mensais médias (últimos 6 meses)
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7); if (!d) continue;
    const cur = byMonth.get(d) || { out: 0 }; if (tx.type === "out") cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const last6 = [...byMonth.keys()].sort().slice(-6);
  const avgMonthlyExp = last6.length ? last6.reduce((s, k) => s + (byMonth.get(k).out || 0), 0) / last6.length : 0;
  const monthsOfRunway = avgMonthlyExp > 0 ? t.net / avgMonthlyExp : null;

  const semaforo = (val, good, ok) => val <= good ? "🟢" : val <= ok ? "🟡" : "🔴";
  const semaforoInv = (val, good, ok) => val >= good ? "🟢" : val >= ok ? "🟡" : "🔴";

  el.innerHTML = `
    <div class="kpiRow" style="margin-bottom:10px">
      <div class="kpi">
        <div class="kpi__k">Rácio dívida/activos ${semaforo(debtRatio, 30, 60)}</div>
        <div class="kpi__v" style="color:${debtRatio <= 30 ? '#059669' : debtRatio <= 60 ? '#d97706' : '#dc2626'}">${fmt(debtRatio, 1)}%</div>
        <div class="kpi__s">&lt;30% excelente · &lt;60% aceitável</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Yield médio ponderado ${semaforoInv(passiveRatio, 4, 2)}</div>
        <div class="kpi__v" style="color:${passiveRatio >= 4 ? '#059669' : passiveRatio >= 2 ? '#d97706' : '#94a3b8'}">${fmtPct(passiveRatio)}</div>
        <div class="kpi__s">Rendimento passivo / activos</div>
      </div>
    </div>
    <div class="kpiRow">
      <div class="kpi">
        <div class="kpi__k">Alavancagem ${semaforo(leverageRatio, 1.5, 3)}</div>
        <div class="kpi__v">${fmt(leverageRatio, 2)}×</div>
        <div class="kpi__s">Activos / Património líquido</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Autonomia financeira ${monthsOfRunway ? semaforoInv(monthsOfRunway, 24, 6) : ""}</div>
        <div class="kpi__v">${monthsOfRunway ? fmt(monthsOfRunway, 0) + " meses" : "—"}</div>
        <div class="kpi__s">Net worth / despesas mensais</div>
      </div>
    </div>`;
}

/* ─── ALERTAS DE CONCENTRAÇÃO DE RISCO ─────────────────────── */
function renderRiskAlerts() {
  const card = document.getElementById("riskAlertCard");
  const content = document.getElementById("riskAlertContent");
  if (!card || !content) return;

  const t = calcTotals();
  if (t.assetsTotal === 0) { card.style.display = "none"; return; }

  const alerts = [];

  // Concentração por ativo individual
  for (const a of state.assets) {
    const pct = parseNum(a.value) / t.assetsTotal * 100;
    if (pct >= 40) alerts.push({ label: `${a.name}`, pct, tipo: "Ativo individual", severity: pct >= 60 ? "alta" : "média" });
  }

  // Concentração por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }
  for (const [cls, val] of Object.entries(byClass)) {
    const pct = val / t.assetsTotal * 100;
    if (pct >= 50) alerts.push({ label: `Classe: ${cls}`, pct, tipo: "Classe de activo", severity: pct >= 70 ? "alta" : "média" });
  }

  if (!alerts.length) { card.style.display = "none"; return; }
  card.style.display = "";

  content.innerHTML = alerts.map(a => {
    const col = a.severity === "alta" ? "#dc2626" : "#d97706";
    const bg = a.severity === "alta" ? "#fef2f2" : "#fffbeb";
    return `<div class="item" style="cursor:default;background:${bg}">
      <div class="item__l">
        <div class="item__t" style="color:${col}">${escapeHtml(a.label)}</div>
        <div class="item__s">${escapeHtml(a.tipo)} · Concentração ${a.severity}</div>
      </div>
      <div class="item__v" style="color:${col};font-weight:900">${fmt(a.pct, 1)}%</div>
    </div>`;
  }).join("");
}

/* ─── SIMULADOR "E SE?" ─────────────────────────────────────── */
function runWhatIf() {
  const pctInput = parseNum((document.getElementById("whatIfPct") || {}).value || "-20");
  const result = document.getElementById("whatIfResult");
  if (!result) return;

  const t = calcTotals();
  if (t.assetsTotal === 0) { toast("Sem activos para simular."); return; }

  // Calcular impacto por classe (só activos de mercado são afectados)
  const MARKET_CLASSES = ["Ações/ETFs", "Cripto", "Ouro", "Prata", "Fundos", "Obrigações"];
  const STABLE_CLASSES = ["Imobiliário", "Depósitos", "PPR", "Liquidez"];

  let marketVal = 0, stableVal = 0, otherVal = 0;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const cls = a.class || "Outros";
    if (MARKET_CLASSES.some(c => cls.includes(c.split("/")[0]))) marketVal += v;
    else if (STABLE_CLASSES.some(c => cls.includes(c.split("/")[0]))) stableVal += v;
    else otherVal += v;
  }

  const factor = pctInput / 100;
  const marketLoss = marketVal * factor; // negativo se queda
  const newAssetsTotal = t.assetsTotal + marketLoss;
  const newNet = t.net + marketLoss;
  const netChange = newNet - t.net;

  const col = netChange >= 0 ? "#059669" : "#dc2626";
  const sign = netChange >= 0 ? "+" : "";
  const arrow = netChange >= 0 ? "▲" : "▼";

  result.style.display = "";
  result.innerHTML = `
    <div style="padding:14px;background:${netChange >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:14px">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">
        Cenário: <b>${pctInput >= 0 ? "+" : ""}${pctInput}%</b> nos activos de mercado
        (${fmtEUR(marketVal)} afectados de ${fmtEUR(t.assetsTotal)} totais)
      </div>
      <div class="kpiRow">
        <div class="kpi"><div class="kpi__k">Activos totais</div><div class="kpi__v">${fmtEUR(newAssetsTotal)}</div><div class="kpi__s" style="color:${col}">${sign}${fmtEUR(marketLoss)}</div></div>
        <div class="kpi"><div class="kpi__k">Net worth</div><div class="kpi__v" style="color:${col}">${fmtEUR(newNet)}</div><div class="kpi__s" style="color:${col}">${sign}${fmtEUR(netChange)}</div></div>
        <div class="kpi"><div class="kpi__k">Impacto</div><div class="kpi__v" style="color:${col}">${sign}${fmtPct(netChange / Math.max(1, t.net) * 100)}</div><div class="kpi__s">do net worth</div></div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:8px">
        💡 Imóveis, depósitos, PPR e liquidez (${fmtEUR(stableVal)}) não são afectados neste cenário.
      </div>
    </div>`;
}

/* ─── RESUMO FISCAL COMPLETO ────────────────────────────────── */
function renderFiscalPanel() {
  const el = document.getElementById("fiscalContent");
  if (!el) return;

  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;

  // 1. Dividendos
  const divs = (state.dividends || []).filter(d => d.date >= yearStart);
  const divGross = divs.reduce((s, d) => s + parseNum(d.amount), 0);
  const divTaxPaid = divs.reduce((s, d) => s + parseNum(d.taxWithheld || 0), 0);
  const divNet = divGross - divTaxPaid;
  const divTaxDue = Math.max(0, divGross * 0.28 - divTaxPaid);

  // Usar resumo anual se existir
  const summary = (state.divSummaries || []).find(s => s.year === year);
  const divGrossFinal = summary ? parseNum(summary.gross) : divGross;
  const divTaxFinal = summary ? parseNum(summary.tax) : divTaxPaid;

  // 2. Rendas
  const rendasAcum = state.assets
    .filter(a => a.yieldType === "rent_month")
    .reduce((s, a) => s + parseNum(a.yieldValue) * now.getMonth(), 0); // meses já passados

  // 3. Mais-valias latentes (não realizadas — informativo)
  const latentGains = state.assets
    .map(a => calcGainLoss(a)).filter(Boolean)
    .reduce((s, g) => ({ gains: s.gains + Math.max(0, g.gain), losses: s.losses + Math.max(0, -g.gain) }),
      { gains: 0, losses: 0 });

  // 4. Mais-valias realizadas (movimentos de cashflow com categoria "Venda activo" — se registadas)
  const realizedGains = state.transactions
    .filter(t => t.date >= yearStart && (t.category || "").toLowerCase().includes("venda"))
    .reduce((s, t) => s + (t.type === "in" ? parseNum(t.amount) : -parseNum(t.amount)), 0);

  const totalTax = divTaxFinal + rendasAcum * 0.28;

  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:12px">Ano ${year} — estimativa simplificada (taxa fixa 28%)</div>

    <!-- Dividendos -->
    <div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">💰 Dividendos</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Bruto recebido</span><span>${fmtEUR(divGrossFinal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Retenção na fonte (já paga)</span><span style="color:#dc2626">-${fmtEUR(divTaxFinal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Líquido recebido</span><span style="color:#059669">${fmtEUR(divGrossFinal - divTaxFinal)}</span></div>
      ${divTaxDue > 0 ? `<div style="margin-top:6px;padding:6px 10px;background:#fef2f2;border-radius:8px;font-size:13px;color:#dc2626">⚠️ IRS adicional estimado a entregar: <b>${fmtEUR(divTaxDue)}</b></div>` : ""}
    </div>

    <!-- Rendas -->
    ${rendasAcum > 0 ? `<div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">🏠 Rendas recebidas (est. ${now.getMonth()} meses)</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Rendas acumuladas</span><span>${fmtEUR(rendasAcum)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>IRS estimado (28%)</span><span style="color:#dc2626">-${fmtEUR(rendasAcum * 0.28)}</span></div>
    </div>` : ""}

    <!-- Mais-valias -->
    <div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">📈 Mais-valias latentes (não realizadas)</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Ganhos latentes</span><span style="color:#059669">${fmtEUR(latentGains.gains)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Perdas latentes</span><span style="color:#dc2626">-${fmtEUR(latentGains.losses)}</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">Só são tributáveis quando realizadas (vendas).</div>
      ${latentGains.gains > 0 ? `<div style="font-size:12px;color:#92400e;margin-top:4px">Se realizadas: IRS estimado <b>${fmtEUR(latentGains.gains * 0.28)}</b></div>` : ""}
    </div>

    <!-- Total estimado -->
    <div style="padding:12px 0">
      <div style="font-weight:700;font-size:16px;display:flex;justify-content:space-between">
        <span>Total IRS estimado ${year}</span>
        <span style="color:#dc2626">${fmtEUR(totalTax)}</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">
        Estimativa muito simplificada. Não considera deduções, retenções especiais, IRS englobado, ou escalões progressivos.
        Consulta sempre um Técnico Oficial de Contas.
      </div>
    </div>`;
}

function exportFiscalCSV() {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;
  const divs = (state.dividends || []).filter(d => d.date >= yearStart);
  const header = ["Data","Activo","Dividendo Bruto (EUR)","Retenção (EUR)","Líquido (EUR)"];
  const rows = divs.map(d => [d.date||"", d.assetName||"", parseNum(d.amount).toFixed(2), parseNum(d.taxWithheld||0).toFixed(2), (parseNum(d.amount)-parseNum(d.taxWithheld||0)).toFixed(2)]);
  const csv = [header,...rows].map(r => r.map(c=>`"${c}"`).join(";")).join("\n");
  downloadText(csv, `fiscal_${year}.csv`, "text/csv;charset=utf-8;");
  toast("Resumo fiscal exportado.");
}

/* v15: FIRE custom params lidos directamente em renderFire via window._fireCustomR/Inf */

/* ─── WIRE v15 PARTE 2 ───────────────────────────────────────── */
(function wireV15b() {
  const init = () => {
    // Simulador E-se?
    const btnWI = document.getElementById("btnWhatIf");
    if (btnWI) btnWI.addEventListener("click", runWhatIf);

    // Enter no campo E-se
    const wiInput = document.getElementById("whatIfPct");
    if (wiInput) wiInput.addEventListener("keydown", e => { if (e.key === "Enter") runWhatIf(); });

    // Export fiscal
    const btnFisc = document.getElementById("btnExportFiscal");
    if (btnFisc) btnFisc.addEventListener("click", exportFiscalCSV);

    // FIRE custom inputs — wired via wire() principal

    // Nota: renderFiscalPanel é chamada directamente em renderAnalysis quando tab === "fiscal"
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* v15: renderHealthRatios e renderRiskAlerts chamados directamente em renderDashboard */

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 PARTE 3
   Funcionalidades adicionais: DCA tracker, histórico poupança,
   alerta DP próximo do vencimento, net worth milestone
   ═══════════════════════════════════════════════════════════════ */

/* ─── HISTÓRICO DE TAXA DE POUPANÇA (últimos 12 meses) ──────── */
function calcSavingsHistory() {
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7);
    if (!d) continue;
    const cur = byMonth.get(d) || { in: 0, out: 0 };
    if (tx.type === "in") cur.in += parseNum(tx.amount);
    else cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const keys = [...byMonth.keys()].sort().slice(-12);
  return keys.map(k => {
    const { in: inc, out } = byMonth.get(k);
    const net = inc - out;
    const rate = inc > 0 ? Math.max(0, net / inc * 100) : 0;
    return { month: k, in: inc, out, net, rate };
  });
}

/* ─── DCA (Dollar-Cost Averaging) TRACKER ──────────────────── */
function calcDCA(assetId) {
  // Calcula preço médio ponderado das compras do asset via transacções marcadas como "Compra"
  const buys = state.transactions.filter(t =>
    t.type === "in" &&
    (t.category || "").toLowerCase().includes("compra") &&
    t.assetRef === assetId
  );
  if (!buys.length) return null;
  const totalSpent = buys.reduce((s, t) => s + parseNum(t.amount), 0);
  const totalUnits = buys.reduce((s, t) => s + parseNum(t.units || 0), 0);
  return { totalSpent, totalUnits, avgPrice: totalUnits > 0 ? totalSpent / totalUnits : 0, count: buys.length };
}

/* ─── METAS / MILESTONES DE NET WORTH ───────────────────────── */
function renderMilestones() {
  const el = document.getElementById("milestonesContent");
  const card = document.getElementById("milestonesCard");
  if (!el) return;

  const t = calcTotals();
  const net = t.net;
  if (net <= 0) { if (card) card.style.display = "none"; return; }
  if (card) card.style.display = "";

  const milestones = [
    { val: 10000,   label: "10K€",   emoji: "🌱" },
    { val: 25000,   label: "25K€",   emoji: "🌿" },
    { val: 50000,   label: "50K€",   emoji: "🌳" },
    { val: 100000,  label: "100K€",  emoji: "💎" },
    { val: 250000,  label: "250K€",  emoji: "🏆" },
    { val: 500000,  label: "500K€",  emoji: "🚀" },
    { val: 1000000, label: "1M€",    emoji: "👑" },
  ];

  const nextMilestone = milestones.find(m => m.val > net);
  const lastAchieved  = [...milestones].reverse().find(m => m.val <= net);

  el.innerHTML = milestones.map(m => {
    const done = net >= m.val;
    const active = nextMilestone && m.val === nextMilestone.val;
    const pct = active ? Math.min(100, net / m.val * 100) : done ? 100 : 0;
    const falta = active ? m.val - net : 0;

    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;opacity:${done || active ? 1 : 0.4}">
      <div style="font-size:24px;width:32px;text-align:center">${done ? m.emoji : active ? "⏳" : "○"}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;color:${done ? "#059669" : active ? "#6366f1" : "#94a3b8"}">${m.label}</div>
        ${active ? `<div style="height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:4px">
          <div style="height:5px;background:#6366f1;border-radius:3px;width:${pct}%;transition:width .6s"></div>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${fmtPct(pct)} · faltam ${fmtEUR(falta)}</div>` : ""}
      </div>
      <div style="font-size:18px">${done ? "✅" : ""}</div>
    </div>`;
  }).join("");
}

/* ─── ALERTAS DE DEPÓSITOS A PRAZO PRÓXIMO VENCIMENTO ───────── */
function renderMaturityAlerts() {
  const el = document.getElementById("maturityAlertsContent");
  if (!el) return;

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const in60 = new Date(today); in60.setDate(in60.getDate() + 60);
  const in60ISO = in60.toISOString().slice(0, 10);

  const expiring = state.assets
    .filter(a => a.maturityDate && a.maturityDate >= todayISO && a.maturityDate <= in60ISO)
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

  const alertCard = document.getElementById("maturityAlertsCard");
  if (!expiring.length) {
    if (alertCard) alertCard.style.display = "none";
    return;
  }
  if (alertCard) alertCard.style.display = "";

  el.innerHTML = expiring.map(a => {
    const days = Math.round((new Date(a.maturityDate) - today) / 86400000);
    const urgent = days <= 14;
    const col = urgent ? "#dc2626" : "#d97706";
    const bg  = urgent ? "#fef2f2" : "#fffbeb";
    const passive = passiveFromItem(a);
    return `<div style="padding:10px 12px;border-radius:12px;background:${bg};margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;color:${col}">${escapeHtml(a.name)}</div>
          <div style="font-size:12px;color:#64748b">${escapeHtml(a.class)} · ${a.maturityDate}</div>
          ${passive > 0 ? `<div style="font-size:12px;color:#059669;margin-top:2px">Rendimento: ${fmtEUR(passive)}/ano</div>` : ""}
        </div>
        <div style="text-align:right">
          <div style="font-weight:900;font-size:15px">${fmtEUR(parseNum(a.value))}</div>
          <div style="font-size:12px;font-weight:700;color:${col}">${days}d</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

/* ─── SCORE DE DIVERSIFICAÇÃO ────────────────────────────────── */
function calcDiversificationScore() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return { score: 0, label: "—", color: "#94a3b8", breakdown: [] };

  // Herfindahl-Hirschman Index (HHI) por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }
  const shares = Object.values(byClass).map(v => v / t.assetsTotal);
  const hhi = shares.reduce((s, p) => s + p * p, 0); // 0=perfeito, 1=concentrado

  // Score 0-100 (inverso do HHI)
  const nClasses = Object.keys(byClass).length;
  const score = Math.round((1 - hhi) * 100);

  const label = score >= 70 ? "Excelente" : score >= 50 ? "Boa" : score >= 30 ? "Moderada" : "Fraca";
  const color = score >= 70 ? "#059669" : score >= 50 ? "#6366f1" : score >= 30 ? "#d97706" : "#dc2626";

  const breakdown = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, val]) => ({ cls, val, pct: val / t.assetsTotal * 100 }));

  return { score, label, color, breakdown, nClasses };
}

/* ─── RENDER: PAINEL LATERAL DE QUALIDADE DO PORTFÓLIO ──────── */
function renderPortfolioQuality() {
  const el = document.getElementById("portfolioQualityContent");
  const card = document.getElementById("portfolioQualityCard");
  if (!el) return;

  const div = calcDiversificationScore();
  const t = calcTotals();

  // Yield coverage — rendimento passivo cobre despesas?
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7); if (!d) continue;
    const cur = byMonth.get(d) || { out: 0 };
    if (tx.type === "out") cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const last6 = [...byMonth.keys()].sort().slice(-6);
  const avgOut = last6.length ? last6.reduce((s, k) => s + byMonth.get(k).out, 0) / last6.length : 0;
  const coverage = avgOut > 0 ? t.passiveAnnual / (avgOut * 12) * 100 : 0;

  if (card) card.style.display = "";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #f1f5f9">
      <div style="width:56px;height:56px;border-radius:50%;background:${div.color}20;border:3px solid ${div.color};
        display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:${div.color}">
        ${div.score}
      </div>
      <div>
        <div style="font-weight:700">Diversificação: <span style="color:${div.color}">${div.label}</span></div>
        <div style="font-size:12px;color:#64748b">${div.nClasses} classe${div.nClasses !== 1 ? "s" : ""} de activos</div>
      </div>
    </div>
    <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      ${div.breakdown.slice(0, 5).map(b =>
        `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${escapeHtml(b.cls)}</span>
          <span style="font-weight:700">${fmt(b.pct, 1)}%</span>
        </div>
        <div style="height:4px;background:#f1f5f9;border-radius:2px;margin-bottom:6px;overflow:hidden">
          <div style="height:4px;background:#6366f1;width:${Math.min(100,b.pct)}%;border-radius:2px"></div>
        </div>`
      ).join("")}
    </div>
    <div style="padding:10px 0">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px">
        <span>Cobertura passiva das despesas</span>
        <span style="font-weight:700;color:${coverage >= 100 ? "#059669" : coverage >= 50 ? "#d97706" : "#dc2626"}">${fmt(Math.min(coverage, 999), 1)}%</span>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
        <div style="height:6px;background:${coverage >= 100 ? "#10b981" : "#6366f1"};width:${Math.min(100,coverage)}%;border-radius:3px;transition:width .6s"></div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v16 PROFISSIONAL
   TWR · XIRR · Benchmark · Rebalancing · Price Alerts · Drawdown
   ═══════════════════════════════════════════════════════════════ */

/* ─── XIRR — Taxa Interna de Retorno com datas reais ────────── */
// Newton-Raphson sobre NPV para encontrar a taxa que zera os fluxos
function xirr(cashflows) {
  // cashflows: [{date: "YYYY-MM-DD", amount: number}]
  // amount positivo = investimento (saída de dinheiro = negativo para nós)
  // amount negativo = retorno (entrada)
  // convenção: cash invested = negativo, value today = positivo
  if (!cashflows || cashflows.length < 2) return null;

  const t0 = new Date(cashflows[0].date).getTime();
  const flows = cashflows.map(cf => ({
    t: (new Date(cf.date).getTime() - t0) / (365.25 * 24 * 3600 * 1000), // anos desde t0
    v: cf.amount
  }));

  // NPV(r) = sum(v_i / (1+r)^t_i)
  const npv = r => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, f.t), 0);
  const dnpv = r => flows.reduce((s, f) => s - f.t * f.v / Math.pow(1 + r, f.t + 1), 0);

  let r = 0.1; // initial guess 10%
  for (let i = 0; i < 100; i++) {
    const n = npv(r), d = dnpv(r);
    if (Math.abs(d) < 1e-12) break;
    const r2 = r - n / d;
    if (Math.abs(r2 - r) < 1e-8) { r = r2; break; }
    r = r2;
    if (!Number.isFinite(r) || Math.abs(r) > 100) return null;
  }
  return Number.isFinite(r) && Math.abs(r) < 100 ? r * 100 : null; // em %
}

function calcPortfolioXIRR() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return null;

  // Fluxos: entradas de cashflow marcadas como investimento, valor actual como retorno
  const investFlows = state.transactions
    .filter(tx => tx.type === "in" && (tx.category || "").toLowerCase().match(/poupança|investimento|depósito|compra/))
    .map(tx => ({ date: tx.date, amount: -parseNum(tx.amount) })); // saída de caixa = negativo

  if (investFlows.length === 0) return null;

  // Ordenar por data
  investFlows.sort((a, b) => a.date.localeCompare(b.date));

  // Adicionar valor actual como retorno hoje
  investFlows.push({ date: isoToday(), amount: t.net });

  return xirr(investFlows);
}

/* ─── TWR — Time-Weighted Return ────────────────────────────── */
// Elimina o efeito dos fluxos externos (depósitos/levantamentos)
// Usa os snapshots mensais como sub-períodos
function calcTWR() {
  const h = state.history
    .slice()
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));

  if (h.length < 2) return null;

  let twr = 1;
  for (let i = 1; i < h.length; i++) {
    const prev = parseNum(h[i - 1].net);
    const cur  = parseNum(h[i].net);
    if (prev <= 0) continue;

    // Estimar fluxos externos no período (poupança líquida)
    const prevISO = String(h[i - 1].dateISO).slice(0, 7);
    const curISO  = String(h[i].dateISO).slice(0, 7);
    const periodFlow = state.transactions
      .filter(tx => {
        const m = (tx.date || "").slice(0, 7);
        return m > prevISO && m <= curISO && !isInterAccountTransfer(tx);
      })
      .reduce((s, tx) => s + (tx.type === "in" ? parseNum(tx.amount) : -parseNum(tx.amount)), 0);

    // Sub-período return = (cur - flow) / prev
    const prevAdj = prev + Math.max(0, periodFlow); // adjust for external cash
    if (prevAdj <= 0) continue;
    const subReturn = (cur - periodFlow) / prevAdj;
    if (subReturn > 0) twr *= subReturn;
  }

  // Annualise
  const firstDate = new Date(h[0].dateISO);
  const lastDate  = new Date(h[h.length - 1].dateISO);
  const years = (lastDate - firstDate) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return null;

  const annualisedTWR = (Math.pow(twr, 1 / years) - 1) * 100;
  const totalTWR = (twr - 1) * 100;

  return { annualised: annualisedTWR, total: totalTWR, years: Math.round(years * 10) / 10 };
}

/* ─── BENCHMARK COMPARISON ──────────────────────────────────── */
// Retornos anuais históricos aproximados (S&P500, MSCI World, PSI20, Obrigações PT 10a)
const BENCHMARK_RETURNS = {
  "S&P 500":     { annual: 10.5, color: "#f59e0b", emoji: "🇺🇸" },
  "MSCI World":  { annual: 9.2,  color: "#6366f1", emoji: "🌍" },
  "VWCE (ETF)":  { annual: 8.8,  color: "#8b5cf6", emoji: "📊" },
  "PSI 20":      { annual: 3.2,  color: "#10b981", emoji: "🇵🇹" },
  "Ob. PT 10a":  { annual: 2.8,  color: "#64748b", emoji: "📄" },
  "Imobiliário PT": { annual: 5.5, color: "#f97316", emoji: "🏠" },
};

function renderBenchmarkComparison() {
  const el = document.getElementById("benchmarkContent");
  if (!el) return;

  const twr = calcTWR();
  const t = calcTotals();
  if (!twr || t.assetsTotal === 0) {
    el.innerHTML = `<div class="note">Precisas de pelo menos 2 snapshots para calcular a performance.<br>Usa "📸 Registar mês" no Dashboard.</div>`;
    return;
  }

  const portfolioReturn = twr.annualised;
  const rows = Object.entries(BENCHMARK_RETURNS).map(([name, b]) => {
    const diff = portfolioReturn - b.annual;
    const beating = diff > 0;
    return { name, annual: b.annual, color: b.color, emoji: b.emoji, diff, beating };
  }).sort((a, b) => b.annual - a.annual);

  // Chart data
  const allEntries = [
    { name: "O teu portfólio", annual: portfolioReturn, color: "#059669", emoji: "💼" },
    ...rows
  ].sort((a, b) => b.annual - a.annual);

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">
        TWR anualizado do teu portfólio:
        <span style="font-size:18px;font-weight:900;color:${portfolioReturn >= 0 ? "#059669" : "#dc2626"}">
          ${portfolioReturn >= 0 ? "+" : ""}${fmtPct(portfolioReturn)}
        </span>
        <span style="font-size:12px;color:#94a3b8">(${twr.years} anos · total ${twr.total >= 0 ? "+" : ""}${fmtPct(twr.total)})</span>
      </div>
    </div>
    ${allEntries.map(e => {
      const isPortfolio = e.name === "O teu portfólio";
      const barW = Math.max(0, Math.min(100, (e.annual + 5) / 20 * 100));
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span style="font-weight:${isPortfolio ? "900" : "600"}">${e.emoji} ${e.name}</span>
          <span style="font-weight:700;color:${e.annual >= 0 ? e.color : "#dc2626"}">${e.annual >= 0 ? "+" : ""}${fmtPct(e.annual)}/ano</span>
        </div>
        <div style="height:${isPortfolio ? 8 : 5}px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;background:${e.color};width:${barW}%;border-radius:4px;transition:width .6s"></div>
        </div>
        ${!isPortfolio ? `<div style="font-size:11px;color:${portfolioReturn > e.annual ? "#059669" : "#dc2626"};margin-top:2px">
          ${portfolioReturn > e.annual ? "▲ bates por " : "▼ ficas atrás por "} ${fmtPct(Math.abs(portfolioReturn - e.annual))}/ano
        </div>` : ""}
      </div>`;
    }).join("")}
    <div style="margin-top:12px;padding:10px;background:#f8fafc;border-radius:10px;font-size:11px;color:#94a3b8">
      ⚠️ Retornos históricos dos benchmarks são aproximações (médias longas). O TWR do portfólio pode variar consoante o período. Não é garantia de retornos futuros.
    </div>`;
}

/* ─── REBALANCING CALCULATOR ────────────────────────────────── */
// Calcula quanto comprar/vender para atingir a alocação alvo
function calcRebalancing() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return [];

  // Ler targets do estado (guardado em settings)
  const targets = (state.settings && state.settings.allocationTargets) || {};

  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }

  return Object.entries(byClass).map(([cls, val]) => {
    const currentPct = val / t.assetsTotal * 100;
    const targetPct = parseNum(targets[cls] || 0);
    const targetVal = t.assetsTotal * targetPct / 100;
    const delta = targetVal - val;
    return { cls, val, currentPct, targetPct, targetVal, delta };
  }).filter(r => r.targetPct > 0 || r.currentPct > 0)
    .sort((a, b) => a.delta - b.delta); // mais urgentes primeiro
}

function renderRebalancing() {
  const el = document.getElementById("rebalancingContent");
  const totalEl = document.getElementById("rebalancingTotal");
  if (!el) return;

  const targets = (state.settings && state.settings.allocationTargets) || {};
  const t = calcTotals();

  if (t.assetsTotal === 0) { el.innerHTML = `<div class="note">Sem activos.</div>`; return; }

  // Se não há targets definidos, mostrar interface de configuração
  const hasSomeTarget = Object.values(targets).some(v => parseNum(v) > 0);
  if (!hasSomeTarget) {
    const byClass = {};
    for (const a of state.assets) { const k = a.class||"Outros"; byClass[k]=(byClass[k]||0)+parseNum(a.value); }
    el.innerHTML = `
      <div class="note" style="margin-bottom:12px">Define a tua <b>alocação alvo</b> por classe (total deve = 100%):</div>
      ${Object.entries(byClass).map(([cls, val]) => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <label style="flex:1;font-size:13px;font-weight:600">${escapeHtml(cls)}<br><span style="font-weight:400;color:#94a3b8">${fmtPct(val/t.assetsTotal*100)} actual</span></label>
          <input class="input" style="width:80px" inputmode="decimal" placeholder="%" id="target_${escapeHtml(cls).replace(/[^a-zA-Z0-9]/g,'_')}"
            value="${parseNum(targets[cls])||""}">
          <span style="font-size:13px;color:#94a3b8">%</span>
        </div>`).join("")}
      <button class="btn btn--primary" id="btnSaveTargets" style="width:100%;margin-top:8px">💾 Guardar alocação alvo</button>`;

    const btnSave = document.getElementById("btnSaveTargets");
    if (btnSave) btnSave.addEventListener("click", () => {
      const newTargets = {};
      for (const [cls] of Object.entries(byClass)) {
        const key = cls.replace(/[^a-zA-Z0-9]/g,'_');
        const el2 = document.getElementById("target_" + key);
        const v = parseNum(el2 ? el2.value : 0);
        if (v > 0) newTargets[cls] = v;
      }
      const total = Object.values(newTargets).reduce((s,v)=>s+v,0);
      if (Math.abs(total - 100) > 1) { toast(`Total = ${fmtPct(total)}, deve ser 100%.`); return; }
      if (!state.settings) state.settings = {};
      state.settings.allocationTargets = newTargets;
      saveState();
      renderRebalancing();
      toast("✅ Alocação alvo guardada.");
    });
    return;
  }

  const rows = calcRebalancing();
  const totalBuy  = rows.filter(r => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const totalSell = rows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);

  if (totalEl) totalEl.innerHTML = `Comprar ${fmtEUR(totalBuy)} · Vender ${fmtEUR(totalSell)}`;

  el.innerHTML = rows.map(r => {
    const offTarget = Math.abs(r.currentPct - r.targetPct);
    const urgent = offTarget > 5;
    const action = r.delta > 0 ? "COMPRAR" : r.delta < 0 ? "VENDER" : "OK";
    const actionCol = r.delta > 0 ? "#059669" : r.delta < 0 ? "#dc2626" : "#94a3b8";
    const barCur = Math.min(100, r.currentPct);
    const barTgt = Math.min(100, r.targetPct);
    return `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <span style="font-weight:700;font-size:14px">${escapeHtml(r.cls)}</span>
          ${urgent ? `<span style="font-size:10px;background:#fef2f2;color:#dc2626;border-radius:4px;padding:1px 5px;margin-left:6px">fora do alvo</span>` : ""}
        </div>
        <div style="text-align:right">
          <span style="font-size:12px;color:${actionCol};font-weight:900">${action}</span>
          ${Math.abs(r.delta) > 1 ? `<span style="font-size:13px;font-weight:700;color:${actionCol};margin-left:6px">${fmtEUR(Math.abs(r.delta))}</span>` : ""}
        </div>
      </div>
      <div style="position:relative;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;margin-bottom:3px">
        <div style="height:8px;background:#6366f1;width:${barCur}%;border-radius:4px;transition:width .6s"></div>
        <div style="position:absolute;top:0;left:${barTgt}%;width:2px;height:8px;background:#ef4444;transform:translateX(-1px)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8">
        <span>Actual: ${fmtPct(r.currentPct)} · ${fmtEUR(r.val)}</span>
        <span>Alvo: ${fmtPct(r.targetPct)} · ${fmtEUR(r.targetVal)}</span>
      </div>
    </div>`;
  }).join("") + `
    <button class="btn btn--ghost" id="btnResetTargets" style="margin-top:10px;font-size:12px;width:100%">✏️ Redefinir alocação alvo</button>`;

  const btnReset = document.getElementById("btnResetTargets");
  if (btnReset) btnReset.addEventListener("click", () => {
    if (!state.settings) state.settings = {};
    state.settings.allocationTargets = {};
    saveState();
    renderRebalancing();
  });
}

/* ─── ALERTAS DE PREÇO ───────────────────────────────────────── */
function checkPriceAlerts() {
  const alerts = (state.settings && state.settings.priceAlerts) || [];
  if (!alerts.length) return;

  for (const a of state.assets) {
    const price = parseNum(a.value);
    for (const alert of alerts) {
      if (alert.assetId !== a.id) continue;
      const triggered =
        (alert.type === "above" && price >= alert.price) ||
        (alert.type === "below" && price <= alert.price);
      if (triggered && !alert.fired) {
        alert.fired = true;
        const msg = `${a.name}: ${alert.type === "above" ? "acima de" : "abaixo de"} ${fmtEUR(alert.price)} (actual: ${fmtEUR(price)})`;
        toast(`🔔 Alerta: ${msg}`, 6000);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("🔔 Alerta de preço — Património", { body: msg, icon: "icon192.png" });
        }
      }
    }
  }
  saveState();
}

/* ─── SIMULAÇÃO DE DRAWDOWN (pós-FIRE) ──────────────────────── */
// Simula quanto tempo dura o capital se retirar X€/ano
function calcDrawdown(capital, annualWithdrawal, returnRate, inflationRate, years) {
  if (annualWithdrawal <= 0) return { survives: true, depletedAt: null, data: [] };

  const data = [];
  let cap = capital;
  let withdrawal = annualWithdrawal;
  let depletedAt = null;

  for (let y = 0; y <= years; y++) {
    data.push({ year: y, capital: Math.max(0, cap) });
    if (cap <= 0 && !depletedAt) { depletedAt = y; }
    if (cap <= 0) continue;
    cap = cap * (1 + returnRate / 100) - withdrawal;
    withdrawal *= (1 + inflationRate / 100);
  }

  return { survives: cap > 0, depletedAt, data, finalCap: Math.max(0, cap) };
}

function renderDrawdownPanel() {
  const el = document.getElementById("drawdownContent");
  if (!el) return;

  const t = calcTotals();
  const capital = t.net;

  const wdEl  = document.getElementById("drawdownWithdrawal");
  const retEl = document.getElementById("drawdownReturn");
  const infEl = document.getElementById("drawdownInflation");
  const yrEl  = document.getElementById("drawdownYears");

  const withdrawal  = parseNum((wdEl  || {}).value) || t.passiveAnnual || 24000;
  const returnRate  = parseNum((retEl || {}).value) || 5;
  const inflationRate = parseNum((infEl || {}).value) || 2.5;
  const years = parseInt((yrEl || {}).value || "40");

  // Auto-fill se vazio
  if (wdEl && !wdEl.value) wdEl.placeholder = fmtEUR(withdrawal) + " (auto)";

  const result = calcDrawdown(capital, withdrawal, returnRate, inflationRate, years);

  const ctx = document.getElementById("drawdownChart");
  if (ctx && ctx.getContext) {
    if (window._drawdownChart) window._drawdownChart.destroy();
    window._drawdownChart = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        labels: result.data.map(d => d.year === 0 ? "Hoje" : `+${d.year}a`),
        datasets: [{
          label: "Capital restante",
          data: result.data.map(d => d.capital),
          borderColor: result.survives ? "#10b981" : "#ef4444",
          backgroundColor: result.survives ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.06)",
          fill: true, tension: .3, pointRadius: 0, borderWidth: 2
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `Capital: ${fmtEUR(c.raw)}` } }
        },
        scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v) } } }
      }
    });
  }

  el.innerHTML = `
    <div style="padding:12px;background:${result.survives ? "#f0fdf4" : "#fef2f2"};border-radius:12px;margin-bottom:12px">
      ${result.survives
        ? `<div style="font-weight:700;color:#059669;font-size:15px">✅ O capital aguenta os ${years} anos</div>
           <div style="font-size:13px;color:#064e3b;margin-top:4px">Capital final estimado: <b>${fmtEUR(result.finalCap)}</b></div>`
        : `<div style="font-weight:700;color:#dc2626;font-size:15px">⚠️ Capital esgota-se ao ano ${result.depletedAt}</div>
           <div style="font-size:13px;color:#7f1d1d;margin-top:4px">Reduz os levantamentos ou aumenta o capital antes de te reformares.</div>`
      }
    </div>
    <div style="font-size:12px;color:#64748b">
      Capital inicial: <b>${fmtEUR(capital)}</b> · 
      Levantamento: <b>${fmtEUR(withdrawal)}/ano</b> · 
      SWR: <b>${fmtPct(withdrawal/Math.max(1,capital)*100)}</b> ·
      Retorno ${fmtPct(returnRate)} · Inflação ${fmtPct(inflationRate)}
    </div>`;
}

/* ─── WIRE v16 ───────────────────────────────────────────────── */
(function wireV16() {
  const init = () => {
    // Drawdown recalc
    ["drawdownWithdrawal","drawdownReturn","drawdownInflation","drawdownYears"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", renderDrawdownPanel);
    });
    // Benchmark tab
    const tab = document.getElementById("analysisTab");
    if (tab) tab.addEventListener("change", () => {
      if (tab.value === "performance") {
        renderBenchmarkComparison();
        renderRebalancing();
      }
      if (tab.value === "drawdown") renderDrawdownPanel();
    });
    // Verificar alertas de preço após actualização de cotações
    document.addEventListener("quotesUpdated", checkPriceAlerts);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — ANÁLISE POR IA (Claude API)
   Arquitectura: app → Anthropic API /v1/messages (browser fetch)
   O utilizador precisa de introduzir a sua API key uma vez.
   Dados ficam SEMPRE locais — só o resumo vai à API.
   ═══════════════════════════════════════════════════════════════ */

/* ─── PREPARAR CONTEXTO DO PORTFÓLIO PARA A IA ──────────────── */
function buildPortfolioContext() {
  const t = calcTotals();
  const div = calcDiversificationScore();
  const twr = calcTWR();
  const irs = (() => {
    try {
      const now = new Date();
      const yearStart = now.getFullYear() + "-01-01";
      const divYTD = (state.dividends||[]).filter(d=>d.date>=yearStart).reduce((s,d)=>s+parseNum(d.amount),0);
      const rendasYTD = state.assets.filter(a=>a.yieldType==="rent_month").reduce((s,a)=>s+parseNum(a.yieldValue)*now.getMonth(),0);
      return { divYTD, rendasYTD, total: (divYTD+rendasYTD)*0.28 };
    } catch { return { divYTD:0, rendasYTD:0, total:0 }; }
  })();

  // Distribuição por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k]||0) + parseNum(a.value);
  }
  const classBreakdown = Object.entries(byClass)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `${k}: ${fmtEUR(v)} (${fmt(v/t.assetsTotal*100,1)}%)`)
    .join(", ");

  // Top 5 activos
  const top5 = [...state.assets]
    .sort((a,b)=>parseNum(b.value)-parseNum(a.value))
    .slice(0,5)
    .map(a => {
      const gl = calcGainLoss(a);
      const glStr = gl ? ` | PL: ${gl.gain>=0?"+":""}${fmtEUR(gl.gain)} (${fmt(gl.gainPct,1)}%)` : "";
      return `${a.name} [${a.class}]: ${fmtEUR(parseNum(a.value))}${glStr}`;
    })
    .join("\n    ");

  // Passivos
  const liabsStr = state.liabilities.length > 0
    ? state.liabilities.map(l=>`${l.name}: ${fmtEUR(parseNum(l.value))}`).join(", ")
    : "Sem passivos";

  // Cashflow últimos 3 meses
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date||"").slice(0,7); if (!d) continue;
    const cur = byMonth.get(d)||{in:0,out:0};
    if (tx.type==="in") cur.in+=parseNum(tx.amount); else cur.out+=parseNum(tx.amount);
    byMonth.set(d,cur);
  }
  const last3 = [...byMonth.keys()].sort().slice(-3);
  const avgIn  = last3.length ? last3.reduce((s,k)=>s+byMonth.get(k).in,0)/last3.length : 0;
  const avgOut = last3.length ? last3.reduce((s,k)=>s+byMonth.get(k).out,0)/last3.length : 0;
  const savingsRate = avgIn > 0 ? (avgIn-avgOut)/avgIn*100 : 0;

  // FIRE status
  const baseFireNum = avgOut*12 > 0 ? avgOut*12/0.0375 : 0;
  const firePct = baseFireNum > 0 ? Math.min(100,t.net/baseFireNum*100) : 0;

  // Vencimentos próximos
  const today = isoToday();
  const in90 = new Date(); in90.setDate(in90.getDate()+90);
  const in90ISO = in90.toISOString().slice(0,10);
  const maturities = state.assets
    .filter(a=>a.maturityDate && a.maturityDate>=today && a.maturityDate<=in90ISO)
    .map(a=>`${a.name} (${a.maturityDate}): ${fmtEUR(parseNum(a.value))}`)
    .join(", ") || "Nenhum";

  // Alertas de concentração
  const riskAlerts = [];
  for (const [cls, val] of Object.entries(byClass)) {
    const pct = val/t.assetsTotal*100;
    if (pct>=50) riskAlerts.push(`${cls}: ${fmt(pct,1)}% do portfólio (concentração elevada)`);
  }

  return `PORTFÓLIO FAMILIAR — DADOS REAIS (${isoToday()})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BALANÇO GLOBAL
  Activos totais:    ${fmtEUR(t.assetsTotal)}
  Passivos totais:   ${fmtEUR(t.liabsTotal)}
  Património líquido: ${fmtEUR(t.net)}

RENDIMENTO PASSIVO
  Anual estimado:    ${fmtEUR(t.passiveAnnual)}
  Mensal estimado:   ${fmtEUR(t.passiveAnnual/12)}
  Yield médio:       ${fmt(t.assetsTotal>0?t.passiveAnnual/t.assetsTotal*100:0,2)}%

DISTRIBUIÇÃO POR CLASSE
  ${classBreakdown}

SCORE DE DIVERSIFICAÇÃO: ${div.score}/100 (${div.label})

TOP 5 ACTIVOS
    ${top5}

PASSIVOS
  ${liabsStr}

CASHFLOW (média 3 meses)
  Entradas médias:   ${fmtEUR(avgIn)}/mês
  Saídas médias:     ${fmtEUR(avgOut)}/mês
  Taxa de poupança:  ${fmt(savingsRate,1)}%

MÉTRICAS CHAVE
  Rácio dívida/activos: ${fmt(t.assetsTotal>0?t.liabsTotal/t.assetsTotal*100:0,1)}%
  Progresso FIRE (base): ${fmt(firePct,1)}%
  ${twr ? `TWR anualizado: ${fmt(twr.annualised,2)}% (${twr.years} anos)` : "TWR: sem histórico suficiente"}

FISCAL (${new Date().getFullYear()} YTD)
  Dividendos brutos:  ${fmtEUR(irs.divYTD)}
  IRS estimado:       ${fmtEUR(irs.total)}

VENCIMENTOS (90 dias)
  ${maturities}

ALERTAS DE RISCO
  ${riskAlerts.length ? riskAlerts.join("\n  ") : "Sem alertas de concentração"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/* ─── PROMPTS POR MODO DE ANÁLISE ───────────────────────────── */
const AI_PROMPTS = {
  geral: `És um consultor de gestão de patrimônio pessoal experiente, especializado no mercado português.
Analisa o portfólio abaixo e fornece uma análise completa e honesta em português de Portugal.

Estrutura a tua resposta EXACTAMENTE assim (usa estes emojis e títulos):

## 💪 Pontos Fortes
(2-3 pontos concretos sobre o que está bem no portfólio)

## ⚠️ Riscos & Vulnerabilidades
(2-3 riscos reais identificados com base nos dados)

## 🎯 Sugestões Prioritárias
(3-4 acções concretas e realistas, ordenadas por impacto)

## 📊 Benchmarking
(Comparar métricas chave com referências — ex: yield vs média mercado PT, taxa de poupança, etc.)

## 🔭 Perspectiva a 5 Anos
(Projecção qualitativa com base na trajectória actual)

Sê directo, usa números concretos do portfólio, evita generalidades. Máximo 600 palavras.`,

  risco: `És um gestor de risco especializado em portfólios de particulares portugueses.
Analisa os riscos do portfólio abaixo com rigor.

Estrutura assim:

## 🔴 Riscos Críticos
(Riscos que precisam de acção imediata)

## 🟡 Riscos Moderados
(Riscos a monitorizar)

## 🟢 Pontos de Resiliência
(O que protege o portfólio)

## 🛡️ Plano de Mitigação
(Acções concretas para reduzir os riscos identificados, por ordem de prioridade)

Foca em: concentração, liquidez, risco de taxa de juro, risco cambial, risco de crédito, risco imobiliário.
Máximo 500 palavras.`,

  fiscal: `És um consultor fiscal especializado em Portugal (IRS, mais-valias, dividendos).
Analisa a situação fiscal do portfólio abaixo.

Estrutura assim:

## 🧾 Situação Fiscal Actual
(Resumo do que está sujeito a tributação)

## 💡 Oportunidades de Optimização Fiscal
(Estratégias legais para reduzir carga fiscal — PPR, mais-valias, timing, etc.)

## ⚠️ Alertas Fiscais
(O que pode causar problemas com o Fisco)

## 📋 Acções Recomendadas para ${new Date().getFullYear()}
(Específico para este ano fiscal)

IMPORTANTE: Inclui sempre a nota "Consulta sempre um TOC antes de tomar decisões fiscais."
Máximo 500 palavras.`,

  fire: `És um especialista em FIRE (Financial Independence, Retire Early) com foco em Portugal.
Analisa o progresso FIRE do portfólio abaixo.

Estrutura assim:

## 🔥 Estado FIRE Actual
(Onde está em relação ao objectivo)

## 📈 Trajectória & Prazo Estimado
(Com a taxa de poupança e rendimento actuais, quando atingirá FIRE?)

## 🚀 Aceleradores
(O que pode fazer para atingir FIRE mais cedo)

## ⚡ Riscos para o Plano FIRE
(O que pode atrasar ou comprometer)

## 🌤️ FIRE Parcial / Coast FIRE
(Análise de independência parcial já possível)

Usa os dados reais de cashflow e activos. Máximo 500 palavras.`,

  rebalancing: `És um gestor de carteiras especializado em alocação de activos para investidores portugueses.
Analisa o portfólio e sugere uma estratégia de rebalancing.

Estrutura assim:

## 📊 Alocação Actual vs Ideal
(Para o perfil deste investidor, qual seria a alocação ideal? Compara com a actual)

## ⚖️ Rebalancing Sugerido
(Exactamente o que comprar/vender/reforçar, com valores aproximados)

## 🌍 Diversificação Geográfica & Sectorial
(Como melhorar a exposição geográfica e sectorial)

## 📅 Plano de Execução
(Como e quando executar o rebalancing de forma eficiente)

Considera o contexto português: fiscalidade de ETFs, PPR, depósitos, imobiliário. Máximo 500 palavras.`
};

/* ─── ENGINE DE ANÁLISE IA ───────────────────────────────────── */
let aiHistory = [];

/* ─── CONFIGURAÇÕES DOS PROVIDERS DE IA ─────────────────────── */
const AI_PROVIDERS = {
  groq: {
    name: "Groq (Gratuito)",
    emoji: "⚡",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",   // melhor modelo gratuito Groq
    keyHint: "Obtém grátis em console.groq.com",
    keyPrefix: "gsk_",
    settingKey: "groqKey",
    format: "openai"   // protocolo OpenAI-compat
  },
  anthropic: {
    name: "Claude (Anthropic)",
    emoji: "🤖",
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    keyHint: "Obtém em console.anthropic.com (pago, mais preciso)",
    keyPrefix: "sk-",
    settingKey: "anthropicKey",
    format: "anthropic"
  }
};

async function callAIProvider(provider, apiKey, systemPrompt, userMsg) {
  if (provider.format === "openai") {
    // Groq / OpenAI-compatible
    const resp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1500,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userMsg }
        ]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error("API key Groq inválida. Verifica em console.groq.com");
      if (resp.status === 429) throw new Error("Limite Groq atingido. Tenta em alguns segundos.");
      throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";

  } else {
    // Anthropic nativo
    const resp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error("API key Claude inválida. Verifica em console.anthropic.com");
      if (resp.status === 429) throw new Error("Limite Claude atingido. Tenta em alguns segundos.");
      throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.content?.[0]?.text || "";
  }
}

async function runAIAnalysis() {
  const btn = document.getElementById("btnAiAnalyse");
  const loading = document.getElementById("aiLoadingCard");
  const resultCard = document.getElementById("aiResultCard");
  const loadingMsg = document.getElementById("aiLoadingMsg");

  // Obter modo, provider e pergunta
  const modeEl = document.querySelector('input[name="aiMode"]:checked');
  const mode = modeEl ? modeEl.value : "geral";
  const question = (document.getElementById("aiQuestion") || {}).value || "";
  const providerKey = (document.querySelector('input[name="aiProvider"]:checked') || {}).value || "groq";
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.groq;

  // Obter API key do provider seleccionado
  let apiKey = (state.settings && state.settings[provider.settingKey]) || "";
  if (!apiKey) {
    apiKey = prompt(
      `${provider.emoji} Análise IA — ${provider.name}

` +
      `Introduz a tua API key.
${provider.keyHint}

` +
      `A key fica guardada localmente. Os dados do portfólio só são enviados quando carregas "Analisar".`
    );
    if (!apiKey || !apiKey.trim()) { toast("API key não introduzida."); return; }
    apiKey = apiKey.trim();
    if (!state.settings) state.settings = {};
    state.settings[provider.settingKey] = apiKey;
    saveState();
  }

  // UI: loading
  if (btn) btn.disabled = true;
  if (resultCard) resultCard.style.display = "none";
  if (loading) loading.style.display = "";

  const modeLabels = { geral:"Análise Geral", risco:"Análise de Risco", fiscal:"Análise Fiscal", fire:"Plano FIRE", rebalancing:"Rebalancing" };

  const loadingMsgs = [
    `A usar ${provider.name}…`,
    "A ler o portfólio…",
    "A identificar riscos…",
    "A gerar sugestões…",
    "A finalizar análise…"
  ];
  let msgIdx = 0;
  const msgInterval = setInterval(() => {
    if (loadingMsg) loadingMsg.textContent = loadingMsgs[Math.min(msgIdx++, loadingMsgs.length-1)];
  }, 1800);

  try {
    const context = buildPortfolioContext();
    const systemPrompt = AI_PROMPTS[mode] || AI_PROMPTS.geral;
    const userMsg = question.trim()
      ? `Dados do portfólio:

${context}

Pergunta específica: ${question}`
      : `Dados do portfólio:

${context}`;

    const text = await callAIProvider(provider, apiKey, systemPrompt, userMsg);
    if (!text) throw new Error("Resposta vazia da IA.");

    clearInterval(msgInterval);
    if (loading) loading.style.display = "none";

    // Renderizar resultado
    renderAIResult(text, modeLabels[mode] || "Análise IA", mode, question);

    // Guardar no histórico (máx 5)
    const histEntry = {
      id: uid(),
      date: isoToday(),
      mode,
      modeLabel: modeLabels[mode],
      question: question.slice(0, 80),
      text,
      netWorth: calcTotals().net
    };
    aiHistory.unshift(histEntry);
    if (aiHistory.length > 5) aiHistory.length = 5;
    renderAIHistory();

  } catch (err) {
    clearInterval(msgInterval);
    if (loading) loading.style.display = "none";
    if (resultCard) resultCard.style.display = "";

    const errEl = document.getElementById("aiResultContent");
    const titleEl = document.getElementById("aiResultTitle");
    if (titleEl) titleEl.textContent = "❌ Erro";
    if (errEl) errEl.innerHTML = `
      <div style="padding:14px;background:#fef2f2;border-radius:12px;color:#dc2626">
        <b>${escapeHtml(err.message)}</b>
        <div style="margin-top:8px;font-size:13px;color:#64748b">
          Verifica: (1) API key correcta em Definições → IA, (2) tens créditos na conta Anthropic.
        </div>
      </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderAIResult(text, title, mode, question) {
  const resultCard = document.getElementById("aiResultCard");
  const titleEl = document.getElementById("aiResultTitle");
  const metaEl = document.getElementById("aiResultMeta");
  const contentEl = document.getElementById("aiResultContent");

  if (resultCard) resultCard.style.display = "";
  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = `${isoToday()} · Portfólio ${fmtEUR(calcTotals().net)}${question ? ` · "${question.slice(0,40)}…"` : ""}`;

  // Converter Markdown simples para HTML seguro
  if (contentEl) contentEl.innerHTML = markdownToHTML(text);

  // Scroll ao resultado
  if (resultCard) resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markdownToHTML(md) {
  if (!md) return "";
  return md
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    // Headers ## → styled div
    .replace(/^## (.+)$/gm, (_, t) => `<div class="ai-section-head">${t}</div>`)
    // **bold**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // *italic*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Listas - item
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    // Agrupar <li> em <ul>
    .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
    // Parágrafos
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<)(.+)$/gm, (m, t) => t.trim() ? `<p>${t}</p>` : "")
    // Limpar duplicados
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<div|<ul)/g, "$1")
    .replace(/(<\/div>|<\/ul>)<\/p>/g, "$1");
}

function updateAIKeyStatus() {
  const groqEl = document.getElementById("groqKeyStatus");
  const anthropicEl = document.getElementById("anthropicKeyStatus");
  const groqKey = state.settings && state.settings.groqKey;
  const anthropicKey = state.settings && state.settings.anthropicKey;
  if (groqEl) groqEl.textContent = groqKey ? "✅ Key configurada" : "Sem key — será pedida ao usar";
  if (anthropicEl) anthropicEl.textContent = anthropicKey ? "✅ Key configurada" : "Sem key — será pedida ao usar";
}

function renderAIHistory() {
  const section = document.getElementById("aiHistorySection");
  const container = document.getElementById("aiHistory");
  if (!section || !container || !aiHistory.length) {
    if (section) section.style.display = "none";
    return;
  }
  section.style.display = "";
  container.innerHTML = aiHistory.map(h => `
    <div class="item" onclick="showAIHistoryEntry('${h.id}')">
      <div class="item__l">
        <div class="item__t">${escapeHtml(h.modeLabel)}</div>
        <div class="item__s">${h.date} · Net worth: ${fmtEUR(h.netWorth)}${h.question ? ` · ${escapeHtml(h.question)}` : ""}</div>
      </div>
      <div class="item__v" style="font-size:14px">Ver →</div>
    </div>`).join("");
}

function showAIHistoryEntry(id) {
  const entry = aiHistory.find(h => h.id === id);
  if (!entry) return;
  renderAIResult(entry.text, entry.modeLabel, entry.mode, entry.question);
}

/* ─── LIMPAR API KEY NAS SETTINGS ───────────────────────────── */
function clearAIKey(provider) {
  const key = provider === "anthropic" ? "anthropicKey" : "groqKey";
  const name = provider === "anthropic" ? "Claude (Anthropic)" : "Groq";
  if (!confirm(`Apagar a API key de ${name}?`)) return;
  if (state.settings) delete state.settings[key];
  saveState();
  toast(`API key de ${name} removida.`);
}

/* ─── WIRE IA ────────────────────────────────────────────────── */
(function wireAI() {
  const init = () => {
    const btn = document.getElementById("btnAiAnalyse");
    if (btn) btn.addEventListener("click", runAIAnalysis);

    const btnCopy = document.getElementById("btnAiCopy");
    if (btnCopy) btnCopy.addEventListener("click", () => {
      const text = document.getElementById("aiResultContent");
      if (!text) return;
      navigator.clipboard.writeText(text.innerText || text.textContent || "")
        .then(() => toast("✅ Copiado para a área de transferência."))
        .catch(() => toast("Não foi possível copiar."));
    });

    // Renderizar análise quando entra na tab
    const tab = document.getElementById("analysisTab");
    if (tab) tab.addEventListener("change", () => {
      if (tab.value === "ai") { renderAIHistory(); updateAIKeyStatus(); }
    });
    // Actualizar status quando entra nas Definições
    document.querySelectorAll(".navbtn").forEach(b => {
      if (b.dataset.view === "settings") b.addEventListener("click", () => setTimeout(updateAIKeyStatus, 100));
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PORTFOLIO DE ACÇÕES/ETFs — P&L por posição + resumo global
   Lê Qty e PM das notas do import, compara com valor actual
   ═══════════════════════════════════════════════════════════════ */

/* ─── EXTRAIR DADOS DE POSIÇÃO DAS NOTAS ────────────────────── */
function parsePositionFromAsset(asset) {
  const notes = asset.notes || "";

  // 1. Qty — campo dedicado (guardado no import) ou das notas
  let qty = parseNum(asset.qty || 0);
  if (!qty) {
    const m = notes.match(/Qty=([\d.,]+)/);
    qty = m ? parseNum(m[1]) : 0;
  }
  if (!qty || qty <= 0) return null;

  // 2. Custo total em EUR — campo dedicado (mais fiável)
  let costBasis = parseNum(asset.costBasis || 0);

  // Fallback: qty × PM das notas
  if (!costBasis) {
    const pmMatch  = notes.match(/PM=([\d.,]+)/);
    const ccyMatch = notes.match(/PM=[\d.,]+\s+([A-Z]{3})/);
    const pm  = pmMatch  ? parseNum(pmMatch[1])  : 0;
    const ccy = ccyMatch ? ccyMatch[1] : "EUR";
    if (pm > 0) {
      const FX = { EUR:1, USD:0.92, GBP:1.17, CHF:1.05, DKK:0.134,
                   SEK:0.087, NOK:0.085, CAD:0.68, AUD:0.59, JPY:0.006 };
      costBasis = qty * pm * (FX[ccy] || 0.92); // default USD se não reconhecer
    }
  }
  if (!costBasis || costBasis <= 0) return null;

  // 3. Valor actual — campo value actualizado pelas cotações
  // Se value for 0 ou muito baixo (cotação não actualizada), estimar pelo custo
  let currentValue = parseNum(asset.value);
  const hasLivePrice = asset.lastUpdated && currentValue > 0;

  // Se não há cotação ao vivo ainda, usar o custo como valor actual (P&L = 0)
  if (!currentValue || currentValue <= 0) currentValue = costBasis;

  const gain = currentValue - costBasis;
  const gainPct = (gain / costBasis) * 100;
  const currentPricePerUnit = currentValue / qty;
  const costPricePerUnit = costBasis / qty;

  // Extrair PM original para mostrar
  const pmMatch2  = notes.match(/PM=([\d.,]+)/);
  const ccyMatch2 = notes.match(/PM=[\d.,]+\s+([A-Z]{3})/);
  const pm  = pmMatch2  ? parseNum(pmMatch2[1])  : costPricePerUnit;
  const ccy = ccyMatch2 ? ccyMatch2[1] : "EUR";

  return {
    qty, pm, ccy, costBasis, currentValue,
    gain, gainPct, hasLivePrice,
    currentPricePerUnit, costPricePerUnit,
    priceChange: currentPricePerUnit - costPricePerUnit,
    priceChangePct: costPricePerUnit > 0 ? (currentPricePerUnit - costPricePerUnit) / costPricePerUnit * 100 : 0
  };
}

/* ─── CALCULAR P&L GLOBAL DO PORTFÓLIO DE ACÇÕES/ETFS ───────── */
function calcEquityPortfolioPnL() {
  const equityClasses = ["Ações/ETFs", "Cripto", "Fundos"];
  const equityAssets = state.assets.filter(a =>
    equityClasses.some(c => (a.class || "").includes(c.split("/")[0]))
  );

  let totalCost    = 0;
  let totalCurrent = 0;
  const positions  = [];

  for (const asset of equityAssets) {
    const pos = parsePositionFromAsset(asset);
    if (!pos) continue;
    totalCost    += pos.costBasis;
    totalCurrent += pos.currentValue;
    positions.push({ asset, pos });
  }

  const totalGain    = totalCurrent - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return { positions, totalCost, totalCurrent, totalGain, totalGainPct };
}

/* ─── RENDER: PAINEL P&L ─────────────────────────────────────── */
function renderEquityPnL() {
  const el = document.getElementById("equityPnLContent");
  if (!el) return;

  const { positions, totalCost, totalCurrent, totalGain, totalGainPct } = calcEquityPortfolioPnL();

  if (!positions.length) {
    el.innerHTML = `<div class="note">
      Sem posições com dados de custo.<br><br>
      <b>Como activar:</b> importa o CSV do DivTracker ou de uma corretora com colunas
      <code>ticker, qty, cost_per_share</code>. A app guarda automaticamente o preço médio (PM) e,
      após actualizar cotações (⟳), calcula o P&L de cada posição.
    </div>`;
    return;
  }

  const posNeg = positions.filter(p => p.pos.gain <  0).length;
  const posPos = positions.filter(p => p.pos.gain >= 0).length;

  // Ordenar por ganho % decrescente
  const sorted = [...positions].sort((a, b) => b.pos.gainPct - a.pos.gainPct);

  // Cabeçalho global
  const totalCol = totalGain >= 0 ? "var(--green)" : "var(--red)";
  const totalSign = totalGain >= 0 ? "+" : "";

  // Calcular média ponderada de rendimento (weighted avg return)
  const withLive = positions.filter(p => p.pos.hasLivePrice);
  const avgReturn = withLive.length > 0
    ? withLive.reduce((s, p) => s + p.pos.gainPct, 0) / withLive.length
    : totalGainPct;

  el.innerHTML = `
    <!-- KPI global — hero card P&L -->
    <div style="background:linear-gradient(135deg,${totalGain >= 0 ? "#059669,#10b981" : "#dc2626,#ef4444"});
      border-radius:var(--r-sm);padding:16px 16px 14px;margin-bottom:14px;color:#fff">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;opacity:.75;margin-bottom:10px">
        Portfólio Acções &amp; ETFs — P&L
      </div>
      <!-- Valor principal: ganho/perda total -->
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
        <div style="font-size:38px;font-weight:900;letter-spacing:-1px;line-height:1">
          ${totalSign}${fmtPct(totalGainPct)}
        </div>
        <div>
          <div style="font-size:16px;font-weight:800">${totalSign}${fmtEUR(totalGain)}</div>
          <div style="font-size:11px;opacity:.7">ganho / perda total</div>
        </div>
      </div>
      <!-- Barra progresso -->
      <div style="height:5px;background:rgba(255,255,255,.25);border-radius:3px;overflow:hidden;margin-bottom:12px">
        <div style="height:5px;background:#fff;border-radius:3px;
          width:${Math.min(100, Math.max(2, (totalCurrent/Math.max(totalCost,1))*100))}%;
          transition:width .8s cubic-bezier(.4,0,.2,1)"></div>
      </div>
      <!-- 3 métricas secundárias -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px 10px">
          <div style="font-size:10px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Investido</div>
          <div style="font-size:14px;font-weight:900;margin-top:2px">${fmtEUR(totalCost)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px 10px">
          <div style="font-size:10px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Actual</div>
          <div style="font-size:14px;font-weight:900;margin-top:2px">${fmtEUR(totalCurrent)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px 10px">
          <div style="font-size:10px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Média ret.</div>
          <div style="font-size:14px;font-weight:900;margin-top:2px">${avgReturn>=0?"+":""}${fmtPct(avgReturn)}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:11px;opacity:.65">
        ${posPos} positiva${posPos!==1?"s":""} · ${posNeg} negativa${posNeg!==1?"s":""} · ${positions.length} total
        ${!withLive.length ? " · ⚡ Actualiza ⟳ Cotações para P&L real" : ""}
      </div>
    </div>

    <!-- Lista de posições — máx 10, toggle para ver todas -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;
      letter-spacing:.5px;margin-bottom:8px;display:grid;
      grid-template-columns:1fr 60px 70px 80px;gap:4px;padding:0 4px">
      <span>Activo</span><span style="text-align:right">Qtd</span>
      <span style="text-align:right">PM / Actual</span>
      <span style="text-align:right">P&L</span>
    </div>

    ${(window._pnlExpanded ? sorted : sorted.slice(0, 10)).map(({ asset, pos }) => {
      const col   = pos.gain >= 0 ? "var(--green)" : "var(--red)";
      const sign  = pos.gain >= 0 ? "+" : "";
      const arrow = pos.gain >= 0 ? "▲" : "▼";
      const barW  = Math.min(100, Math.max(0, (pos.currentValue / Math.max(pos.costBasis, 1)) * 100));
      const isCrypto = (asset.class||"").toLowerCase().includes("cripto");

      return `<div style="border:1px solid var(--line);border-radius:var(--r-sm);
        padding:11px 13px;margin-bottom:7px;background:var(--item-bg);
        border-left:3px solid ${col}">
        <div style="display:grid;grid-template-columns:1fr 60px 70px 80px;gap:4px;align-items:center">
          <div>
            <div style="font-weight:900;font-size:14px">${escapeHtml(asset.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${escapeHtml(asset.class||"")}</div>
          </div>
          <div style="text-align:right;font-size:13px;font-weight:700;color:var(--muted)">
            ${fmt(pos.qty, pos.qty < 1 ? 6 : 2)}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--muted)">${fmtEUR2(pos.costPricePerUnit)}</div>
            <div style="font-size:13px;font-weight:800;color:${pos.hasLivePrice?"var(--text)":"var(--muted)"}">
              ${pos.hasLivePrice ? fmtEUR2(pos.currentPricePerUnit) : "—"}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:900;color:${col}">${sign}${fmtPct(pos.gainPct)}</div>
            <div style="font-size:11px;color:${col};font-weight:700">${sign}${fmtEUR(pos.gain)}</div>
          </div>
        </div>
        <!-- Barra de progresso custo → actual -->
        <div style="margin-top:7px;height:4px;background:var(--line);border-radius:2px;overflow:hidden">
          <div style="height:4px;background:${col};width:${barW}%;border-radius:2px;transition:width .5s"></div>
        </div>
      </div>`;
    }).join("")}

    ${sorted.length > 10 ? `
    <div style="text-align:center;margin-top:10px">
      <button class="btn btn--ghost btn--sm" onclick="window._pnlExpanded=!window._pnlExpanded;renderEquityPnL()" style="font-size:13px">
        ${window._pnlExpanded ? "Ver menos" : "Ver todas (" + sorted.length + ")"}
      </button>
    </div>` : ""}
    <div style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">
      ${!withLive.length ? "⚡ Actualiza ⟳ Cotações para P&L real · " : ""}${positions.length} posição${positions.length!==1?"s":""} com dados de custo
    </div>`;
}

/* ─── WIRE P&L ───────────────────────────────────────────────── */
(function wirePnL() {
  const init = () => {
    // Renderizar P&L quando entra na tab "assets" e quando cotações são actualizadas
    document.addEventListener("quotesUpdated", renderEquityPnL);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   MELHORIAS ADICIONAIS v16.1
   1. Compound com DCA explícito (reinvestimento dividendos separado)
   2. Projecção FIRE com 3 taxas de retorno baseadas em TWR real
   3. Alerta de rentabilidade negativa na carteira
   4. Contexto expandido para a IA (inclui P&L e TWR reais)
   ═══════════════════════════════════════════════════════════════ */

/* ─── PROJECÇÃO COMPOSTA COM DCA + DIVIDENDOS ───────────────── */
// Versão melhorada do compound que separa:
//   - Capital inicial
//   - Contribuições mensais (DCA)
//   - Reinvestimento de dividendos (taxa separada)
function compoundWithDCA(principal, rateAnnual, years, monthlyDCA, divYieldNet) {
  // rateAnnual = valorização do capital (ex: 8%)
  // divYieldNet = yield dividendos após IRS (ex: 2% × 0.72 = 1.44%)
  // monthlyDCA = contribuição mensal fixa
  const monthlyRate    = rateAnnual / 100 / 12;
  const monthlyDivRate = divYieldNet / 100 / 12;
  const results = [];
  let cap = principal;
  let totalContrib = 0;
  let totalDivReceived = 0;

  for (let m = 0; m <= years * 12; m++) {
    if (m % 12 === 0) {
      const yr = m / 12;
      results.push({
        year: yr,
        value: cap,
        contributed: principal + totalContrib,
        dividends: totalDivReceived,
        gain: cap - principal - totalContrib
      });
    }
    if (m < years * 12) {
      const divMonth = cap * monthlyDivRate;
      totalDivReceived += divMonth;
      cap = cap * (1 + monthlyRate) + divMonth + monthlyDCA;
      totalContrib += monthlyDCA;
    }
  }
  return results;
}

/* ─── RENDER: COMPOUND MELHORADO COM DCA + DIVIDENDOS ───────── */
function renderCompoundWithDCAPanel() {
  const el = document.getElementById("compoundDCAResult");
  if (!el) return;

  const principal = parseNum($("compPrincipal").value) || calcTotals().net;
  const rateStr   = parseNum($("compRate").value);
  const years     = parseInt($("compYears").value) || 20;
  const dca       = parseNum($("compContrib").value);
  const inflEl    = document.getElementById("compInflation");
  const inflation = inflEl ? parseNum(inflEl.value) || 2.5 : 2.5;

  // Dividend yield líquido
  const divYield  = calcDividendYield ? (calcDividendYield().weightedYield || 0) * 0.72 : 0;

  // Taxa real = nominal - inflação (Fisher)
  const realRate  = realRate ? realRate(rateStr, inflation) : rateStr - inflation;

  const results = compoundWithDCA(principal, rateStr, years, dca, divYield);
  const finalRow = results[results.length - 1];
  const finalReal = compoundWithDCA(principal, Math.max(0, realRate), years, dca * 0.975 ** years, 0);
  const finalRealVal = finalReal[finalReal.length - 1].value;

  const col = finalRow.gain >= 0 ? "var(--green)" : "var(--red)";

  el.innerHTML = `
    <div style="background:var(--kpi-net);border-radius:var(--r-sm);padding:12px;margin-top:12px">
      <div style="font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
        Projecção a ${years} anos (nominal ${fmtPct(rateStr)} + ${fmtPct(divYield)} div líq.)
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Capital final</div>
          <div style="font-size:22px;font-weight:900;color:var(--vio)">${fmtEUR(finalRow.value)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Em valores reais (−${fmtPct(inflation)} inf.)</div>
          <div style="font-size:22px;font-weight:900;color:var(--muted)">${fmtEUR(finalRealVal)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Total investido</div>
          <div style="font-size:16px;font-weight:800">${fmtEUR(finalRow.contributed)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Dividendos reinvestidos</div>
          <div style="font-size:16px;font-weight:800;color:var(--green)">${fmtEUR(finalRow.dividends)}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted)">
        DCA: ${fmtEUR(dca)}/mês · Div yield líq.: ${fmtPct(divYield)} · Inflação: ${fmtPct(inflation)}
      </div>
      ${dca > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">
        💡 O DCA de ${fmtEUR(dca)}/mês contribui com <b>${fmtEUR(dca*12*years)}</b> ao longo de ${years} anos
        mas gera <b>${fmtEUR(finalRow.value - principal - dca*12*years)}</b> de juros compostos adicionais.
      </div>` : ""}
    </div>`;
}

/* ─── ALERTA: RENTABILIDADE NEGATIVA ────────────────────────── */
function checkNegativeReturn() {
  const twr = calcTWR();
  if (!twr) return;
  const el = document.getElementById("negReturnAlert");
  if (!el) return;
  if (twr.annualised < -5) {
    el.style.display = "";
    el.innerHTML = `⚠️ TWR anualizado negativo: <b>${fmt(twr.annualised,1)}%/ano</b> — o portfólio está a perder valor acima da inflação.`;
  } else {
    el.style.display = "none";
  }
}

/* ─── WIRE v16.1 ─────────────────────────────────────────────── */
(function wireV16b() {
  const init = () => {
    // Render compound DCA quando muda qualquer campo
    ["compPrincipal","compRate","compYears","compContrib","compInflation"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => {
        renderCompoundWithDCAPanel();
      });
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   FUNCIONALIDADES PROFISSIONAIS ADICIONAIS
   1. Breakdown detalhado do retorno por classe no Compound
   2. Mapa de calor de rendimento por ativo
   3. Simulador de reforma antecipada — anos até FIRE com DCA
   4. Exportação completa do relatório anual
   ═══════════════════════════════════════════════════════════════ */

/* ─── BREAKDOWN DE RETORNO POR CLASSE ───────────────────────── */
function renderReturnBreakdown() {
  const el = document.getElementById("returnBreakdownContent");
  if (!el) return;

  const py = calcPortfolioYield();
  const t  = calcTotals();
  if (t.assetsTotal === 0) { el.innerHTML = ""; return; }

  // Agrupar por classe
  const byClass = {};
  for (const a of state.assets) {
    const cls = a.class || "Outros";
    const v   = parseNum(a.value);
    const p   = passiveFromItem(a);
    if (!byClass[cls]) byClass[cls] = { value: 0, passive: 0, count: 0 };
    byClass[cls].value   += v;
    byClass[cls].passive += p;
    byClass[cls].count++;
  }

  // Para acções/ETFs: adicionar retorno de capital estimado
  const EQUITY_CLS = ["Ações/ETFs","Cripto","Fundos"];
  const rows = Object.entries(byClass)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([cls, d]) => {
      const isEq = EQUITY_CLS.some(e => cls.includes(e.split("/")[0]));
      const passiveYield = d.value > 0 ? d.passive / d.value * 100 : 0;
      const capitalReturn = isEq ? (py.equityReturnAnnual || 7) : 0;
      const totalReturn   = passiveYield + capitalReturn;
      const weight        = t.assetsTotal > 0 ? d.value / t.assetsTotal * 100 : 0;
      const contrib       = totalReturn * weight / 100; // contribuição para retorno blended
      return { cls, value: d.value, passive: d.passive, passiveYield,
               capitalReturn, totalReturn, weight, contrib, isEq };
    });

  const totalContrib = rows.reduce((s, r) => s + r.contrib, 0);

  el.innerHTML = `
    <div style="margin-bottom:10px;padding:10px;background:var(--kpi-net);border-radius:var(--r-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700">Retorno blended total</span>
        <span style="font-size:20px;font-weight:900;color:var(--vio)">${fmtPct(totalContrib)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">
        Yield passivo ${fmtPct(py.weightedYield)} + retorno capital acções ${fmtPct(py.equityReturnAnnual)}${py.twr ? " (TWR real)" : " (estimado)"}
      </div>
    </div>
    ${rows.map(r => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="font-weight:700">${escapeHtml(r.cls)}</span>
        <div style="text-align:right">
          <span style="font-weight:900;color:${r.totalReturn>3?"var(--green)":r.totalReturn>1?"var(--amber)":"var(--muted)"}">${fmtPct(r.totalReturn)}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:6px">${fmtEUR(r.value)} · ${fmtPct(r.weight)} da carteira</span>
        </div>
      </div>
      <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:2px">
        <div style="height:5px;border-radius:3px;background:${r.isEq?"var(--vio)":"var(--green)"};width:${Math.min(100,r.totalReturn/20*100)}%;transition:width .5s"></div>
      </div>
      <div style="font-size:10px;color:var(--muted)">
        Yield passivo ${fmtPct(r.passiveYield)}${r.capitalReturn>0?" + capital "+fmtPct(r.capitalReturn)+(r.isEq?" (eq.)":""):""}
        · contribui <b>${fmtPct(r.contrib)}</b> para o retorno global
        ${r.passive>0?` · ${fmtEUR(r.passive)}/ano`:""}
      </div>
    </div>`).join("")}
    <div style="font-size:11px;color:var(--muted);margin-top:8px;padding:8px;background:var(--note-bg);border-radius:var(--r-xs)">
      💡 <b>Retorno blended</b> = soma ponderada dos retornos por classe. Inclui yield passivo (juros/rendas/dividendos) e retorno de capital esperado para acções/ETFs. ${!py.twr ? "Sem snapshots suficientes — retorno acções usa estimativa histórica de 7%/ano." : "Retorno acções baseado no TWR real da carteira."}
    </div>`;
}

/* ─── ANOS ATÉ FIRE COM DCA ──────────────────────────────────── */
function calcYearsToFIRE(capital, annualSavings, returnRate, expenses) {
  const fireNumber = expenses / 0.04; // regra 4% SWR
  if (capital >= fireNumber) return 0;

  const monthlyRate = returnRate / 100 / 12;
  const monthlyDCA  = annualSavings / 12;
  let cap = capital;
  let months = 0;
  const MAX_MONTHS = 600; // 50 anos

  while (cap < fireNumber && months < MAX_MONTHS) {
    cap = cap * (1 + monthlyRate) + monthlyDCA;
    months++;
  }
  return months < MAX_MONTHS ? months / 12 : null;
}

/* ─── EXPORTAR RELATÓRIO ANUAL ───────────────────────────────── */
function exportAnnualReport() {
  const t    = calcTotals();
  const py   = calcPortfolioYield();
  const twr  = calcTWR();
  const div  = calcDiversificationScore();
  const pnl  = calcEquityPortfolioPnL();
  const year = new Date().getFullYear();

  const lines = [
    `RELATÓRIO PATRIMONIAL ${year}`,
    `Gerado em: ${new Date().toLocaleDateString("pt-PT")}`,
    "",
    "═══════════════════════════════════════",
    "BALANÇO GLOBAL",
    "═══════════════════════════════════════",
    `Activos totais:       ${fmtEUR(t.assetsTotal)}`,
    `Passivos totais:      ${fmtEUR(t.liabsTotal)}`,
    `Património líquido:   ${fmtEUR(t.net)}`,
    "",
    "═══════════════════════════════════════",
    "RENDIMENTO & RETORNO",
    "═══════════════════════════════════════",
    `Rendimento passivo anual: ${fmtEUR(t.passiveAnnual)}`,
    `Rendimento mensal:        ${fmtEUR(t.passiveAnnual/12)}`,
    `Yield passivo ponderado:  ${fmtPct(py.weightedYield)}`,
    `Retorno blended:          ${fmtPct(py.totalReturnBlended)}`,
    twr ? `TWR anualizado:           ${fmtPct(twr.annualised)} (${twr.years} anos)` : "",
    "",
    "═══════════════════════════════════════",
    "PORTFÓLIO DE ACÇÕES/ETFs",
    "═══════════════════════════════════════",
    `Investido:    ${fmtEUR(pnl.totalCost)}`,
    `Valor actual: ${fmtEUR(pnl.totalCurrent)}`,
    `Ganho/Perda:  ${pnl.totalGain>=0?"+":""}${fmtEUR(pnl.totalGain)} (${pnl.totalGain>=0?"+":""}${fmtPct(pnl.totalGainPct)})`,
    "",
    "POSIÇÕES:",
    ...pnl.positions.map(({asset,pos}) =>
      `  ${String(asset.name).padEnd(10)} ${fmtPct(pos.gainPct).padStart(8)} ${pos.gain>=0?"+":""}${fmtEUR(pos.gain)}`
    ),
    "",
    "═══════════════════════════════════════",
    "ANÁLISE DE RISCO",
    "═══════════════════════════════════════",
    `Score diversificação: ${div.score}/100 (${div.label})`,
    `Rácio dívida/activos: ${fmtPct(t.assetsTotal>0?t.liabsTotal/t.assetsTotal*100:0)}`,
    "",
    "DISTRIBUIÇÃO POR CLASSE:",
    ...div.breakdown.map(b =>
      `  ${String(b.cls).padEnd(20)} ${fmtPct(b.pct).padStart(7)} (${fmtEUR(b.val)})`
    ),
    "",
    "═══════════════════════════════════════",
    "AVISO LEGAL",
    "═══════════════════════════════════════",
    "Este relatório é meramente informativo.",
    "Consulta sempre um TOC para matérias fiscais",
    "e um consultor financeiro para decisões de investimento.",
  ].filter(l => l !== null && l !== undefined);

  downloadText(lines.join("\n"), `relatorio_patrimonial_${year}.txt`, "text/plain;charset=utf-8;");
  toast("✅ Relatório exportado.");
}
