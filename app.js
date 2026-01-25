// Património Familiar v0.2
// Armazenamento: LocalStorage (browser)
// Modelo: Percento-like (Ativos reais + Investimentos + Despesas + Rendimentos + Dashboard agregado)

const STORAGE_KEY = "pf_data_v02";

const defaultState = {
  settings: { baseCcy: "EUR", decimals: 2 },
  assets: [],
  investments: [],
  expenses: [],
  income: []
};

let state = loadState();

// ---------- UTIL ----------
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return mergeDefaults(parsed, defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function mergeDefaults(obj, defaults) {
  const out = structuredClone(defaults);
  for (const k of Object.keys(defaults)) {
    if (obj && typeof obj === "object" && k in obj) {
      if (Array.isArray(defaults[k])) out[k] = Array.isArray(obj[k]) ? obj[k] : defaults[k];
      else if (typeof defaults[k] === "object") out[k] = mergeDefaults(obj[k], defaults[k]);
      else out[k] = obj[k];
    }
  }
  return out;
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fmtEUR(n) {
  const d = Number(state.settings.decimals ?? 2);
  const x = Number(n || 0);
  return x.toLocaleString("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d });
}

function sum(arr, pick) {
  return arr.reduce((acc, it) => acc + Number(pick(it) || 0), 0);
}

// ---------- NAV ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.dataset.tab;
    document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
    renderAll();
  });
});

// ---------- FORMS ----------
document.getElementById("formAsset").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    id: uid(),
    type: val("assetType"),
    name: val("assetName"),
    value: num("assetValue"),
    qty: num("assetQty"),
    unit: val("assetUnit"),
    notes: val("assetNotes")
  };
  state.assets.unshift(item);
  saveState();
  e.target.reset();
  renderAll();
});

document.getElementById("formInvestment").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    id: uid(),
    class: val("invClass"),
    symbol: val("invSymbol").toUpperCase().trim(),
    qty: num("invQty"),
    avgPrice: num("invAvgPrice"),
    ccy: val("invCcy"),
    notes: val("invNotes")
  };
  state.investments.unshift(item);
  saveState();
  e.target.reset();
  renderAll();
});

document.getElementById("formExpense").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    id: uid(),
    category: val("expCategory"),
    name: val("expName"),
    value: num("expValue"),
    type: val("expType"),
    notes: val("expNotes")
  };
  state.expenses.unshift(item);
  saveState();
  e.target.reset();
  renderAll();
});

document.getElementById("formIncome").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    id: uid(),
    category: val("incCategory"),
    name: val("incName"),
    value: num("incValue"),
    notes: val("incNotes")
  };
  state.income.unshift(item);
  saveState();
  e.target.reset();
  renderAll();
});

// ---------- SETTINGS ----------
document.getElementById("btnSaveSettings").addEventListener("click", (e) => {
  e.preventDefault();
  state.settings.baseCcy = val("baseCcy");
  state.settings.decimals = Number(val("decimals"));
  saveState();
  renderAll();
});

// ---------- EXPORT / IMPORT / RESET ----------
document.getElementById("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "patrimonio-familiar-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("fileImport").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    state = mergeDefaults(imported, defaultState);
    saveState();
    renderAll();
    alert("Importação concluída.");
  } catch {
    alert("Ficheiro inválido.");
  } finally {
    e.target.value = "";
  }
});

document.getElementById("btnReset").addEventListener("click", () => {
  const ok = confirm("Isto apaga os dados locais deste browser. Confirmar?");
  if (!ok) return;
  state = structuredClone(defaultState);
  saveState();
  renderAll();
});

// ---------- RENDER ----------
function renderAll() {
  // settings UI
  document.getElementById("baseCcy").value = state.settings.baseCcy;
  document.getElementById("decimals").value = String(state.settings.decimals ?? 2);

  renderTables();
  renderKPIs();
  renderQuickBreakdown();
}

function renderKPIs() {
  const assetsReal = sum(state.assets, x => x.value);
  const investmentsCost = sum(state.investments, x => (x.qty * x.avgPrice)); // até termos preços live
  const totalAssets = assetsReal + investmentsCost;

  const monthlyExpenses = sum(state.expenses, x => x.value);
  const monthlyIncome = sum(state.income, x => x.value);

  // Nesta fase, tratamos "passivos" como despesas mensais fixas+variáveis.
  // Mais tarde adicionamos "passivos de balanço" (principal em dívida, etc.)
  const liabilities = monthlyExpenses;

  const netWorth = totalAssets - 0; // passivos de balanço entram numa fase posterior
  const cashflow = monthlyIncome - monthlyExpenses;

  setText("kpiAssets", fmtEUR(totalAssets));
  setText("kpiLiabilities", fmtEUR(liabilities));
  setText("kpiNetWorth", fmtEUR(netWorth));
  setText("kpiCashflow", fmtEUR(cashflow));
}

function renderQuickBreakdown() {
  const el = document.getElementById("quickBreakdown");
  el.innerHTML = "";

  const a = sum(state.assets, x => x.value);
  const i = sum(state.investments, x => (x.qty * x.avgPrice));
  const e = sum(state.expenses, x => x.value);
  const inc = sum(state.income, x => x.value);

  el.appendChild(row("Património (real)", fmtEUR(a)));
  el.appendChild(row("Investimentos (custo)", fmtEUR(i)));
  el.appendChild(row("Rendimentos (mensal)", fmtEUR(inc)));
  el.appendChild(row("Despesas (mensal)", fmtEUR(e)));
}

function renderTables() {
  // assets
  document.getElementById("assetsTable").innerHTML = table(
    ["Tipo", "Nome", "Qtd", "Valor", ""],
    state.assets,
    (it) => [
      esc(it.type),
      esc(it.name),
      it.qty ? `${it.qty}${it.unit ? " " + esc(it.unit) : ""}` : "—",
      fmtEUR(it.value),
      actionCell(() => del("assets", it.id))
    ]
  );

  // investments
  document.getElementById("investmentsTable").innerHTML = table(
    ["Classe", "Símbolo", "Qtd", "Preço médio", "Valor (custo)", ""],
    state.investments,
    (it) => [
      esc(it.class),
      esc(it.symbol),
      numFmt(it.qty),
      numFmt(it.avgPrice),
      fmtEUR(it.qty * it.avgPrice),
      actionCell(() => del("investments", it.id))
    ]
  );

  // expenses
  document.getElementById("expensesTable").innerHTML = table(
    ["Categoria", "Descrição", "Tipo", "Mensal", ""],
    state.expenses,
    (it) => [
      esc(it.category),
      esc(it.name),
      esc(it.type),
      fmtEUR(it.value),
      actionCell(() => del("expenses", it.id))
    ]
  );

  // income
  document.getElementById("incomeTable").innerHTML = table(
    ["Fonte", "Descrição", "Mensal", ""],
    state.income,
    (it) => [
      esc(it.category),
      esc(it.name),
      fmtEUR(it.value),
      actionCell(() => del("income", it.id))
    ]
  );
}

function del(bucket, id) {
  const ok = confirm("Remover este item?");
  if (!ok) return;
  state[bucket] = state[bucket].filter(x => x.id !== id);
  saveState();
  renderAll();
}

// ---------- UI HELPERS ----------
function val(id){ return document.getElementById(id).value ?? ""; }
function num(id){ return Number(document.getElementById(id).value || 0); }
function setText(id, v){ document.getElementById(id).textContent = v; }

function row(left, right){
  const d = document.createElement("div");
  d.className = "row";
  d.innerHTML = `<span>${esc(left)}</span><strong>${esc(right)}</strong>`;
  return d;
}

function table(headers, rows, mapRow){
  const h = headers.map(x => `<th>${esc(x)}</th>`).join("");
  const b = rows.map(r => {
    const cols = mapRow(r).map((c, i) => `<td class="${i===headers.length-1 ? "actions-cell": ""}">${c}</td>`).join("");
    return `<tr>${cols}</tr>`;
  }).join("");

  if (!rows.length) return `<div class="muted">Sem registos.</div>`;

  return `
    <table class="table">
      <thead><tr>${h}</tr></thead>
      <tbody>${b}</tbody>
    </table>
  `;
}

function actionCell(onDelete){
  // cria um botão inline com handler por data-id (simplificado)
  const id = uid();
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", onDelete);
  }, 0);
  return `<button class="small-btn danger" id="${id}">Apagar</button>`;
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function numFmt(x){
  const d = Number(state.settings.decimals ?? 2);
  const n = Number(x || 0);
  return n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

// init
renderAll();
