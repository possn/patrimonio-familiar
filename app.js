// Património Familiar — v8 rebuild (stable, sem dependências externas)
// Tudo local (localStorage). Sem login/back-end.
// Funcionalidades: ativos/passivos, distribuição, snapshots, top10, cripto, balanço mensal (entradas/saídas), templates salário, import/export CSV/JSON.

const STORAGE_KEY = "PF_STATE_V8";

const DEFAULT_CLASSES = [
  { key: "Liquidez", color: "#a78bfa" },
  { key: "Imobiliário", color: "#34d399" },
  { key: "Ações", color: "#22d3ee" },
  { key: "ETFs", color: "#4ade80" },
  { key: "Fundos", color: "#fbbf24" },
  { key: "PPR", color: "#fb7185" },
  { key: "Depósitos a prazo", color: "#60a5fa" },
  { key: "Cripto", color: "#93c5fd" },
  { key: "Ouro", color: "#f59e0b" },
  { key: "Prata", color: "#cbd5e1" },
  { key: "Arte", color: "#f472b6" },
  { key: "Outros", color: "#94a3b8" },
];

const el = (id) => document.getElementById(id);

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

function safeNum(x, fallback=0){
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function fmtMoney(n){
  const ccy = state.settings.baseCurrency || "EUR";
  const v = Number.isFinite(n) ? n : 0;
  try{
    return new Intl.NumberFormat("pt-PT", { style:"currency", currency:ccy, maximumFractionDigits:0 }).format(v);
  }catch{
    return `${v.toFixed(0)} ${ccy}`;
  }
}

function fmtDateISO(d){
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const da = String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function monthKeyFromDateISO(dateISO){
  // "YYYY-MM"
  if (!dateISO) return "";
  return dateISO.slice(0,7);
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try{
      const s = JSON.parse(raw);
      s.assets = Array.isArray(s.assets) ? s.assets : [];
      s.liabilities = Array.isArray(s.liabilities) ? s.liabilities : [];
      s.history = Array.isArray(s.history) ? s.history : []; // [{month, netWorth, assets, liabilities, passiveNet}]
      s.transactions = Array.isArray(s.transactions) ? s.transactions : []; // [{id,date,kind,category,description,amount}]
      s.settings = s.settings || { baseCurrency:"EUR", taxRate:0 };
      return s;
    }catch{}
  }
  // seed mínimo
  return {
    assets: [
      { id: uid(), class:"Liquidez", name:"Conta à ordem", value:12000, incomeType:"none", incomeValue:0, notes:"", favorite:true },
      { id: uid(), class:"ETFs", name:"VWCE", value:25000, incomeType:"div_yield", incomeValue:1.8, notes:"yield %/ano (aprox.)", favorite:true },
      { id: uid(), class:"Cripto", name:"BTC", value:5000, incomeType:"none", incomeValue:0, notes:"exemplo (edita)", favorite:false },
      { id: uid(), class:"Imobiliário", name:"Apartamento", value:180000, incomeType:"rent_month", incomeValue:700, notes:"renda mensal", favorite:true },
    ],
    liabilities: [
      { id: uid(), name:"Crédito habitação", value:120000, notes:"" }
    ],
    history: [],
    transactions: [],
    settings: { baseCurrency:"EUR", taxRate: 0 }
  };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Anti-cache / SW antigo (iOS/GitHub Pages) ---------- */
async function tryUnregisterServiceWorkers(){
  try{
    if ("serviceWorker" in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
  }catch{}
}
async function tryClearCaches(){
  try{
    if (window.caches && caches.keys){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch{}
}

/* ---------- Cálculos ---------- */
function sumAssets(){
  return state.assets.reduce((a,x)=>a + safeNum(x.value,0), 0);
}
function sumLiabilities(){
  return state.liabilities.reduce((a,x)=>a + safeNum(x.value,0), 0);
}
function netWorth(){
  return sumAssets() - sumLiabilities();
}

function passiveAnnualGross(){
  // incomeType:
  // none
  // div_yield: incomeValue = %/ano
  // div_amount_year: incomeValue = €/ano
  // rent_month: incomeValue = €/mês
  // interest_year: incomeValue = €/ano
  let total = 0;
  for (const a of state.assets){
    const v = safeNum(a.value,0);
    const t = a.incomeType || "none";
    const iv = safeNum(a.incomeValue,0);
    if (t === "div_yield") total += v * (iv/100);
    else if (t === "div_amount_year") total += iv;
    else if (t === "rent_month") total += iv * 12;
    else if (t === "interest_year") total += iv;
  }
  return total;
}
function passiveAnnualNet(){
  const gross = passiveAnnualGross();
  const tax = clamp(safeNum(state.settings.taxRate,0), 0, 80) / 100;
  return gross * (1 - tax);
}

function allocByClass(){
  const map = new Map();
  for (const c of DEFAULT_CLASSES) map.set(c.key, 0);
  for (const a of state.assets){
    const k = a.class || "Outros";
    map.set(k, (map.get(k) || 0) + safeNum(a.value,0));
  }
  // filter >0
  const out = [];
  for (const c of DEFAULT_CLASSES){
    const v = map.get(c.key) || 0;
    if (v > 0) out.push({ key:c.key, value:v, color:c.color });
  }
  // any unknown classes
  for (const [k,v] of map.entries()){
    if (!DEFAULT_CLASSES.some(c=>c.key===k) && v>0){
      out.push({ key:k, value:v, color:"#94a3b8" });
    }
  }
  // sort desc
  out.sort((a,b)=>b.value-a.value);
  return out;
}

/* ---------- UI: Tabs ---------- */
function setTab(tab){
  for (const btn of document.querySelectorAll(".tabbtn")){
    btn.classList.toggle("tabbtn--active", btn.dataset.tab === tab);
  }
  const pages = ["dashboard","assets","import","balance","settings"];
  for (const p of pages){
    const sec = el(`page-${p}`);
    if (sec) sec.style.display = (p===tab) ? "" : "none";
  }
  state.ui = state.ui || {};
  state.ui.activeTab = tab;
  saveState();
  if (tab === "dashboard") renderDashboard();
  if (tab === "assets") renderAssets();
  if (tab === "balance") renderBalance();
  if (tab === "settings") renderSettings();
}

document.addEventListener("click", (ev)=>{
  const t = ev.target.closest("[data-tab]");
  if (t){ setTab(t.dataset.tab); }
});

el("btnAddQuick").addEventListener("click", ()=> openAddAssetModal());

/* ---------- Modal helpers ---------- */
function openModal(title, bodyHTML){
  el("modalTitle").textContent = title;
  el("modalBody").innerHTML = bodyHTML;
  el("modal").classList.add("modal--open");
  el("modal").setAttribute("aria-hidden","false");
}
function closeModal(){
  el("modal").classList.remove("modal--open");
  el("modal").setAttribute("aria-hidden","true");
  el("modalBody").innerHTML = "";
}
document.addEventListener("click", (ev)=>{
  const a = ev.target.closest("[data-action]");
  if (!a) return;
  const action = a.dataset.action;
  if (action === "closeModal") closeModal();
  if (action === "openAddAsset") openAddAssetModal();
  if (action === "openAddLiability") openAddLiabilityModal();
  if (action === "snapshotMonth") snapshotMonth();
  if (action === "clearHistory") clearHistory();
  if (action === "goAssets") setTab("assets");
  if (action === "openAddIncome") openTxModal("income");
  if (action === "openAddExpense") openTxModal("expense");
  if (action === "applySalaryTemplate") applySalaryTemplate();
  if (action === "exportJson") exportJson();
  if (action === "importJson") el("fileJson").click();
  if (action === "resetAll") resetAll();
  if (action === "hardRefresh") hardRefresh();
});

el("modal").addEventListener("click",(ev)=>{
  if (ev.target === el("modal")) closeModal();
});

/* ---------- Charts (canvas, sem libs) ---------- */
function clearCanvas(c){
  const ctx = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = c.clientWidth || c.width;
  const cssH = c.clientHeight || c.height;
  c.width = Math.floor(cssW * dpr);
  c.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  return {ctx, w:cssW, h:cssH};
}

function drawDonut(canvas, series){
  const {ctx,w,h} = clearCanvas(canvas);
  ctx.save();
  const cx = w/2, cy = h/2;
  const r = Math.min(w,h)*0.42;
  const thickness = r*0.35;
  const total = series.reduce((a,x)=>a+x.value,0) || 1;
  let ang = -Math.PI/2;
  for (const s of series){
    const frac = s.value/total;
    const a2 = ang + frac*2*Math.PI;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = thickness;
    ctx.lineCap = "butt";
    ctx.arc(cx, cy, r, ang, a2);
    ctx.stroke();
    ang = a2;
  }
  // inner circle
  ctx.beginPath();
  ctx.fillStyle = "rgba(11,18,32,1)";
  ctx.arc(cx, cy, r - thickness/2 - 1, 0, 2*Math.PI);
  ctx.fill();

  // total text
  ctx.fillStyle = "rgba(229,231,235,.92)";
  ctx.font = "800 18px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Ativos", cx, cy-10);
  ctx.fillStyle = "rgba(229,231,235,.98)";
  ctx.font = "900 22px system-ui";
  ctx.fillText(fmtMoney(sumAssets()), cx, cy+16);
  ctx.restore();
}

function drawLine(canvas, points){
  const {ctx,w,h} = clearCanvas(canvas);
  ctx.save();
  // padding
  const padL = 38, padR = 16, padT = 12, padB = 26;
  const x0=padL, x1=w-padR, y0=padT, y1=h-padB;
  ctx.strokeStyle = "rgba(148,163,184,.18)";
  ctx.lineWidth = 1;
  // grid lines
  const lines = 4;
  for (let i=0;i<=lines;i++){
    const y = y0 + (y1-y0)*(i/lines);
    ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
  }

  if (!points || points.length === 0){
    ctx.fillStyle = "rgba(148,163,184,.75)";
    ctx.font = "700 13px system-ui";
    ctx.fillText("Sem histórico. Usa “Registar mês”.", x0, y0+22);
    ctx.restore();
    return;
  }

  const ys = points.map(p=>p.y);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY){ minY -= 1; maxY += 1; }
  const scaleX = (i)=> x0 + (x1-x0)*(i/(points.length-1 || 1));
  const scaleY = (v)=> y1 - (y1-y0)*((v-minY)/(maxY-minY));

  // line
  ctx.beginPath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(34,211,238,.9)";
  points.forEach((p,i)=>{
    const x = scaleX(i);
    const y = scaleY(p.y);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // dots
  for (let i=0;i<points.length;i++){
    const x=scaleX(i), y=scaleY(points[i].y);
    ctx.beginPath();
    ctx.fillStyle="rgba(124,58,237,.95)";
    ctx.arc(x,y,3.5,0,2*Math.PI);
    ctx.fill();
  }

  // labels (min/max)
  ctx.fillStyle = "rgba(148,163,184,.85)";
  ctx.font = "700 12px system-ui";
  ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(fmtMoney(maxY), 6, y0+2);
  ctx.fillText(fmtMoney(minY), 6, y1);

  // x labels (first/last)
  ctx.textAlign="left";
  ctx.fillText(points[0].x, x0, h-10);
  ctx.textAlign="right";
  ctx.fillText(points[points.length-1].x, x1, h-10);

  ctx.restore();
}

/* ---------- Render ---------- */
function renderDashboard(){
  const a = sumAssets();
  const l = sumLiabilities();
  const nw = a - l;
  el("kpiNetWorth").textContent = fmtMoney(nw);
  el("kpiSub").textContent = `Ativos ${fmtMoney(a)} | Passivos ${fmtMoney(l)}`;

  const pY = passiveAnnualNet();
  el("kpiPassiveYear").textContent = fmtMoney(pY);
  el("kpiPassiveMonth").textContent = fmtMoney(pY/12);

  const alloc = allocByClass();
  drawDonut(el("chartAlloc"), alloc);

  // pills
  const total = alloc.reduce((s,x)=>s+x.value,0) || 1;
  el("allocPills").innerHTML = alloc.map(x=>{
    const pct = Math.round((x.value/total)*100);
    return `<div class="pill"><span class="dot" style="background:${x.color}"></span>${escapeHtml(x.key)} <small>${pct}%</small></div>`;
  }).join("");

  // trend
  const pts = state.history
    .slice()
    .sort((a,b)=>a.month.localeCompare(b.month))
    .map(h=>({x:h.month, y:safeNum(h.netWorth,0)}));
  drawLine(el("chartTrend"), pts);

  // top10
  const top = state.assets.slice().sort((a,b)=>safeNum(b.value)-safeNum(a.value)).slice(0,10);
  el("top10List").innerHTML = top.length ? top.map(a=>assetRowHTML(a)).join("") : `<div class="muted">Sem ativos.</div>`;
}

function renderAssets(){
  const mode = el("assetFilter").value;
  let list = state.assets.slice();
  if (mode === "fav") list = list.filter(a=>!!a.favorite);
  list.sort((a,b)=>safeNum(b.value)-safeNum(a.value));
  el("assetsList").innerHTML = list.length ? list.map(a=>assetRowHTML(a,true)).join("") : `<div class="muted">Sem ativos.</div>`;
}
el("assetFilter").addEventListener("change", renderAssets);

function renderBalance(){
  // init month picker to current month if empty
  const inp = el("balanceMonth");
  if (!inp.value){
    const d = new Date();
    const m = String(d.getMonth()+1).padStart(2,"0");
    inp.value = `${d.getFullYear()}-${m}`;
  }
  const mk = inp.value;
  const tx = state.transactions.filter(t=>monthKeyFromDateISO(t.date)===mk);
  const inc = tx.filter(t=>t.kind==="income").reduce((s,t)=>s+safeNum(t.amount),0);
  const out = tx.filter(t=>t.kind==="expense").reduce((s,t)=>s+safeNum(t.amount),0);
  el("kpiIn").textContent = fmtMoney(inc);
  el("kpiOut").textContent = fmtMoney(out);
  el("kpiNet").textContent = fmtMoney(inc - out);

  tx.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  el("txList").innerHTML = tx.length ? tx.map(t=>txRowHTML(t)).join("") : `<div class="muted">Sem movimentos neste mês.</div>`;
}
el("balanceMonth").addEventListener("change", renderBalance);

function renderSettings(){
  el("baseCurrency").value = state.settings.baseCurrency || "EUR";
  el("taxRate").value = (state.settings.taxRate ?? 0);
}

el("baseCurrency").addEventListener("change", ()=>{
  state.settings.baseCurrency = el("baseCurrency").value;
  saveState();
  rerenderAll();
});
el("taxRate").addEventListener("input", ()=>{
  state.settings.taxRate = safeNum(el("taxRate").value,0);
  saveState();
  rerenderAll();
});

function rerenderAll(){
  const tab = (state.ui && state.ui.activeTab) || "dashboard";
  if (tab === "dashboard") renderDashboard();
  if (tab === "assets") renderAssets();
  if (tab === "balance") renderBalance();
  if (tab === "settings") renderSettings();
}

/* ---------- HTML helpers ---------- */
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function assetRowHTML(a, editable=false){
  const cls = escapeHtml(a.class || "Outros");
  const nm = escapeHtml(a.name || "");
  const val = fmtMoney(safeNum(a.value));
  const fav = a.favorite ? "★" : "☆";
  const tag = `<span class="tag"><span class="dot"></span>${cls}</span>`;
  const sub = (a.notes && String(a.notes).trim()) ? escapeHtml(a.notes) : cls;
  const data = editable ? `data-edit-asset="${a.id}"` : "";
  return `
    <div class="item" ${data}>
      <div class="item__l">
        <div class="item__title">${nm}</div>
        <div class="item__sub">${sub}</div>
      </div>
      <div class="item__r">
        <div class="item__val">${val}</div>
        <div class="tag" style="margin-top:8px">${fav} ${cls}</div>
      </div>
    </div>
  `;
}

function txRowHTML(t){
  const d = escapeHtml(t.date||"");
  const desc = escapeHtml(t.description||"");
  const cat = escapeHtml(t.category||"");
  const kind = t.kind==="income" ? "Entrada" : "Despesa";
  const amt = fmtMoney(safeNum(t.amount));
  return `
    <div class="item" data-edit-tx="${t.id}">
      <div class="item__l">
        <div class="item__title">${kind}: ${desc || cat}</div>
        <div class="item__sub">${d} • ${cat}</div>
      </div>
      <div class="item__r">
        <div class="item__val">${amt}</div>
      </div>
    </div>
  `;
}

/* ---------- CRUD modals ---------- */
function openAddAssetModal(existingId=null){
  const a = existingId ? state.assets.find(x=>x.id===existingId) : null;
  const title = existingId ? "Editar ativo" : "Adicionar ativo";
  const classOptions = DEFAULT_CLASSES.map(c=>`<option value="${escapeHtml(c.key)}">${escapeHtml(c.key)}</option>`).join("");
  openModal(title, `
    <div class="field">
      <label>Classe</label>
      <select id="m_class">${classOptions}</select>
    </div>
    <div class="field">
      <label>Nome</label>
      <input id="m_name" placeholder="ex: VWCE, Apartamento, Conta, BTC">
    </div>
    <div class="field">
      <label>Valor (${escapeHtml(state.settings.baseCurrency||"EUR")})</label>
      <input id="m_value" inputmode="decimal" placeholder="ex: 25000">
    </div>

    <div class="field">
      <label>Tipo de rendimento</label>
      <select id="m_incomeType">
        <option value="none">Sem</option>
        <option value="div_yield">Dividend yield (%/ano)</option>
        <option value="div_amount_year">Dividendos fixos (€/ano)</option>
        <option value="rent_month">Renda (€/mês)</option>
        <option value="interest_year">Juros (€/ano)</option>
      </select>
    </div>
    <div class="field">
      <label>Valor do rendimento (depende do tipo)</label>
      <input id="m_incomeValue" inputmode="decimal" placeholder="ex: 1.8 (yield) ou 700 (renda)">
    </div>

    <div class="field">
      <label>Notas</label>
      <textarea id="m_notes" placeholder="opcional"></textarea>
    </div>

    <div class="field">
      <label><input type="checkbox" id="m_fav"> Favorito</label>
    </div>

    <div class="actions">
      <button class="btn" data-action="saveAsset">${existingId ? "Guardar" : "Adicionar"}</button>
      ${existingId ? `<button class="btn btn--ghost" data-action="deleteAsset">Apagar</button>` : ``}
    </div>
  `);

  // seed values
  if (a){
    el("m_class").value = a.class || "Outros";
    el("m_name").value = a.name || "";
    el("m_value").value = a.value ?? "";
    el("m_incomeType").value = a.incomeType || "none";
    el("m_incomeValue").value = a.incomeValue ?? "";
    el("m_notes").value = a.notes || "";
    el("m_fav").checked = !!a.favorite;
  }else{
    el("m_class").value = "Liquidez";
  }

  // bind save/delete (one-shot via delegation)
  document.addEventListener("click", function handler(ev){
    const act = ev.target.closest("[data-action]");
    if (!act) return;
    if (act.dataset.action === "saveAsset"){
      const obj = {
        id: a ? a.id : uid(),
        class: el("m_class").value,
        name: el("m_name").value.trim(),
        value: safeNum(el("m_value").value,0),
        incomeType: el("m_incomeType").value,
        incomeValue: safeNum(el("m_incomeValue").value,0),
        notes: el("m_notes").value.trim(),
        favorite: el("m_fav").checked
      };
      if (!obj.name){ alert("Nome em falta."); return; }
      if (a){
        const idx = state.assets.findIndex(x=>x.id===a.id);
        if (idx>=0) state.assets[idx]=obj;
      }else{
        state.assets.push(obj);
      }
      saveState();
      closeModal();
      rerenderAll();
      document.removeEventListener("click", handler, true);
    }
    if (act.dataset.action === "deleteAsset" && a){
      if (confirm("Apagar este ativo?")){
        state.assets = state.assets.filter(x=>x.id!==a.id);
        saveState();
        closeModal();
        rerenderAll();
        document.removeEventListener("click", handler, true);
      }
    }
  }, true);
}

function openAddLiabilityModal(existingId=null){
  const l = existingId ? state.liabilities.find(x=>x.id===existingId) : null;
  const title = existingId ? "Editar passivo" : "Adicionar passivo";
  openModal(title, `
    <div class="field">
      <label>Nome</label>
      <input id="m_l_name" placeholder="ex: Crédito habitação">
    </div>
    <div class="field">
      <label>Valor em dívida (${escapeHtml(state.settings.baseCurrency||"EUR")})</label>
      <input id="m_l_value" inputmode="decimal" placeholder="ex: 120000">
    </div>
    <div class="field">
      <label>Notas</label>
      <textarea id="m_l_notes" placeholder="opcional"></textarea>
    </div>
    <div class="actions">
      <button class="btn" data-action="saveLiability">${existingId ? "Guardar" : "Adicionar"}</button>
      ${existingId ? `<button class="btn btn--ghost" data-action="deleteLiability">Apagar</button>` : ``}
    </div>
  `);
  if (l){
    el("m_l_name").value = l.name || "";
    el("m_l_value").value = l.value ?? "";
    el("m_l_notes").value = l.notes || "";
  }

  document.addEventListener("click", function handler(ev){
    const act = ev.target.closest("[data-action]");
    if (!act) return;
    if (act.dataset.action === "saveLiability"){
      const obj = {
        id: l ? l.id : uid(),
        name: el("m_l_name").value.trim(),
        value: safeNum(el("m_l_value").value,0),
        notes: el("m_l_notes").value.trim()
      };
      if (!obj.name){ alert("Nome em falta."); return; }
      if (l){
        const idx = state.liabilities.findIndex(x=>x.id===l.id);
        if (idx>=0) state.liabilities[idx]=obj;
      }else{
        state.liabilities.push(obj);
      }
      saveState();
      closeModal();
      rerenderAll();
      document.removeEventListener("click", handler, true);
    }
    if (act.dataset.action === "deleteLiability" && l){
      if (confirm("Apagar este passivo?")){
        state.liabilities = state.liabilities.filter(x=>x.id!==l.id);
        saveState();
        closeModal();
        rerenderAll();
        document.removeEventListener("click", handler, true);
      }
    }
  }, true);
}

function openTxModal(kind, existingId=null){
  const t = existingId ? state.transactions.find(x=>x.id===existingId) : null;
  const title = t ? "Editar movimento" : (kind==="income" ? "Adicionar entrada" : "Adicionar despesa");
  const today = fmtDateISO(new Date());
  openModal(title, `
    <div class="field">
      <label>Data</label>
      <input id="m_t_date" type="date">
    </div>
    <div class="field">
      <label>Categoria</label>
      <input id="m_t_cat" placeholder="ex: Salário, Renda, Supermercado, Escola">
    </div>
    <div class="field">
      <label>Descrição</label>
      <input id="m_t_desc" placeholder="opcional">
    </div>
    <div class="field">
      <label>Valor (${escapeHtml(state.settings.baseCurrency||"EUR")})</label>
      <input id="m_t_amt" inputmode="decimal" placeholder="ex: 2500">
    </div>
    <div class="actions">
      <button class="btn" data-action="saveTx">${t ? "Guardar" : "Adicionar"}</button>
      ${t ? `<button class="btn btn--ghost" data-action="deleteTx">Apagar</button>` : ``}
    </div>
  `);

  if (t){
    el("m_t_date").value = t.date || today;
    el("m_t_cat").value = t.category || "";
    el("m_t_desc").value = t.description || "";
    el("m_t_amt").value = t.amount ?? "";
  }else{
    el("m_t_date").value = today;
  }

  document.addEventListener("click", function handler(ev){
    const act = ev.target.closest("[data-action]");
    if (!act) return;
    if (act.dataset.action === "saveTx"){
      const obj = {
        id: t ? t.id : uid(),
        date: el("m_t_date").value,
        kind: t ? t.kind : kind,
        category: el("m_t_cat").value.trim(),
        description: el("m_t_desc").value.trim(),
        amount: safeNum(el("m_t_amt").value,0)
      };
      if (!obj.date){ alert("Data em falta."); return; }
      if (!obj.category){ alert("Categoria em falta."); return; }
      if (t){
        const idx = state.transactions.findIndex(x=>x.id===t.id);
        if (idx>=0) state.transactions[idx]=obj;
      }else{
        state.transactions.push(obj);
      }
      saveState();
      closeModal();
      renderBalance();
      document.removeEventListener("click", handler, true);
    }
    if (act.dataset.action === "deleteTx" && t){
      if (confirm("Apagar este movimento?")){
        state.transactions = state.transactions.filter(x=>x.id!==t.id);
        saveState();
        closeModal();
        renderBalance();
        document.removeEventListener("click", handler, true);
      }
    }
  }, true);
}

/* ---------- Edit on tap ---------- */
document.addEventListener("click",(ev)=>{
  const a = ev.target.closest("[data-edit-asset]");
  if (a) openAddAssetModal(a.dataset.editAsset);
  const t = ev.target.closest("[data-edit-tx]");
  if (t) openTxModal("income", t.dataset.editTx);
});

/* ---------- History snapshots ---------- */
function snapshotMonth(){
  // key month = current balanceMonth if set else current
  let mk = el("balanceMonth")?.value;
  if (!mk){
    const d=new Date(); mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }
  const snap = {
    month: mk,
    netWorth: netWorth(),
    assets: sumAssets(),
    liabilities: sumLiabilities(),
    passiveNet: passiveAnnualNet()
  };
  // replace existing for month
  state.history = state.history.filter(h=>h.month!==mk);
  state.history.push(snap);
  saveState();
  renderDashboard();
}

function clearHistory(){
  if (!confirm("Apagar histórico (snapshots)?")) return;
  state.history = [];
  saveState();
  renderDashboard();
}

/* ---------- Templates ---------- */
function applySalaryTemplate(){
  const mk = el("balanceMonth").value;
  if (!mk){ alert("Escolhe o mês."); return; }
  const year = mk.slice(0,4);
  const month = mk.slice(5,7);
  // default on day 1
  const date = `${year}-${month}-01`;
  // add or update two salary entries
  const templates = [
    { kind:"income", category:"Salário Pedro", description:"Salário (variável)", amount:0 },
    { kind:"income", category:"Salário Cônjuge", description:"Salário (variável)", amount:0 },
  ];
  for (const tpl of templates){
    // find existing same month + category
    const existing = state.transactions.find(t=>monthKeyFromDateISO(t.date)===mk && t.kind===tpl.kind && t.category===tpl.category);
    if (existing){
      // keep amount
      existing.date = existing.date || date;
      existing.description = existing.description || tpl.description;
    }else{
      state.transactions.push({ id:uid(), date, ...tpl });
    }
  }
  saveState();
  renderBalance();
  alert("Templates adicionados. Edita os valores (toque no movimento).");
}

/* ---------- Import / Export ---------- */
function exportJson(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `patrimonio-familiar-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

el("fileJson").addEventListener("change", async ()=>{
  const f = el("fileJson").files[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const s = JSON.parse(txt);
    if (!s || typeof s !== "object") throw new Error("JSON inválido");
    if (!confirm("Importar este backup vai substituir os dados locais. Continuar?")) return;
    // basic validate + defaults
    state.assets = Array.isArray(s.assets) ? s.assets : [];
    state.liabilities = Array.isArray(s.liabilities) ? s.liabilities : [];
    state.history = Array.isArray(s.history) ? s.history : [];
    state.transactions = Array.isArray(s.transactions) ? s.transactions : [];
    state.settings = s.settings || { baseCurrency:"EUR", taxRate:0 };
    saveState();
    closeModal();
    rerenderAll();
    setTab("dashboard");
  }catch(e){
    alert("Falha ao importar JSON: " + (e.message || e));
  }finally{
    el("fileJson").value = "";
  }
});

function parseCSV(text){
  // parser simples (suporta aspas)
  const rows = [];
  let i=0, cur="", inQ=false;
  const pushCell = (row)=>{ row.push(cur); cur=""; };
  let row=[];
  while (i<text.length){
    const ch=text[i];
    if (ch === '"'){
      if (inQ && text[i+1] === '"'){ cur+='"'; i++; }
      else inQ=!inQ;
    }else if (ch === "," && !inQ){
      pushCell(row);
    }else if ((ch === "\n" || ch === "\r") && !inQ){
      if (ch === "\r" && text[i+1]==="\n") i++;
      pushCell(row);
      if (row.some(c=>c!=="" )) rows.push(row);
      row=[];
    }else{
      cur+=ch;
    }
    i++;
  }
  pushCell(row);
  if (row.some(c=>c!=="" )) rows.push(row);
  return rows;
}

function csvToObjects(text){
  const rows = parseCSV(text.trim());
  if (rows.length < 2) return [];
  const head = rows[0].map(h=>String(h).trim());
  return rows.slice(1).map(r=>{
    const obj={};
    head.forEach((h,idx)=> obj[h]= (r[idx] ?? "").trim());
    return obj;
  });
}

el("fileAssetsCsv").addEventListener("change", async ()=>{
  const f = el("fileAssetsCsv").files[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const objs = csvToObjects(txt);
    if (!objs.length) throw new Error("CSV vazio");
    // merge by name+class, else add
    for (const o of objs){
      const obj = {
        id: uid(),
        class: o.class || "Outros",
        name: (o.name||"").trim(),
        value: safeNum(o.value,0),
        incomeType: (o.incomeType||"none").trim(),
        incomeValue: safeNum(o.incomeValue,0),
        notes: (o.notes||"").trim(),
        favorite: String(o.favorite||"").toLowerCase() === "true"
      };
      if (!obj.name) continue;
      state.assets.push(obj);
    }
    saveState();
    rerenderAll();
    alert("Importação de ativos concluída.");
  }catch(e){
    alert("Falha ao importar CSV de ativos: " + (e.message||e));
  }finally{
    el("fileAssetsCsv").value = "";
  }
});

el("fileTxCsv").addEventListener("change", async ()=>{
  const f = el("fileTxCsv").files[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const objs = csvToObjects(txt);
    if (!objs.length) throw new Error("CSV vazio");
    for (const o of objs){
      const kind = (o.kind||"").trim();
      if (!["income","expense"].includes(kind)) continue;
      const obj = {
        id: uid(),
        date: (o.date||"").trim(),
        kind,
        category: (o.category||"").trim(),
        description: (o.description||"").trim(),
        amount: safeNum(o.amount,0),
      };
      if (!obj.date || !obj.category) continue;
      state.transactions.push(obj);
    }
    saveState();
    renderBalance();
    alert("Importação de movimentos concluída.");
  }catch(e){
    alert("Falha ao importar CSV de movimentos: " + (e.message||e));
  }finally{
    el("fileTxCsv").value = "";
  }
});

/* ---------- Reset / Refresh ---------- */
function resetAll(){
  if (!confirm("Isto vai apagar todos os dados locais. Continuar?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  saveState();
  location.reload();
}

async function hardRefresh(){
  // remove SW + caches + reload
  await tryUnregisterServiceWorkers();
  await tryClearCaches();
  // force cache-bust
  const u = new URL(location.href);
  u.searchParams.set("v", String(Date.now()));
  location.replace(u.toString());
}

/* ---------- Init ---------- */
let state = loadState();
saveState();

(async ()=>{
  // Evita que SW antigos “prendam” builds no iOS
  await tryUnregisterServiceWorkers();
  // UI init
  // default month picker
  const d = new Date();
  el("balanceMonth").value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

  // initial render
  renderDashboard();
  renderAssets();
  renderBalance();
  renderSettings();

  const tab = (state.ui && state.ui.activeTab) || "dashboard";
  setTab(tab);
})();
