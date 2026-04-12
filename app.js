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
      navigator.serviceWorker.register("sw.js?v=20260416").catch(() => {});
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

/* ─── TOAST ───────────────────────────────────────────────── */
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
  // passiveAnnual: yield teórico dos ativos + dividendos reais dos últimos 12 meses
  const theoreticalPassive = state.assets.reduce((a, x) => a + passiveFromItem(x), 0);
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0,10);
  const realDividends12m = (state.dividends || [])
    .filter(d => d.date >= cutoff)
    .reduce((a, d) => a + parseNum(d.amount), 0);
  // Se há dividendos reais registados usamos esses; senão o teórico
  const passiveAnnual = realDividends12m > 0
    ? Math.max(realDividends12m, theoreticalPassive)
    : theoreticalPassive;
  return { assetsTotal, liabsTotal, net, passiveAnnual, theoreticalPassive, realDividends12m };
}

/* ─── COMPOUND INTEREST ENGINE ────────────────────────────── */
// Returns array of {year, value} for n years with compound interest
function compoundGrowth(principal, rateAnnual, years, freq = 12, contributions = 0) {
  const r = rateAnnual / 100;
  const result = [];
  let v = principal;
  for (let y = 0; y <= years; y++) {
    result.push({ year: y, value: v });
    // compound for one year with monthly contributions
    for (let m = 0; m < 12; m++) {
      v = v * (1 + r / freq) + contributions / 12;
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
  list.innerHTML = alerts.map(a => {
    const days = Math.round((new Date(a.maturityDate) - today) / 86400000);
    return `<div class="item">
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
  if (gran === "month") {
    txs = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === key && t.type === "out");
  } else if (gran === "year") {
    txs = expandRecurring(state.transactions).filter(t => String(t.date || "").slice(0,4) === y && t.type === "out");
  } else {
    txs = expandRecurring(state.transactions).filter(t => t.type === "out");
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

function renderDashboard() {
  const t = calcTotals();
  $("kpiNet").textContent = fmtEUR(t.net);
  $("kpiAP").textContent = `Ativos ${fmtEUR(t.assetsTotal)} | Passivos ${fmtEUR(t.liabsTotal)}`;
  $("kpiPassiveAnnual").textContent = fmtEUR(t.passiveAnnual);
  $("kpiPassiveMonthly").textContent = fmtEUR(t.passiveAnnual / 12);
  updatePassiveBar();
  renderGoal();
  renderAlerts();

  // Dividendos YTD
  const yearStart = new Date().getFullYear() + "-01-01";
  const divYTD = (state.dividends || [])
    .filter(d => d.date >= yearStart)
    .reduce((a, d) => a + parseNum(d.amount), 0);
  const divEl = $("kpiDivYTD");
  if (divEl) divEl.textContent = fmtEUR(divYTD);
  const divCountEl = $("kpiDivCount");
  if (divCountEl) {
    const count = (state.dividends || []).filter(d => d.date >= yearStart).length;
    divCountEl.textContent = `${count} pagamento${count !== 1 ? "s" : ""} em ${new Date().getFullYear()}`;
  }

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
  const all = expandRecurring(state.transactions).filter(t => parseNum(t.amount) > 0);
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

function renderCashflow() {
  ensureMonthYearOptions();
  const y = $("cfYear").value;
  const m = String($("cfMonth").value).padStart(2, "0");
  const key = `${y}-${m}`;
  const tx = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === key);
  const totalIn = tx.filter(t => t.type === "in").reduce((a, t) => a + parseNum(t.amount), 0);
  const totalOut = tx.filter(t => t.type === "out").reduce((a, t) => a + parseNum(t.amount), 0);
  const net = totalIn - totalOut;
  const rate = totalIn > 0 ? (net / totalIn) * 100 : 0;
  $("cfIn").textContent = fmtEUR(totalIn);
  $("cfOut").textContent = fmtEUR(totalOut);
  $("cfNet").textContent = fmtEUR(net);
  $("cfRate").textContent = `${Math.round(rate)}%`;
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
  const tx = expandRecurring(state.transactions)
    .filter(t => parseNum(t.amount) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!tx.length) {
    wrap.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem movimentos</div><div class="item__s">Adiciona entradas/saídas.</div></div><div class="item__v">—</div></div>`;
    $("btnTxToggle").style.display = "none";
    return;
  }

  const shown = txExpanded ? tx : tx.slice(0, TX_PREVIEW_COUNT);
  for (const t of shown) {
    const sign = t.type === "in" ? "+" : "−";
    const isRecurringInstance = t.id && t.id.includes("_r");
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${sign} ${escapeHtml(t.category)}</div>
      <div class="item__s">${escapeHtml(t.type === "in" ? "Entrada" : "Saída")} · ${escapeHtml(t.date)}${t.recurring !== "none" ? " · ↻" : ""}${isRecurringInstance ? " · cópia" : ""}</div>
    </div><div class="item__v">${fmtEUR(parseNum(t.amount))}</div>`;
    // Only allow editing original transactions, not recurring copies
    if (!isRecurringInstance) {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => openTxModal(t.id));
    }
    wrap.appendChild(row);
  }
  if (tx.length > TX_PREVIEW_COUNT) {
    $("btnTxToggle").style.display = "inline";
    $("btnTxToggle").textContent = txExpanded ? "Ver menos" : "Ver todos";
  } else {
    $("btnTxToggle").style.display = "none";
  }
}

/* ─── DIVIDENDOS ──────────────────────────────────────────── */
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

function openTxModal() {
  $("tType").value = "in";
  $("tCat").value = "";
  $("tAmt").value = "";
  $("tRec").value = "none";
  $("tDate").value = isoToday();
  $("tNotes").value = "";
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
  state.transactions.push({ id: uid(), type, category, amount, date, recurring, notes });
  saveState();
  closeModal("modalTx");
  renderCashflow();
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
function calcPortfolioYield() {
  let totalValue = 0, totalPassive = 0;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const p = passiveFromItem(a);
    totalValue += v;
    totalPassive += p;
  }
  // yield ponderado = rendimento passivo anual / valor total dos ativos
  const weightedYield = totalValue > 0 ? (totalPassive / totalValue) * 100 : 0;
  return { totalValue, totalPassive, weightedYield };
}

// Estima contribuição mensal média dos últimos 6 meses de cashflow
function calcAvgMonthlySavings(months = 6) {
  const now = new Date();
  const byMonth = new Map();
  for (const t of state.transactions) {
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

  // Calcular dados reais da carteira
  const portfolio = calcPortfolioYield();
  const avgSavings = calcAvgMonthlySavings(6);

  // Rebuild selector
  const prev = sel.value;
  sel.innerHTML = `<option value="__portfolio__">📊 Carteira completa (automático)</option>
    <option value="__custom__">✏️ Personalizado…</option>`;
  for (const a of state.assets) {
    const rate = a.yieldType === "yield_pct" ? parseNum(a.yieldValue) :
      a.yieldType === "yield_eur_year" ? parseNum(a.yieldValue) / Math.max(1, parseNum(a.value)) * 100 :
      a.yieldType === "rent_month" ? parseNum(a.yieldValue) * 12 / Math.max(1, parseNum(a.value)) * 100 : 0;
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.name} · ${fmtPct(rate)} · ${fmtEUR(parseNum(a.value))}`;
    sel.appendChild(o);
  }

  // Default to portfolio view
  const newVal = prev && prev !== "__portfolio__" ? prev : "__portfolio__";
  sel.value = newVal;
  syncCompoundFromAsset(portfolio, avgSavings);

  // Show portfolio summary note
  const note = document.getElementById("compPortfolioNote");
  if (note) {
    if (portfolio.totalValue > 0) {
      note.style.display = "";
      note.innerHTML = `📊 <b>Carteira real:</b> ${fmtEUR(portfolio.totalValue)} investidos · Yield médio ponderado <b>${fmtPct(portfolio.weightedYield)}</b> · Rendimento passivo anual <b>${fmtEUR(portfolio.totalPassive)}</b>${avgSavings > 0 ? ` · Poupança média mensal <b>${fmtEUR(avgSavings)}</b>` : ""}`;
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

  // Chart — 3 linhas: capital+juros, sem reinvestimento, apenas capital
  const ctx = $("compoundChart") && $("compoundChart").getContext("2d");
  if (!ctx) return;
  if (compoundChart) compoundChart.destroy();

  // Linha sem reinvestimento (juro simples)
  const simpleLine = data.map((d, i) => principal + (principal * rate / 100) * i + contrib * 12 * i);
  const contribLine = data.map((_, i) => principal + contrib * 12 * i);

  compoundChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(d => `+${d.year}a`),
      datasets: [
        { label: "Juro composto", data: data.map(d => d.value), tension: .4, borderColor: "#5b5ce6", backgroundColor: "rgba(91,92,230,.08)", fill: true, pointRadius: 0, borderWidth: 2.5 },
        { label: "Juro simples", data: simpleLine, tension: .2, borderDash: [4, 4], borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0 },
        { label: "Só capital", data: contribLine, tension: 0, borderDash: [2, 6], borderColor: "#94a3b8", borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
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

async function importBankMovementsCsv(file) {
  if (!file) throw new Error("Sem ficheiro.");
  const text = await fileToText(file);
  const parsed = parseBankCsvLikeText(text);

  const debugEl = $("bankImportDebug");
  if (!parsed.length) {
    toast("0 linhas reconhecidas. Verifica o formato do ficheiro.");
    if (debugEl && debugEl.style) { debugEl.style.display = "block"; debugEl.textContent = `Primeira linha: ${text.split("\n")[0].slice(0, 200)}`; }
    return { added: 0, dup: 0, read: 0 };
  }

  const existing = new Set(state.transactions.map(tx => {
    const dir = tx.type || "in";
    return `${String(tx.date||"").slice(0,10)}|${dir}|${Math.round(Math.abs(parseNum(tx.amount))*100)}|${normStr(tx.category||"")}`;
  }));

  let added = 0, dup = 0;
  for (const r of parsed) {
    const dir = r.amount >= 0 ? "in" : "out";
    const amount = Math.abs(r.amount);
    const key = `${r.date}|${dir}|${Math.round(amount*100)}|${normStr(r.desc)}`;
    if (existing.has(key)) { dup++; continue; }
    existing.add(key);
    state.transactions.push({ id: uid(), type: dir, category: r.desc || "Banco", amount, date: r.date, recurring: "none", notes: "" });
    added++;
  }

  saveState();
  renderCashflow();
  toast(`Importação: ${added} novos · ${dup} duplicados · ${parsed.length} reconhecidos`);
  if (debugEl && debugEl.style) { debugEl.style.display = "block"; debugEl.textContent = `Lidas: ${parsed.length} · Novas: ${added} · Dup: ${dup}`; }
  return { added, dup, read: parsed.length };
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
    settings: p.settings || { currency: "EUR" },
    assets: Array.isArray(p.assets) ? p.assets : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    transactions: Array.isArray(p.transactions) ? p.transactions : [],
    dividends: Array.isArray(p.dividends) ? p.dividends : [],
    history: Array.isArray(p.history) ? p.history : []
  };
  saveState();
  renderAll();
  toast("Backup importado com sucesso.");
}

function resetAll() {
  if (!confirm("Apagar TODOS os dados deste dispositivo? Não pode ser desfeito.")) return;
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
  if (cfGran) cfGran.addEventListener("change", renderCashflow);

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

  // Bank CSV import
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

  // Settings
  $("baseCurrency").value = state.settings.currency || "EUR";
  $("baseCurrency").addEventListener("change", () => {
    state.settings.currency = $("baseCurrency").value;
    saveState(); renderAll();
  });
  const btnGoImport = document.getElementById("btnGoImport");
  if (btnGoImport) btnGoImport.addEventListener("click", () => setView("import"));

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

  // Dividendos
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

document.addEventListener("DOMContentLoaded", async () => {
  await requestPersistentStorage();
  state = await loadStateAsync();
  wire();
  renderAll();
});
