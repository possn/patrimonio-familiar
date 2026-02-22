// Património Familiar — app.js (offline-first, vanilla JS)
// Libs: Chart.js (alloc + trend) | SheetJS (XLSX/CSV import)

const STORAGE_KEY = "PF_STATE_V1";
const STORAGE_KEY_ENC = "PF_STATE_V1_ENC";
const STORAGE_META = "PF_SEC_META_V1";

function showToast(msg, ms=2200){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('toast--show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=> t.classList.remove('toast--show'), ms);
}

function openSheet(){
  const s = document.getElementById('actionSheet');
  if (!s) return;
  s.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
  tryVibrate(6);
}
function closeSheet(){
  const s = document.getElementById('actionSheet');
  if (!s) return;
  s.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}


// ===== Local encryption (AES-GCM + PBKDF2) =====
function b64u(bytes){
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
function ub64u(str){
  str = str.replaceAll("-","+").replaceAll("_","/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function deriveKey(pass, salt){
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pass),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt","decrypt"]
  );
}
async function encryptJson(pass, obj){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const enc = new TextEncoder();
  const pt = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, pt);
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    it: 250000,
    salt: b64u(salt),
    iv: b64u(iv),
    ct: b64u(ct)
  };
}
async function decryptJson(pass, payload){
  const salt = ub64u(payload.salt);
  const iv = ub64u(payload.iv);
  const ct = ub64u(payload.ct);
  const key = await deriveKey(pass, salt);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ct);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(new Uint8Array(pt)));
}
function secMeta(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_META) || "{}"); }catch{ return {}; }
}
function setSecMeta(m){
  localStorage.setItem(STORAGE_META, JSON.stringify(m || {}));
}
function isEncryptedEnabled(){ return false; }
function lockApp(){
  const m = secMeta();
  m.locked = true;
  setSecMeta(m);
}
function unlockApp(){
  const m = secMeta();
  m.locked = false;
  setSecMeta(m);
}
function tryVibrate(ms=12){
  try{ if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}


const DEFAULT_CLASSES = [
  { key: "Liquidez", color: "#a78bfa" },
  { key: "Ações", color: "#22d3ee" },
  { key: "ETFs", color: "#4ade80" },
  { key: "Fundos", color: "#fbbf24" },
  { key: "PPR", color: "#fb7185" },
  { key: "Depósitos a prazo", color: "#60a5fa" },
  { key: "Imobiliário", color: "#34d399" },
  { key: "Ouro", color: "#f59e0b" },
  { key: "Prata", color: "#cbd5e1" },
  { key: "Arte", color: "#f472b6" },
  { key: "Outros", color: "#94a3b8" },
];

const state = loadState();

let chartAlloc = null;
let chartNW = null;
let chartPassive = null;
let chartCashflow = null;
let chartExpenseClass = null;

const el = (id) => document.getElementById(id);
const fmtMoney = (n) => {
  const ccy = state.settings.baseCurrency || "EUR";
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return (n || 0).toFixed(0) + " " + ccy;
  }
};

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }


async function bootState(){
  // If encryption enabled, state is stored encrypted in localStorage under STORAGE_KEY_ENC.
  if (!isEncryptedEnabled()){
    // state loaded via bootState()
    return;
  }
  const m = secMeta();
  const payloadStr = localStorage.getItem(STORAGE_KEY_ENC);
  if (!payloadStr){
    // enabled but missing payload: fall back to empty
    state = defaultState();
    return;
  }
  const payload = JSON.parse(payloadStr);
  // Ask for password if locked OR no cached session.
  let pass = sessionStorage.getItem("PF_SEC_PASS") || "";
  if (m.locked || !pass){
    pass = prompt("Password para desbloquear Património Familiar:");
    if (!pass){ throw new Error("locked"); }
  }
  try{
    const obj = await decryptJson(pass, payload);
    state = obj;
    // normalize
    state.settings = state.settings || { baseCurrency:"EUR", taxRate:0, txTemplates: [] };
    state.settings.txTemplates = Array.isArray(state.settings.txTemplates) ? state.settings.txTemplates : [];
    state.assets = Array.isArray(state.assets) ? state.assets : [];
    state.liabilities = Array.isArray(state.liabilities) ? state.liabilities : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    sessionStorage.setItem("PF_SEC_PASS", pass);
    unlockApp();
  }catch(e){
    sessionStorage.removeItem("PF_SEC_PASS");
    lockApp();
    alert("Password inválida. A app mantém-se bloqueada.");
    throw e;
  }
}

function defaultState(){
  return {
    assets: [],
    liabilities: [],
    history: [],
    transactions: [],
    settings: { baseCurrency: "EUR", taxRate: 0, txTemplates: [] }
  };
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try{
      const s = JSON.parse(raw);
      // harden defaults
      s.assets = Array.isArray(s.assets) ? s.assets : [];
      s.liabilities = Array.isArray(s.liabilities) ? s.liabilities : [];
      s.history = Array.isArray(s.history) ? s.history : [];
      s.settings = s.settings || { baseCurrency:"EUR", taxRate: 0, txTemplates: [] };
      s.settings.txTemplates = Array.isArray(s.settings.txTemplates) ? s.settings.txTemplates : [];
      s.transactions = Array.isArray(s.transactions) ? s.transactions : [];
      return s;
    }catch{}
  }
  // seed with minimal examples (edit/delete as you wish)
  return {
    assets: [
      { id: uid(), class: inferAssetClass(row), name: "Conta à ordem", value: 12000, incomeType: "none", incomeValue: 0, notes:"" },
      { id: uid(), class: "ETFs", name: "VWCE", value: 25000, incomeType: "div_yield", incomeValue: 1.8, notes:"yield %/ano (aprox.)" },
      { id: uid(), class: "Imobiliário", name: "Casa (valor estimado)", value: 280000, incomeType: "rent", incomeValue: 0, notes:"se for arrendada, inserir renda mensal" },
    ],
    liabilities: [
      { id: uid(), class: "Crédito", name: "Crédito habitação", value: 180000, notes:"" },
    ],
    history: [],
    transactions: [],
    settings: { baseCurrency: "EUR", taxRate: 0, txTemplates: [] },
  };
}

async function saveStateSecure(){
  if (!isEncryptedEnabled()){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  const pass = sessionStorage.getItem("PF_SEC_PASS") || "";
  if (!pass){
    // locked - do not write
    return;
  }
  const payload = await encryptJson(pass, state);
  localStorage.setItem(STORAGE_KEY_ENC, JSON.stringify(payload));
  // remove plaintext
  localStorage.removeItem(STORAGE_KEY);
}

function saveState(){
  // keep API but async-save in background
  saveStateSecure();
}


function getClassColor(cls){
  const found = DEFAULT_CLASSES.find(c => c.key === cls);
  return found ? found.color : "#94a3b8";
}

function classesForSelect(kind){
  // assets: financial classes; liabilities: keep simple
  if (kind === "liability"){
    return [
      {key:"Crédito", color:"#fb7185"},
      {key:"Cartão", color:"#fbbf24"},
      {key:"Dívida", color:"#a78bfa"},
      {key:"Outros", color:"#94a3b8"},
    ];
  }
  return DEFAULT_CLASSES;
}

function incomeHintText(type){
  switch(type){
    case "div_yield": return "Yield anual em % (ex: 3.2). A app calcula valor*%/100.";
    case "div_amount": return "Dividendos em € por ano (ex: 450).";
    case "rate": return "Taxa anual em % (ex: 2.5). A app calcula valor*%/100.";
    case "rent": return "Renda mensal em € (ex: 950). A app anualiza (×12).";
    default: return "Sem rendimento passivo associado.";
  }
}

function computeTotals(){
  const assetsTotal = state.assets.reduce((a,x) => a + (Number(x.value)||0), 0);
  const liabTotal = state.liabilities.reduce((a,x) => a + (Number(x.value)||0), 0);
  const netWorth = assetsTotal - liabTotal;
  const passiveGross = computePassiveAnnualGross();
  const tax = Math.max(0, Math.min(100, Number(state.settings.taxRate)||0));
  const passiveNet = passiveGross * (1 - tax/100);
  return { assetsTotal, liabTotal, netWorth, passiveGross, passiveNet };
}

function estimateItemIncome(a){
  if (!a) return 0;
  const v = Number(a.value)||0;
  const t = a.incomeType || 'none';
  const iv = Number(a.incomeValue)||0;
  if (t === 'div_yield' || t === 'rate') return v * (iv/100);
  if (t === 'div_amount') return iv;
  if (t === 'rent') return iv * 12;
  return 0;
}

function computePassiveAnnualGross(){
  let sum = 0;
  for (const a of state.assets){
    const v = Number(a.value) || 0;
    const t = a.incomeType || "none";
    const iv = Number(a.incomeValue) || 0;
    if (t === "div_yield" || t === "rate"){
      sum += v * (iv/100);
    } else if (t === "div_amount"){
      sum += iv;
    } else if (t === "rent"){
      sum += iv * 12;
    }
  }
  return sum;
}

function allocationByClassFull(){
  const map = new Map();
  for (const a of state.assets){
    const cls = a.class || "Outros";
    const v = Number(a.value) || 0;
    if (v <= 0) continue;
    map.set(cls, (map.get(cls) || 0) + v);
  }
  return Array.from(map.entries()).sort((x,y)=>y[1]-x[1]).map(([cls,val])=>({
    cls, val, color: getClassColor(cls)
  }));
}

function allocationByClass(limit=6){
  const arr = allocationByClassFull();
  if (arr.length <= limit) return arr;
  const head = arr.slice(0, limit);
  const tail = arr.slice(limit);
  const other = tail.reduce((a,x)=>a+x.val,0);
  if (other > 0){
    head.push({ cls:"Outros", val: other, color: getClassColor("Outros") });
  }
  return head;
}


function topAssets(n=6){
  return deepClone(state.assets)
    .sort((a,b) => (Number(b.value)||0) - (Number(a.value)||0))
    .slice(0,n);
}

function setActiveView(name){
  const views = {
    Dashboard: "viewDashboard",
    Assets: "viewAssets",
    Import: "viewImport",
    Cashflow: "viewCashflow",
    Settings: "viewSettings"
  };
  Object.values(views).forEach(id => el(id).classList.remove("view--active"));
  el(views[name]).classList.add("view--active");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("tab--active"));
  document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("tab--active");

  if (name === "Dashboard") renderDashboard();
  if (name === "Assets") renderAssets();
  if (name === "Settings") renderSettings();
  if (name === "Cashflow") renderCashflow();
}

function renderDashboard(){
  const t = computeTotals();
  el("netWorth").textContent = fmtMoney(t.netWorth);
  el("netWorthSub").textContent = `Ativos ${fmtMoney(t.assetsTotal)}  |  Passivos ${fmtMoney(t.liabTotal)}`;
  el("passiveAnnual").textContent = fmtMoney(t.passiveNet);
  el("passiveMonthly").textContent = fmtMoney(t.passiveNet/12);

  renderAllocationChart();
  renderNetWorthChart();
  renderPassiveChart();
  try{ renderCoverage(String(new Date().getFullYear())); }catch{}
  renderTopAssets();
}


function renderAllocationChart(){
  const canvas = document.getElementById("chartAlloc");
  const legend = document.getElementById("allocLegend");
  const bar = document.getElementById("distBar");
  if (!canvas || !legend) return;

  const full = allocationByClassFull(); // sorted desc
  const data = allocationByClass();     // top6 + outros
  const total = full.reduce((a,x)=>a+(x.val||0),0) || 0;

  // Build doughnut
  const labels = data.map(x=>x.cls);
  const values = data.map(x=>x.val);
  const colors = data.map(x=>x.color);

  if (window.Chart){
    if (chartAlloc) { try{ chartAlloc.destroy(); }catch{} }
    chartAlloc = new Chart(canvas, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive:true,
        cutout: "70%",
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label:(c)=> ` ${c.label}: ${fmtMoney(c.raw)} ` } }
        }
      }
    });
  }

  // Stacked bar (simple)
  if (bar){
    bar.innerHTML = "";
    for (const x of data){
      const seg = document.createElement("div");
      seg.className = "dist__seg";
      const pct = total>0 ? (x.val/total*100) : 0;
      seg.style.width = pct.toFixed(2)+"%";
      seg.style.background = x.color;
      bar.appendChild(seg);
    }
  }

  // Legend: show top 10 classes max (never infinite) + "Ver tudo"
  legend.innerHTML = "";
  const show = full.slice(0,10);
  for (const x of show){
    const pct = total>0 ? Math.round((x.val/total)*100) : 0;
    const row = document.createElement("div");
    row.className = "legend__row";
    row.innerHTML = `
      <span class="dot" style="background:${x.color}"></span>
      <span class="legend__name">${escapeHtml(x.cls)}</span>
      <span class="legend__pct">${pct}%</span>
      <span class="legend__val">${fmtMoney(x.val)}</span>
    `;
    legend.appendChild(row);
  }
  if (full.length>10){
    const more = document.createElement("button");
    more.className = "btn btn--text";
    more.type = "button";
    more.textContent = "Ver o resto";
    more.addEventListener("click", ()=> openAllocModal());
    legend.appendChild(more);
  }
}

function renderNetWorthChart(){
  const canvas = document.getElementById("chartNetWorth");
  if (!canvas || !window.Chart) return;
  const hist = (state.history||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  const labels = hist.map(h=>h.date || "");
  const values = hist.map(h=>Number(h.netWorth)||0);

  if (chartNW) { try{ chartNW.destroy(); }catch{} }
  chartNW = new Chart(canvas, {
    type:"line",
    data:{ labels, datasets:[{ data: values, borderWidth:2, pointRadius:2, tension:0.25 }] },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(c)=>` ${fmtMoney(c.raw)} ` } } },
      scales:{
        x:{ ticks:{ color:"rgba(168,179,207,.9)" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ ticks:{ color:"rgba(168,179,207,.9)" }, grid:{ color:"rgba(255,255,255,.06)" } }
      }
    }
  });
}

function renderPassiveChart(){
  const canvas = document.getElementById("chartPassive");
  if (!canvas || !window.Chart) return;
  const hist = (state.history||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  const labels = hist.map(h=>h.date || "");
  const values = hist.map(h=>Number(h.passiveNet)||0);

  if (chartPassive) { try{ chartPassive.destroy(); }catch{} }
  chartPassive = new Chart(canvas, {
    type:"bar",
    data:{ labels, datasets:[{ data: values, borderWidth:0 }] },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(c)=>` ${fmtMoney(c.raw)} /ano` } } },
      scales:{
        x:{ ticks:{ color:"rgba(168,179,207,.9)" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ ticks:{ color:"rgba(168,179,207,.9)" }, grid:{ color:"rgba(255,255,255,.06)" } }
      }
    }
  });
}

function renderTopAssets(){
  const list = el("topAssets");
  const btn = document.getElementById("btnTopAssetsMore");
  if (!list) return;

  const itemsAll = (state.assets||[]).slice().filter(a => (Number(a.value)||0) > 0);
  itemsAll.sort((a,b)=> (Number(b.value)||0)-(Number(a.value)||0));

  const expanded = !!state.settings.topAssetsExpanded;
  const items = expanded ? itemsAll : itemsAll.slice(0,10);

  list.innerHTML = "";
  if (items.length===0){
    list.innerHTML = `<div class="note">Sem ativos. Adiciona ou importa para começar.</div>`;
  } else {
    for (const a of items){
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(a.name||"—")}</div>
          <div class="item__meta">${escapeHtml(a.class||"—")}${a.symbol ? " • "+escapeHtml(a.symbol):""}</div>
        </div>
        <div class="item__right">
          <div class="item__value">${fmtMoney(Number(a.value)||0)}</div>
          <div class="badge">${pct(Number(a.value)||0, totals().assetsTotal)}</div>
        </div>
      `;
      div.addEventListener("click", ()=> openEdit("asset", a.id));
      list.appendChild(div);
    }
  }

  if (btn){
    btn.style.display = (itemsAll.length > 10) ? "inline-flex" : "none";
    btn.textContent = expanded ? "Mostrar menos" : "Ver o resto";
    btn.onclick = ()=>{
      state.settings.topAssetsExpanded = !state.settings.topAssetsExpanded;
      saveState();
      renderTopAssets();
    };
  }
}

function renderSettings(){
  el("baseCurrency").value = state.settings.baseCurrency || "EUR";
  el("taxRate").value = Number(state.settings.taxRate || 0);
}

function setupNav(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveView(btn.dataset.view));
  });
  el("linkGoAssets").addEventListener("click", (e)=>{ e.preventDefault(); setActiveView("Assets"); });
}

function setupButtons(){
  // FAB + action sheet
  const fab = document.getElementById('fabAdd');
  if (fab) fab.addEventListener('click', openSheet);
  const sheet = document.getElementById('actionSheet');
  if (sheet) sheet.addEventListener('click', (e)=>{ if (e.target?.dataset?.sheetClose) closeSheet(); });
  const qaA = document.getElementById('qaAddAsset');
  const qaL = document.getElementById('qaAddLiab');
  const qaS = document.getElementById('qaSnapshot');
  const qaI = document.getElementById('qaImport');
  if (qaA) qaA.addEventListener('click', ()=>{ closeSheet(); openCreate('asset'); });
  if (qaL) qaL.addEventListener('click', ()=>{ closeSheet(); openCreate('liability'); });
  if (qaS) qaS.addEventListener('click', ()=>{ closeSheet(); document.getElementById('btnAddSnapshot')?.click(); });
  if (qaI) qaI.addEventListener('click', ()=>{ closeSheet(); setActiveView('Import'); });

  // Dashboard quick chips
  document.getElementById('dqAddAsset')?.addEventListener('click', ()=> openCreate('asset'));
  document.getElementById('dqAddLiab')?.addEventListener('click', ()=> openCreate('liability'));
  document.getElementById('dqSnapshot')?.addEventListener('click', ()=> document.getElementById('btnAddSnapshot')?.click());


  el("btnAddAsset").addEventListener("click", () => { closeSheet(); openCreate("asset"); });
  el("btnAddLiab").addEventListener("click", () => { closeSheet(); openCreate("liability"); });
  el("btnAddQuick").addEventListener("click", () => { closeSheet(); openCreate("asset"); });

  document.getElementById('btnAllocDetail')?.addEventListener('click', ()=> openAllocModal());

  el("btnAddSnapshot").addEventListener("click", () => {
    const t = computeTotals();
    const now = new Date();
    const date = now.toISOString().slice(0,10);
    state.history.push({ ts: now.getTime(), date, netWorth: t.netWorth, assetsTotal: t.assetsTotal, liabTotal: t.liabTotal, passiveGross: t.passiveGross, passiveNet: t.passiveNet });
    showToast('Snapshot registado.');
    saveState();
    renderDashboard();
  });

  el("btnClearHistory").addEventListener("click", () => {
    if (!confirm("Limpar histórico de snapshots?")) return;
    state.history = [];
    saveState();
    renderDashboard();
  });

  el("btnReset").addEventListener("click", () => {
    if (!confirm("Isto apaga todos os dados locais. Continuar?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_ENC);
    localStorage.removeItem(STORAGE_META);
    sessionStorage.removeItem("PF_SEC_PASS");
    location.reload();
  });

  // settings
  el("baseCurrency").addEventListener("change", () => {
    state.settings.baseCurrency = el("baseCurrency").value;
    saveState();
    renderDashboard();
    renderAssets();
  });
  el("taxRate").addEventListener("input", () => {
    state.settings.taxRate = Number(el("taxRate").value || 0);
    saveState();
    renderDashboard();
  });

  // security
  document.getElementById('btnResetAll')?.addEventListener('click', hardResetAll);
  document.getElementById('btnReset')?.addEventListener('click', hardResetAll);
  document.getElementById('btnWipe')?.addEventListener('click', hardResetAll);
  document.getElementById('btnClearAll')?.addEventListener('click', hardResetAll);
  document.getElementById('secEnable')?.addEventListener('click', enableEncryption);
  document.getElementById('secDisable')?.addEventListener('click', disableEncryption);
  document.getElementById('secLockNow')?.addEventListener('click', ()=>{ lockApp(); sessionStorage.removeItem('PF_SEC_PASS'); showToast('Bloqueado.'); updateSecurityUI(); });
  document.getElementById('secExportEnc')?.addEventListener('click', exportEncryptedBackup);
  document.getElementById('secImportEnc')?.addEventListener('click', ()=> document.getElementById('secImportFile')?.click());
  document.getElementById('secImportFile')?.addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) importEncryptedBackupFile(f); e.target.value=''; });

  // cashflow
  document.getElementById('btnAddTx')?.addEventListener('click', openTxCreate);
  document.getElementById('btnExportTx')?.addEventListener('click', exportTxCsv);

  // export / import JSON
  el("btnExport").addEventListener("click", exportJson);
  el("btnImportJson").addEventListener("click", () => el("jsonInput").click());
  el("jsonInput").addEventListener("change", importJson);

  // import xlsx/csv
  el("btnImport").addEventListener("click", importFile);
  el("btnDownloadTemplate").addEventListener("click", downloadTemplate);
}

function setupModal(){
  const modal = el("modal");
  modal.addEventListener("click", (e)=>{
    const t = e.target;
    if (t && t.dataset && t.dataset.close) closeModal();
  });

  const incomeType = el("incomeType");
  incomeType.addEventListener("change", ()=>{
    el("incomeHint").textContent = incomeHintText(incomeType.value);
  });

  el("formItem").addEventListener("submit", (e)=>{
    e.preventDefault();
    const id = el("itemId").value || uid();
    const kind = el("itemKind").value;
    const obj = {
      id,
      class: el("itemClass").value,
      name: el("itemName").value.trim(),
      value: Number(el("itemValue").value || 0),
      notes: el("itemNotes").value.trim()
    };

    if (kind === "asset"){
      obj.incomeType = el("incomeType").value;
      obj.incomeValue = Number(el("incomeValue").value || 0);
    }

    if (kind === "asset"){
      upsert(state.assets, obj);
    } else {
      upsert(state.liabilities, obj);
    }

    saveState();
    tryVibrate(14);
    showToast('Guardado.');
    closeModal();
    renderDashboard();
    renderAssets();
  });

  el("btnDeleteItem").addEventListener("click", ()=>{
    const id = el("itemId").value;
    const kind = el("itemKind").value;
    if (!id) return;
    if (!confirm("Eliminar este item?")) return;
    if (kind === "asset"){
      state.assets = state.assets.filter(x => x.id !== id);
    } else {
      state.liabilities = state.liabilities.filter(x => x.id !== id);
    }
    saveState();
    tryVibrate(14);
    showToast('Guardado.');
    closeModal();
    renderDashboard();
    renderAssets();
  });
function setupTxModal(){
  const modal = document.getElementById("txModal");
  if (!modal) return;
  modal.addEventListener("click", (e)=>{
    const t = e.target;
    if (t && t.dataset && t.dataset.txClose) closeTxModal();
  });

  document.getElementById("formTx").addEventListener("submit", (e)=>{
    e.preventDefault();
    const id = document.getElementById("txId").value || uid();
    const obj = {
      id,
      kind: document.getElementById("txKind").value,
      class: document.getElementById("txClass").value,
      name: document.getElementById("txName").value.trim(),
      amount: Number(document.getElementById("txAmount").value || 0),
      date: document.getElementById("txDate").value,
      notes: document.getElementById("txNotes").value.trim(),
              recurring: (document.getElementById('txRecurring')?.checked ? { freq:'monthly', until: (document.getElementById('txUntil')?.value || '') } : null)
    };
    const arr = state.transactions || (state.transactions = []);
    const idx = arr.findIndex(x => x.id === id);
    if (idx >= 0) arr[idx] = obj;
    else arr.unshift(obj);

    saveState();
    tryVibrate(14);
    showToast("Guardado.");
    closeTxModal();
    renderCashflow();
  });

  document.getElementById("btnDeleteTx").addEventListener("click", ()=>{
    const id = document.getElementById("txId").value;
    if (!id) return;
    if (!confirm("Eliminar este movimento?")) return;
    state.transactions = (state.transactions||[]).filter(x => x.id !== id);
    saveState();
    tryVibrate(18);
    showToast("Eliminado.");
    closeTxModal();
    renderCashflow();
  });
}

}

function openCreate(kind){
  openModal({
    title: kind === "asset" ? "Adicionar ativo" : "Adicionar passivo",
    kind,
    item: null
  });
}
function openEdit(id, kind){
  const item = (kind === "asset" ? state.assets : state.liabilities).find(x => x.id === id);
  if (!item) return;
  openModal({
    title: kind === "asset" ? "Editar ativo" : "Editar passivo",
    kind,
    item
  });
}

function openModal({title, kind, item}){
  tryVibrate(8);

  el("modalTitle").textContent = title;
  el("itemKind").value = kind;

  // classes
  const clsSel = el("itemClass");
  const classes = classesForSelect(kind);
  clsSel.innerHTML = classes.map(c => `<option value="${escapeAttr(c.key)}">${escapeHtml(c.key)}</option>`).join("");

  // reset
  el("itemId").value = item?.id || "";
  el("itemClass").value = item?.class || classes[0].key;
  el("itemName").value = item?.name || "";
  el("itemValue").value = item?.value ?? "";
  el("itemNotes").value = item?.notes || "";

  const incomeType = el("incomeType");
  const incomeValue = el("incomeValue");

  if (kind === "asset"){
    incomeType.disabled = false;
    incomeValue.disabled = false;
    incomeType.value = item?.incomeType || "none";
    incomeValue.value = item?.incomeValue ?? "";
    el("incomeHint").textContent = incomeHintText(incomeType.value);
  } else {
    // liabilities: hide/disable income
    incomeType.value = "none";
    incomeValue.value = "";
    incomeType.disabled = true;
    incomeValue.disabled = true;
    el("incomeHint").textContent = "Passivos não têm rendimento passivo.";
  }

  el("btnDeleteItem").style.display = item ? "inline-flex" : "none";

  el("modal").setAttribute("aria-hidden", "false");
  setTimeout(()=>{ try{ el("itemName").focus(); }catch{} }, 50);

  document.body.style.overflow = "hidden";
}

function closeModal(){
  el("modal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function upsert(arr, obj){
  const idx = arr.findIndex(x => x.id === obj.id);
  if (idx >= 0) arr[idx] = obj;
  else arr.unshift(obj);
}

// ===== Import / Export =====

function downloadTemplate(){
  const rows = [
    ["kind","class","name","value","income_type","income_value","notes"],
    ["asset","ETFs","VWCE",25000,"div_yield",1.8,"yield %/ano"],
    ["asset","Depósitos a prazo","DP Banco X",15000,"rate",2.2,"taxa %/ano"],
    ["asset","Imobiliário","Apartamento arrendado",200000,"rent",950,"renda €/mês"],
    ["liability","Crédito","Crédito habitação",180000,"","", "valor em dívida"],
  ];
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
  }).join(",")).join("\n");

  downloadBlob(new Blob([csv], {type:"text/csv;charset=utf-8"}), "template_patrimonio.csv");
}


function inferAssetClass(row){
  const s = (x)=>String(x??"").trim();
  const clsRaw = s(row.class||row.classe||row.asset_class||row.tipo||row.category);
  const sym = s(row.symbol||row.ticker||row.isin||row.code);
  const name = s(row.name||row.nome||row.asset||row.ativo);

  const u = (clsRaw||name||sym).toUpperCase();

  // explicit
  if (clsRaw) return clsRaw;

  // crypto heuristics
  if (sym.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(sym.toUpperCase())) return "Cripto";

  // ETFs heuristics
  if (u.includes("ETF") || ["VWCE","VWRL","CSPX","IWDA","EMIM","EUNL","SPY","VOO","QQQ"].includes(sym.toUpperCase())) return "ETFs";

  // stocks heuristics
  if (sym && sym.length<=6) return "Ações";

  return "Outros";
}

async function importFile(){
  const file = el("fileInput").files?.[0];
  if (!file){
    note("importNote", "Escolhe um ficheiro primeiro.");
    return;
  }
  try{
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type:"array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const parsed = parseRows(rows);
    if (parsed.assets.length === 0 && parsed.liabilities.length === 0){
      note("importNote", "Nada importado. Confere cabeçalhos/colunas.");
      return;
    }
    state.assets = mergeByIdOrName(state.assets, parsed.assets, "asset");
    state.liabilities = mergeByIdOrName(state.liabilities, parsed.liabilities, "liability");
    saveState();
    note("importNote", `Importado: ${parsed.assets.length} ativos, ${parsed.liabilities.length} passivos.`);
    showToast('Importação concluída.');
    renderDashboard();
    renderAssets();
    setActiveView("Dashboard");
  }catch(err){
    console.error(err);
    note("importNote", "Falha ao importar. Confere se é CSV/XLSX válido.");
  }
}

function parseRows(rows){
  // Robust import for CSV/XLSX.
  // Supports columns (case-insensitive):
  // kind/type, class/classe/asset_class, name/nome, symbol/ticker, value/valor/amount, qty/units, notes/notas, income_type, income_value
  const cleaned = rows
    .filter(r => Array.isArray(r) && r.some(x => String(x||"").trim() !== ""))
    .map(r => r.map(x => (typeof x === "string" ? x.trim() : x)));

  if (cleaned.length === 0) return {assets:[], liabilities:[]};

  const header = cleaned[0].map(x => String(x||"").trim().toLowerCase());
  const col = (...names) => {
    for (const n of names){
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iKind = col("kind","tipo","type");
  const iClass = col("class","classe","asset_class","categoria");
  const iName = col("name","nome","descrição","descricao","desc");
  const iSymbol = col("symbol","ticker","isin","ativo","asset");
  const iValue = col("value","valor","amount","montante");
  const iQty = col("qty","quantidade","units","unidades","shares");
  const iNotes = col("notes","notas","obs","observacoes","observações");
  const iIncomeType = col("income_type","income type","tipo_rendimento","tipo rendimento");
  const iIncomeVal = col("income_value","income value","rendimento","yield","yield_%","yield%","dividend_yield");

  const assets = [];
  const liabilities = [];

  for (let r=1; r<cleaned.length; r++){
    const row = cleaned[r];
    if (!row) continue;

    const kind = (iKind !== -1 ? String(row[iKind]||"asset").trim().toLowerCase() : "asset");
    const rawClass = (iClass !== -1 ? String(row[iClass]||"").trim() : "");
    const name = (iName !== -1 ? String(row[iName]||"").trim() : "");
    const symbol = (iSymbol !== -1 ? String(row[iSymbol]||"").trim() : "");
    const value = toNumber(iValue !== -1 ? row[iValue] : "");
    const qty = toNumber(iQty !== -1 ? row[iQty] : "");
    const notes = (iNotes !== -1 ? String(row[iNotes]||"").trim() : "");

    const income_type = (iIncomeType !== -1 ? String(row[iIncomeType]||"").trim() : "");
    const income_value = toNumber(iIncomeVal !== -1 ? row[iIncomeVal] : "");

    // Determine name/class safely
    const finalName = (name || symbol || "Sem nome").trim();
    let finalClass = (rawClass || "").trim();

    // Infer class if missing or clearly wrong (e.g., looks like a ticker)
    const looksLikeTicker = /^[A-Z0-9]{1,6}([.-][A-Z0-9]{1,6})?$/.test(finalClass) && finalClass.length <= 12;
    if (!finalClass || looksLikeTicker){
      finalClass = inferClass(finalName, symbol || finalClass, kind);
    }

    if (kind === "liability" || kind === "passivo"){
      liabilities.push({
        id: uid(),
        class: finalClass || "Passivo",
        name: finalName,
        value: value || 0,
        notes
      });
    } else {
      assets.push({
        id: uid(),
        class: finalClass || "Outros",
        name: finalName,
        symbol: symbol || "",
        qty: isFinite(qty) && qty ? qty : null,
        value: value || 0,
        income_type: income_type || "",
        income_value: isFinite(income_value) ? income_value : 0,
        notes,
        fav: false
      });
    }
  }

  return { assets, liabilities };
}

function inferClass(name, symbol, kind){
  const s = String(symbol||"").toUpperCase();
  const n = String(name||"").toLowerCase();

  if (kind === "liability" || kind === "passivo") return "Passivo";

  // crypto heuristics
  const cryptoSet = new Set(["BTC","ETH","SOL","ADA","XRP","DOT","BNB"]);
  if (s.endsWith(".CC") || cryptoSet.has(s) || s.includes("BTC") || s.includes("ETH") || n.includes("bitcoin") || n.includes("ethereum") || n.includes("cripto") || n.includes("crypto")){
    return "Cripto";
  }
  if (n.includes("conta") || n.includes("liquidez") || n.includes("cash") || n.includes("depósito") || n.includes("deposito")){
    return "Liquidez";
  }
  if (n.includes("etf")) return "ETFs";
  if (n.includes("ppr")) return "PPR";
  if (n.includes("imó") || n.includes("imo") || n.includes("imobili")) return "Imobiliário";
  if (n.includes("ouro") || s==="XAU" || s.includes("GOLD")) return "Ouro";
  if (n.includes("prata") || s==="XAG" || s.includes("SILVER")) return "Prata";
  if (n.includes("arte")) return "Arte";
  return "Ações";
}

function mergeByIdOrName(existing, incoming, kind){
  // Simple merge: if same (class+name) exists, overwrite value/income; else add.
  const out = existing.slice();
  for (const it of incoming){
    const key = `${(it.class||"").toLowerCase()}|${(it.name||"").toLowerCase()}`;
    const idx = out.findIndex(x => `${(x.class||"").toLowerCase()}|${(x.name||"").toLowerCase()}` === key);
    if (idx >= 0){
      out[idx] = { ...out[idx], ...it, id: out[idx].id };
      if (kind === "asset"){
        out[idx].incomeType = it.incomeType || out[idx].incomeType || "none";
        out[idx].incomeValue = Number(it.incomeValue || 0);
      }
    } else {
      out.unshift(it);
    }
  }
  return out;
}

function exportJson(){
  const payload = {
    exported_at: new Date().toISOString(),
    version: 1,
    state
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"}), "patrimonio_familiar_backup.json");
  showToast('Backup exportado.');
}

async function importJson(){
  const f = el("jsonInput").files?.[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const obj = JSON.parse(txt);
    const s = obj.state || obj;
    if (!s || !Array.isArray(s.assets) || !Array.isArray(s.liabilities)){
      alert("JSON inválido (não encontrei assets/liabilities).");
      return;
    }
    state.assets = s.assets;
    state.liabilities = s.liabilities;
    state.history = Array.isArray(s.history) ? s.history : [];
    state.settings = s.settings || state.settings || { baseCurrency:"EUR", taxRate: 0 };
    saveState();
    renderDashboard();
    renderAssets();
    setActiveView("Dashboard");
  } catch(err){
    console.error(err);
    alert("Falha ao importar JSON.");
  } finally {
    el("jsonInput").value = "";
  }
}

function downloadBlob(blob, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 250);
}

function note(id, msg){
  el(id).textContent = msg;
}

function escapeHtml(s){
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function escapeAttr(s){
  return escapeHtml(s).replaceAll('"',"&quot;");
}

// ===== Service worker =====

function renderTemplates(){
  const box = document.getElementById("txTemplates");
  if (!box) return;
  const tpls = (state.settings?.txTemplates) || [];
  box.innerHTML = "";
  for (const t of tpls){
    const b = document.createElement("button");
    b.className = "tpl";
    const sub = t.kind === "income" ? "Entrada" : "Saída";
    b.innerHTML = `<span>${escapeHtml(t.name)}</span> <span class="tpl__sub">${escapeHtml(sub)}</span>`;
    b.addEventListener("click", ()=> applyTemplate(t));
    box.appendChild(b);
  }
}

function applyTemplate(t){
  openTxModal({ title: "Adicionar movimento", item: null });
  document.getElementById("txKind").value = t.kind;
  document.getElementById("txClass").value = t.class;
  document.getElementById("txName").value = t.name;
  if (t.amount != null) document.getElementById("txAmount").value = t.amount;
  // default date = today; user can change month/day
  tryVibrate(8);
}

function renderCashflow(){
  // fill month filter options from existing data
  const months = Array.from(new Set(expandTransactions().map(t=>monthKey(t.date)).filter(Boolean))).sort().reverse();
  const monthSel = document.getElementById("txMonth");
  if (monthSel){
    const current = monthSel.value || "";
    monthSel.innerHTML = `<option value="">Todos</option>` + months.map(m=>`<option value="${escapeAttr(m)}">${escapeHtml(fmtMonthLabel(m))}</option>`).join("");
    // keep selection if possible
    if (months.includes(current)) monthSel.value = current;
  }

  // fill tx class select in modal
  const clsSel = document.getElementById("txClass");
  if (clsSel){
    clsSel.innerHTML = txClasses().map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  }

  // handlers
  document.getElementById("qTx").oninput = drawCashflow;
  document.getElementById("txMonth").onchange = drawCashflow;
  document.getElementById("txType").onchange = drawCashflow;
}

function renderAnnualAndBreakdown(){
  // Year selector options from transactions + history
  const years = new Set();
  for (const t of expandTransactions()) years.add(yearKey(t.date));
  for (const p of (state.history||[])) years.add(yearKey(p.date));
  years.delete("");
  const arr = Array.from(years).sort().reverse();

  const sel = document.getElementById("yearSelect");
  if (sel){
    const prev = sel.value || "";
    sel.innerHTML = arr.length ? arr.map(y=>`<option value="${escapeAttr(y)}">${escapeHtml(y)}</option>`).join("") : `<option value="">—</option>`;
    // default to current year if present
    const currentY = String(new Date().getFullYear());
    if (!prev && arr.includes(currentY)) sel.value = currentY;
    else if (prev && arr.includes(prev)) sel.value = prev;
    else if (arr.length) sel.value = arr[0];
    sel.onchange = ()=> { drawCashflow(); };
  }

  const year = getSelectedYear();
  renderAnnualSummary(year);
  renderExpenseClassChart(year);
  renderTopExpenses(year);
  renderCoverage(year);
}

function renderAnnualSummary(year){
  const box = document.getElementById("annualSummary");
  if (!box) return;
  const s = computeYearSummary(year);
  const pct = (s.savingsRate*100);
  box.innerHTML = `
    <div class="kpi"><div class="kpi__label">Entradas (ano)</div><div class="kpi__value">${fmtMoney(s.income)}</div></div>
    <div class="kpi"><div class="kpi__label">Saídas (ano)</div><div class="kpi__value">${fmtMoney(s.expense)}</div></div>
    <div class="kpi"><div class="kpi__label">Saldo (ano)</div><div class="kpi__value">${fmtMoney(s.net)}</div></div>
    <div class="kpi"><div class="kpi__label">Taxa de poupança</div><div class="kpi__value">${isFinite(pct) ? pct.toFixed(1) : "0.0"}%</div></div>
  `;
}

function renderExpenseClassChart(year){
  const ctx = document.getElementById("chartExpenseClass");
  const note = document.getElementById("expNote");
  if (!ctx || !note) return;

  const data = expenseByClass(year);
  if (data.length === 0){
    note.textContent = "Sem despesas registadas para este ano.";
    note.style.display = "block";
  } else {
    note.style.display = "none";
  }

  const labels = data.map(x=>x.cls);
  const values = data.map(x=>x.amt);

  if (chartExpenseClass) chartExpenseClass.destroy();
  chartExpenseClass = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins:{
        legend:{ position: "bottom", labels:{ color:"rgba(168,179,207,.92)", boxWidth: 10 } },
        tooltip:{ callbacks:{ label: (c)=> ` ${c.label}: ${fmtMoney(c.raw)} ` } }
      }
    }
  });
}

function renderTopExpenses(year){
  const list = document.getElementById("topExpenses");
  if (!list) return;
  const top = topExpenses(year, 5);

  list.innerHTML = "";
  if (top.length === 0){
    list.innerHTML = `<div class="note">Sem despesas no ano selecionado.</div>`;
    return;
  }

  for (const x of top){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__name">${escapeHtml(x.name || "—")}</div>
        <div class="item__meta">${escapeHtml(x.class || "—")} • ${escapeHtml(x.date || "")}</div>
      </div>
      <div class="item__right">
        <div class="item__value">− ${fmtMoney(Number(x.amount)||0)}</div>
        <div class="badge badge--out">Saída</div>
      </div>
    `;
    div.addEventListener("click", ()=> openTxEdit(x.id));
    list.appendChild(div);
  }
}

function renderCoverage(year){
  const box = document.getElementById("coverageBox");
  const mini = document.getElementById("dashCoverage");
  if (!box && !mini) return;

  const c = computeCoverage(year);
  const pctNet = Math.max(0, Math.min(1, c.covNet));
  const pctGross = Math.max(0, Math.min(1, c.covGross));

  const pctText = (p)=> `${(p*100).toFixed(1)}%`;
  const bar = (p)=> `<div class="coverage__bar"><div class="coverage__fill" style="width:${(p*100).toFixed(1)}%"></div></div>`;

  const expTxt = fmtMoney(c.exp);
  const netTxt = fmtMoney(c.passiveNet);
  const grossTxt = fmtMoney(c.passiveGross);

  const inner = `
    <div class="coverage__row">
      <div>
        <div class="coverage__title">Cobertura anual (ano ${escapeHtml(year || "—")})</div>
        <div class="coverage__meta">Despesas: ${expTxt} • Passivo líquido: ${netTxt} • Passivo bruto: ${grossTxt}</div>
      </div>
      <div class="coverage__pct">${pctText(pctNet)}</div>
    </div>
    ${bar(pctNet)}
    <div class="coverage__meta" style="margin-top:8px">Cobertura líquida. (Bruto: ${pctText(pctGross)})</div>
  `;

  if (box) box.innerHTML = inner;

  // mini uses current year selection or latest year, more compact
  if (mini){
    const y = year || String(new Date().getFullYear());
    mini.innerHTML = `
      <div class="coverage__row">
        <div>
          <div class="coverage__title">Cobertura passivo</div>
          <div class="coverage__meta">Ano ${escapeHtml(y)} • ${pctText(pctNet)} líquido</div>
        </div>
        <div class="coverage__pct">${pctText(pctNet)}</div>
      </div>
      ${bar(pctNet)}
    `;
  }
}

function drawCashflow(){
  const q = (document.getElementById("qTx").value || "").trim().toLowerCase();
  const m = document.getElementById("txMonth").value || "";
  const ttype = document.getElementById("txType").value || "";

  const list = document.getElementById("txList");
  const filtered = expandTransactions().filter(t=>{
    const hit = (t.name||"").toLowerCase().includes(q) || (t.class||"").toLowerCase().includes(q);
    const okM = !m || monthKey(t.date) === m;
    const okT = !ttype || t.kind === ttype;
    return hit && okM && okT;
  }).sort((a,b)=> (b.date||"").localeCompare(a.date||""));

  // KPIs
  const k = computeCashKPIs(filtered);
  const box = document.getElementById("cashSummary");
  if (box){
    box.innerHTML = `
      <div class="kpi"><div class="kpi__label">Entradas</div><div class="kpi__value">${fmtMoney(k.income)}</div></div>
      <div class="kpi"><div class="kpi__label">Saídas</div><div class="kpi__value">${fmtMoney(k.expense)}</div></div>
      <div class="kpi"><div class="kpi__label">Saldo</div><div class="kpi__value">${fmtMoney(k.net)}</div></div>
    `;
  }

  // list render
  if (list){
    list.innerHTML = "";
    if (filtered.length === 0){
      list.innerHTML = `<div class="note">Sem movimentos. Adiciona entradas/saídas para teres balanço mensal/anual.</div>`;
    } else {
      for (const x of filtered){
        const badgeClass = x.kind === "income" ? "badge--in" : "badge--out";
        const sign = x.kind === "income" ? "+" : "−";
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
          <div class="item__left">
            <div class="item__name">${escapeHtml(x.name || "—")}</div>
            <div class="item__meta">${escapeHtml(x.class || "—")} • ${escapeHtml(x.date || "")}${x.recurring ? " • Recorrente" : ""}${x.notes ? " • "+escapeHtml(x.notes) : ""}</div>
          </div>
          <div class="item__right">
            <div class="item__value">${sign} ${fmtMoney(Number(x.amount)||0)}</div>
            <div class="badge ${badgeClass}">${x.kind === "income" ? "Entrada" : "Saída"}</div>
          </div>
        `;
        div.addEventListener("click", ()=> openTxEdit(x.id));
        list.appendChild(div);
      }
    }
  }

  renderCashflowChart();
}

function renderCashflowChart(){
  const ctx = document.getElementById("chartCashflow");
  if (!ctx) return;

  const data = computeCashflow();
  const labels = data.map(r=> fmtMonthLabel(r.ym));
  const net = data.map(r=> r.net);

  if (chartCashflow) chartCashflow.destroy();
  chartCashflow = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Saldo mensal",
        data: net,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: (c)=> ` ${fmtMoney(c.raw)} ` } }
      },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)" } },
        y:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)", callback:(v)=> fmtMoney(v) } }
      }
    }
  });
}

function openCreateAsset(){ openCreate("asset"); }
function openCreateLiab(){ openCreate("liab"); }

function openTxCreate(){
  openTxModal({ title: "Adicionar movimento", item: null });
}
function openTxEdit(id){
  const item = (state.transactions||[]).find(t=>t.id===id);
  if (!item) return;
  openTxModal({ title: "Editar movimento", item });
}

function openTxModal({title, item}){
  document.getElementById("txTitle").textContent = title;
  const modal = document.getElementById("txModal");
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
  tryVibrate(8);

  // fill classes
  const clsSel = document.getElementById("txClass");
  clsSel.innerHTML = txClasses().map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  document.getElementById("txId").value = item?.id || "";
  document.getElementById("txKind").value = item?.kind || "expense";
  document.getElementById("txClass").value = item?.class || "Outros";
  document.getElementById("txName").value = item?.name || "";
  document.getElementById("txAmount").value = item?.amount ?? "";
  document.getElementById("txDate").value = item?.date || new Date().toISOString().slice(0,10);
  document.getElementById("txNotes").value = item?.notes || "";

      const rec = item?.recurring;
      document.getElementById('txRecurring').checked = !!(rec && rec.freq==='monthly');
      document.getElementById('txUntil').value = (rec && rec.until) ? rec.until : '';

  document.getElementById("btnDeleteTx").style.display = item ? "inline-flex" : "none";
  setTimeout(()=>{ try{ document.getElementById("txName").focus(); }catch{} }, 50);
}

function closeTxModal(){
  const modal = document.getElementById("txModal");
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

function exportTxCsv(){
  const rows = [["kind","class","name","amount","date","notes"]];
  for (const t of (state.transactions||[])){
    rows.push([t.kind, t.class, t.name, t.amount, t.date, t.notes || ""]);
  }
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
  }).join(",")).join("\n");
  downloadBlob(new Blob([csv], {type:"text/csv;charset=utf-8"}), "cashflow_movimentos.csv");
  showToast("CSV exportado.");
}

function openAllocModal(){
  const modal = document.getElementById("allocModal");
  if (!modal) return;
  const list = document.getElementById("allocDetailList");
  const full = allocationByClassFull();
  const total = full.reduce((a,x)=>a+x.val,0) || 1;
  list.innerHTML = "";
  if (!full.length){
    list.innerHTML = `<div class="note">Sem ativos com valor.</div>`;
  } else {
    for (const seg of full){
      const pct = (seg.val/total)*100;
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(seg.cls)}</div>
          <div class="item__meta">${pct.toFixed(1)}%</div>
        </div>
        <div class="item__right">
          <div class="item__value">${fmtMoney(seg.val)}</div>
          <div class="badge"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${seg.color}"></span>${escapeHtml(seg.cls)}</div>
        </div>
      `;
      list.appendChild(div);
    }
  }
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
}
function closeAllocModal(){
  const modal = document.getElementById("allocModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow="";
}


async function exportEncryptedBackup(){
  let pass = sessionStorage.getItem("PF_SEC_PASS") || "";
  if (!pass){
    pass = prompt("Password para encriptar o backup:");
    if (!pass) return;
  }
  const payload = await encryptJson(pass, state);
  const blob = new Blob([JSON.stringify(payload)], {type:"application/octet-stream"});
  downloadBlob(blob, "patrimonio_familiar_backup.pfenc");
  showToast("Backup encriptado exportado.");
}

async function importEncryptedBackupFile(file){
  const txt = await file.text();
  let payload;
  try{ payload = JSON.parse(txt); }catch{ alert("Ficheiro inválido."); return; }
  const pass = prompt("Password para desencriptar o backup:");
  if (!pass) return;
  try{
    const obj = await decryptJson(pass, payload);
    state = obj;
    // normalize
    state.settings = state.settings || { baseCurrency:"EUR", taxRate:0, txTemplates: [] };
    state.settings.txTemplates = Array.isArray(state.settings.txTemplates) ? state.settings.txTemplates : [];
    state.assets = Array.isArray(state.assets) ? state.assets : [];
    state.liabilities = Array.isArray(state.liabilities) ? state.liabilities : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    sessionStorage.setItem("PF_SEC_PASS", pass);
    unlockApp();
    // store encrypted if enabled
    if (isEncryptedEnabled()){
      await saveStateSecure();
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    renderAll();
    showToast("Backup encriptado importado.");
  }catch(e){
    alert("Password incorreta ou ficheiro corrompido.");
  }
}

async function enableEncryption(){
  const pass = (document.getElementById("secPass").value || "").trim();
  if (pass.length < 8){
    alert("Password demasiado curta. Usa 12+ caracteres.");
    return;
  }
  // Encrypt current plaintext state and store
  sessionStorage.setItem("PF_SEC_PASS", pass);
  const payload = await encryptJson(pass, state);
  localStorage.setItem(STORAGE_KEY_ENC, JSON.stringify(payload));
  localStorage.removeItem(STORAGE_KEY);
  setSecMeta({ enabled:true, locked:false, ts: Date.now() });
  showToast("Encriptação ativada.");
  updateSecurityUI();
}

async function disableEncryption(){
  if (!confirm("Desativar encriptação? Os dados voltarão a ficar em claro no dispositivo.")) return;
  const pass = sessionStorage.getItem("PF_SEC_PASS") || prompt("Password atual:");
  if (!pass) return;
  const payloadStr = localStorage.getItem(STORAGE_KEY_ENC);
  if (!payloadStr){ alert("Sem dados encriptados."); return; }
  try{
    const obj = await decryptJson(pass, JSON.parse(payloadStr));
    state = obj;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(STORAGE_KEY_ENC);
    setSecMeta({ enabled:false, locked:false, ts: Date.now() });
    sessionStorage.removeItem("PF_SEC_PASS");
    showToast("Encriptação desativada.");
    updateSecurityUI();
    renderAll();
  }catch(e){
    alert("Password incorreta.");
  }
}


function hardResetAll(){
  if (!confirm("Reset total? Isto apaga dados locais (incluindo encriptados) neste dispositivo.")) return;
  try{
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_ENC);
    localStorage.removeItem(STORAGE_META);
    sessionStorage.removeItem("PF_SEC_PASS");
  }catch{}
  // reload clean
  location.reload();
}

function updateSecurityUI(){
  const elStatus = document.getElementById("secStatus");
  if (!elStatus) return;
  const enabled = isEncryptedEnabled();
  const m = secMeta();
  const locked = !!m.locked;
  elStatus.innerHTML = `Estado: <b>${enabled ? (locked ? "Encriptado (bloqueado)" : "Encriptado (ativo)") : "Sem encriptação"}</b>.`;
}

// ===== Init =====
async function renderAll(){
  renderDashboard();
  renderAssets();
  renderImport();
  renderCashflow();
  renderSettings();
}

function init(){
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){ closeModal(); closeTxModal(); closeAllocModal(); closeSheet(); } });

  setupNav();
  setupButtons();
  setupModal();
  setupTxModal();
  // setupSW removed (core stable)
  setActiveView("Dashboard");
}

document.addEventListener("DOMContentLoaded", init);
function renderLiabilities(){
  const topBox = document.getElementById("liabTop10");
  const listBox = document.getElementById("liabList");
  const btn = document.getElementById("btnLiabMore");
  if (!topBox || !listBox) return;

  const all = (state.liabilities||[]).slice().filter(x => (Number(x.value)||0) > 0);
  all.sort((a,b)=> (Number(b.value)||0)-(Number(a.value)||0));

  const expanded = !!state.settings.liabExpanded;
  const top = expanded ? all : all.slice(0,10);

  topBox.innerHTML = "";
  listBox.innerHTML = "";

  if (top.length===0){
    topBox.innerHTML = `<div class="note">Sem passivos. Importa ou adiciona um empréstimo/crédito.</div>`;
  } else {
    for (const x of top){
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(x.name||"—")}</div>
          <div class="item__meta">${escapeHtml(x.class||"Passivo")}</div>
        </div>
        <div class="item__right">
          <div class="item__value">− ${fmtMoney(Number(x.value)||0)}</div>
          <div class="badge badge--out">Passivo</div>
        </div>
      `;
      div.addEventListener("click", ()=> openEdit("liability", x.id));
      topBox.appendChild(div);
    }
  }

  if (btn){
    btn.style.display = (all.length > 10) ? "inline-flex" : "none";
    btn.textContent = expanded ? "Mostrar menos" : "Ver o resto";
    btn.onclick = ()=>{
      state.settings.liabExpanded = !state.settings.liabExpanded;
      saveState();
      renderLiabilities();
    };
  }
}

function setupAssetsSegment(){
  const seg = document.getElementById("segAssets");
  if (!seg) return;
  const panelLiab = document.getElementById("liabPanel");
  const panelAssetsTop = document.getElementById("assetsTop10")?.closest(".card--inner");
  const assetsList = document.getElementById("assetsList");

  const setSeg = (which)=>{
    state.settings.assetsSeg = which;
    saveState();
    for (const b of seg.querySelectorAll(".seg__btn")){
      const on = b.dataset.seg === which;
      b.classList.toggle("seg__btn--on", on);
      b.setAttribute("aria-selected", on ? "true":"false");
    }
    if (which==="liabilities"){
      if (panelLiab) panelLiab.style.display = "";
      if (panelAssetsTop) panelAssetsTop.style.display = "none";
      if (assetsList) assetsList.style.display = "none";
      renderLiabilities();
    } else {
      if (panelLiab) panelLiab.style.display = "none";
      if (panelAssetsTop) panelAssetsTop.style.display = "";
      if (assetsList) assetsList.style.display = "";
      renderAssetsTop10();
  setupAssetsSegment();
    }
  };

  seg.querySelectorAll(".seg__btn").forEach(b=>{
    b.onclick = ()=> setSeg(b.dataset.seg);
  });

  setSeg(state.settings.assetsSeg || "assets");
}


function expandTransactions(){
  // Returns materialized list including recurrences (monthly)
  const tx = expandTransactions();
  const out = [];
  const today = new Date();
  const horizonMonths = 12;

  for (const t of tx){
    if (!t.recurring || t.recurring.freq !== "monthly"){
      out.push(t);
      continue;
    }
    const start = new Date(t.date);
    if (isNaN(start)) { out.push(t); continue; }

    let until = t.recurring.until ? new Date(t.recurring.until) : null;
    if (until && isNaN(until)) until = null;

    // If no until, generate horizonMonths from start
    let count = 0;
    let cur = new Date(start);
    while (true){
      // stop criteria
      if (until && cur > until) break;
      if (!until && count >= horizonMonths) break;

      const inst = {...t, id: t.id + "__" + cur.toISOString().slice(0,10), date: cur.toISOString().slice(0,10), _generated:true, _src:t.id};
      out.push(inst);

      // next month
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const d = cur.getDate();
      const next = new Date(y, m+1, 1);
      // keep same day if possible, else last day of month
      const lastDay = new Date(next.getFullYear(), next.getMonth()+1, 0).getDate();
      next.setDate(Math.min(d, lastDay));
      cur = next;
      count += 1;
    }
  }

  // Sort by date desc
  out.sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  return out;
}

let distShowAll = false;

function renderDistList(labels, values, colors, total){
  const box = document.getElementById("distList");
  const btn = document.getElementById("btnDistToggle");
  if (!box) return;

  const items = labels.map((name,i)=>{
    const v = Number(values[i])||0;
    const p = total>0 ? (v/total) : 0;
    return { name, v, p, color: (colors && colors[i]) ? colors[i] : null };
  }).filter(x=>x.v>0).sort((a,b)=> b.v-a.v);

  const topN = 10;
  const show = distShowAll ? items : items.slice(0, topN);
  box.innerHTML = "";

  for (const it of show){
    const row = document.createElement("div");
    row.className = "distRow";
    const pct = (it.p*100);
    row.innerHTML = `
      <div class="distLeft">
        <span class="dot" style="${it.color ? "background:"+it.color : ""}"></span>
        <div class="distName">${escapeHtml(it.name)}</div>
        <div class="distMeta">${pct.toFixed(0)}%</div>
      </div>
      <div class="distVal">${fmtMoney(it.v)}</div>
    `;
    box.appendChild(row);
  }

  if (btn){
    if (items.length > topN){
      btn.style.display = "inline-flex";
      btn.textContent = distShowAll ? "Mostrar menos" : "Ver o resto";
      btn.onclick = ()=>{ distShowAll = !distShowAll; renderDistTop(labels, values, colors, total); };
    }else{
      btn.style.display = "none";
    }
  }
}



// --- v15 Distribution UI (simple) ---
let distModalShowAll = false;

function openDistModal(){
  const m = document.getElementById("distModal");
  if (!m) return;
  m.setAttribute("aria-hidden","false");
}
function closeDistModal(){
  const m = document.getElementById("distModal");
  if (!m) return;
  m.setAttribute("aria-hidden","true");
}

function renderDistTop(labels, values, colors, total){
  const box = document.getElementById("distTop");
  if (!box) return;
  const items = labels.map((name,i)=>{
    const v = Number(values[i])||0;
    const p = total>0 ? (v/total) : 0;
    return { name, v, p, color: colors?.[i] || null };
  }).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);

  const top3 = items.slice(0,3);
  box.innerHTML = "";
  for (const it of top3){
    const b = document.createElement("button");
    b.className = "tpl"; // reuse chip style
    b.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px">
      <span class="dot" style="width:10px;height:10px;border-radius:999px;${it.color?"background:"+it.color:""}"></span>
      ${escapeHtml(it.name)}
    </span>
    <span class="tpl__sub">${(it.p*100).toFixed(0)}% • ${fmtMoney(it.v)}</span>`;
    b.addEventListener("click", openDistModal);
    box.appendChild(b);
  }

  // Show a single "Detalhe" chip
  const d = document.createElement("button");
  d.className = "tpl";
  d.innerHTML = `<span>Detalhe</span><span class="tpl__sub">Top 10 + resto</span>`;
  d.addEventListener("click", openDistModal);
  box.appendChild(d);

  // Render modal list too
  renderDistModalList(items);
}

function renderDistModalList(items){
  const box = document.getElementById("distListModal");
  const btn = document.getElementById("btnDistToggleModal");
  if (!box) return;

  const topN = 10;
  const show = distModalShowAll ? items : items.slice(0, topN);

  box.innerHTML = "";
  for (const it of show){
    const row = document.createElement("div");
    row.className = "distRow";
    const pct = (it.p*100);
    row.innerHTML = `
      <div class="distLeft">
        <span class="dot" style="${it.color ? "background:"+it.color : ""}"></span>
        <div class="distName">${escapeHtml(it.name)}</div>
        <div class="distMeta">${pct.toFixed(0)}%</div>
      </div>
      <div class="distVal">${fmtMoney(it.v)}</div>`;
    box.appendChild(row);
  }

  if (btn){
    if (items.length > topN){
      btn.style.display = "inline-flex";
      btn.textContent = distModalShowAll ? "Mostrar menos" : "Ver o resto";
      btn.onclick = ()=>{ distModalShowAll = !distModalShowAll; renderDistModalList(items); };
    }else{
      btn.style.display = "none";
    }
  }
}

document.addEventListener("click", (e)=>{
  const t = e.target;
  if (t?.dataset?.close === "dist") closeDistModal();
});
document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("btnCloseDist")?.addEventListener("click", closeDistModal);
  document.getElementById("btnDistToggleModal")?.addEventListener("click", ()=>{ distModalShowAll = !distModalShowAll; });
});


// v16: explicit import button (iOS-friendly)
function handleImportClick(){
  const inp = document.getElementById("fileInput");
  const f = inp?.files?.[0];
  if (!f){ alert("Escolhe um ficheiro primeiro."); return; }
  importFile();
}
document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("btnImport")?.addEventListener("click", handleImportClick);
});


document.addEventListener("DOMContentLoaded", ()=>{
  const inp = document.getElementById("fileInput");
  const btn = document.getElementById("btnImport");
  if (inp && btn){
    const sync=()=>{ btn.disabled = !(inp.files && inp.files.length); };
    inp.addEventListener("change", sync);
    sync();
  }
});
