// Património Familiar — app.js (offline-first, vanilla JS)
// Libs: Chart.js (alloc + trend) | SheetJS (XLSX/CSV import)

const STORAGE_KEY = "PF_STATE_V1";

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

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try{
      const s = JSON.parse(raw);
      // harden defaults
      s.assets = Array.isArray(s.assets) ? s.assets : [];
      s.liabilities = Array.isArray(s.liabilities) ? s.liabilities : [];
      s.history = Array.isArray(s.history) ? s.history : [];
      s.settings = s.settings || { baseCurrency:"EUR", taxRate: 0 };
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
    settings: { baseCurrency: "EUR", taxRate: 0 },
  };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function allocationByClass(){
  const map = new Map();
  for (const a of state.assets){
    const cls = a.class || "Outros";
    const v = Number(a.value) || 0;
    map.set(cls, (map.get(cls) || 0) + v);
  }
  // sort desc
  return Array.from(map.entries()).sort((x,y) => y[1]-x[1]).map(([cls,val]) => ({
    cls, val, color: getClassColor(cls)
  }));
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
    Settings: "viewSettings"
  };
  Object.values(views).forEach(id => el(id).classList.remove("view--active"));
  el(views[name]).classList.add("view--active");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("tab--active"));
  document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("tab--active");

  if (name === "Dashboard") renderDashboard();
  if (name === "Assets") renderAssets();
  if (name === "Settings") renderSettings();
}

function renderDashboard(){
  const t = computeTotals();
  el("netWorth").textContent = fmtMoney(t.netWorth);
  el("netWorthSub").textContent = `Ativos ${fmtMoney(t.assetsTotal)}  |  Passivos ${fmtMoney(t.liabTotal)}`;
  el("passiveAnnual").textContent = fmtMoney(t.passiveNet);
  el("passiveMonthly").textContent = fmtMoney(t.passiveNet/12);

  renderAllocationChart();
  renderNetWorthChart();
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
  const alloc = allocationByClass();
  const total = alloc.reduce((a,x)=>a+x.val,0) || 1;

  // vertical bar segments
  const bar = el("distBar");
  bar.innerHTML = "";
  for (const seg of alloc){
    const h = Math.max(1, Math.round((seg.val/total)*1000)/10); // one decimal
    const s = document.createElement("div");
    s.className = "dist__seg";
    s.style.height = `${h}%`;
    s.style.background = seg.color;
    bar.appendChild(s);
  }

  // legend pills
  const legend = el("allocLegend");
  legend.innerHTML = "";
  for (const seg of alloc){
    const pct = (seg.val/total)*100;
    const item = document.createElement("div");
    item.className = "legend__item";
    item.innerHTML = `<span class="legend__dot" style="background:${seg.color}"></span>
      <span>${escapeHtml(seg.cls)}</span>
      <span style="color:rgba(168,179,207,.85)">${pct.toFixed(0)}%</span>`;
    legend.appendChild(item);
  }

  // donut chart
  const ctx = el("chartAlloc");
  const labels = alloc.map(x => x.cls);
  const data = alloc.map(x => x.val);
  const colors = alloc.map(x => x.color);

  if (chartAlloc) chartAlloc.destroy();
  chartAlloc = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]},
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (c) => ` ${c.label}: ${fmtMoney(c.raw)} ` }
        }
      },
      cutout: "68%"
    }
  });
}

function renderNetWorthChart(){
  const ctx = el("chartNetWorth");
  const points = (state.history || []).slice().sort((a,b)=> (a.ts||0)-(b.ts||0));

  const labels = points.map(p => (p.date || "").slice(0,10));
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

function renderAssets(){
  // fill class filter
  const classes = Array.from(new Set(state.assets.map(a => a.class).filter(Boolean))).sort();
  const sel = el("fClass");
  sel.innerHTML = `<option value="">Todas as classes</option>` + classes.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  drawLists();
  // handlers
  el("qAssets").oninput = drawLists;
  sel.onchange = drawLists;
}

function drawLists(){
  const q = (el("qAssets").value || "").trim().toLowerCase();
  const f = el("fClass").value || "";

  const listA = el("assetsList");
  listA.innerHTML = "";
  const items = state.assets.filter(a => {
    const hit = (a.name||"").toLowerCase().includes(q) || (a.class||"").toLowerCase().includes(q);
    const ok = !f || a.class === f;
    return hit && ok;
  }).sort((a,b) => (Number(b.value)||0)-(Number(a.value)||0));

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
  el("btnAddAsset").addEventListener("click", () => openCreate("asset"));
  el("btnAddLiab").addEventListener("click", () => openCreate("liability"));
  el("btnAddQuick").addEventListener("click", () => openCreate("asset"));

  el("btnAddSnapshot").addEventListener("click", () => {
    const t = computeTotals();
    const now = new Date();
    const date = now.toISOString().slice(0,10);
    state.history.push({ ts: now.getTime(), date, netWorth: t.netWorth });
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
    closeModal();
    renderDashboard();
    renderAssets();
  });
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

// ===== Init =====
function init(){
  setupNav();
  setupButtons();
  setupModal();
  setupSW();
  setActiveView("Dashboard");
}

document.addEventListener("DOMContentLoaded", init);
