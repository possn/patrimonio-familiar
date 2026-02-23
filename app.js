/* Património Familiar — REBUILD percento-ish v5 (fix nav+import+tx) */
"use strict";

function safeClone(obj){
  try{ if (typeof structuredClone === "function") return structuredClone(obj); }catch(_){ }
  return JSON.parse(JSON.stringify(obj));
}


// =======================
// Persistence (iOS-safe)
// =======================
// iOS in-app browsers / Private Mode can drop localStorage between sessions.
// Use IndexedDB as primary storage with localStorage fallback.

const STORAGE_KEY = "PF_STATE_PERCENTO_V5"; // keep for backwards-compat

const DB_NAME = "pf_percento";
const DB_STORE = "kv";
const DB_KEY = "state";

function idbAvailable(){
  return typeof indexedDB !== "undefined" && indexedDB;
}

function idbOpen(){
  return new Promise((resolve, reject) => {
    try{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB open failed"));
    }catch(e){ reject(e); }
  });
}

async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    try{
      const tx = db.transaction(DB_STORE, "readonly");
      const st = tx.objectStore(DB_STORE);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB get failed"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => { try{db.close();}catch{} };
    }catch(e){ try{db.close();}catch{} reject(e); }
  });
}

async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    try{
      const tx = db.transaction(DB_STORE, "readwrite");
      const st = tx.objectStore(DB_STORE);
      st.put(value, key);
      tx.oncomplete = () => { try{db.close();}catch{} resolve(true); };
      tx.onerror = () => { try{db.close();}catch{} reject(tx.error || new Error("IDB set failed")); };
    }catch(e){ try{db.close();}catch{} reject(e); }
  });
}

async function idbDel(key){
  const db = await idbOpen();
  return new Promise((resolve) => {
    try{
      const tx = db.transaction(DB_STORE, "readwrite");
      const st = tx.objectStore(DB_STORE);
      st.delete(key);
      tx.oncomplete = () => { try{db.close();}catch{} resolve(true); };
      tx.onerror = () => { try{db.close();}catch{} resolve(false); };
    }catch(e){ try{db.close();}catch{} resolve(false); }
  });
}

async function requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(_){/* ignore */}
}

async function storageGet(){
  // 1) IndexedDB
  if(idbAvailable()){
    try{
      const v = await idbGet(DB_KEY);
      if(v) return v;
    }catch(_){/* fall through */}
  }
  // 2) localStorage fallback
  try{ return localStorage.getItem(STORAGE_KEY); }catch(_){ return null; }
}

async function storageSet(raw){
  if(idbAvailable()){
    try{ await idbSet(DB_KEY, raw); return; }catch(_){/* fall through */}
  }
  try{ localStorage.setItem(STORAGE_KEY, raw); }catch(_){/* ignore */}
}

async function storageClear(){
  if(idbAvailable()) await idbDel(DB_KEY);
  try{ localStorage.removeItem(STORAGE_KEY); }catch(_){/* ignore */}
}
const TX_PREVIEW_COUNT = 5;

const DEFAULT_STATE = {
  settings: { currency: "EUR" },
  assets: [],       // {id, class, name, value, yieldType, yieldValue, notes, fav}
  liabilities: [],  // {id, class, name, value, notes}
  transactions: [], // {id, type:'in'|'out', category, amount, date, recurring:'none'|'monthly'|'yearly'}
  history: []       // {dateISO, net, assets, liabilities, passiveAnnual}
};

let state = safeClone(DEFAULT_STATE);
let currentView = "dashboard";
let showingLiabs = false;
let summaryExpanded = false;
let txExpanded = false;

let distChart = null;
let distDetailExpanded = false;
let fireChart = null;

let trendChart = null;

function $(id){ return document.getElementById(id); }

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fmtEUR(n){
  const cur = (state.settings && state.settings.currency) ? state.settings.currency : "EUR";
  const v = Number(n || 0);
  try{
    return new Intl.NumberFormat("pt-PT", { style:"currency", currency: cur, maximumFractionDigits:0 }).format(v);
  }catch{
    return (Math.round(v)).toString() + " " + cur;
  }
}

// Generic number formatter (for quantities, prices, etc.)
function fmt(n, maxFrac = 6){
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return new Intl.NumberFormat("pt-PT", {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0
  }).format(v);
}

// Money formatter for arbitrary currencies (fallbacks to EUR)
function fmtMoney(n, currency){
  const v = Number(n);
  const cur = (currency || (state.settings && state.settings.currency) || "EUR");
  try{
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2
    }).format(Number.isFinite(v) ? v : 0);
  }catch{
    // Some brokers export non-ISO codes; fallback.
    try{
      return new Intl.NumberFormat("pt-PT", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2
      }).format(Number.isFinite(v) ? v : 0);
    }catch{
      return (Number.isFinite(v) ? v.toFixed(2) : "0.00") + " " + cur;
    }
  }
}

function parseNum(x){
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;

  let s = String(x).trim();
  if (!s) return 0;

  // Normalise whitespace and strip common noise (€, $, USD, etc.).
  s = s.replace(/\u00A0/g, " ").replace(/\s+/g, " ");

  // Parentheses indicate negative values: (1 234,56)
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }

  // Keep only digits, separators, minus and spaces.
  let t = s.replace(/[^0-9,\.\- ]+/g, "");
  t = t.replace(/\s/g, "");

  const hasComma = t.includes(",");
  const hasDot = t.includes(".");

  if (hasComma && hasDot){
    // Last separator decides decimal.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")){
      // 1.234,56
      t = t.replace(/\./g, "").replace(/,/g, ".");
    }else{
      // 1,234.56
      t = t.replace(/,/g, "");
    }
  }else if (hasComma && !hasDot){
    // Comma only: decimal if ends with ,d or ,dd; otherwise thousands.
    if (/,[0-9]{1,2}$/.test(t)) t = t.replace(/,/g, ".");
    else t = t.replace(/,/g, "");
  }else if (!hasComma && hasDot){
    // Dot only: if multiple dots and doesn't look like a decimal, strip dots.
    const parts = t.split(".");
    if (parts.length > 2 && !/\.[0-9]{1,2}$/.test(t)) t = t.replace(/\./g, "");
  }

  const n = Number(t);
  const out = Number.isFinite(n) ? n : 0;
  return neg ? -out : out;
}

async function loadStateAsync(){
  try{
    const raw = await storageGet();
    if (!raw) return safeClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      settings: parsed.settings || {currency:"EUR"},
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  }catch{
    return safeClone(DEFAULT_STATE);
  }
}

function showStorageWarningOnce(){
  try{
    if(sessionStorage.getItem("pf_storage_warned")) return;
    sessionStorage.setItem("pf_storage_warned","1");
  }catch{}
  // Non-blocking toast
  toast("Atenção: alguns browsers (modo privado / app do GitHub) podem não guardar. Abre no Safari e adiciona ao Ecrã principal para máxima fiabilidade.");
}

async function saveStateAsync(){
  try{
    await storageSet(JSON.stringify(state));
  }catch(_){
    showStorageWarningOnce();
  }
}

// Backwards-compatible sync-ish wrapper (fire-and-forget)
function saveState(){
  void saveStateAsync();
}

function setView(view){
  currentView = view;
  for (const s of document.querySelectorAll(".view")){
    s.hidden = s.dataset.view !== view;
  }
  for (const b of document.querySelectorAll(".navbtn")){
    b.classList.toggle("navbtn--active", b.dataset.view === view);
  }
  // render on view switch
  if (view === "dashboard") renderDashboard();
  if (view === "assets") renderItems();
  if (view === "cashflow") renderCashflow();
  // ensure top of main content on switch (avoid manual scroll)
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openModal(id){ $(id).setAttribute("aria-hidden","false"); }
function closeModal(id){ $(id).setAttribute("aria-hidden","true"); }

function wireModalClosers(){
  document.body.addEventListener("click", (e)=>{
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const close = t.getAttribute("data-close");
    if (close) closeModal(close);
  });
}

function calcTotals(){
  const assetsTotal = state.assets.reduce((a,x)=>a + parseNum(x.value), 0);
  const liabsTotal = state.liabilities.reduce((a,x)=>a + parseNum(x.value), 0);
  const net = assetsTotal - liabsTotal;
  const passiveAnnual = state.assets.reduce((a,x)=>a + passiveFromItem(x), 0);
  return {assetsTotal, liabsTotal, net, passiveAnnual};
}

function passiveFromItem(it){
  const v = parseNum(it.value);
  const yv = parseNum(it.yieldValue);
  const yt = it.yieldType || "none";
  if (yt === "yield_pct") return v * (yv/100);
  if (yt === "yield_eur_year") return yv;
  if (yt === "rent_month") return yv * 12;
  return 0;
}

function renderDashboard(){
  const t = calcTotals();
  $("kpiNet").textContent = fmtEUR(t.net);
  $("kpiAP").textContent = `Ativos ${fmtEUR(t.assetsTotal)} | Passivos ${fmtEUR(t.liabsTotal)}`;
  $("kpiPassiveAnnual").textContent = fmtEUR(t.passiveAnnual);
  $("kpiPassiveMonthly").textContent = fmtEUR(t.passiveAnnual/12);

  renderSummary();
  renderDistChart();
  renderTrendChart();
}

function renderSummary(){
  const list = $("summaryList");
  list.innerHTML = "";
  const items = [...state.assets].sort((a,b)=>parseNum(b.value)-parseNum(a.value));
  if (items.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="item__l"><div class="item__t">Sem ativos</div><div class="item__s">Usa o botão + para adicionar.</div></div><div class="item__v">—</div>`;
    list.appendChild(empty);
    $("btnSummaryToggle").style.display = "none";
    return;
  }
  const shown = summaryExpanded ? items : items.slice(0,10);
  for (const it of shown){
    list.appendChild(renderRow(it.name, it.class, parseNum(it.value)));
  }
  $("btnSummaryToggle").style.display = (items.length > 10) ? "inline-flex" : "none";
  $("btnSummaryToggle").textContent = summaryExpanded ? "Ver menos" : "Ver o resto";
}

function renderRow(title, subtitle, value){
  const d = document.createElement("div");
  d.className = "item";
  d.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(title||"—")}</div><div class="item__s">${escapeHtml(subtitle||"")}</div></div><div class="item__v">${fmtEUR(value)}</div>`;
  return d;
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function renderDistChart(){
  const by = {};
  for (const a of state.assets){
    const k = a.class || "Outros";
    by[k] = (by[k]||0) + parseNum(a.value);
  }
  const labels = Object.keys(by);
  const values = labels.map(k=>by[k]);

  const ctx = $("distChart").getContext("2d");
  if (distChart) distChart.destroy();

  if (labels.length === 0){
    distChart = new Chart(ctx, {
      type:"doughnut",
      data:{ labels:["Sem dados"], datasets:[{ data:[1] }] },
      options:{ plugins:{ legend:{ display:false } }, cutout:"70%" }
    });
    return;
  }

  distChart = new Chart(ctx,{
    type:"doughnut",
    data:{ labels, datasets:[{ data: values, borderWidth:0 }] },
    options:{
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label:(c)=> `${c.label}: ${fmtEUR(c.raw)}` } }
      },
      cutout:"70%"
    }
  });
}

function renderTrendChart(){
  const ctx = $("trendChart").getContext("2d");
  if (trendChart) trendChart.destroy();

  const h = state.history.slice().sort((a,b)=>String(a.dateISO).localeCompare(String(b.dateISO)));
  if (h.length === 0){
    $("historyHint").style.display = "block";
    trendChart = new Chart(ctx, {
      type:"line",
      data:{ labels:["—"], datasets:[{ data:[0], tension:.35, pointRadius:0 }] },
      options:{
        plugins:{ legend:{ display:false } },
        scales:{ x:{ display:false }, y:{ display:false } }
      }
    });
    return;
  }
  $("historyHint").style.display = "none";
  const labels = h.map(x=>x.dateISO.slice(0,7));
  const data = h.map(x=>parseNum(x.net));

  trendChart = new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{ data, tension:.35, pointRadius:3 }] },
    options:{
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(c)=>fmtEUR(c.raw) } } },
      scales:{ y:{ ticks:{ callback:(v)=>fmtEUR(v) } } }
    }
  });
}

function snapshotMonth(){
  const t = calcTotals();
  const now = new Date();
  const dateISO = now.toISOString().slice(0,10);
  state.history.push({ dateISO, net: t.net, assets: t.assetsTotal, liabilities: t.liabsTotal, passiveAnnual: t.passiveAnnual });
  saveState();
  renderDashboard();
  alert("Snapshot registado.");
}

/* ITEMS view */
function setModeLiabs(on){
  showingLiabs = !!on;
  $("segLiabs").classList.toggle("seg__btn--active", showingLiabs);
  $("segAssets").classList.toggle("seg__btn--active", !showingLiabs);
  $("itemsTitle").textContent = showingLiabs ? "Passivos" : "Ativos";
  $("itemsSub").textContent = showingLiabs ? "Créditos, dívidas, cartões… (valor positivo = dívida)" : "Imobiliário, liquidez, ações/ETFs, metais, cripto, fundos, PPR, depósitos…";
  $("btnAddItem").textContent = "Adicionar";
  rebuildClassFilter();
  renderItems();
}

function rebuildClassFilter(){
  const sel = $("qClass");
  const current = sel.value;
  sel.innerHTML = `<option value="">Todas as classes</option>`;
  const src = showingLiabs ? state.liabilities : state.assets;
  const classes = Array.from(new Set(src.map(x=>x.class).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b),"pt"));
  for (const c of classes){
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  sel.value = current;
}

function renderItems(){
  rebuildClassFilter();
  const list = $("itemsList");
  list.innerHTML = "";
  const q = ($("qSearch").value||"").trim().toLowerCase();
  const cfilter = $("qClass").value || "";
  const sort = $("qSort").value;

  let src = showingLiabs ? [...state.liabilities] : [...state.assets];
  src = src.filter(it=>{
    const hay = `${it.name||""} ${it.class||""}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (cfilter && (it.class||"") !== cfilter) return false;
    return true;
  });

  if (sort === "value_desc") src.sort((a,b)=>parseNum(b.value)-parseNum(a.value));
  if (sort === "value_asc") src.sort((a,b)=>parseNum(a.value)-parseNum(b.value));
  if (sort === "name_asc") src.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"pt"));

  if (src.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="item__l"><div class="item__t">Sem ${showingLiabs ? "passivos" : "ativos"}</div><div class="item__s">Usa “Adicionar”.</div></div><div class="item__v">—</div>`;
    list.appendChild(empty);
    return;
  }

  for (const it of src){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(it.name||"—")}</div>
      <div class="item__s">${escapeHtml(it.class||"")}${showingLiabs ? "" : yieldBadge(it)}</div>
    </div>
    <div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", ()=>editItem(it.id));
    list.appendChild(row);
  }
}

function yieldBadge(it){
  const yt = it.yieldType || "none";
  const yv = parseNum(it.yieldValue);
  if (yt === "yield_pct" && yv>0) return ` · yield ${yv}%`;
  if (yt === "yield_eur_year" && yv>0) return ` · ${fmtEUR(yv)}/ano`;
  if (yt === "rent_month" && yv>0) return ` · ${fmtEUR(yv)}/mês`;
  return "";
}

/* modal item */
const CLASSES_ASSETS = ["Imobiliário","Liquidez","Ações/ETFs","Cripto","Ouro","Prata","Arte","Fundos","PPR","Depósitos","Outros"];
const CLASSES_LIABS  = ["Crédito habitação","Crédito pessoal","Cartão de crédito","Outros"];

let editingItemId = null;

function openItemModal(kind){
  editingItemId = null;
  $("mId").value = "";
  $("mKind").value = kind;
  const delBtn = document.getElementById("btnDeleteItem");
  if (delBtn) delBtn.style.display = "none";
  $("modalItemTitle").textContent = (kind === "liab") ? "Adicionar passivo" : "Adicionar ativo";
  const sel = $("mClass");
  sel.innerHTML = "";
  const classes = (kind === "liab") ? CLASSES_LIABS : CLASSES_ASSETS;
  for (const c of classes){
    const o = document.createElement("option");
    o.value=c; o.textContent=c;
    sel.appendChild(o);
  }
  $("mName").value = "";
  $("mValue").value = "";
  $("mYieldType").value = "none";
  $("mYieldValue").value = "";
  $("mNotes").value = "";
  $("mYieldType").disabled = (kind === "liab");
  $("mYieldValue").disabled = (kind === "liab");
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
}

function editItem(id){
  const src = showingLiabs ? state.liabilities : state.assets;
  const it = src.find(x=>x.id===id);
  if (!it) return;

  editingItemId = id;
  const kind = showingLiabs ? "liab" : "asset";
  $("mId").value = id;
  $("mKind").value = kind;
  const delBtn = document.getElementById("btnDeleteItem");
  if (delBtn) delBtn.style.display = "";
  $("modalItemTitle").textContent = showingLiabs ? "Editar passivo" : "Editar ativo";
  const sel = $("mClass");
  sel.innerHTML = "";
  const classes = (kind === "liab") ? CLASSES_LIABS : CLASSES_ASSETS;
  for (const c of classes){
    const o=document.createElement("option"); o.value=c; o.textContent=c; sel.appendChild(o);
  }
  sel.value = it.class || classes[0];
  $("mName").value = it.name || "";
  $("mValue").value = String(parseNum(it.value) || "");
  $("mNotes").value = it.notes || "";
  $("mYieldType").disabled = showingLiabs;
  $("mYieldValue").disabled = showingLiabs;
  if (!showingLiabs){
    $("mYieldType").value = it.yieldType || "none";
    $("mYieldValue").value = (it.yieldValue!==undefined && it.yieldValue!==null) ? String(it.yieldValue) : "";
  }else{
    $("mYieldType").value = "none";
    $("mYieldValue").value = "";
  }
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
}

function saveItemFromModal(){
  const kind = $("btnSaveItem").dataset.kind;
  const isLiab = (kind === "liab");
  const obj = {
    id: editingItemId || uid(),
    class: $("mClass").value || (isLiab ? "Outros" : "Outros"),
    name: ($("mName").value||"").trim(),
    value: parseNum($("mValue").value),
    notes: ($("mNotes").value||"").trim()
  };

  if (!obj.name){
    alert("Nome é obrigatório.");
    return;
  }
  if (!isLiab){
    obj.yieldType = $("mYieldType").value || "none";
    obj.yieldValue = parseNum($("mYieldValue").value);
  }

  if (isLiab){
    const ix = state.liabilities.findIndex(x=>x.id===obj.id);
    if (ix>=0) state.liabilities[ix] = obj; else state.liabilities.push(obj);
  }else{
    const ix = state.assets.findIndex(x=>x.id===obj.id);
    if (ix>=0) state.assets[ix] = obj; else state.assets.push(obj);
  }

  saveState();
  closeModal("modalItem");
  renderDashboard();
  renderItems();
}

/* CASHFLOW */
function ensureMonthYearOptions(){
  const now = new Date();
  const yearNow = now.getFullYear();
  const years = [];
  for (let y=yearNow-3; y<=yearNow+1; y++) years.push(y);
  $("cfYear").innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
  $("cfMonth").innerHTML = Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}">${String(m).padStart(2,"0")}</option>`).join("");
  $("cfYear").value = String(yearNow);
  $("cfMonth").value = String(now.getMonth()+1);

  // default date in modal
  $("tDate").value = now.toISOString().slice(0,10);
}

function monthKeyFromDateISO(d){
  const s = String(d||"");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s.slice(0,7);
}

function renderCashflow(){
  ensureMonthYearOptions();

  const y = $("cfYear").value;
  const m = String($("cfMonth").value).padStart(2,"0");
  const key = `${y}-${m}`;

  const tx = expandRecurring(state.transactions).filter(t=>monthKeyFromDateISO(t.date)===key);
  const totalIn = tx.filter(t=>t.type==="in").reduce((a,t)=>a+parseNum(t.amount),0);
  const totalOut = tx.filter(t=>t.type==="out").reduce((a,t)=>a+parseNum(t.amount),0);
  const net = totalIn - totalOut;
  const rate = totalIn>0 ? (net/totalIn)*100 : 0;

  $("cfIn").textContent = fmtEUR(totalIn);
  $("cfOut").textContent = fmtEUR(totalOut);
  $("cfNet").textContent = fmtEUR(net);
  $("cfRate").textContent = `${Math.round(rate)}%`;

  renderTxList();
}

// Compat: some codepaths (e.g., CSV import) call renderBalance().
// In this build, the Balance tab is rendered via renderCashflow().
function renderBalance(){
  renderCashflow();
}

function expandRecurring(tx){
  // Recorrentes contam para o mês selecionado e meses futuros; isto é uma aproximação.
  // Mantemos também o item original para o mês da data.
  const out = [];
  const now = new Date();
  const yearNow = now.getFullYear();
  const monthNow = now.getMonth()+1;
  for (const t of tx){
    out.push(t);
    const rec = t.recurring || "none";
    if (rec === "none") continue;
    const d0 = new Date(t.date+"T00:00:00");
    if (isNaN(d0.getTime())) continue;
    for (let i=1;i<=24;i++){ // expand up to 24 months
      const d = new Date(d0);
      if (rec === "monthly") d.setMonth(d.getMonth()+i);
      if (rec === "yearly") d.setFullYear(d.getFullYear()+i);
      if (d.getFullYear()>yearNow+2) break;
      out.push({ ...t, id: t.id + "_r" + i, date: d.toISOString().slice(0,10) });
    }
  }
  return out;
}

function openTxModal(){
  $("tType").value = "in";
  $("tCat").value = "";
  $("tAmt").value = "";
  $("tRec").value = "none";
  $("tDate").value = new Date().toISOString().slice(0,10);
  openModal("modalTx");
}

function saveTxFromModal(){
  const type = $("tType").value;
  const category = ($("tCat").value||"").trim() || "Outros";
  const amount = parseNum($("tAmt").value);
  const date = $("tDate").value;
  const recurring = $("tRec").value || "none";

  if (!amount || amount <= 0){
    alert("Valor tem de ser > 0.");
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    alert("Data inválida.");
    return;
  }

  state.transactions.push({ id: uid(), type, category, amount, date, recurring });
  saveState();
  closeModal("modalTx");
  renderCashflow();
}

function renderTxList(){
  const wrap = $("txList");
  wrap.innerHTML = "";
  const tx = expandRecurring(state.transactions)
    .filter(t=>parseNum(t.amount) > 0)
    .slice()
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  if (tx.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="item__l"><div class="item__t">Sem movimentos</div><div class="item__s">Adiciona entradas/saídas para calcular o balanço.</div></div><div class="item__v">—</div>`;
    wrap.appendChild(empty);
    $("btnTxToggle").style.display = "none";
    return;
  }

  const shown = txExpanded ? tx : tx.slice(0, TX_PREVIEW_COUNT);
  for (const t of shown){
    const sign = (t.type==="in") ? "+" : "−";
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${sign} ${escapeHtml(t.category)}</div>
      <div class="item__s">${escapeHtml(t.type==="in" ? "Entrada" : "Saída")} · ${escapeHtml(t.date)}</div>
    </div>
    <div class="item__v">${fmtEUR(parseNum(t.amount))}</div>`;
    wrap.appendChild(row);
  }

  if (tx.length > TX_PREVIEW_COUNT){
    $("btnTxToggle").style.display = "inline";
    $("btnTxToggle").textContent = txExpanded ? "Ver menos" : "Ver todos";
  }else{
    $("btnTxToggle").style.display = "none";
  }
}

/* IMPORT */
function fileToRows(file){
  return new Promise((resolve,reject)=>{
    const name = file.name.toLowerCase();
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error("Erro a ler ficheiro."));
    reader.onload = ()=>{
      try{
        const data = reader.result;
        let rows = [];
        if (name.endsWith(".csv")){
          const text = data;
          rows = csvToObjects(text);
        }else{
          const wb = XLSX.read(data, { type:"array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
        }
        resolve(rows);
      }catch(e){
        reject(e);
      }
    };
    if (name.endsWith(".csv")) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}


function csvToObjects(text){
  // Robust CSV/TSV parser with delimiter + header detection and multi-section support (e.g., "Combined" exports).
  const raw = String(text||"").replace(/^\uFEFF/,""); // strip BOM
  const lines = raw.split(/\r?\n/);

  const delims = [",",";","\t","|"];
  const headerHints = [
    "tipo","type","class","classe","nome","name","ticker","symbol","isin",
    "shares","qty","quantity","units","valor","value","market","market_value",
    "current","price","yield","dividend","amount","cash","data","date","categoria","category"
  ];

  function splitLine(line, delim){ return splitCSVLine(line, delim); }

  function scoreHeader(line, delim){
    const cols = splitLine(line, delim).map(c=>String(c||"").trim().toLowerCase());
    if (cols.length < 3) return -1;
    let hits = 0;
    for (const c of cols){
      for (const h of headerHints){
        if (c === h || c.includes(h)) { hits++; break; }
      }
    }
    return hits;
  }

  function bestDelimForLine(line){
    let best = {d:",", score:-1, cols:0};
    for (const d of delims){
      const cols = splitLine(line, d);
      const sc = scoreHeader(line, d);
      if (sc > best.score || (sc === best.score && cols.length > best.cols)){
        best = {d, score: sc, cols: cols.length};
      }
    }
    return best;
  }

  // Identify header lines (supports multiple sections)
  const headers = [];
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const b = bestDelimForLine(line);
    if (b.score >= 2){
      headers.push({idx:i, delim:b.d, header: splitLine(line, b.d).map(h=>String(h||"").trim())});
    }
  }

  // Fallback: first non-empty line
  if (!headers.length){
    let first = -1;
    for (let i=0;i<lines.length;i++){ if (lines[i] && lines[i].trim()){ first=i; break; } }
    if (first === -1) return [];
    const b = bestDelimForLine(lines[first]);
    headers.push({idx:first, delim:b.d, header: splitLine(lines[first], b.d).map(h=>String(h||"").trim())});
  }

  const out = [];
  for (let h=0; h<headers.length; h++){
    const hinfo = headers[h];
    const nextHeaderIdx = (h+1<headers.length) ? headers[h+1].idx : lines.length;
    const header = hinfo.header;
    const delim = hinfo.delim;

    for (let i=hinfo.idx+1; i<nextHeaderIdx; i++){
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const cols = splitLine(line, delim);
      if (!cols.length) continue;

      // Skip section titles (single column)
      if (cols.length === 1 && header.length > 2) continue;

      // If line looks like a new header, stop this section
      if (scoreHeader(line, delim) >= 2) break;

      const obj = {};
      for (let j=0;j<header.length;j++){
        obj[header[j]] = (cols[j]!==undefined) ? cols[j] : "";
      }

      let any=false;
      for (const k in obj){ if (String(obj[k]||"").trim()!==""){ any=true; break; } }
      if (!any) continue;

      out.push(obj);
    }
  }
  return out;
}

function splitCSVLine(line, delim){
  // supports quotes + escaped quotes
  const out=[]; let cur=""; let q=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"'){
      if (q && line[i+1] === '"'){ cur += '"'; i++; continue; }
      q = !q; 
      continue;
    }
    if (!q && ch===delim){ out.push(cur); cur=""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normKey(k){
  return String(k||"")
    .trim()
    .toLowerCase()
    .replace(/[\u00A0]/g," ")
    .replace(/[^\p{L}\p{N}]+/gu,"_")
    .replace(/^_+|_+$/g,"");
}

function normalizeRow(obj){
  const out = {};
  for (const k in (obj||{})){
    out[normKey(k)] = String(obj[k] ?? "").trim();
  }
  return out;
}

function parseNumberSmart(x){
  if (x===null || x===undefined) return NaN;
  let s = String(x).trim();
  if (!s) return NaN;
  s = s.replace(/[%€$£]/g,"").replace(/\s/g,"");
  let neg=false;
  if (s.startsWith("(") && s.endsWith(")")){ neg=true; s=s.slice(1,-1); }
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot){
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot){
      s = s.replace(/\./g,"").replace(",",".");
    } else {
      s = s.replace(/,/g,"");
    }
  } else if (hasComma && !hasDot){
    s = s.replace(",",".");
  } else {
    s = s.replace(/,/g,"");
  }
  const n = Number(s);
  if (Number.isFinite(n)) return neg ? -n : n;
  return NaN;
}

function classifyRow(r){
  const tipo = (r.tipo || r.type || "").toLowerCase();
  if (["ativo","asset","assets"].includes(tipo)) return "ativo";
  if (["passivo","liability","debt","liabilities"].includes(tipo)) return "passivo";
  if (["movimento","transaction","movement","cashflow","cash_flow","tx","dividend"].includes(tipo)) return "movimento";

  const hasDate = !!(r.data || r.date || r.payment_date || r.trade_date);
  const amount = parseNumberSmart(r.montante || r.amount || r.valor || r.value || r.cash || r.total || r.net || r.saldo);
  const qty = parseNumberSmart(r.qty || r.quantity || r.shares || r.units || r.unidades);
  const mv  = parseNumberSmart(r.market_value || r.current_value || r.position_value || r.total_value || r.value || r.valor);

  // DivTracker/transactions-like CSV (Ticker, Quantity, Cost Per Share, Currency, Date, Commission...)
  // This file is not a holdings snapshot; we derive positions by aggregating trades.
  const hasTicker = !!(r.ticker || r.symbol);
  const cps = parseNumberSmart(r.cost_per_share || r.costpershare || r.price || r.preco || r.unit_price);
  // Date can be missing/blank in some exports; it's not required to build holdings.
  if (hasTicker && Number.isFinite(qty) && Number.isFinite(cps)) return "trade";

  if (hasDate && Number.isFinite(amount) && Math.abs(amount) > 0) return "movimento";

  const cls = (r.classe || r.class || r.category || "").toLowerCase();
  const name = (r.nome || r.name || r.instrument || r.security || r.asset || r.description || "").toLowerCase();
  if (cls.includes("passiv") || cls.includes("dívid") || cls.includes("divid") || name.includes("loan") || name.includes("mortgage") || name.includes("cart")) {
    if (Number.isFinite(mv) || Number.isFinite(amount)) return "passivo";
  }

  const hasId = !!(r.ticker || r.symbol || r.isin || r.nome || r.name || r.instrument || r.security);
  if (hasId && Number.isFinite(mv) && mv>0) return "ativo";
  if (hasId && Number.isFinite(qty) && Number.isFinite(parseNumberSmart(r.price || r.preco || r.unit_price))) return "ativo";
  if (hasId && Number.isFinite(amount) && !hasDate && amount>0) return "ativo";
  if (Number.isFinite(mv) && mv>0) return "ativo";

  return "unknown";
}

function importRows(rows){
  let addedA=0, addedL=0, addedT=0, unknown=0;
  let sampleUnknown=null;

  // Trade-style import aggregator (DivTracker_Combined, etc.)
  // We derive positions (assets) from trades; we do NOT push thousands of rows to "Movimentos".
  const posMap = new Map(); // key=ticker|ccy -> {ticker, ccy, qty, cost, comm}

  for (const raw of rows){
    const r = normalizeRow(raw);
    const kind = classifyRow(r);

    if (kind === "trade"){
      const ticker = String(r.ticker || r.symbol || "").trim();
      const qty = parseNumberSmart(r.quantity || r.qty || r.shares || r.units || r.unidades);
      const cps = parseNumberSmart(r.cost_per_share || r.costpershare || r.price || r.preco || r.unit_price);
      const ccy = String(r.currency || r.ccy || r.moeda || "").trim().toUpperCase();
      const comm = parseNumberSmart(r.commission || r.fee || r.commission_amount);
      if(!ticker || !Number.isFinite(qty) || !Number.isFinite(cps)) {
        unknown++; if(!sampleUnknown) sampleUnknown = r; 
        continue;
      }

      const key = `${ticker}|${ccy||""}`;
      const prev = posMap.get(key) || { ticker, ccy, qty:0, cost:0, comm:0 };
      if(qty >= 0){
        prev.qty += qty;
        prev.cost += qty * cps;
        if(Number.isFinite(comm) && comm>0) prev.comm += comm;
      } else {
        const sellQty = Math.abs(qty);
        const avg = prev.qty>0 ? (prev.cost/prev.qty) : cps;
        prev.qty = Math.max(0, prev.qty - sellQty);
        prev.cost = Math.max(0, prev.cost - sellQty*avg);
      }
      posMap.set(key, prev);
      continue;
    }

    if (kind === "movimento"){
      const amtRaw = r.montante || r.amount || r.valor || r.value || r.cash || r.total || r.net || r.saldo;
      const amt = parseNumberSmart(amtRaw);
      if (!Number.isFinite(amt) || Math.abs(amt) < 1e-9) continue;

      const when = (r.data || r.date || r.payment_date || r.trade_date || "").trim();
      const cat  = (r.categoria || r.category || r.classe || r.class || "Outros").trim() || "Outros";
      const desc = (r.descricao || r.description || r.nome || r.name || r.memo || "").trim();

      state.transactions.push({
        id: uid(),
        date: normalizeDate(when) || isoToday(),
        kind: amt>=0 ? "Entrada" : "Saída",
        category: cat,
        description: desc,
        amount: Math.abs(amt)
      });
      addedT++;
      continue;
    }

    if (kind === "ativo" || kind === "passivo"){
      const name = (r.nome || r.name || r.instrument || r.security || r.asset || r.description || r.ticker || r.symbol || "Item").trim();
      const className = (r.classe || r.class || r.category || (kind==="passivo" ? "Dívida" : "Outros")).trim() || (kind==="passivo" ? "Dívida" : "Outros");
      const value = parseNumberSmart(r.valor || r.value || r.market_value || r.current_value || r.total_value || r.position_value || r.amount || r.total);
      if (!Number.isFinite(value) || Math.abs(value) < 1e-9) continue;

      const yieldType = (r.yield_tipo || r.yield_type || r.income_type || "").trim();
      const yieldVal = (r.yield_valor || r.yield_value || r.yield || r.dividend_yield || r.div_yield || "").trim();
      const yv = parseNumberSmart(yieldVal);

      const item = {
        id: uid(),
        class: normalizeClassName(className),
        name: name,
        value: Math.abs(value),
        yieldType: normalizeYieldType(yieldType),
        yieldValue: Number.isFinite(yv) ? yv : 0,
        notes: "",
        favorite: false
      };

      if (kind === "passivo"){
        state.liabilities.push(item);
        addedL++;
      } else {
        state.assets.push(item);
        addedA++;
      }
      continue;
    }

    unknown++;
    if (!sampleUnknown) sampleUnknown = r;
  }

  // Convert aggregated positions (trades) into Assets.
  // NOTE: DivTracker_Combined is a trade ledger (buy/sell). We create ONE asset per ticker
  // valued at cost basis (offline). This is still useful for portfolio structure and manual editing.
  for (const p of posMap.values()){
    if (!(p.qty > 0) || !(p.cost > 0)) continue;
    const avg = p.cost / p.qty;
    const estValue = p.cost + (p.comm || 0);

    const upper = String(p.ticker).toUpperCase();
    const sym = upper.replace(/\.CC$/, "");
    const isCrypto = upper.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(sym);
    const cls = isCrypto ? "Cripto" : "Ações/ETFs";

    const notes = `Importado (DivTracker trades). Qty=${fmt(p.qty)} · PM=${fmtMoney(avg, p.ccy||"EUR")} · Moeda=${p.ccy||"EUR"}`;

    // Merge if already exists (same name+class)
    const existingIx = state.assets.findIndex(a => (a.name||"").toUpperCase() === upper && (a.class||"") === cls);
    const item = {
      id: existingIx>=0 ? state.assets[existingIx].id : uid(),
      class: cls,
      name: p.ticker,
      value: estValue,
      yieldType: "",
      yieldValue: 0,
      notes,
      favorite: existingIx>=0 ? !!state.assets[existingIx].favorite : false
    };
    if (existingIx>=0) state.assets[existingIx] = item; else state.assets.push(item);
    addedA++;
  }

  saveState();
  renderDashboard();
  renderItems();
  renderCashflow();
  renderBalance();

  // UI feedback
  const hint = document.getElementById("importHint");
  if (hint){
    if (addedA+addedL+addedT > 0){
      hint.textContent = `Importado: ${addedA} ativos, ${addedL} passivos, ${addedT} movimentos.`;
    } else {
      hint.textContent = `Importei ${rows.length} linhas mas não reconheci nenhum registo. (Ver detalhes no alerta.)`;
    }
  }

  if (addedA+addedL+addedT === 0){
    const cols = rows.length ? Object.keys(rows[0]||{}) : [];
    alert("Importação concluída, mas 0 registos reconhecidos.\n\n" +
      "Isto costuma acontecer quando as colunas do CSV são diferentes do esperado.\n\n" +
      "Diagnóstico:\n" +
      `• linhas lidas: ${rows.length}\n` +
      `• colunas (primeira linha): ${cols.slice(0,20).join(", ")}${cols.length>20?"…":""}\n\n` +
      "Sugestão: exporta um 'CSV holdings/positions' com colunas tipo ticker/symbol/nome + value/market value, ou usa o botão 'Template CSV'.");
  } else {
    alert(`Importado com sucesso: ${addedA} ativos, ${addedL} passivos, ${addedT} movimentos. (linhas: ${rows.length})`);
  }
}


function downloadTemplate(){
  const rows = [
    ["tipo","classe","nome","valor","yield_tipo","yield_valor","data","notas"],
    ["ativo","Ações/ETFs","VWCE",25000,"yield_pct",1.8,"",""],
    ["ativo","Imobiliário","Apartamento",280000,"rent_month",700,"",""],
    ["passivo","Crédito habitação","CH Casa",150000,"","","",""],
    ["movimento","","Salário Pedro",2500,"","",new Date().toISOString().slice(0,10),""]
  ];
  const csv = rows.map(r=>r.map(x=>String(x)).join(";")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "PF_template.csv";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

/* JSON backup */
function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "PF_backup.json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

async function importJSON(file){
  const text = await file.text();
  const parsed = JSON.parse(text);
  state = {
    settings: parsed.settings || {currency:"EUR"},
    assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
  saveState();
  renderDashboard();
  renderItems();
  renderCashflow();
  alert("Backup importado.");
}

/* reset */
function resetAll(){
  if (!confirm("Apagar tudo deste dispositivo?")) return;
  void storageClear();
  state = safeClone(DEFAULT_STATE);
  saveState();
  renderDashboard();
  renderItems();
  renderCashflow();
  alert("Dados apagados.");
}

/* WIRING */
function wire(){
  wireModalClosers();

  // nav
  $("navDashboard").addEventListener("click", ()=>setView("dashboard"));
  $("navAssets").addEventListener("click", ()=>setView("assets"));
  $("navImport").addEventListener("click", ()=>setView("import"));
  $("navCashflow").addEventListener("click", ()=>setView("cashflow"));
  $("navSettings").addEventListener("click", ()=>setView("settings"));

  // fab
  $("btnFab").addEventListener("click", ()=>{
    // open item modal based on current view / mode
    if (currentView === "cashflow") openTxModal();
    else if (currentView === "assets") openItemModal(showingLiabs ? "liab" : "asset");
    else openItemModal("asset");
  });


// distribuição detalhe
const distBtn = document.getElementById("btnDistDetail");
if (distBtn){
  distBtn.addEventListener("click", ()=>{ distDetailExpanded = false; openDistDetail(); });
}
const distTog = document.getElementById("btnDistToggle");
if (distTog){
  distTog.addEventListener("click", ()=>{ distDetailExpanded = !distDetailExpanded; openDistDetail(true); });
}

// apagar item (ativo/passivo)
const delBtn = document.getElementById("btnDeleteItem");
if (delBtn){
  delBtn.addEventListener("click", ()=>deleteCurrentItem());
}

// settings segmented: Definições vs Projeção
const segS = document.getElementById("segSettings");
const segF = document.getElementById("segFire");
if (segS && segF){
  segS.addEventListener("click", ()=>setSettingsPane("settings"));
  segF.addEventListener("click", ()=>setSettingsPane("fire"));
}
const recalc = document.getElementById("btnRecalcFire");
if (recalc){
  recalc.addEventListener("click", ()=>renderFire());
}
const fw = document.getElementById("fireWindow");
const fh = document.getElementById("fireHorizon");
if (fw) fw.addEventListener("change", ()=>renderFire());
if (fh) fh.addEventListener("change", ()=>renderFire());

  // dashboard buttons  // dashboard buttons
  $("btnSnapshot").addEventListener("click", snapshotMonth);
  $("btnClearHistory").addEventListener("click", ()=>{
    if (!confirm("Limpar histórico de snapshots?")) return;
    state.history = [];
    saveState();
    renderDashboard();
  });
  $("btnTrendClear").addEventListener("click", ()=>{
    if (!confirm("Limpar histórico de snapshots?")) return;
    state.history = [];
    saveState();
    renderDashboard();
  });

  $("btnSummaryAll").addEventListener("click", ()=>setView("assets"));
  $("btnSummaryToggle").addEventListener("click", ()=>{
    summaryExpanded = !summaryExpanded;
    renderSummary();
  });

  // seg
  $("segAssets").addEventListener("click", ()=>setModeLiabs(false));
  $("segLiabs").addEventListener("click", ()=>setModeLiabs(true));

  // assets filters
  $("qSearch").addEventListener("input", renderItems);
  $("qClass").addEventListener("change", renderItems);
  $("qSort").addEventListener("change", renderItems);
  $("btnAddItem").addEventListener("click", ()=>openItemModal(showingLiabs ? "liab" : "asset"));

  // modal item save
  $("btnSaveItem").addEventListener("click", saveItemFromModal);

  // cashflow
  $("btnAddTx").addEventListener("click", openTxModal);
  $("btnSaveTx").addEventListener("click", saveTxFromModal);
  $("cfMonth").addEventListener("change", renderCashflow);
  $("cfYear").addEventListener("change", renderCashflow);
  $("btnTxToggle").addEventListener("click", ()=>{
    txExpanded = !txExpanded;
    renderTxList();
  });

  // import
  $("fileInput").addEventListener("change", ()=>{
    $("btnImport").disabled = !$("fileInput").files || !$("fileInput").files.length;
  });
  $("btnImport").addEventListener("click", async ()=>{
    const f = $("fileInput").files && $("fileInput").files[0];
    if (!f) return;
    try{
      const rows = await fileToRows(f);
      importRows(rows);
      const hint = $("importHint").textContent || "Importado.";
      const n = Math.max(0, (rows.length||0) - 1);
      alert(`${hint}  (linhas: ${n})`);
    }catch(e){
      alert("Falha no import: " + (e && e.message ? e.message : String(e)));
    }
  });
  $("btnTemplate").addEventListener("click", downloadTemplate);

  // json backup
  $("btnExportJSON").addEventListener("click", exportJSON);
  $("jsonInput").addEventListener("change", ()=>{
    $("btnImportJSON").disabled = !$("jsonInput").files || !$("jsonInput").files.length;
  });
  $("btnImportJSON").addEventListener("click", async ()=>{
    const f = $("jsonInput").files && $("jsonInput").files[0];
    if (!f) return;
    try{ await importJSON(f); }catch(e){ alert("Erro a importar JSON."); }
  });

  $("btnReset").addEventListener("click", resetAll);

  // settings
  $("baseCurrency").value = state.settings.currency || "EUR";
  $("baseCurrency").addEventListener("change", ()=>{
    state.settings.currency = $("baseCurrency").value;
    saveState();
    renderDashboard();
    renderItems();
    renderCashflow();
  });

  // init
  setModeLiabs(false);
  setView("dashboard");
  renderCashflow();
}

document.addEventListener("DOMContentLoaded", async () => {
  await requestPersistentStorage();
  state = await loadStateAsync();
  wire();
  renderAll();
});


function openDistDetail(keepOpen=false){
  // build class distribution list (assets)
  const by = {};
  for (const a of state.assets){
    const k = a.class || "Outros";
    by[k] = (by[k]||0) + parseNum(a.value);
  }
  const entries = Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const list = document.getElementById("distDetailList");
  const tog = document.getElementById("btnDistToggle");
  if (!list) return;

  list.innerHTML = "";
  if (entries.length === 0){
    const row = document.createElement("div");
    row.className="item";
    row.innerHTML = `<div class="item__l"><div class="item__t">Sem dados</div><div class="item__s">Adiciona ativos para ver a distribuição.</div></div><div class="item__v">—</div>`;
    list.appendChild(row);
  } else {
    const shown = distDetailExpanded ? entries : entries.slice(0,10);
    for (const [cls,val] of shown){
      const row = document.createElement("div");
      row.className="item";
      row.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(cls)}</div><div class="item__s">Tocar para filtrar</div></div><div class="item__v">${fmtEUR(val)}</div>`;
      row.addEventListener("click", ()=>{
        // switch to assets and filter by class
        setView("assets");
        $("qClass").value = cls;
        renderItems();
        closeModal("modalDist");
      });
      list.appendChild(row);
    }
  }

  if (tog){
    if (entries.length > 10){
      tog.style.display = "";
      tog.textContent = distDetailExpanded ? "Ver menos" : "Ver o resto";
    } else {
      tog.style.display = "none";
    }
  }
  if (!keepOpen) openModal("modalDist");
}

function deleteCurrentItem(){
  if (!editingItemId) return;
  const kind = $("mKind").value || $("btnSaveItem").dataset.kind || (showingLiabs ? "liab" : "asset");
  const ok = confirm("Apagar este item? Esta ação não pode ser anulada.");
  if (!ok) return;
  if (kind === "liab"){
    state.liabilities = state.liabilities.filter(x=>x.id!==editingItemId);
  } else {
    state.assets = state.assets.filter(x=>x.id!==editingItemId);
  }
  editingItemId = null;
  saveStateAsync();
  closeModal("modalItem");
  renderAll();
}

function setSettingsPane(which){
  const ps = document.getElementById("paneSettings");
  const pf = document.getElementById("paneFire");
  const bs = document.getElementById("segSettings");
  const bf = document.getElementById("segFire");
  if (!ps || !pf || !bs || !bf) return;

  const isFire = which === "fire";
  ps.style.display = isFire ? "none" : "";
  pf.style.display = isFire ? "" : "none";
  bs.classList.toggle("seg__btn--active", !isFire);
  bf.classList.toggle("seg__btn--active", isFire);

  if (isFire) renderFire();
}

function renderFire(){
  const capEl = document.getElementById("fireCap");
  const expEl = document.getElementById("fireExp");
  const пасEl = document.getElementById("firePass");
  const list = document.getElementById("fireResults");
  const canvas = document.getElementById("fireChart");
  if (!capEl || !expEl || !пасEl || !list || !canvas) return;

  const W = parseInt(document.getElementById("fireWindow")?.value || "6",10);
  const H = parseInt(document.getElementById("fireHorizon")?.value || "30",10);

  // Capital investível: exclui casa própria (classe Imobiliário + nome com casa/habitação/home)
  const isHome = (a)=>{
    const name = (a.name||"").toLowerCase();
    const cls = (a.class||"").toLowerCase();
    return cls.includes("imob") && (name.includes("casa") || name.includes("habita") || name.includes("home"));
  };
  const investible = state.assets.filter(a=>!isHome(a)).reduce((s,a)=>s+parseNum(a.value),0);
  const debt = state.liabilities.reduce((s,a)=>s+Math.abs(parseNum(a.value)),0);
  const cap0 = investible - debt;

  // Cashflow mensal médio (últimos W meses) + passivo mensal médio (heurística)
  const byMonth = new Map();
  for (const t of (state.transactions||[])){
    const d = t.date || "";
    if (d.length < 7) continue;
    const ym = d.slice(0,7);
    const cur = byMonth.get(ym) || {inc:0, out:0, pass:0};
    const v = parseNum(t.value);
    const type = t.type || (v<0 ? "out":"in");
    const abs = Math.abs(v);
    if (type === "out") cur.out += abs;
    else cur.inc += abs;

    const cat = (t.category||"").toLowerCase();
    if (type !== "out" && (cat.includes("div") || cat.includes("juros") || cat.includes("reit") || cat.includes("renda") || cat.includes("passiv"))){
      cur.pass += abs;
    }
    byMonth.set(ym, cur);
  }
  const months = Array.from(byMonth.keys()).sort();
  const last = months.slice(-W);
  const avg = (key)=>{
    if (last.length===0) return 0;
    return last.reduce((s,m)=>s+(byMonth.get(m)?.[key]||0),0)/last.length;
  };
  const incM = avg("inc");
  const outM = avg("out");
  const passM = avg("pass");
  const saveM = Math.max(0, incM - outM);

  const exp0 = outM*12;
  const pass0 = passM*12;

  const y = (cap0>0 && pass0>0) ? (pass0/cap0) : 0;

  capEl.textContent = fmtEUR(cap0);
  expEl.textContent = fmtEUR(exp0);
  пасEl.textContent = fmtEUR(pass0);

  const scenarios = [
    {name:"Conservador", r:0.04, inf:0.03, swr:0.0325},
    {name:"Base", r:0.06, inf:0.025, swr:0.0375},
    {name:"Otimista", r:0.08, inf:0.02, swr:0.04}
  ];

  const results = [];
  for (const sc of scenarios){
    let cap = cap0, exp = exp0;
    let hit = null;
    for (let t=0; t<=H; t++){
      const pass = y*cap;
      const fireNum = sc.swr>0 ? (exp/sc.swr) : Infinity;
      if (cap >= fireNum && pass >= exp){ hit = {t, cap, exp, pass, fireNum}; break; }
      cap = cap*(1+sc.r) + saveM*12;
      exp = exp*(1+sc.inf);
    }
    results.push({sc, hit});
  }

  list.innerHTML = "";
  for (const r of results){
    const row = document.createElement("div");
    row.className = "item";
    const right = r.hit ? `FIRE em ${r.hit.t}a` : "Sem FIRE";
    row.innerHTML = `<div class="item__l"><div class="item__t">${r.sc.name}</div><div class="item__s">r ${(r.sc.r*100).toFixed(1)}% · inflação ${(r.sc.inf*100).toFixed(1)}% · SWR ${(r.sc.swr*100).toFixed(2)}%</div></div><div class="item__v">${right}</div>`;
    list.appendChild(row);
  }

  // chart: base scenario capital vs fire number
  const base = scenarios[1];
  let cap=cap0, exp=exp0;
  const labels=[], capS=[], fireS=[];
  for (let t=0; t<=H; t++){
    labels.push("+"+t+"a");
    capS.push(cap);
    fireS.push(base.swr>0 ? (exp/base.swr) : null);
    cap = cap*(1+base.r) + saveM*12;
    exp = exp*(1+base.inf);
  }

  const ctx = canvas.getContext("2d");
  if (fireChart) fireChart.destroy();
  fireChart = new Chart(ctx,{
    type:"line",
    data:{labels, datasets:[
      {label:"Capital (Base)", data:capS, tension:.25, borderWidth:2, pointRadius:0},
      {label:"FIRE # (Base)", data:fireS, tension:.25, borderWidth:2, pointRadius:0},
    ]},
    options:{
      responsive:true,
      plugins:{ legend:{ display:true } },
      scales:{ y:{ ticks:{ callback:(v)=>fmtEUR(v) } } }
    }
  });
}


// === PDF BANK STATEMENT IMPORT (LOCAL) ===
const PT_MONTHS = {"jan":"01","fev":"02","mar":"03","abr":"04","mai":"05","jun":"06","jul":"07","ago":"08","set":"09","out":"10","nov":"11","dez":"12"};

function parseEuroNumber(str){
  if (!str) return NaN;
  let s = String(str).trim().replace(/[−–]/g,"-");
  s = s.replace(/€/g,"").replace(/\s/g,"");
  const negParen = /^\(.*\)$/.test(s);
  if (negParen) s = s.slice(1,-1);
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) {
    s = s.replace(/\./g,"").replace(/,/g,".");
  } else {
    s = s.replace(/,/g,"");
  }
  let v = Number(s);
  if (negParen) v = -v;
  return v;
}

function parsePtDate(line){
  const m = String(line).trim().toLowerCase().match(/^(\d{1,2})\s+([a-zç]{3})\s+(\d{4})$/i);
  if (!m) return null;
  const dd = m[1].padStart(2,"0");
  const mm = PT_MONTHS[m[2]];
  const yyyy = m[3];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function categorizeBankDesc(desc, value){
  const d = (desc||"").toLowerCase();
  if (d.includes("ordenado") || d.includes("salário") || d.includes("salario") || d.includes("unidade local de saude") || d.includes("uls")) return "Salário";
  if (d.includes("pagamento de conta cartão") || d.includes("pagamento de conta cartao") || d.includes("cartão") || d.includes("cartao")) return "Cartão";
  if (d.includes("mb way") || d.includes("transfer") || d.includes("trf.") || d.includes("trf ") || d.includes("sepa")) return value >= 0 ? "Transferência (entrada)" : "Transferência (saída)";
  if (d.includes("levantamento") || d.includes("numerário") || d.includes("numerario") || d.includes("atm")) return "Numerário";
  if (d.includes("via verde") || d.includes("portagens") || d.includes("lisboagas") || d.includes("ibelectra") || d.includes("edp") || d.includes("aguas") || d.includes("municip") || d.includes("imposto") || d.includes("comissão") || d.includes("comissao")) return "Serviços";
  return "Outros";
}

async function extractLinesFromPdf(file){
  if (typeof pdfjsLib === "undefined") throw new Error("pdf.js não carregou.");
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: ab}).promise;
  const out = [];
  const yTol = 2.0;

  for (let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.map(it => ({str: it.str, x: it.transform[4], y: it.transform[5]}))
      .filter(it => it.str && it.str.trim() !== "");
    items.sort((a,b)=> (b.y - a.y) || (a.x - b.x));

    let current = null;
    for (const it of items){
      if (!current || Math.abs(it.y - current.y) > yTol){
        current = {y: it.y, parts: [it]};
        out.push(current);
      } else current.parts.push(it);
    }
  }

  return out.map(l=>{
    l.parts.sort((a,b)=>a.x-b.x);
    return l.parts.map(p=>p.str).join(" ").replace(/\s+/g," ").trim();
  }).filter(Boolean);
}

function parseBankMovementsFromLines(lines){
  const moves = [];
  let i=0;

  while (i < lines.length){
    const dateIso = parsePtDate(lines[i]);
    if (!dateIso){ i++; continue; }

    let j = i+1;
    if (j < lines.length && /^d\.\s*valor\s*:/i.test(lines[j])) j++;

    const descParts = [];
    let valueLine = null;

    while (j < lines.length){
      const ln = lines[j];
      if (parsePtDate(ln) && descParts.length>0) break;

      const euros = ln.match(/[-−–]?\d{1,3}(?:[\.,\s]\d{3})*(?:[\.,]\d{2})\s*€/g);
      if (euros && euros.length >= 1){
        valueLine = ln;
        break;
      } else {
        if (!/^lista de movimentos/i.test(ln) && !/^página\s+\d+/i.test(ln)) descParts.push(ln);
      }
      j++;
    }

    if (!valueLine){ i++; continue; }

    const euros = valueLine.match(/[-−–]?\d{1,3}(?:[\.,\s]\d{3})*(?:[\.,]\d{2})\s*€/g) || [];
    const valueRaw = euros[0] || "";
    let value = parseEuroNumber(valueRaw);
    if (Number.isNaN(value)){
      const m = valueLine.match(/[-−–]?\d+[\.,]\d{2}/);
      value = parseEuroNumber(m ? m[0] : "");
    }

    const desc = descParts.join(" ").replace(/\s+/g," ").trim() || "Movimento";
    const cat = categorizeBankDesc(desc, value);
    const type = value < 0 ? "out" : "in";
    const key = `${dateIso}|${type}|${Math.round(value*100)}|${desc.toLowerCase().slice(0,80)}`;

    if (!Number.isNaN(value) && value !== 0){
      moves.push({_key:key, date:dateIso, type, category:cat, desc, value:Math.round(value*100)/100, source:"bank_pdf"});
    }

    i = j + 1;
  }

  return moves;
}

function applyPdfMovementsImport(moves){
  if (!moves || moves.length === 0) return {added:0, removed:0};

  const dates = moves.map(m=>m.date).sort();
  const minDate = dates[0], maxDate = dates[dates.length-1];

  const before = (state.transactions||[]).length;
  state.transactions = (state.transactions||[]).filter(t=>{
    if (t.source !== "bank_pdf") return true;
    if (!t.date) return true;
    return !(t.date >= minDate && t.date <= maxDate);
  });
  const removed = before - state.transactions.length;

  const existingKeys = new Set((state.transactions||[]).map(t=>{
    const desc = (t.desc||t.description||"").toLowerCase().slice(0,80);
    const type = t.type || ((Number(t.value)||0) < 0 ? "out" : "in");
    const date = t.date || "";
    const value = Number(t.value)||0;
    return `${date}|${type}|${Math.round(value*100)}|${desc}`;
  }));

  let added = 0;
  for (const m of moves){
    if (existingKeys.has(m._key)) continue;
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("tx_" + Date.now() + "_" + Math.random().toString(16).slice(2));
    state.transactions.push({id, date:m.date, type:m.type, category:m.category, desc:m.desc, value:m.value, source:"bank_pdf"});
    existingKeys.add(m._key);
    added++;
  }

  saveState();
  try{ renderAll(); }catch{}
  try{ renderTxList(); }catch{}
  return {added, removed, minDate, maxDate};
}

async function handleImportPDF(){
  const inp = document.getElementById("pdfFile");
  const file = inp && inp.files && inp.files[0];
  if (!file){ alert("Seleciona um PDF primeiro."); return; }

  try{
    const lines = await extractLinesFromPdf(file);
    const moves = parseBankMovementsFromLines(lines);
    if (moves.length === 0){
      alert("Não encontrei movimentos. Confirma se o PDF tem texto (não digitalizado).");
      return;
    }
    const res = applyPdfMovementsImport(moves);
    alert(`Importação concluída. Adicionados: ${res.added}. Substituídos no período: ${res.removed}. (${res.minDate} → ${res.maxDate})`);
    inp.value = "";
  }catch(err){
    console.error(err);
    alert("Falha a importar PDF: " + (err?.message || String(err)));
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("btnImportPDF");
  if (btn) btn.addEventListener("click", handleImportPDF);
});
