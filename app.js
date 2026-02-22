/* Património Familiar — rebuild v1 (no SW, no haze overlays) */
"use strict";

const TX_PREVIEW_COUNT = 5;
let txExpanded = false;


function safeClone(obj){
  // structuredClone isn't available in some iOS WebViews; JSON clone is sufficient for our plain objects.
  try{
    if (typeof structuredClone === "function") return structuredClone(obj);
  }catch{}
  return JSON.parse(JSON.stringify(obj));
}

function safeStorageGet(key){
  try{ return localStorage.getItem(key); }catch{ return null; }
}
function safeStorageSet(key, value){
  try{ localStorage.setItem(key, value); return true; }catch{ return false; }
}

const STORAGE_KEY = "PF_STATE_REBUILD_V2";

const DEFAULT_STATE = {
  settings: { currency: "EUR" },
  assets: [],
  liabilities: [],
  transactions: [],
  history: [] // {date:'YYYY-MM', net:number, passiveAnnual:number}
};

let state = loadState();
let currentView = "dashboard";
let itemsShowLiabs = false;
let summaryShowAll = false;
let distShowAll = false;

let distChart = null;
let trendChart = null;

function $(id){ return document.getElementById(id); }
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function fmtMoney(n){
  const cur = state.settings.currency || "EUR";
  const v = Number(n)||0;
  try{
    return new Intl.NumberFormat("pt-PT",{style:"currency",currency:cur, maximumFractionDigits:0}).format(v);
  }catch{
    return v.toFixed(0) + " " + cur;
  }
}
function fmtPct(x){ return (Number(x)||0).toFixed(0) + "%"; }

function uid(){
  return (Date.now().toString(36) + Math.random().toString(36).slice(2,8)).toUpperCase();
}

function loadState(){
  try{
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return safeClone(DEFAULT_STATE);
    const obj = JSON.parse(raw);
    return {
      settings: { currency: obj?.settings?.currency || "EUR" },
      assets: Array.isArray(obj?.assets) ? obj.assets : [],
      liabilities: Array.isArray(obj?.liabilities) ? obj.liabilities : [],
      transactions: Array.isArray(obj?.transactions) ? obj.transactions : [],
      history: Array.isArray(obj?.history) ? obj.history : []
    };
  }catch{
    return safeClone(DEFAULT_STATE);
  }
}

function saveState(){
  safeStorageSet(STORAGE_KEY, JSON.stringify(state));
}

function totals(){
  const a = state.assets.reduce((s,x)=>s + (Number(x.value)||0), 0);
  const l = state.liabilities.reduce((s,x)=>s + (Number(x.value)||0), 0);
  const net = a - l;
  return { assets:a, liabs:l, net };
}

function passiveAnnualEstimate(){
  // Only from assets (not liabilities)
  let annual = 0;
  for (const x of state.assets){
    const v = Number(x.value)||0;
    const yt = x.yieldType || "none";
    const yv = Number(x.yieldValue)||0;
    if (yt === "yield_pct") annual += v * (yv/100);
    else if (yt === "income_year") annual += yv;
    else if (yt === "rent_month") annual += yv * 12;
  }
  return annual;
}

function classList(){
  // canonical classes for UI
  return ["Liquidez","Imobiliário","Ações","ETFs","Cripto","Ouro","Prata","Arte","Fundos","PPR","Depósitos","Outros"];
}

function refreshClassSelects(){
  const cls = classList();
  const sel = $("itemClass");
  if (sel){
    sel.innerHTML = "";
    for (const c of cls){
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    }
  }
  const q = $("qClass");
  if (q){
    // keep first option
    const first = q.querySelector("option[value='']");
    q.innerHTML = "";
    const f = document.createElement("option");
    f.value = ""; f.textContent = "Todas as classes";
    q.appendChild(f);
    for (const c of cls){
      const o = document.createElement("option");
      o.value=c; o.textContent=c;
      q.appendChild(o);
    }
  }
}

function setView(view){
  currentView = view;
  for (const el of document.querySelectorAll(".view")){
    el.hidden = el.dataset.view !== view;
  }
  for (const b of document.querySelectorAll(".navbtn")){
    b.classList.toggle("navbtn--active", b.dataset.nav === view);
  }
  // Also update FAB sheet context? nothing.
  if (view === "assets") renderItems();
  if (view === "cashflow") renderCashflow();
  if (view === "dashboard") renderDashboard();
}

function openSheet(){
  $("sheet").setAttribute("aria-hidden","false");
}
function closeSheet(){
  $("sheet").setAttribute("aria-hidden","true");
}

function openModal(id){
  $(id).setAttribute("aria-hidden","false");
}
function closeModal(id){
  $(id).setAttribute("aria-hidden","true");
}

function wireGlobal(){
  // nav
  $("navDashboard").addEventListener("click", ()=>setView("dashboard"));
  $("navAssets").addEventListener("click", ()=>setView("assets"));
  $("navImport").addEventListener("click", ()=>setView("import"));
  $("navCashflow").addEventListener("click", ()=>setView("cashflow"));
  $("navSettings").addEventListener("click", ()=>setView("settings"));

  // FAB + sheet
  $("btnFAB").addEventListener("click", openSheet);
  $("sheetBg").addEventListener("click", closeSheet);
  $("sheetClose").addEventListener("click", closeSheet);

  $("sheetAddAsset").addEventListener("click", ()=>{ closeSheet(); openItemModal("asset"); });
  $("sheetAddLiab").addEventListener("click", ()=>{ closeSheet(); openItemModal("liab"); });
  $("sheetAddTx").addEventListener("click", ()=>{ closeSheet(); openTxModal(); });
  $("sheetSnapshot").addEventListener("click", ()=>{ closeSheet(); snapshot(); });

  // Dashboard buttons
  $("btnSnapshot").addEventListener("click", snapshot);
  $("btnClearHistory").addEventListener("click", clearHistory);
  $("btnDistDetail").addEventListener("click", ()=>{ distShowAll=false; openDistModal(); });
  $("btnSummaryAll").addEventListener("click", ()=>{ setView("assets"); });

  $("btnSummaryToggle").addEventListener("click", ()=>{ summaryShowAll = !summaryShowAll; renderSummary(); });

  // Assets segment + add
  $("segAssets").addEventListener("click", ()=>{ itemsShowLiabs=false; updateItemsSeg(); renderItems(); });
  $("segLiabs").addEventListener("click", ()=>{ itemsShowLiabs=true; updateItemsSeg(); renderItems(); });
  $("btnAddHere").addEventListener("click", ()=> openItemModal(itemsShowLiabs ? "liab":"asset"));

  // filters
  $("qSearch").addEventListener("input", renderItems);
  $("qClass").addEventListener("change", renderItems);
  $("qSort").addEventListener("change", renderItems);

  // Item modal close
  document.addEventListener("click", (e)=>{
    const t = e.target;
    if (t?.dataset?.close === "item") closeModal("itemModal");
    if (t?.dataset?.close === "tx") closeModal("txModal");
    if (t?.dataset?.close === "dist") closeModal("distModal");
  });

  // yield hint
  $("yieldType").addEventListener("change", updateYieldHint);

  // save item
  $("itemForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    saveItem();
  });
  $("btnDeleteItem").addEventListener("click", deleteItem);

  // tx modal
  $("btnAddTx").addEventListener("click", openTxModal);
  $("txForm").addEventListener("submit", (e)=>{ e.preventDefault(); saveTx(); });
  $("btnDeleteTx").addEventListener("click", deleteTx);

  // settings
  $("baseCurrency").addEventListener("change", ()=>{
    state.settings.currency = $("baseCurrency").value;
    saveState();
    renderAll();
  });

  // Import
  $("fileInput").addEventListener("change", ()=>{
    $("btnImportFile").disabled = !$("fileInput").files?.length;
  });
  $("btnImportFile").addEventListener("click", importFile);
  $("btnTemplateCSV").addEventListener("click", downloadTemplateCSV);

  $("jsonInput").addEventListener("change", ()=>{
    $("btnImportJSON").disabled = !$("jsonInput").files?.length;
  });
  $("btnExportJSON").addEventListener("click", exportJSON);
  $("btnImportJSON").addEventListener("click", importJSON);

  // Reset
  $("btnReset").addEventListener("click", hardReset);
}

function updateItemsSeg(){
  $("segAssets").classList.toggle("seg__btn--active", !itemsShowLiabs);
  $("segLiabs").classList.toggle("seg__btn--active", itemsShowLiabs);
  $("assetsTitle").textContent = itemsShowLiabs ? "Passivos" : "Ativos";
  $("assetsSub").textContent = itemsShowLiabs
    ? "Créditos, dívidas, cartões… (valor positivo = dívida)"
    : "Imobiliário, liquidez, ações/ETFs, metais, cripto, fundos, PPR, depósitos…";
}

function updateYieldHint(){
  const yt = $("yieldType").value;
  let msg = "Sem rendimento passivo associado.";
  if (yt === "yield_pct") msg = "Yield %/ano sobre o valor do ativo.";
  if (yt === "income_year") msg = "Valor em € por ano.";
  if (yt === "rent_month") msg = "Renda mensal (a app anualiza).";
  $("yieldHint").textContent = msg;
}

function openItemModal(kind, item=null){
  $("itemKind").value = kind;
  $("itemId").value = item?.id || "";
  $("itemModalTitle").textContent = item ? "Editar " + (kind==="asset" ? "ativo":"passivo") : "Adicionar " + (kind==="asset" ? "ativo":"passivo");
  $("itemClass").value = item?.class || (kind==="asset" ? "Liquidez":"Crédito");
  // For liabilities, we still use same class list; default "Outros"
  if (kind==="liab" && !classList().includes($("itemClass").value)) $("itemClass").value="Outros";
  $("itemName").value = item?.name || "";
  $("itemValue").value = item?.value ?? "";
  $("yieldType").value = item?.yieldType || "none";
  $("yieldValue").value = item?.yieldValue ?? "";
  $("itemNotes").value = item?.notes || "";
  updateYieldHint();
  $("btnDeleteItem").style.display = item ? "inline-flex" : "none";
  openModal("itemModal");
}

function saveItem(){
  const kind = $("itemKind").value;
  const id = $("itemId").value || uid();
  const obj = {
    id,
    class: $("itemClass").value.trim() || "Outros",
    name: $("itemName").value.trim(),
    value: Number($("itemValue").value||0),
    yieldType: $("yieldType").value,
    yieldValue: Number($("yieldValue").value||0),
    notes: $("itemNotes").value.trim()
  };

  if (kind === "asset"){
    const idx = state.assets.findIndex(x=>x.id===id);
    if (idx>=0) state.assets[idx]=obj; else state.assets.unshift(obj);
  }else{
    // liabilities do not use yield
    obj.yieldType = "none"; obj.yieldValue = 0;
    const idx = state.liabilities.findIndex(x=>x.id===id);
    if (idx>=0) state.liabilities[idx]=obj; else state.liabilities.unshift(obj);
  }
  saveState();
  closeModal("itemModal");
  renderAll();
}

function deleteItem(){
  const kind = $("itemKind").value;
  const id = $("itemId").value;
  if (!id) return;
  if (!confirm("Eliminar?")) return;
  if (kind==="asset") state.assets = state.assets.filter(x=>x.id!==id);
  else state.liabilities = state.liabilities.filter(x=>x.id!==id);
  saveState();
  closeModal("itemModal");
  renderAll();
}

function openTxModal(tx=null){
  $("txId").value = tx?.id || "";
  $("txModalTitle").textContent = tx ? "Editar movimento" : "Adicionar movimento";
  $("txType").value = tx?.type || "in";
  $("txClass").value = tx?.class || "";
  $("txValue").value = tx?.value ?? "";
  $("txDate").value = tx?.date || new Date().toISOString().slice(0,10);
  $("txNotes").value = tx?.notes || "";
  $("btnDeleteTx").style.display = tx ? "inline-flex" : "none";
  openModal("txModal");
}

function saveTx(){
  const id = $("txId").value || uid();
  const obj = {
    id,
    type: $("txType").value,
    class: $("txClass").value.trim(),
    value: Number($("txValue").value||0),
    date: $("txDate").value,
    notes: $("txNotes").value.trim()
  };
  const idx = state.transactions.findIndex(t=>t.id===id);
  if (idx>=0) state.transactions[idx]=obj; else state.transactions.unshift(obj);
  saveState();
  closeModal("txModal");
  renderAll();
}

function deleteTx(){
  const id = $("txId").value;
  if (!id) return;
  if (!confirm("Eliminar movimento?")) return;
  state.transactions = state.transactions.filter(t=>t.id!==id);
  saveState();
  closeModal("txModal");
  renderAll();
}

function snapshot(){
  // snapshot current month YYYY-MM
  const ym = new Date().toISOString().slice(0,7);
  const {net} = totals();
  const pa = passiveAnnualEstimate();
  const idx = state.history.findIndex(h=>h.date===ym);
  const entry = { date: ym, net: Math.round(net), passiveAnnual: Math.round(pa) };
  if (idx>=0) state.history[idx]=entry; else state.history.push(entry);
  state.history.sort((a,b)=>a.date.localeCompare(b.date));
  saveState();
  renderDashboard();
}

function clearHistory(){
  if (!confirm("Limpar histórico?")) return;
  state.history = [];
  saveState();
  renderDashboard();
}

function renderDashboard(){
  const t = totals();
  $("kpiNet").textContent = fmtMoney(t.net);
  $("kpiAP").textContent = `Ativos ${fmtMoney(t.assets)} | Passivos ${fmtMoney(t.liabs)}`;

  const pa = passiveAnnualEstimate();
  $("kpiPassiveAnnual").textContent = fmtMoney(pa);
  $("kpiPassiveMonthly").textContent = fmtMoney(pa/12);

  renderSummary();
  renderDistChart();
  renderTrendChart();
}

function renderSummary(){
  const list = $("summaryList");
  const btn = $("btnSummaryToggle");

  const items = [...state.assets].sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  const topN = 10;
  const show = summaryShowAll ? items : items.slice(0, topN);

  list.innerHTML = "";
  if (items.length === 0){
    list.innerHTML = `<div class="note">Sem ativos. Usa o botão <b>+</b> para adicionar.</div>`;
    btn.style.display="none";
    return;
  }

  for (const x of show){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item__left">
        <div class="item__name">${escapeHtml(x.name)}</div>
        <div class="item__meta">${escapeHtml(x.class)}</div>
      </div>
      <div class="item__val">${fmtMoney(x.value)}</div>
    `;
    el.addEventListener("click", ()=>{ setView("assets"); itemsShowLiabs=false; updateItemsSeg(); renderItems(); });
    list.appendChild(el);
  }

  if (items.length > topN){
    btn.style.display="inline-flex";
    btn.textContent = summaryShowAll ? "Mostrar menos" : "Ver o resto";
  }else{
    btn.style.display="none";
  }
}

function distData(){
  const by = new Map();
  for (const x of state.assets){
    const c = x.class || "Outros";
    by.set(c, (by.get(c)||0) + (Number(x.value)||0));
  }
  const labels = Array.from(by.keys());
  const values = labels.map(k=>by.get(k)||0);
  // sort desc
  const idx = labels.map((_,i)=>i).sort((i,j)=>values[j]-values[i]);
  const L = idx.map(i=>labels[i]);
  const V = idx.map(i=>values[i]);
  return {labels:L, values:V};
}

function colorsFor(n){
  const palette = ["#34d399","#a78bfa","#94a3b8","#22c55e","#60a5fa","#f59e0b","#f472b6","#38bdf8","#cbd5e1","#10b981","#818cf8","#e879f9"];
  return Array.from({length:n}, (_,i)=>palette[i%palette.length]);
}

function renderDistChart(){
  const {labels, values} = distData();
  const ctx = $("distChart").getContext("2d");
  const cols = colorsFor(labels.length);
  if (distChart) distChart.destroy();
  distChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets:[{ data: values, backgroundColor: cols, borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (c)=> `${c.label}: ${fmtMoney(c.parsed)}`
        }}
      }
    }
  });

  // dist modal list
  renderDistList(labels, values, cols);
}

function openDistModal(){
  distShowAll = false;
  renderDistModal();
  openModal("distModal");
}
function renderDistModal(){
  const {labels, values} = distData();
  const cols = colorsFor(labels.length);
  renderDistList(labels, values, cols);
}
function renderDistList(labels, values, cols){
  const list = $("distList");
  const btn = $("btnDistToggle");
  const total = values.reduce((a,x)=>a+(Number(x)||0),0);
  const items = labels.map((name,i)=>{
    const v = Number(values[i])||0;
    return { name, v, p: total>0 ? (v/total) : 0, color: cols[i] };
  }).filter(x=>x.v>0);

  const topN = 10;
  const show = distShowAll ? items : items.slice(0, topN);
  list.innerHTML = "";

  if (items.length === 0){
    list.innerHTML = `<div class="note">Sem ativos para calcular distribuição.</div>`;
    btn.style.display="none";
    return;
  }

  for (const it of show){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item__left">
        <div class="item__name"><span class="badge" style="margin-right:8px"><span style="width:10px;height:10px;border-radius:999px;background:${it.color};display:inline-block"></span></span>${escapeHtml(it.name)}</div>
        <div class="item__meta">${fmtPct(it.p*100)} • ${fmtMoney(it.v)}</div>
      </div>
      <div class="item__val">${fmtMoney(it.v)}</div>
    `;
    list.appendChild(el);
  }

  if (items.length > topN){
    btn.style.display="inline-flex";
    btn.textContent = distShowAll ? "Mostrar menos" : "Ver o resto";
    btn.onclick = ()=>{ distShowAll = !distShowAll; renderDistList(labels, values, cols); };
  }else{
    btn.style.display="none";
  }
}

function renderTrendChart(){
  const ctx = $("trendChart").getContext("2d");
  const labels = state.history.map(h=>h.date);
  const values = state.history.map(h=>Number(h.net)||0);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets:[{ data: values, tension:.25, borderWidth:2, pointRadius:3 }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}},
      scales:{
        x:{ ticks:{ color:"rgba(226,232,240,.65)"}, grid:{ color:"rgba(255,255,255,.06)"} },
        y:{ ticks:{ color:"rgba(226,232,240,.65)"}, grid:{ color:"rgba(255,255,255,.06)"} }
      }
    }
  });

  $("historyHint").textContent = state.history.length ? `${state.history.length} ponto(s) no histórico.` : "Sem histórico.";
}

function renderItems(){
  const list = $("itemsList");
  const q = $("qSearch").value.trim().toLowerCase();
  const cls = $("qClass").value;
  const sort = $("qSort").value;

  let arr = itemsShowLiabs ? [...state.liabilities] : [...state.assets];

  if (q){
    arr = arr.filter(x=>(x.name||"").toLowerCase().includes(q) || (x.class||"").toLowerCase().includes(q));
  }
  if (cls){
    arr = arr.filter(x=>(x.class||"")===cls);
  }
  if (sort==="value_desc") arr.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  if (sort==="value_asc") arr.sort((a,b)=>(Number(a.value)||0)-(Number(b.value)||0));
  if (sort==="name_asc") arr.sort((a,b)=>(a.name||"").localeCompare(b.name||""));

  list.innerHTML = "";
  if (!arr.length){
    list.innerHTML = `<div class="note">Sem ${itemsShowLiabs?"passivos":"ativos"} (ou filtros demasiado restritos).</div>`;
    return;
  }

  for (const x of arr){
    const el = document.createElement("div");
    el.className="item";
    el.innerHTML = `
      <div class="item__left">
        <div class="item__name">${escapeHtml(x.name)}</div>
        <div class="item__meta">${escapeHtml(x.class)}${x.notes ? " • "+escapeHtml(x.notes) : ""}</div>
      </div>
      <div class="item__val">${fmtMoney(x.value)}</div>
    `;
    el.addEventListener("click", ()=> openItemModal(itemsShowLiabs ? "liab":"asset", x));
    list.appendChild(el);
  }
}

function monthKey(d){
  if (!d) return "";
  return String(d).slice(0,7);
}
function yearKey(d){
  if (!d) return "";
  return String(d).slice(0,4);
}

function renderCashflow(){
  // populate selectors
  const months = Array.from(new Set(state.transactions.map(t=>monthKey(t.date)).filter(Boolean))).sort().reverse();
  const years = Array.from(new Set(state.transactions.map(t=>yearKey(t.date)).filter(Boolean))).sort().reverse();

  const msel = $("cfMonth");
  const ysel = $("cfYear");

  if (!months.length){
    msel.innerHTML = `<option value="">—</option>`;
  }else{
    msel.innerHTML = months.map(m=>`<option value="${m}">${m}</option>`).join("");
  }
  if (!years.length){
    ysel.innerHTML = `<option value="">—</option>`;
  }else{
    ysel.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
  }

  const curM = msel.value || months[0] || "";
  if (curM && msel.value!==curM) msel.value=curM;
  const curY = ysel.value || years[0] || "";
  if (curY && ysel.value!==curY) ysel.value=curY;

  const filtered = state.transactions.filter(t=>{
    const mk = monthKey(t.date);
    const yk = yearKey(t.date);
    if (curM) return mk===curM;
    if (curY) return yk===curY;
    return true;
  });

  let ins=0, outs=0;
  for (const t of filtered){
    const v = Number(t.value)||0;
    if (t.type==="in") ins += v; else outs += v;
  }
  const net = ins - outs;
  const rate = ins>0 ? (net/ins)*100 : 0;

  $("cfIn").textContent = fmtMoney(ins);
  $("cfOut").textContent = fmtMoney(outs);
  $("cfNet").textContent = fmtMoney(net);
  $("cfRate").textContent = (isFinite(rate)? rate:0).toFixed(0) + "%";

  // render list
  const list = $("txList");
  list.innerHTML = "";
  if (!filtered.length){
    list.innerHTML = `<div class="note">Sem movimentos. Usa “Adicionar movimento”.</div>`;
    return;
  }
  for (const t of filtered.sort((a,b)=>(b.date||"").localeCompare(a.date||""))){
    const el = document.createElement("div");
    el.className="item";
    const sign = t.type==="in" ? "+" : "−";
    const meta = `${escapeHtml(t.class)} • ${escapeHtml(t.date)}${t.notes ? " • "+escapeHtml(t.notes):""}`;
    el.innerHTML = `
      <div class="item__left">
        <div class="item__name">${sign} ${escapeHtml(t.class)}</div>
        <div class="item__meta">${meta}</div>
      </div>
      <div class="item__val">${fmtMoney(t.value)}</div>
    `;
    el.addEventListener("click", ()=> openTxModal(t));
    list.appendChild(el);
  }

  // wire selector changes once
  if (!msel.dataset.wired){
    msel.dataset.wired="1";
    ysel.dataset.wired="1";
    msel.addEventListener("change", renderCashflow);
    ysel.addEventListener("change", renderCashflow);
  }
}

function importFile(){
  const f = $("fileInput").files?.[0];
  if (!f) return;

  const name = f.name.toLowerCase();
  if (name.endsWith(".csv")){
    const reader = new FileReader();
    reader.onload = ()=>{
      const text = String(reader.result||"");
      importCSV(text);
    };
    reader.readAsText(f);
  }else if (name.endsWith(".xlsx") || name.endsWith(".xls")){
    const reader = new FileReader();
    reader.onload = ()=>{
      const data = new Uint8Array(reader.result);
      const wb = XLSX.read(data, { type:"array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
      importRows(rows);
    };
    reader.readAsArrayBuffer(f);
  }else{
    alert("Formato não suportado.");
  }
}

function getAny(obj, keys){
  for (const k of keys){
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}
function numAny(obj, keys){
  const v = getAny(obj, keys);
  if (v === "") return 0;
  return Number(String(v).replace(/\s/g,"").replace(",", ".").replace(/[^0-9.\-]/g,"")) || 0;
}
function strAny(obj, keys){
  return String(getAny(obj, keys)).trim();
}

function detectHoldingsColumns(headers){
  const h = new Set(headers.map(x=>String(x||"").toLowerCase().trim()));
  const holdingSignals = ["ticker","symbol","isin","shares","quantity","units","holding","market value","market_value","value_eur","value","nav","position","asset","coin","crypto"];
  let score = 0;
  for (const s of holdingSignals){
    for (const k of h){
      if (k.includes(s.replace(" ","_")) || k.includes(s)) { score++; break; }
    }
  }
  return score >= 3; // heuristic
}
function hasExplicitTxType(headers){
  const h = new Set(headers.map(x=>String(x||"").toLowerCase().trim()));
  return h.has("tipo") || h.has("type") || h.has("transaction_type") || h.has("tx_type");
}

function normalizeHeader(h){
  return String(h||"").trim().toLowerCase()
    .replace(/\s+/g,"_")
    .replace(/[^a-z0-9_]/g,"");
}

function parseCSV(text){
  // minimal CSV parser (handles quoted commas)
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  if (!lines.length) return [];
  const head = splitCSVLine(lines[0]).map(normalizeHeader);
  const out = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    head.forEach((h,idx)=> obj[h]=cols[idx] ?? "");
    out.push(obj);
  }
  return out;
}
function splitCSVLine(line){
  const out=[];
  let cur="", inQ=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"' ){
      if (inQ && line[i+1] === '"'){ cur+='"'; i++; }
      else inQ = !inQ;
    }else if (ch === ',' && !inQ){
      out.push(cur); cur="";
    }else{
      cur+=ch;
    }
  }
  out.push(cur);
  return out.map(s=>String(s).trim());
}

function importCSV(text){
  const rows = parseCSV(text);
  importRows(rows);
}

function importRows(rows){
  // expected keys: tipo, kind, classe, class, nome, name, valor, value, yield_tipo, yield_valor, data, date, tx_tipo, tx_valor
  let added=0;
  for (const r of rows){
    const tipo = (r.tipo || r.kind || r.type || "").toString().trim().toLowerCase();
    const classe = (r.classe || r.class || "").toString().trim() || "Outros";
    const nome = (r.nome || r.name || "").toString().trim();
    const valorRaw = (r.valor ?? r.value ?? "").toString().replace(",", ".");
    const valor = Number(valorRaw||0);

    if (tipo === "ativo" || tipo === "asset"){
      const yt = (r.yield_tipo || r.yieldtype || "none").toString().trim().toLowerCase();
      const yv = Number(((r.yield_valor ?? r.yieldvalue ?? "0").toString().replace(",","."))||0);
      state.assets.push({ id: uid(), class: classe, name: nome || classe, value: valor, yieldType: yt || "none", yieldValue: yv, notes:"" });
      added++;
    }else if (tipo === "passivo" || tipo === "liab" || tipo === "liability"){
      state.liabilities.push({ id: uid(), class: classe, name: nome || classe, value: valor, yieldType:"none", yieldValue:0, notes:"" });
      added++;
    }else if (tipo === "movimento" || tipo === "tx" || tipo === "transacao" || tipo === "transação"){
      const ttype = (r.tx_tipo || r.txtype || r.mov_tipo || r.movtype || r.tipo_mov || r.direction || "in").toString().trim().toLowerCase();
      const tval = Number(((r.tx_valor ?? r.txvalue ?? r.valor ?? r.value ?? "0").toString().replace(",","."))||0);
      const date = (r.data || r.date || "").toString().trim() || new Date().toISOString().slice(0,10);
      state.transactions.push({ id: uid(), type: (ttype==="out"||ttype==="saida"||ttype==="saída") ? "out" : "in", class: classe || nome || "Movimento", value: tval, date, notes:"" });
      added++;
    }else{
      // if tipo empty, try infer: if has date -> tx; else asset
      const date = (r.data || r.date || "").toString().trim();
      if (date){
        const tval = Number(((r.tx_valor ?? r.txvalue ?? r.valor ?? r.value ?? "0").toString().replace(",","."))||0);
        state.transactions.push({ id: uid(), type: "in", class: classe || nome || "Movimento", value: tval, date, notes:"" });
        added++;
      }else if (nome || classe){
        state.assets.push({ id: uid(), class: classe, name: nome || classe, value: valor, yieldType:"none", yieldValue:0, notes:"" });
        added++;
      }
    }
  }
  // keep newest first for lists
  state.assets.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  state.liabilities.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  state.transactions.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  saveState();
  alert(`Importado: ${added} linha(s).`);
  renderAll();
}

function downloadTemplateCSV(){
  const csv = [
    "tipo,classe,nome,valor,yield_tipo,yield_valor,data,tx_tipo,tx_valor",
    "ativo,ETFs,VWCE,25000,yield_pct,1.8,,," ,
    "ativo,Cripto,BTC.CC,87800,none,0,,," ,
    "passivo,Crédito,Crédito Habitação,180000,none,0,,," ,
    "movimento,Salário,Salário Pedro,,none,0,2026-01-31,in,3200",
    "movimento,Habitação,Renda/Prestação,,none,0,2026-01-31,out,900"
  ].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "PF_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "PF_backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(){
  const f = $("jsonInput").files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const obj = JSON.parse(String(reader.result||""));
      state = {
        settings: { currency: obj?.settings?.currency || "EUR" },
        assets: Array.isArray(obj?.assets) ? obj.assets : [],
        liabilities: Array.isArray(obj?.liabilities) ? obj.liabilities : [],
        transactions: Array.isArray(obj?.transactions) ? obj.transactions : [],
        history: Array.isArray(obj?.history) ? obj.history : []
      };
      saveState();
      alert("Importação JSON concluída.");
      renderAll();
    }catch{
      alert("JSON inválido.");
    }
  };
  reader.readAsText(f);
}

function hardReset(){
  if (!confirm("Reset total? Apaga tudo neste dispositivo.")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  saveState();
  renderAll();
  alert("Reset concluído.");
}

function renderAll(){
  refreshClassSelects();
  $("baseCurrency").value = state.settings.currency || "EUR";
  updateItemsSeg();
  if (currentView==="dashboard") renderDashboard();
  if (currentView==="assets") renderItems();
  if (currentView==="cashflow") renderCashflow();
  // update charts regardless (safe)
  renderDashboard();
}

function init(){
  refreshClassSelects();
  $("baseCurrency").value = state.settings.currency || "EUR";
  updateItemsSeg();
  wireGlobal();
  renderAll();
  setView("dashboard");
}

document.addEventListener("DOMContentLoaded", init);

function renderTxRow(t){
  const el = document.createElement("div");
  el.className = "item";
  const sign = t.type === "out" ? "−" : "+";
  const meta = `${t.category || "Movimento"} · ${formatDateShort(t.date)}`;
  el.innerHTML = `
    <div class="item__left">
      <div class="item__name">${escapeHTML(sign + " " + (t.category || "Movimento"))}</div>
      <div class="item__meta">${escapeHTML(meta)}</div>
    </div>
    <div class="item__val">${formatMoney(t.value || 0)}</div>
  `;
  el.addEventListener("click", ()=> openTxModal(t.id));
  return el;
}

function renderTxList(){
  const card = document.getElementById("txCard");
  const list = document.getElementById("txList");
  const btn = document.getElementById("btnTxToggle");
  if (!card || !list) return;

  const tx = (state.transactions || []).slice().sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  if (tx.length === 0){
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  const show = txExpanded ? tx : tx.slice(0, TX_PREVIEW_COUNT);

  list.innerHTML = "";
  show.forEach(t => list.appendChild(renderTxRow(t)));

  if (btn){
    if (tx.length > TX_PREVIEW_COUNT){
      btn.style.display = "";
      btn.textContent = txExpanded ? "Ver menos" : "Ver todos";
    } else {
      btn.style.display = "none";
    }
  }
}
