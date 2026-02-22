/* Património Familiar — REBUILD percento-ish v5 (fix nav+import+tx) */
"use strict";

const STORAGE_KEY = "PF_STATE_PERCENTO_V5";
const TX_PREVIEW_COUNT = 5;

const DEFAULT_STATE = {
  settings: { currency: "EUR" },
  assets: [],       // {id, class, name, value, yieldType, yieldValue, notes, fav}
  liabilities: [],  // {id, class, name, value, notes}
  transactions: [], // {id, type:'in'|'out', category, amount, date, recurring:'none'|'monthly'|'yearly'}
  history: []       // {dateISO, net, assets, liabilities, passiveAnnual}
};

let state = loadState();
let currentView = "dashboard";
let showingLiabs = false;
let summaryExpanded = false;
let txExpanded = false;

let distChart = null;
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

function parseNum(x){
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return isFinite(x) ? x : 0;
  let s = String(x).trim();
  if (!s) return 0;
  // accept "12 345,67" or "12,345.67"
  s = s.replace(/\s+/g,"");
  // if has both separators, assume last is decimal
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot){
    if (s.lastIndexOf(",") > s.lastIndexOf(".")){
      s = s.replace(/\./g,"").replace(",",".");
    }else{
      s = s.replace(/,/g,"");
    }
  }else if (hasComma && !hasDot){
    s = s.replace(",",".");
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // harden: ensure arrays
    return {
      settings: parsed.settings || {currency:"EUR"},
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  }catch{
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    alert("Não foi possível guardar (storage cheio ou bloqueado).");
  }
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
  // robust CSV parsing for simple exports (comma/semicolon)
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
  if (!lines.length) return [];
  const delim = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
  const header = splitCSVLine(lines[0], delim).map(h=>h.trim());
  const out = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i], delim);
    if (!cols.length) continue;
    const obj = {};
    for (let j=0;j<header.length;j++){
      obj[header[j]] = (cols[j]!==undefined) ? cols[j] : "";
    }
    out.push(obj);
  }
  return out;
}

function splitCSVLine(line, delim){
  const out=[]; let cur=""; let q=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"'){ q = !q; continue; }
    if (!q && ch===delim){ out.push(cur); cur=""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normKey(k){
  return String(k||"").trim().toLowerCase().replace(/\s+/g,"_");
}

function detectSchema(rows){
  if (!rows.length) return "empty";
  const keys = Object.keys(rows[0]||{}).map(normKey);
  if (keys.includes("tipo")) return "template";
  if (keys.includes("type") && keys.includes("class") && keys.includes("name")) return "template";
  // holdings
  const hasSymbol = keys.some(k=>["ticker","symbol","isin"].includes(k));
  const hasQty = keys.some(k=>["shares","qty","quantity","units"].includes(k));
  const hasValue = keys.some(k=>["valor","value","market_value","current_value","currentvalue","total_value","position_value"].includes(k) || k.includes("value"));
  if (hasSymbol && (hasValue || hasQty)) return "holdings";
  return "unknown";
}

function pick(obj, candidates){
  for (const c of candidates){
    const v = obj[c];
    if (v!==undefined && v!==null && String(v).trim()!=="") return v;
  }
  return "";
}

function importRows(rows){
  const schema = detectSchema(rows);
  let addedA=0, addedL=0, addedT=0;

  if (schema === "empty"){
    alert("Ficheiro vazio.");
    return;
  }

  if (schema === "template"){
    for (const r0 of rows){
      const r = {};
      for (const k of Object.keys(r0)) r[normKey(k)] = r0[k];
      const tipo = String(r.tipo || r.type || "").toLowerCase().trim();
      if (tipo === "ativo" || tipo === "asset"){
        state.assets.push({
          id: uid(),
          class: String(r.classe||r.class||"Outros").trim() || "Outros",
          name: String(r.nome||r.name||"").trim(),
          value: parseNum(r.valor||r.value),
          yieldType: String(r.yield_tipo||r.yieldtype||"none").trim() || "none",
          yieldValue: parseNum(r.yield_valor||r.yieldvalue),
          notes: String(r.notas||r.notes||"").trim()
        });
        if (state.assets[state.assets.length-1].name) addedA++; else state.assets.pop();
      }else if (tipo === "passivo" || tipo === "liability"){
        state.liabilities.push({
          id: uid(),
          class: String(r.classe||r.class||"Outros").trim() || "Outros",
          name: String(r.nome||r.name||"").trim(),
          value: parseNum(r.valor||r.value),
          notes: String(r.notas||r.notes||"").trim()
        });
        if (state.liabilities[state.liabilities.length-1].name) addedL++; else state.liabilities.pop();
      }else if (tipo === "movimento" || tipo === "transaction" || tipo === "tx"){
        const amount = parseNum(r.valor||r.value||r.amount);
        if (!(amount>0)) continue;
        const type = String(r.tx_tipo||r.kind||r.inout||r.mov_tipo||"").toLowerCase().includes("out") ? "out" : (String(r.tx_tipo||r.kind||"").toLowerCase().includes("sa") ? "out" : "in");
        const date = String(r.data||r.date||"").trim() || new Date().toISOString().slice(0,10);
        state.transactions.push({
          id: uid(),
          type,
          category: String(r.nome||r.categoria||r.category||"Outros").trim() || "Outros",
          amount,
          date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0,10),
          recurring: "none"
        });
        addedT++;
      }
    }
  }else{
    // holdings-ish import (e.g., DivTracker). We'll create assets only.
    for (const r0 of rows){
      const r = {};
      for (const k of Object.keys(r0)) r[normKey(k)] = r0[k];

      const symbol = String(pick(r, ["ticker","symbol","isin"])).trim();
      const name = String(pick(r, ["name","company","asset","instrument","security"])).trim() || symbol;
      const qty = parseNum(pick(r, ["shares","qty","quantity","units"]));
      const mv  = parseNum(pick(r, ["market_value","current_value","currentvalue","total_value","position_value","valor","value","current_value_(eur)","marketvalue"]));
      const price = parseNum(pick(r, ["price","last_price","current_price"]));
      const value = mv>0 ? mv : (qty>0 && price>0 ? qty*price : parseNum(pick(r, ["total","amount"])));

      if (!symbol && !name) continue;
      if (!(value>0)) continue;

      // detect class
      let cls = "Ações/ETFs";
      const symU = symbol.toUpperCase();
      if (symU.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(symU)) cls = "Cripto";
      if (["XAU","GOLD"].includes(symU)) cls = "Ouro";
      if (["XAG","SILVER"].includes(symU)) cls = "Prata";

      // yield if available
      const yPct = parseNum(pick(r, ["yield","div_yield","dividend_yield","yield_%","yield_percent","yieldpercent"]));
      const yEurYear = parseNum(pick(r, ["dividend","dividends","dividends_year","annual_dividend","income"]));
      let yieldType = "none";
      let yieldValue = 0;
      if (yPct>0 && yPct<60){ yieldType="yield_pct"; yieldValue=yPct; }
      else if (yEurYear>0){ yieldType="yield_eur_year"; yieldValue=yEurYear; }

      state.assets.push({
        id: uid(),
        class: cls,
        name: symbol ? symbol : name,
        value,
        yieldType,
        yieldValue,
        notes: symbol && name && name!==symbol ? name : ""
      });
      addedA++;
    }
  }

  // de-duplicate basic: by (class+name), keep last
  const seen = new Map();
  for (const a of state.assets){
    const key = (a.class||"") + "||" + (a.name||"");
    seen.set(key, a);
  }
  state.assets = Array.from(seen.values());

  saveState();
  $("importHint").textContent = `Importado com sucesso: ${addedA} ativos, ${addedL} passivos, ${addedT} movimentos.`;
  renderDashboard();
  renderItems();
  renderCashflow();
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
  try{ localStorage.removeItem(STORAGE_KEY); }catch{}
  state = structuredClone(DEFAULT_STATE);
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

  // dashboard buttons
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
      alert(`Importado: ${rows.length} linha(s).`);
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

document.addEventListener("DOMContentLoaded", wire);
