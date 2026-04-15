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

function saveState() { void storageSet(JSON.stringify(state)); }

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

  // Priority: summary > individual > theoretical
  const realPassive = summaryNet > 0 ? summaryNet : realDividends12m;
  const passiveAnnual = realPassive > 0
    ? Math.max(realPassive, theoreticalPassive)
    : theoreticalPassive;

  return { assetsTotal, liabsTotal, net, passiveAnnual, theoreticalPassive, realDividends12m, summaryNet };
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
  if (view === "assets") renderItems();
  if (view === "cashflow") renderCashflow();
  if (view === "analysis") renderAnalysis();
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
function renderAll() {
  renderDashboard();
  renderItems();
  renderCashflow();
  renderDividends();
  updatePassiveBar();
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
    label = `Yield ${fmtPct(parseNum(currentSummary.yieldPct))} · Dados ${currentYear}`;
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
  $("kpiNet").textContent = fmtEUR(t.net);
  $("kpiAP").textContent = `Ativos ${fmtEUR(t.assetsTotal)} | Passivos ${fmtEUR(t.liabsTotal)}`;
  $("kpiPassiveAnnual").textContent = fmtEUR(t.passiveAnnual);
  $("kpiPassiveMonthly").textContent = fmtEUR(t.passiveAnnual / 12);
  updatePassiveBar();
  renderGoal();
  renderAlerts();
  renderDivYTD();
  renderSummary();
  renderDistChart();
  renderTrendChart();
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
  if (!h.length) {
    if (hint) hint.style.display = "block";
    trendChart = new Chart(ctx, { type: "line", data: { labels: ["—"], datasets: [{ data: [0], tension: .35, pointRadius: 0 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } } });
    return;
  }
  if (hint) hint.style.display = "none";
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: h.map(x => x.dateISO.slice(0, 7)),
      datasets: [
        { label: "Património", data: h.map(x => parseNum(x.net)), tension: .4, pointRadius: 3, borderColor: "#5b5ce6", backgroundColor: "rgba(91,92,230,.08)", fill: true },
        { label: "Ativos", data: h.map(x => parseNum(x.assets)), tension: .4, pointRadius: 0, borderDash: [4, 4], borderColor: "#39d6d8", borderWidth: 1.5 }
      ]
    },
    options: { plugins: { legend: { display: true, labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } } }, scales: { y: { ticks: { callback: v => fmtEUR(v) } } } }
  });
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

function renderItems() {
  rebuildClassFilter();
  const list = $("itemsList");
  list.innerHTML = "";
  const q = ($("qSearch").value || "").trim().toLowerCase();
  const cfilter = $("qClass").value || "";
  const sort = $("qSort").value;

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
    return;
  }

  for (const it of src) {
    const row = document.createElement("div");
    row.className = "item";
    const badge = !showingLiabs ? yieldBadge(it) : "";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(it.name || "—")}</div>
      <div class="item__s">${escapeHtml(it.class || "")}${badge}</div>
    </div><div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", () => editItem(it.id));
    list.appendChild(row);
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
  const segS = $("segDivSummary");
  const segD = $("segDivDetail");
  if (summary) summary.style.display = mode === "summary" ? "" : "none";
  if (detail) detail.style.display = mode === "detail" ? "" : "none";
  segS.classList.toggle("seg__btn--active", mode === "summary");
  segD.classList.toggle("seg__btn--active", mode === "detail");
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

/* ─── ANALYSIS VIEW ───────────────────────────────────────── */
function renderAnalysis() {
  const tab = ($("analysisTab") && $("analysisTab").value) || "compound";
  document.querySelectorAll(".analysisPanelTab").forEach(p => { p.style.display = "none"; });
  const panel = document.getElementById("analysisPanelTab_" + tab);
  if (panel) panel.style.display = "";
  if (tab === "compound") renderCompoundPanel();
  if (tab === "forecast") renderForecastPanel();
  if (tab === "compare") renderComparePanel();
  if (tab === "fire") renderFire();
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
function calcPortfolioYield() {
  let totalValue = 0, totalPassive = 0;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const p = passiveFromItem(a);
    totalValue += v;
    totalPassive += p;
  }
  const weightedYield = totalValue > 0 ? (totalPassive / totalValue) * 100 : 0;
  return { totalValue, totalPassive, weightedYield };
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
      note.innerHTML = `📊 <b>Capital total:</b> ${fmtEUR(portfolio.totalValue)} · Yield médio ponderado <b>${fmtPct(portfolio.weightedYield)}</b> · Rendimento passivo anual <b>${fmtEUR(portfolio.totalPassive)}</b><br>
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
    $("compRate").value = fmt(p.weightedYield, 2);
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
  const capEl = $("fireCap"), expEl = $("fireExp"), passEl = $("firePass");
  const list = $("fireResults"), canvas = $("fireChart");
  if (!list || !canvas) return;

  const W = parseInt($("fireWindow") && $("fireWindow").value || "6", 10);
  const H = parseInt($("fireHorizon") && $("fireHorizon").value || "30", 10);

  const isHome = a => {
    const name = (a.name || "").toLowerCase(), cls = (a.class || "").toLowerCase();
    return cls.includes("imob") && (name.includes("casa") || name.includes("habita") || name.includes("home"));
  };
  const investible = state.assets.filter(a => !isHome(a)).reduce((s, a) => s + parseNum(a.value), 0);
  const debt = state.liabilities.reduce((s, a) => s + Math.abs(parseNum(a.value)), 0);
  const cap0 = investible - debt;

  const byMonth = new Map();
  for (const t of (state.transactions || [])) {
    if (isInterAccountTransfer(t)) continue;
    const d = t.date || "";
    if (d.length < 7) continue;
    const ym = d.slice(0, 7);
    const cur = byMonth.get(ym) || { inc: 0, out: 0 };
    const v = parseNum(t.amount); // FIXED: was t.value
    if (t.type === "out") cur.out += v; else cur.inc += v;
    byMonth.set(ym, cur);
  }
  const months = [...byMonth.keys()].sort();
  const last = months.slice(-W);
  const avg = key => last.length ? last.reduce((s, m) => s + (byMonth.get(m)?.[key] || 0), 0) / last.length : 0;
  const incM = avg("inc"), outM = avg("out"), saveM = Math.max(0, incM - outM);
  const exp0 = outM * 12;
  const passiveAnnual = calcTotals().passiveAnnual;
  const passY = cap0 > 0 ? passiveAnnual / cap0 : 0;

  if (capEl) capEl.textContent = fmtEUR(cap0);
  if (expEl) expEl.textContent = fmtEUR(exp0);
  if (passEl) passEl.textContent = fmtEUR(passiveAnnual);

  const scenarios = [
    { name: "Conservador", r: 0.04, inf: 0.03, swr: 0.0325 },
    { name: "Base", r: 0.06, inf: 0.025, swr: 0.0375 },
    { name: "Otimista", r: 0.08, inf: 0.02, swr: 0.04 }
  ];

  const results = [];
  for (const sc of scenarios) {
    let cap = cap0, exp = exp0, hit = null;
    for (let t = 0; t <= H; t++) {
      const pass = passY * cap;
      const fireNum = sc.swr > 0 ? exp / sc.swr : Infinity;
      if (cap >= fireNum && pass >= exp) { hit = { t, cap, exp, pass, fireNum }; break; }
      cap = cap * (1 + sc.r) + saveM * 12;
      exp = exp * (1 + sc.inf);
    }
    results.push({ sc, hit });
  }

  list.innerHTML = results.map(r => {
    const right = r.hit ? `🎯 FIRE em ${r.hit.t}a (cap: ${fmtEUR(r.hit.cap)})` : `Sem FIRE em ${H}a`;
    const cls = r.hit ? "kpi--in" : "";
    return `<div class="item ${cls}">
      <div class="item__l"><div class="item__t">${r.sc.name}</div><div class="item__s">r ${fmtPct(r.sc.r * 100)} · infl. ${fmtPct(r.sc.inf * 100)} · SWR ${fmtPct(r.sc.swr * 100)}</div></div>
      <div class="item__v">${right}</div>
    </div>`;
  }).join("");

  const base = scenarios[1];
  let cap = cap0, exp = exp0;
  const labels = [], capS = [], fireS = [], passS = [];
  for (let t = 0; t <= H; t++) {
    labels.push("+" + t + "a");
    capS.push(cap); fireS.push(base.swr > 0 ? exp / base.swr : null); passS.push(passY * cap * 12);
    cap = cap * (1 + base.r) + saveM * 12; exp = exp * (1 + base.inf);
  }

  const ctx = canvas.getContext("2d");
  if (fireChart) fireChart.destroy();
  fireChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Capital", data: capS, tension: .3, borderColor: "#5b5ce6", pointRadius: 0, borderWidth: 2 },
        { label: "FIRE número", data: fireS, tension: .3, borderDash: [6, 4], borderColor: "#ef4444", pointRadius: 0 },
        { label: "Rendimento passivo/ano", data: passS, tension: .3, borderColor: "#10b981", pointRadius: 0 }
      ]
    },
    options: {
      plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } } },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
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
  for (const p of posMap.values()) {
    if (!(p.qty > 0) || !(p.cost > 0)) continue;
    const upper = String(p.ticker).toUpperCase();
    const isCrypto = upper.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(upper.replace(/\.CC$/, ""));
    const cls = isCrypto ? "Cripto" : "Ações/ETFs";
    const estValue = p.cost + (p.comm || 0);
    const existingIx = state.assets.findIndex(a => (a.name || "").toUpperCase() === upper && a.class === cls);
    const item = { id: existingIx >= 0 ? state.assets[existingIx].id : uid(), class: cls, name: p.ticker, value: estValue, yieldType: "none", yieldValue: 0, compoundFreq: 12, notes: `Importado trades. Qty=${fmt(p.qty)} · PM=${p.cost > 0 ? fmt(p.cost / p.qty, 4) : "—"} ${p.ccy}` };
    if (existingIx >= 0) state.assets[existingIx] = item; else state.assets.push(item);
    addedA++;
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
    if (!parsed.length) parsed = parseSantanderTabular(text);
    if (!parsed.length) parsed = parseSantanderPDF(text);
    if (!parsed.length) parsed = parseBankCsvLikeText(text);
    if (!parsed.length) parsed = parseBankCsvGeneric(text);
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    // XLSX: usa parser estruturado directo (mais fiável que texto)
    parsed = await parseXLSXBankRows(file);
    // Fallback para texto
    if (!parsed.length) {
      text = await extractTextFromXLSX(file);
      if (text.trim()) {
        if (!parsed.length) parsed = parseSantanderTabular(text);
        if (!parsed.length) parsed = parseBankCsvGeneric(text);
      }
    }
  } else {
    // CSV, TXT, ou qualquer outro texto
    text = await fileToText(file);
    if (!parsed.length) parsed = parseSantanderTabular(text);
    if (!parsed.length) parsed = parseBankCsvLikeText(text);
    if (!parsed.length) parsed = parseBankCsvGeneric(text);
  }

  if (!parsed.length && !text.trim()) {
    showBankResult("error", "Não foi possível extrair texto do ficheiro.");
    return { added: 0, dup: 0, read: 0 };
  }

  if (!parsed.length) {
    const firstLines = text.split("\n").slice(0, 3).join(" | ").slice(0, 300);
    showBankResult("warn", `0 movimentos reconhecidos.<br><small>Primeiras linhas: ${escapeHtml(firstLines)}</small>`);
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

function resetAll() {
  const answer = prompt(
    "⚠️ RESET TOTAL\n\nEste botão apaga TUDO: ativos, passivos, movimentos, dividendos.\n\nEscreve APAGAR para confirmar:"
  );
  if ((answer || "").trim().toUpperCase() !== "APAGAR") {
    if (answer !== null) toast("Reset cancelado. Tens de escrever APAGAR.");
    return;
  }
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
  const analysisTabs = document.getElementById("analysisTab");
  if (analysisTabs) analysisTabs.addEventListener("change", () => renderAnalysis());

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
  ["fireWindow","fireHorizon"].forEach(id => {
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
  function clearTransactions() {
    const n = state.transactions.length;
    if (!n) { toast("Sem movimentos para limpar."); return; }
    if (!confirm(`⚠️ Apagar TODOS os ${n} movimentos?\n\nOs teus ativos e passivos são mantidos.\nPodes reimportar os ficheiros do banco a seguir.`)) return;
    state.transactions = [];
    saveState();
    renderAll();
    checkDuplicateWarning();
    toast(`🗑️ ${n} movimentos apagados. Reimporta os ficheiros do banco.`, 4000);
  }
  const btnClearTx = document.getElementById("btnClearTransactions");
  if (btnClearTx) btnClearTx.addEventListener("click", clearTransactions);
  const btnClearTx2 = document.getElementById("btnClearTransactions2");
  if (btnClearTx2) btnClearTx2.addEventListener("click", clearTransactions);

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
  if (segDivS) segDivS.addEventListener("click", () => setDivMode("summary"));
  if (segDivD) segDivD.addEventListener("click", () => setDivMode("detail"));
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
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

  for (const asset of candidates) {
    const ticker = asset.name && /^[A-Z0-9.]{2,10}$/.test(asset.name.trim())
      ? asset.name.trim()
      : extractTicker(asset);
    if (!ticker) continue;

    try {
      const q = await fetchQuote(ticker, workerUrl);
      if (q && Number.isFinite(q.price) && q.price > 0) {
        // Detectar qty das notas (importado via DivTracker)
        const qtyMatch = (asset.notes || "").match(/Qty=([\d.]+)/);
        const qty = qtyMatch ? parseFloat(qtyMatch[1]) : null;
        const newValue = qty ? qty * q.price : q.price;

        // Guardar preço unitário e data de actualização nas notas
        const noteBase = (asset.notes || "").replace(/\s*·?\s*Preço:[^\n·]*/g, "").trim();
        asset.value = newValue;
        asset.notes = `${noteBase}${noteBase ? " · " : ""}Preço: ${fmtEUR2(q.price)} (${new Date().toLocaleDateString("pt-PT")})`;
        updated++;
      } else {
        failed++;
        errors.push(ticker);
      }
    } catch (e) {
      failed++;
      errors.push(`${ticker} (${e.message})`);
    }
  }

  saveState();
  renderAll();

  if (btn) { btn.disabled = false; btn.textContent = "⟳ Cotações"; }

  if (updated > 0 && !failed) {
    toast(`✅ ${updated} ativo${updated !== 1 ? "s" : ""} actualizado${updated !== 1 ? "s" : ""}`, 3000);
  } else if (updated > 0) {
    toast(`✅ ${updated} actualizado${updated !== 1 ? "s" : ""} · ⚠️ ${failed} erro${failed !== 1 ? "s" : ""}: ${errors.slice(0,3).join(", ")}`, 5000);
  } else {
    toast(`⚠️ Falha a actualizar: ${errors.slice(0,3).join(", ")}. Verifica o Worker.`, 5000);
  }
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
});
