// Património Familiar v0.3
// - LocalStorage
// - Tabs
// - Património / Investimentos / Despesas / Rendimentos
// - Cripto LIVE via CoinGecko (EUR) + Market Value + P&L

const STORAGE_KEY = "pf_data_v03";

const defaultState = {
  settings: { baseCcy: "EUR", decimals: 2 },
  assets: [],
  investments: [],
  expenses: [],
  income: []
};

let state = loadState();

// ---------------- UTIL ----------------
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

function val(id){ return document.getElementById(id)?.value ?? ""; }
function num(id){ return Number(document.getElementById(id)?.value || 0); }

function setText(id, v){
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function fmtEUR(n) {
  const d = Number(state.settings.decimals ?? 2);
  const x = Number(n || 0);
  return x.toLocaleString("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d });
}

function numFmt(x){
  const d = Number(state.settings.decimals ?? 2);
  const n = Number(x || 0);
  return n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: Math.max(2, d) });
}

function sum(arr, pick) {
  return arr.reduce((acc, it) => acc + Number(pick(it) || 0), 0);
}

// ---------------- NAV (tabs) ----------------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.dataset.tab;
    document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
    document.getElementById(id)?.classList.remove("hidden");
    renderAll();
  });
});

// ---------------- FORMS ----------------
document.getElementById("formAsset")?.addEventListener("submit", (e) => {
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

document.getElementById("formInvestment")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    id: uid(),
    class: val("invClass"),
    symbol: val("invSymbol").toUpperCase().trim(),
    qty: num("invQty"),
    avgPrice: num("invAvgPrice"),
    ccy: val("invCcy"),
    notes: val("invNotes"),

    // live fields (preenchidos quando actualizas preços)
    marketPrice: null,
    marketValue: null,
    pnl: null,
    pnlPct: null,
    lastUpdated: null
  };
  state.investments.unshift(item);
  saveState();
  e.target.reset();
  renderAll();
});

document.getElementById("formExpense")?.addEventListener("submit", (e) => {
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

document.getElementById("formIncome")?.addEventListener("submit", (e) => {
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

// ---------------- SETTINGS ----------------
document.getElementById("btnSaveSettings")?.addEventListener("click", (e) => {
  e.preventDefault();
  state.settings.baseCcy = val("baseCcy") || "EUR";
  state.settings.decimals = Number(val("decimals") || 2);
  saveState();
  renderAll();
});

// ---------------- EXPORT / IMPORT / RESET ----------------
document.getElementById("btnExport")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "patrimonio-familiar-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("fileImport")?.addEventListener("change", async (e) => {
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

document.getElementById("btnReset")?.addEventListener("click", () => {
  const ok = confirm("Isto apaga os dados locais deste browser. Confirmar?");
  if (!ok) return;
  state = structuredClone(defaultState);
  saveState();
  renderAll();
});

// ---------------- TABLE RENDER ----------------
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
  const id = uid();
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", onDelete);
  }, 0);
  return `<button class="small-btn danger" id="${id}">Apagar</button>`;
}

function del(bucket, id) {
  const ok = confirm("Remover este item?");
  if (!ok) return;
  state[bucket] = state[bucket].filter(x => x.id !== id);
  saveState();
  renderAll();
}

function row(left, right){
  const d = document.createElement("div");
  d.className = "row";
  d.innerHTML = `<span>${esc(left)}</span><strong>${esc(right)}</strong>`;
  return d;
}

// ---------------- DASHBOARD / KPI ----------------
function renderKPIs() {
  const assetsReal = sum(state.assets, x => x.value);

  // investimentos: se tiver marketValue usa, senão usa custo
  const invValue = sum(state.investments, x => {
    const mv = Number(x.marketValue);
    if (!Number.isNaN(mv) && mv > 0) return mv;
    return Number(x.qty || 0) * Number(x.avgPrice || 0);
  });

  const totalAssets = assetsReal + invValue;

  const monthlyExpenses = sum(state.expenses, x => x.value);
  const monthlyIncome = sum(state.income, x => x.value);

  const netWorth = totalAssets; // passivos de balanço entram numa fase posterior
  const cashflow = monthlyIncome - monthlyExpenses;

  setText("kpiAssets", fmtEUR(totalAssets));
  setText("kpiLiabilities", fmtEUR(monthlyExpenses));
  setText("kpiNetWorth", fmtEUR(netWorth));
  setText("kpiCashflow", fmtEUR(cashflow));
}

function renderQuickBreakdown() {
  const el = document.getElementById("quickBreakdown");
  if (!el) return;
  el.innerHTML = "";

  const a = sum(state.assets, x => x.value);
  const i = sum(state.investments, x => {
    const mv = Number(x.marketValue);
    if (!Number.isNaN(mv) && mv > 0) return mv;
    return Number(x.qty || 0) * Number(x.avgPrice || 0);
  });
  const e = sum(state.expenses, x => x.value);
  const inc = sum(state.income, x => x.value);

  el.appendChild(row("Património (real)", fmtEUR(a)));
  el.appendChild(row("Investimentos (valor)", fmtEUR(i)));
  el.appendChild(row("Rendimentos (mensal)", fmtEUR(inc)));
  el.appendChild(row("Despesas (mensal)", fmtEUR(e)));
}

function renderTables() {
  // assets
  const assetsEl = document.getElementById("assetsTable");
  if (assetsEl) {
    assetsEl.innerHTML = table(
      ["Tipo", "Nome", "Qtd", "Valor", ""],
      state.assets,
      (it) => [
        esc(it.type),
        esc(it.name),
        it.qty ? `${numFmt(it.qty)}${it.unit ? " " + esc(it.unit) : ""}` : "—",
        fmtEUR(it.value),
        actionCell(() => del("assets", it.id))
      ]
    );
  }

  // investments (com market value)
  const invEl = document.getElementById("investmentsTable");
  if (invEl) {
    invEl.innerHTML = table(
      ["Classe", "Símbolo", "Qtd", "Preço médio", "Preço actual", "Valor mercado", "P&L", ""],
      state.investments,
      (it) => {
        const cost = Number(it.qty || 0) * Number(it.avgPrice || 0);
        const hasLive = typeof it.marketPrice === "number" && typeof it.marketValue === "number";
        const pnlTxt = hasLive
          ? `${fmtEUR(it.pnl)} (${Number(it.pnlPct || 0).toFixed(1)}%)`
          : "—";

        return [
          esc(it.class),
          esc(it.symbol),
          numFmt(it.qty),
          fmtEUR(it.avgPrice),
          hasLive ? fmtEUR(it.marketPrice) : "—",
          hasLive ? fmtEUR(it.marketValue) : "—",
          pnlTxt,
          actionCell(() => del("investments", it.id))
        ];
      }
    );
  }

  // expenses
  const expEl = document.getElementById("expensesTable");
  if (expEl) {
    expEl.innerHTML = table(
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
  }

  // income
  const incEl = document.getElementById("incomeTable");
  if (incEl) {
    incEl.innerHTML = table(
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
}

// ---------------- MAIN RENDER ----------------
function renderAll() {
  // settings UI
  const base = document.getElementById("baseCcy");
  const dec = document.getElementById("decimals");
  if (base) base.value = state.settings.baseCcy;
  if (dec) dec.value = String(state.settings.decimals ?? 2);

  renderTables();
  renderKPIs();
  renderQuickBreakdown();
}

// =======================
// LIVE PRICES — CRYPTO
// =======================

const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

// símbolo → id CoinGecko (podes acrescentar mais quando quiseres)
const CRYPTO_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOT: "polkadot",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  MATIC: "matic-network"
};

window.addEventListener("DOMContentLoaded", () => {
  // botão no index.html: id="btnRefreshPrices"
  const btn = document.getElementById("btnRefreshPrices");
  if (btn) btn.addEventListener("click", updateCryptoPrices);
  renderAll();
});

async function updateCryptoPrices() {
  const cryptos = (state.investments || []).filter(i => i.class === "Cripto");

  if (cryptos.length === 0) {
    alert("Sem criptomoedas registadas.");
    return;
  }

  const ids = cryptos
    .map(c => CRYPTO_MAP[String(c.symbol || "").toUpperCase().trim()])
    .filter(Boolean);

  if (!ids.length) {
    alert("Símbolos não reconhecidos (ex: BTC, ETH, SOL).");
    return;
  }

  const uniqIds = [...new Set(ids)].join(",");

  try {
    const res = await fetch(`${COINGECKO}?ids=${uniqIds}&vs_currencies=eur`);
    const data = await res.json();

    const now = new Date().toISOString();

    cryptos.forEach(inv => {
      const sym = String(inv.symbol || "").toUpperCase().trim();
      const apiId = CRYPTO_MAP[sym];
      const price = data?.[apiId]?.eur;

      if (typeof price === "number") {
        const qty = Number(inv.qty || 0);
        const cost = qty * Number(inv.avgPrice || 0);
        const mv = qty * price;

        inv.marketPrice = price;
        inv.marketValue = mv;
        inv.pnl = mv - cost;
        inv.pnlPct = cost > 0 ? (inv.pnl / cost) * 100 : 0;
        inv.lastUpdated = now;
      }
    });

    saveState();
    renderAll();
    alert("Preços actualizados.");

  } catch (err) {
    console.error(err);
    alert("Erro ao obter preços (rede/API).");
  }
}
