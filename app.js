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
function isEncryptedEnabled(){
  const m = secMeta();
  return !!m.enabled;
}
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
      { id: uid(), class: "Liquidez", name: "Conta à ordem", value: 12000, incomeType: "none", incomeValue: 0, notes:"" },
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

function renderTopAssets(){
  const box = el("topAssets");
  box.innerHTML = "";
  const items = topAssets(6);
  if (items.length === 0){
    box.innerHTML = `<div class="note">Sem ativos. Adiciona um ativo para começar.</div>`;
    return;
  }
  for (const a of items){
    const meta = `${a.class || "—"} • ${a.incomeType && a.incomeType !== "none" ? "com rendimento" : "sem rendimento"}`;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__name">${escapeHtml(a.name || "—")}</div>
        <div class="item__meta">${escapeHtml(meta)}</div>
      </div>
      <div class="item__right">
        <div class="item__value">${fmtMoney(Number(a.value)||0)}</div>
        <div class="badge"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${getClassColor(a.class)}"></span>${escapeHtml(a.class || "Outros")}</div>
      </div>
    `;
    div.addEventListener("click", () => openEdit(a.id, "asset"));
    box.appendChild(div);
  }
}

function renderAllocationChart(){
  const compact = allocationByClass(6);
  const full = allocationByClassFull();
  const totalFull = full.reduce((a,x)=>a+x.val,0) || 1;
  const total = compact.reduce((a,x)=>a+x.val,0) || 1;

  const bar = el("distBar");
  bar.innerHTML = "";
  for (const seg of compact){
    const h = Math.max(2, Math.round((seg.val/total)*1000)/10);
    const s = document.createElement("div");
    s.className = "dist__seg";
    s.style.height = `${h}%`;
    s.style.background = seg.color;
    bar.appendChild(s);
  }

  const legend = el("allocLegend");
  legend.innerHTML = "";
  for (const seg of compact){
    const pct = (seg.val/totalFull)*100;
    if (seg.cls !== "Outros" && pct < 1) continue;
    const item = document.createElement("div");
    item.className = "legend__item";
    item.innerHTML = `<span class="legend__dot" style="background:${seg.color}"></span>
      <span>${escapeHtml(seg.cls)}</span>
      <span style="color:rgba(168,179,207,.85)">${pct.toFixed(0)}%</span>`;
    legend.appendChild(item);
  }

  const ctx = el("chartAlloc");
  const labels = compact.map(x => x.cls);
  const data = compact.map(x => x.val);
  const colors = compact.map(x => x.color);

  if (chartAlloc) chartAlloc.destroy();
  chartAlloc = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]},
    options: {
      responsive: true,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmtMoney(c.raw)} ` } }
      }
    }
  });
}


function renderNetWorthChart(){
  // If no history, Chart.js will show empty axes; we keep it but also guide user.

  const ctx = el("chartNetWorth");
  const points = (state.history || []).slice().sort((a,b)=> (a.ts||0)-(b.ts||0));

  const labels = points.map(p => (p.date || "").slice(0,10));
  const noteElId = "nwNote";
  let noteEl = document.getElementById(noteElId);
  if (!noteEl){
    noteEl = document.createElement("div");
    noteEl.id = noteElId;
    noteEl.className = "note";
    noteEl.style.marginTop = "10px";
    ctx.parentElement.appendChild(noteEl);
  }
  noteEl.innerHTML = points.length === 0 ? `Sem histórico. <button class="btn btn--primary btn--mini" id="btnMakeFirstSnapshot">Criar ponto hoje</button> <span style="opacity:.8">ou</span> clica em ‘Registar mês’.` : "";
  noteEl.style.display = points.length === 0 ? "block" : "none";
  if (points.length === 0){
    if (chartNW){ try{ chartNW.destroy(); }catch{} chartNW=null; }
    setTimeout(()=>{
      const b = document.getElementById("btnMakeFirstSnapshot");
      if (b) b.onclick = ()=> document.getElementById("btnAddSnapshot")?.click();
    }, 0);
    return;
  }

  const data = points.map(p => Number(p.netWorth)||0);

  if (chartNW) chartNW.destroy();
  chartNW = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Património líquido",
        data,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive:true,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: (c) => ` ${fmtMoney(c.raw)} ` } }
      },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)" } },
        y:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)", callback:(v)=> fmtMoney(v) } }
      }
    }
  });
}
function renderPassiveChart(){
  const ctx = document.getElementById("chartPassive");
  const noteEl = document.getElementById("passiveNote");
  if (!ctx || !noteEl) return;

  const points = (state.history || []).slice().sort((a,b)=> (a.ts||0)-(b.ts||0));
  const metric = document.getElementById("passiveMetric")?.value || "net";

  const labels = points.map(p => (p.date || "").slice(0,10));
  const data = points.map(p => {
    if (metric === "gross") return Number(p.passiveGross ?? 0) || 0;
    return Number(p.passiveNet ?? 0) || 0;
  });

  noteEl.textContent = points.length === 0 ? "Sem histórico. Clica em ‘Registar mês’ para acompanhar a evolução do rendimento passivo." : "";
  noteEl.style.display = points.length === 0 ? "block" : "none";

  if (chartPassive) chartPassive.destroy();
  chartPassive = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Rendimento passivo (anual)",
        data,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: (c) => ` ${fmtMoney(c.raw)} / ano ` } }
      },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)" } },
        y:{ grid:{ color:"rgba(255,255,255,.06)" }, ticks:{ color:"rgba(168,179,207,.9)", callback:(v)=> fmtMoney(v) } }
      }
    }
  });
}


function toggleFav(id){
  const a = (state.assets||[]).find(x=>x.id===id);
  if (!a) return;
  a.fav = !a.fav;
  saveState();
  showToast(a.fav ? "Adicionado aos favoritos." : "Removido dos favoritos.");
  renderAssets();
}

function renderAssetsTop10(){
  const box = document.getElementById("assetsTop10");
  if (!box) return;
  const onlyFav = document.getElementById("onlyFav")?.checked;
  let items = (state.assets||[]).slice().filter(a=> (Number(a.value)||0) > 0);
  if (onlyFav) items = items.filter(a=>!!a.fav);
  items.sort((a,b)=> (Number(b.value)||0)-(Number(a.value)||0));
  const top = items.slice(0,10);

  box.innerHTML = "";
  if (top.length===0){
    box.innerHTML = `<div class="note">Sem itens. Marca favoritos ⭐ ou adiciona valores.</div>`;
    return;
  }
  for (const x of top){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__name">${escapeHtml(x.name||"—")}</div>
        <div class="item__meta">${escapeHtml(x.class||"—")}</div>
      </div>
      <div class="item__right" style="display:flex; align-items:center; gap:10px">
        <div style="text-align:right">
          <div class="item__value">${fmtMoney(Number(x.value)||0)}</div>
          <div class="badge">${pct(Number(x.value)||0, totals().assetsTotal)}</div>
        </div>
        <button class="star ${x.fav ? "star--on":""}" aria-label="Favorito" title="Favorito">★</button>
      </div>
    `;
    div.querySelector(".star").addEventListener("click", (e)=>{ e.stopPropagation(); toggleFav(x.id); });
    div.addEventListener("click", ()=> openEdit("asset", x.id));
    box.appendChild(div);
  }
}

function renderAssets(){
  renderAssetsTop10();
  document.getElementById('onlyFav')?.addEventListener('change', renderAssetsTop10);
  // fill class filter
  const classes = Array.from(new Set(state.assets.map(a => a.class).filter(Boolean))).sort();
  const sel = el("fClass");
  sel.innerHTML = `<option value="">Todas as classes</option>` + classes.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  drawLists();
  // handlers
  el("qAssets").oninput = drawLists;
  sel.onchange = drawLists;
  const sortSel = document.getElementById('sortAssets');
  if (sortSel){
    sortSel.value = state.settings.sortAssets || 'value_desc';
    sortSel.onchange = ()=>{ state.settings.sortAssets = sortSel.value; saveState(); drawLists(); };
  }

}

function drawLists(){
  const q = (el("qAssets").value || "").trim().toLowerCase();
  const f = el("fClass").value || "";

  const listA = el("assetsList");
  listA.innerHTML = "";
  const sortMode = (document.getElementById('sortAssets')?.value) || state.settings.sortAssets || 'value_desc';
  const onlyFav = document.getElementById('onlyFav')?.checked;
  const items = state.assets.filter(a => {
    const hit = (a.name||"").toLowerCase().includes(q) || (a.class||"").toLowerCase().includes(q);
    const ok = !f || a.class === f;
    return hit && ok;
  });
  items.sort((a,b)=>{
    const av = Number(a.value)||0, bv = Number(b.value)||0;
    const an = (a.name||'').toLowerCase(), bn = (b.name||'').toLowerCase();
    const ac = (a.class||'').toLowerCase(), bc = (b.class||'').toLowerCase();
    const ai = estimateItemIncome(a), bi = estimateItemIncome(b);
    switch(sortMode){
      case 'value_asc': return av - bv;
      case 'name_asc': return an.localeCompare(bn);
      case 'class_asc': return ac.localeCompare(bc) || bn.localeCompare(an);
      case 'income_desc': return bi - ai;
      default: return bv - av;
    }
  });


  if (items.length === 0){
    listA.innerHTML = `<div class="note">Sem resultados.</div>`;
  } else {
    for (const a of items){
      listA.appendChild(renderRow(a, "asset"));
    }
  }

  const listL = el("liabsList");
  listL.innerHTML = "";
  const liabs = state.liabilities.slice().sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  if (liabs.length === 0){
    listL.innerHTML = `<div class="note">Sem passivos.</div>`;
  } else {
    for (const l of liabs){
      listL.appendChild(renderRow(l, "liability"));
    }
  }
}

function renderRow(item, kind){
  const div = document.createElement("div");
  div.className = "item";
  const metaParts = [];
  if (kind === "asset"){
    metaParts.push(item.class || "—");
    if (item.incomeType && item.incomeType !== "none"){
      metaParts.push("rendimento on");
    }
  } else {
    metaParts.push(item.class || "—");
  }
  if (item.notes) metaParts.push(item.notes);

  div.innerHTML = `
    <div class="item__left">
      <div class="item__name">${escapeHtml(item.name || "—")}</div>
      <div class="item__meta">${escapeHtml(metaParts.join(" • "))}</div>
    </div>
    <div class="item__right">
      <div class="item__value">${fmtMoney(Number(item.value)||0)}</div>
      <div class="badge">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${getClassColor(item.class)}"></span>
        ${escapeHtml(item.class || "Outros")}
      </div>
    </div>
  `;
  div.addEventListener("click", () => openEdit(item.id, kind));
  return div;
}

function seedTemplates(){
  if (!state.settings) state.settings = { baseCurrency:"EUR", taxRate:0, txTemplates: [] };
  if (!Array.isArray(state.settings.txTemplates)) state.settings.txTemplates = [];
  if (state.settings.txTemplates.length) return;
  state.settings.txTemplates = [
    { id:"tpl_sal_pedro", kind:"income", class:"Salário", name:"Salário Pedro", amount:null },
    { id:"tpl_sal_maria", kind:"income", class:"Salário", name:"Salário (esposa)", amount:null },
    { id:"tpl_renda", kind:"income", class:"Rendas", name:"Renda (imóvel)", amount:null },
    { id:"tpl_hab", kind:"expense", class:"Habitação", name:"Habitação (prestação/renda)", amount:null },
    { id:"tpl_escola", kind:"expense", class:"Educação", name:"Escola", amount:null },
    { id:"tpl_alim", kind:"expense", class:"Alimentação", name:"Supermercado", amount:null }
  ];
}

function txClasses(){
  // pragmatic buckets
  return [
    "Habitação", "Alimentação", "Transportes", "Educação", "Saúde", "Serviços", "Lazer", "Impostos",
    "Salário", "Rendas", "Juros/Dividendos", "Outros"
  ];
}

function monthKey(dateStr){
  if (!dateStr) return "";
  return String(dateStr).slice(0,7); // YYYY-MM
}

function fmtMonthLabel(ym){
  if (!ym) return "—";
  const [y,m] = ym.split("-");
  return `${m}/${y}`;
}

function computeCashflow(){
  const tx = Array.isArray(state.transactions) ? state.transactions : [];
  // map by month
  const map = new Map();
  for (const t of tx){
    const ym = monthKey(t.date);
    if (!ym) continue;
    if (!map.has(ym)) map.set(ym, { ym, income:0, expense:0 });
    const row = map.get(ym);
    const amt = Number(t.amount)||0;
    if (t.kind === "income") row.income += amt;
    else row.expense += amt;
  }
  const arr = Array.from(map.values()).sort((a,b)=> a.ym.localeCompare(b.ym));
  for (const r of arr) r.net = r.income - r.expense;
  return arr;
}

function computeCashKPIs(filtered){
  const income = filtered.filter(t=>t.kind==="income").reduce((a,x)=>a+(Number(x.amount)||0),0);
  const expense = filtered.filter(t=>t.kind==="expense").reduce((a,x)=>a+(Number(x.amount)||0),0);
  const net = income - expense;
  return { income, expense, net };
}

function yearKey(dateStr){
  if (!dateStr) return "";
  return String(dateStr).slice(0,4); // YYYY
}

function getSelectedYear(){
  const sel = document.getElementById("yearSelect");
  if (!sel) return "";
  return sel.value || "";
}

function txForYear(year){
  const tx = Array.isArray(state.transactions) ? state.transactions : [];
  if (!year) return tx;
  return tx.filter(t => yearKey(t.date) === year);
}

function computeYearSummary(year){
  const tx = txForYear(year);
  const income = tx.filter(t=>t.kind==="income").reduce((a,x)=>a+(Number(x.amount)||0),0);
  const expense = tx.filter(t=>t.kind==="expense").reduce((a,x)=>a+(Number(x.amount)||0),0);
  const net = income - expense;
  const savingsRate = income > 0 ? (net / income) : 0;
  return { income, expense, net, savingsRate };
}

function expenseByClass(year){
  const tx = txForYear(year).filter(t=>t.kind==="expense");
  const map = new Map();
  for (const t of tx){
    const c = t.class || "Outros";
    map.set(c, (map.get(c)||0) + (Number(t.amount)||0));
  }
  const arr = Array.from(map.entries()).map(([cls, amt])=>({cls, amt}));
  arr.sort((a,b)=> b.amt - a.amt);
  return arr;
}

function topExpenses(year, n=5){
  const tx = txForYear(year).filter(t=>t.kind==="expense").slice();
  tx.sort((a,b)=> (Number(b.amount)||0)-(Number(a.amount)||0));
  return tx.slice(0,n);
}

function computeCoverage(year){
  // Expenses: annualised from transactions of selected year (sum of expenses)
  const exp = txForYear(year).filter(t=>t.kind==="expense").reduce((a,x)=>a+(Number(x.amount)||0),0);

  // Passive: use latest snapshot in that year if available; else use current computed passive
  const points = (state.history||[]).filter(p => yearKey(p.date) === year).sort((a,b)=> (a.ts||0)-(b.ts||0));
  let passiveNet = 0, passiveGross = 0;
  if (points.length){
    const last = points[points.length-1];
    passiveNet = Number(last.passiveNet ?? 0) || 0;
    passiveGross = Number(last.passiveGross ?? 0) || 0;
  } else {
    // fallback: current computed passive (annual)
    const p = computePassiveAnnualGross();
    passiveGross = p.gross;
    passiveNet = p.net;
  }
  const covNet = exp > 0 ? passiveNet / exp : 0;
  const covGross = exp > 0 ? passiveGross / exp : 0;
  return { exp, passiveNet, passiveGross, covNet, covGross };
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
      notes: document.getElementById("txNotes").value.trim()
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
  // Accept either:
  // 1) Template: kind,class,name,value,income_type,income_value,notes
  // 2) Minimal: class,name,value (assume assets)
  const cleaned = rows.filter(r => Array.isArray(r) && r.some(x => String(x||"").trim() !== ""));
  if (cleaned.length === 0) return {assets:[], liabilities:[]};

  const header = cleaned[0].map(x => String(x||"").trim().toLowerCase());
  const hasKind = header.includes("kind");
  const hasClass = header.includes("class") || header.includes("classe");
  const hasName = header.includes("name") || header.includes("nome");
  const hasValue = header.includes("value") || header.includes("valor");

  const idx = (name) => header.indexOf(name);

  const assets = [];
  const liabilities = [];

  for (let i=1; i<cleaned.length; i++){
    const r = cleaned[i];
    if (!r || r.length === 0) continue;

    if (hasKind && hasClass && hasName && hasValue){
      const kind = String(r[idx("kind")]||"asset").trim().toLowerCase();
      const cls = String(r[idx("class")]||"Outros").trim() || "Outros";
      const name = String(r[idx("name")]||"").trim() || "—";
      const value = Number(r[idx("value")]||0) || 0;

      const incomeType = String(r[idx("income_type")]||"none").trim() || "none";
      const incomeValue = Number(r[idx("income_value")]||0) || 0;
      const notes = String(r[idx("notes")]||"").trim();

      if (kind === "liability"){
        liabilities.push({ id: uid(), class: cls, name, value, notes });
      } else {
        assets.push({ id: uid(), class: cls, name, value, incomeType: incomeType || "none", incomeValue, notes });
      }
    } else if (hasClass && hasName && hasValue){
      const cls = String(r[header.indexOf("class")]||"Outros").trim() || "Outros";
      const name = String(r[header.indexOf("name")]||"").trim() || "—";
      const value = Number(r[header.indexOf("value")]||0) || 0;
      assets.push({ id: uid(), class: cls, name, value, incomeType:"none", incomeValue:0, notes:"" });
    } else {
      // fallback: expect columns [class, name, value]
      const cls = String(r[0]||"Outros").trim() || "Outros";
      const name = String(r[1]||"—").trim() || "—";
      const value = Number(r[2]||0) || 0;
      assets.push({ id: uid(), class: cls, name, value, incomeType:"none", incomeValue:0, notes:"" });
    }
  }
  return { assets, liabilities };
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
function setupSW(){
  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
    });
  }
}

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
  const months = Array.from(new Set((state.transactions||[]).map(t=>monthKey(t.date)).filter(Boolean))).sort().reverse();
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
  for (const t of (state.transactions||[])) years.add(yearKey(t.date));
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
  const filtered = (state.transactions||[]).filter(t=>{
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
            <div class="item__meta">${escapeHtml(x.class || "—")} • ${escapeHtml(x.date || "")}${x.notes ? " • "+escapeHtml(x.notes) : ""}</div>
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
  setupSW();
  setActiveView("Dashboard");
}

document.addEventListener("DOMContentLoaded", init);
