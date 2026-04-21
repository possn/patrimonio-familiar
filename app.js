/* Património Familiar — v28
   Performance: memoização por ciclo de render (elimina cálculos redundantes)
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
      navigator.serviceWorker.register("sw.js?v=20260420v28").catch(() => {});
    });
  }
} catch (_) {}

try {
  if (typeof window !== "undefined" && window.Chart) {
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
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
    // Formato misto: o ÚLTIMO separador é o decimal
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g,"").replace(/,/g,".");
    else t = t.replace(/,/g,"");
  } else if (hasComma && !hasDot) {
    // Só vírgula: decimal por defeito, EXCEPTO se for claramente separador de milhares
    // (exactamente 3 dígitos depois, e parte antes ≠ "0"). Isto preserva cripto com 4+ casas
    // decimais (0,1805, 0,00000021) e dinheiro PT (12,500 = doze mil e quinhentos).
    if ((t.match(/,/g) || []).length === 1) {
      const [before, after] = t.split(",");
      const isThousands = /^[0-9]{3}$/.test(after) && before !== "0" && before.length >= 1;
      t = isThousands ? t.replace(/,/g,"") : t.replace(/,/g,".");
    } else {
      t = t.replace(/,/g,"");  // múltiplas vírgulas = milhares
    }
  } else if (!hasComma && hasDot) {
    // Só ponto: decimal por defeito, EXCEPTO se for claramente separador de milhares.
    // Regra igual: "12.500" = 12500, mas "0.1805" = 0.1805 e "100.5" = 100.5
    if ((t.match(/\./g) || []).length === 1) {
      const [before, after] = t.split(".");
      const isThousands = /^[0-9]{3}$/.test(after) && before !== "0" && before.length >= 1;
      t = isThousands ? t.replace(/\./g,"") : t;
    } else {
      t = t.replace(/\./g,"");  // múltiplos pontos = milhares
    }
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
  // Strip time portion if present: "2024-01-15 14:32:11" → "2024-01-15"
  // "15.01.2024 14:32:11" → "15.01.2024"
  const noTime = s.replace(/[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(noTime)) return noTime;
  const parts = noTime.split(/[\/\-\.]/).filter(Boolean);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (Number.isFinite(c) && c > 1000) return `${c}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}`;
    if (Number.isFinite(a) && a > 1000) return `${a}-${String(b).padStart(2,"0")}-${String(c).padStart(2,"0")}`;
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

/* ─── INFO TIPS (explicações contextuais) ─────────────────── */
const TIPS = {
  compound: {
    title: "O que é o Juro Composto?",
    body: `O juro composto é o fenómeno em que os juros gerados também geram juros.<br><br>
<b>Exemplo:</b> 10.000€ a 5%/ano:<br>
• Juro simples: +500€/ano → 15.000€ em 10 anos<br>
• Juro composto: +500€ no ano 1, +525€ no ano 2… → 16.289€ em 10 anos<br><br>
A diferença cresce exponencialmente com o tempo — por isso Einstein terá dito que o juro composto é "a oitava maravilha do mundo".`
  },
  yieldPct: {
    title: "O que é o Yield?",
    body: `O <b>yield</b> (rendimento) é a percentagem de retorno anual de um ativo.<br><br>
<b>Exemplos:</b><br>
• ETF VWCE: yield dividendo ≈ 1.5–2%/ano<br>
• Certificados de aforro: taxa fixa definida pelo Estado<br>
• Depósito a prazo: taxa acordada com o banco<br>
• Imobiliário: renda mensal / valor do imóvel × 12<br><br>
Na app, o rendimento base projectado da carteira é calculado automaticamente com base no rendimento configurado em cada ativo ou, na falta dele, pelos pressupostos por classe.`
  },
  passiveIncome: {
    title: "Rendimento Passivo",
    body: `O <b>rendimento passivo</b> é o dinheiro que a tua carteira gera automaticamente, sem trabalho ativo.<br><br>
<b>Fontes:</b><br>
• Dividendos de ações/ETFs<br>
• Juros de depósitos e obrigações<br>
• Rendas de imóveis<br>
• Juros de PPR e fundos<br><br>
A app calcula dois valores:<br>
• <b>Teórico</b>: baseado nos yields que introduziste<br>
• <b>Real</b>: baseado nos dividendos que registaste (mais preciso)`
  },
  fire: {
    title: "O que é FIRE?",
    body: `<b>FIRE</b> = Financial Independence, Retire Early.<br><br>
O objetivo é acumular capital suficiente para que os rendimentos passivos cubram as despesas, tornando o trabalho opcional.<br><br>
<b>Regra dos 4% (SWR):</b><br>
Se retirares 4% do teu portfólio por ano, historicamente o capital dura mais de 30 anos. Isso significa que precisas de 25× as tuas despesas anuais.<br><br>
<b>Exemplo:</b> Despesas de 2.000€/mês = 24.000€/ano → precisas de 600.000€ investidos.`
  },
  weightedYield: {
    title: "Yield Médio Ponderado",
    body: `O <b>yield médio ponderado</b> é a taxa de retorno média da carteira, tendo em conta o peso de cada ativo.<br><br>
<b>Exemplo:</b><br>
• 80.000€ em ETFs com 5% → contribui 4.000€/ano<br>
• 20.000€ em depósitos com 3% → contribui 600€/ano<br>
• Total: 100.000€ → 4.600€/ano → rendimento base ponderado = 4,6%<br><br>
É mais preciso do que fazer a média simples dos yields porque tem em conta o tamanho de cada posição.`
  },
  savingsRate: {
    title: "Taxa de Poupança",
    body: `A <b>taxa de poupança</b> é a percentagem do rendimento que guardas (não gastas).<br><br>
<b>Fórmula:</b> (Entradas − Saídas) / Entradas × 100<br><br>
<b>Referências:</b><br>
• < 10%: baixa — difícil acumular capital<br>
• 10–20%: razoável<br>
• 20–40%: boa — acelera a independência financeira<br>
• > 50%: excelente — caminho rápido para FIRE<br><br>
Com 50% de taxa de poupança, podes reformar-te em ~17 anos (partindo do zero).`
  },
  netWorth: {
    title: "Património Líquido",
    body: `O <b>património líquido</b> (net worth) é a diferença entre tudo o que tens e tudo o que deves.<br><br>
<b>Fórmula:</b> Ativos − Passivos<br><br>
<b>Ativos:</b> imóveis, ações, depósitos, cripto, ouro…<br>
<b>Passivos:</b> crédito habitação, crédito pessoal, cartões…<br><br>
É a métrica mais importante para medir a saúde financeira. O objetivo é aumentá-lo todos os meses através de poupança e valorização dos ativos.`
  },
  diversification: {
    title: "Diversificação",
    body: `A <b>diversificação</b> consiste em distribuir o capital por diferentes tipos de ativos para reduzir o risco.<br><br>
<b>Princípio:</b> "Não coloques todos os ovos no mesmo cesto."<br><br>
<b>Dimensões de diversificação:</b><br>
• <b>Geográfica:</b> Portugal, Europa, Mundo<br>
• <b>Classe de ativo:</b> ações, obrigações, imóveis, ouro<br>
• <b>Moeda:</b> EUR, USD, GBP<br>
• <b>Temporal:</b> investir regularmente (DCA)<br><br>
Um ETF global (ex: VWCE) oferece diversificação em mais de 3.000 empresas de uma vez.`
  },
  dividends: {
    title: "Dividendos YTD",
    body: `Os <b>dividendos</b> são pagamentos em dinheiro feitos pelas empresas aos seus acionistas, normalmente trimestrais ou anuais.<br><br>
<b>YTD</b> (Year To Date) = total recebido desde o início do ano corrente.<br><br>
<b>Como registar:</b><br>
• Vai ao separador <b>Divid.</b> e usa o botão +<br>
• Ou importa o extrato da corretora (CSV/Excel)<br><br>
O valor mostrado aqui é o líquido (já descontada a retenção na fonte).`
  },
  divSummary: {
    title: "Resumo Anual de Dividendos",
    body: `O <b>resumo anual</b> permite introduzir os totais de dividendos do ano diretamente — útil se tens o extrato anual da corretora.<br><br>
<b>Campos:</b><br>
• <b>Bruto:</b> total recebido antes de impostos<br>
• <b>Retenção:</b> imposto retido na fonte pela corretora<br>
• <b>Líquido:</b> o que efectivamente recebeste (Bruto − Retenção)<br>
• <b>Yield:</b> dividendos / valor da carteira × 100<br><br>
Este valor é usado como fonte principal no cálculo do Rendimento Passivo.`
  },
  forecast: {
    title: "Previsão de retorno",
    body: `A <b>previsão</b> estima o valor futuro de cada ativo com base no seu retorno esperado.<br><br>
<b>Como funciona:</b><br>
• Soma rendimento base e valorização esperada de cada ativo<br>
• Usa TWR anualizado da carteira quando existe histórico robusto para a projeção global<br>
• Projeta para o horizonte temporal escolhido com reinvestimento implícito<br><br>
<b>Nota:</b> É uma estimativa — os retornos reais dependem das condições de mercado.`
  },
  compare: {
    title: "Comparação de Períodos",
    body: `Compara a evolução do teu património entre diferentes períodos.<br><br>
<b>MoM</b> (Month over Month): variação mês a mês<br>
<b>YoY</b> (Year over Year): variação ano a ano<br><br>
Os dados são baseados nos <b>snapshots</b> que guardas usando o botão <b>"Registar mês"</b> no Dashboard.<br><br>
Regista um snapshot no fim de cada mês para teres um historial completo.`
  }
};

function openTip(key) {
  const tip = TIPS[key];
  if (!tip) return;
  const el = document.getElementById("tipModal");
  const titleEl = document.getElementById("tipTitle");
  const bodyEl = document.getElementById("tipBody");
  if (!el || !titleEl || !bodyEl) return;
  titleEl.textContent = tip.title;
  bodyEl.innerHTML = tip.body;
  openModal("tipModal");
}

// Helper to create an info button
function infoBtn(key) {
  return `<button class="info-btn" onclick="openTip('${key}')" title="Saber mais">ℹ️</button>`;
}
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
  settings: { currency: "EUR", goalMonthly: 0, targetAllocation: null },
  assets: [],
  liabilities: [],
  transactions: [],
  dividends: [],
  divSummaries: [], // {id, year, gross, tax, yieldPct, notes}
  history: [],
  brokerData: { files: [], events: [], positions: [] },
  priceHistory: {},   // { "TICKER": [{date:"YYYY-MM-DD", priceEur:n, priceLoc:n, ccy:"USD"}] }
  fxHistory: {}       // { "USD": [{date:"YYYY-MM-DD", rate:n}] }
};

/* ─── ISIN → Yahoo Finance ticker map (built from real T212 data) ─────────
   Prevents ticker collisions like COR (Corticeira Amorim = COR.LS)
   being fetched as COR (Cencora, US pharma ~270 USD).
   448 ISINs covering all exchanges in the T212/XTB universe.
──────────────────────────────────────────────────────────────────────────── */
const ISIN_YAHOO_MAP = {
  "AN8068571086":"SLB","AT0000743059":"OMV.VI","AT0000A3EPA4":"AMS2.VI",
  "AU000000MOB7":"MOB.AX","AU0000185993":"IREN.AX",
  "BMG1466R1732":"BORR","BMG3398L1182":"FIHL","BMG396372051":"GOGL","BMG9001E1286":"LILAK",
  "CA0636711016":"BMO","CA0641491075":"BNS","CA11271J1075":"BN","CA1363851017":"CNQ",
  "CA24477V1058":"DFTX","CA2483561072":"DNN","CA26142Q3044":"DPRO","CA29250N1050":"ENB",
  "CA29259W7008":"EU","CA2926717083":"UUUU","CA3180931014":"FTG","CA3565001086":"FRU",
  "CA38149E1016":"GLDG","CA4339211035":"HIVE","CA46500E8678":"ISO","CA50202P2044":"LICYQ",
  "CA5592224011":"MGA","CA63010G1000":"GRA","CA64046G1063":"NEO","CA64550A1075":"HOVR",
  "CA65340P1062":"NXE","CA67077M1086":"NTR","CA73044W3021":"POET","CA76131D1033":"QSR",
  "CA7800871021":"RY","CA85236X1042":"STCK","CA87261Y1060":"TMC","CA8911605092":"TD",
  "CA91702V1013":"UROY","CA92859G6085":"VZLA","CA96467A2002":"WCP",
  "CH0038863350":"NESN.SW","CH0044328745":"CB.SW","CH0126881561":"SREN.SW",
  "CH0334081137":"CRSP.SW","CH1499059983":"ROP.SW",
  "DE0005552004":"DHL.DE","DE0005785604":"FRE.DE","DE0006231004":"IFX.DE",
  "DE0007100000":"MBG.DE","DE0007657231":"VIB3.DE","DE0007664039":"VOW3.DE",
  "DE000A0WMPJ6":"AIXA.DE","DE000A1K0235":"SMHN.DE","DE000A2E4K43":"DHER.DE",
  "DE000A2NB601":"JEN.DE","DE000BASF111":"BAS.DE","DE000SHA0100":"SHA0.DE",
  "ES0105223004":"GEST.MC","ES0112501012":"EBRO.MC","ES0124244E34":"MAP.MC",
  "ES0130670112":"ELE.MC","ES0173093024":"RED.MC","ES0173516115":"REP.MC",
  "ES0177542018":"IAG.MC","ES0183746314":"VID.MC",
  "FR0000035081":"ICAD.PA","FR0000120073":"AI.PA","FR0000120404":"AC.PA",
  "FR0000120628":"CS.PA","FR0004180578":"SWP.PA","FR0010040865":"GFC.PA",
  "FR0010313833":"AKE.PA","FR0011053636":"ALCPB.PA","FR0011184241":"ADOC.PA",
  "FR0012819381":"ALGIL.PA","FR0012882389":"EQS.PA","FR0013447729":"VRLA.PA",
  "GB0002634946":"BA.L","GB0005603997":"LGEN.L","GB0006027295":"MGAM.L",
  "GB0007188757":"RIO1.L","GB0031743007":"BRBY.L","GB00B0WMWD03":"QQ.L",
  "GB00B132NW22":"ASHM.L","GB00B15KXN58":"ALUM.L","GB00B15KY211":"NICK.L",
  "GB00B63H8491":"RR.L","GB00BGDT3G23":"RMV.L","GB00BJFFLV09":"CRDA.L",
  "GB00BL6K5J42":"EDV.L","GB00BMXWN182":"JMGI.L","GB00BN7SWP63":"GSK.L",
  "GB00BVZK7T90":"UNA.L",
  "IE0002PG6CA6":"VVMX.IR","IE00045C7B38":"HTOO","IE00063FT9K6":"CEBS.IR",
  "IE000OJ5TQP4":"NATP.IR","IE000W8WMSL2":"QWTM.IR","IE00B3WJKG14":"QDVE.IR",
  "IE00B53SZB19":"SXRV.IR","IE00BFXR7892":"KWEB.IR","IE00BGV5VN51":"XAIX.IR",
  "IE00BKVD2N49":"STX.IR","IE00BLCHJ534":"PAVE.IR","IE00BLH3CV30":"UFOP.IR",
  "IE00BLS09M33":"PNR","IE00BQT3WG13":"CNYA.DE","IE00BTN1Y115":"MDT",
  "IE00BY7QL619":"JCI",
  "IT0003128367":"ENEL.MI",
  "LU1598757687":"MT.LU",
  "NL0000235190":"AIR.AS","NL0009434992":"LYB","NL0009805522":"NBIS",
  "NL0010583399":"CRBN.AS","NL0013267909":"AKZA.AS","NL00150001Q9":"STLA",
  "NL0015002MS2":"MICC.AS","NL0015073TS8":"CSG.AS",
  "PTBCP0AM0015":"BCP.LS","PTCOR0AE0006":"COR.LS","PTEDP0AM0009":"EDP.LS",
  "PTFRV0AE0004":"RAM.LS","PTGAL0AM0009":"GALP.LS","PTJMT0AE0001":"JMT.LS",
  "PTMEN0AE0005":"EGL.LS","PTPTC0AM0009":"PHR.LS","PTREL0AM0008":"RENE.LS",
  "PTSON0AM0001":"SON.LS"
};

/* ─── CRIPTOMOEDAS — Top 100 por market cap ──────────────────
   Mapeamento: nome/símbolo comum → ticker Yahoo Finance (formato XXX-USD).
   O Worker do Cloudflare já suporta estes tickers via v8 chart API sem alterações.
   Fonte: CoinGecko top 100 (actualizado em 2026-04).
*/
const CRYPTO_YAHOO_MAP = {
  // Top 20
  "BTC":"BTC-USD", "BITCOIN":"BTC-USD",
  "ETH":"ETH-USD", "ETHEREUM":"ETH-USD",
  "USDT":"USDT-USD", "TETHER":"USDT-USD",
  "BNB":"BNB-USD", "BINANCE COIN":"BNB-USD", "BINANCECOIN":"BNB-USD",
  "SOL":"SOL-USD", "SOLANA":"SOL-USD",
  "XRP":"XRP-USD", "RIPPLE":"XRP-USD",
  "USDC":"USDC-USD", "USD COIN":"USDC-USD",
  "DOGE":"DOGE-USD", "DOGECOIN":"DOGE-USD",
  "ADA":"ADA-USD", "CARDANO":"ADA-USD",
  "TRX":"TRX-USD", "TRON":"TRX-USD",
  "TON":"TON11419-USD", "TONCOIN":"TON11419-USD",
  "AVAX":"AVAX-USD", "AVALANCHE":"AVAX-USD",
  "SHIB":"SHIB-USD", "SHIBA INU":"SHIB-USD",
  "LINK":"LINK-USD", "CHAINLINK":"LINK-USD",
  "DOT":"DOT-USD", "POLKADOT":"DOT-USD",
  "MATIC":"MATIC-USD", "POLYGON":"MATIC-USD", "POL":"POL-USD",
  "BCH":"BCH-USD", "BITCOIN CASH":"BCH-USD",
  "LTC":"LTC-USD", "LITECOIN":"LTC-USD",
  "NEAR":"NEAR-USD",
  "DAI":"DAI-USD",
  // 20-40
  "UNI":"UNI7083-USD", "UNISWAP":"UNI7083-USD",
  "LEO":"LEO-USD",
  "KAS":"KAS-USD", "KASPA":"KAS-USD",
  "PEPE":"PEPE24478-USD",
  "ICP":"ICP-USD", "INTERNET COMPUTER":"ICP-USD",
  "FET":"FET-USD",
  "ETC":"ETC-USD", "ETHEREUM CLASSIC":"ETC-USD",
  "APT":"APT21794-USD", "APTOS":"APT21794-USD",
  "XLM":"XLM-USD", "STELLAR":"XLM-USD",
  "RNDR":"RNDR-USD", "RENDER":"RENDER-USD",
  "CRO":"CRO-USD", "CRONOS":"CRO-USD",
  "ATOM":"ATOM-USD", "COSMOS":"ATOM-USD",
  "HBAR":"HBAR-USD", "HEDERA":"HBAR-USD",
  "FIL":"FIL-USD", "FILECOIN":"FIL-USD",
  "MNT":"MNT27075-USD", "MANTLE":"MNT27075-USD",
  "STX":"STX4847-USD", "STACKS":"STX4847-USD",
  "IMX":"IMX10603-USD", "IMMUTABLE":"IMX10603-USD", "IMMUTABLEX":"IMX10603-USD",
  "OKB":"OKB-USD",
  "MKR":"MKR-USD", "MAKER":"MKR-USD",
  "VET":"VET-USD", "VECHAIN":"VET-USD",
  // 40-60
  "INJ":"INJ-USD", "INJECTIVE":"INJ-USD",
  "TIA":"TIA22861-USD", "CELESTIA":"TIA22861-USD",
  "LDO":"LDO-USD", "LIDO":"LDO-USD", "LIDODAO":"LDO-USD",
  "GRT":"GRT6719-USD", "THE GRAPH":"GRT6719-USD",
  "ARB":"ARB11841-USD", "ARBITRUM":"ARB11841-USD",
  "OP":"OP-USD", "OPTIMISM":"OP-USD",
  "THETA":"THETA-USD",
  "AR":"AR-USD", "ARWEAVE":"AR-USD",
  "RUNE":"RUNE-USD", "THORCHAIN":"RUNE-USD",
  "FTM":"FTM-USD", "FANTOM":"FTM-USD",
  "SUI":"SUI20947-USD",
  "BGB":"BGB-USD", "BITGET":"BGB-USD",
  "SEI":"SEI-USD",
  "BONK":"BONK-USD",
  "JUP":"JUP29210-USD", "JUPITER":"JUP29210-USD",
  "AAVE":"AAVE-USD",
  "ALGO":"ALGO-USD", "ALGORAND":"ALGO-USD",
  "FLR":"FLR-USD", "FLARE":"FLR-USD",
  "XTZ":"XTZ-USD", "TEZOS":"XTZ-USD",
  "FLOW":"FLOW-USD",
  // 60-80
  "WIF":"WIF-USD", "DOGWIFHAT":"WIF-USD",
  "PYTH":"PYTH-USD",
  "TAO":"TAO22974-USD", "BITTENSOR":"TAO22974-USD",
  "KAVA":"KAVA-USD",
  "SAND":"SAND-USD", "SANDBOX":"SAND-USD",
  "MANA":"MANA-USD", "DECENTRALAND":"MANA-USD",
  "EOS":"EOS-USD",
  "AXS":"AXS-USD",
  "WLD":"WLD-USD", "WORLDCOIN":"WLD-USD",
  "NEO":"NEO-USD",
  "XEC":"XEC-USD", "ECASH":"XEC-USD",
  "CHZ":"CHZ-USD", "CHILIZ":"CHZ-USD",
  "CRV":"CRV-USD", "CURVE":"CRV-USD", "CURVE DAO":"CRV-USD",
  "SNX":"SNX-USD", "SYNTHETIX":"SNX-USD",
  "COMP":"COMP5692-USD", "COMPOUND":"COMP5692-USD",
  "ENS":"ENS-USD",
  "GALA":"GALA-USD",
  "ROSE":"ROSE-USD", "OASIS":"ROSE-USD",
  "IOTA":"MIOTA-USD", "MIOTA":"MIOTA-USD",
  "BAT":"BAT-USD",
  // 80-100
  "ZEC":"ZEC-USD", "ZCASH":"ZEC-USD",
  "DASH":"DASH-USD",
  "QNT":"QNT-USD", "QUANT":"QNT-USD",
  "DYDX":"DYDX-USD",
  "STRK":"STRK22691-USD", "STARKNET":"STRK22691-USD",
  "ORDI":"ORDI-USD",
  "PENDLE":"PENDLE-USD",
  "SUSHI":"SUSHI-USD",
  "1INCH":"1INCH-USD",
  "GMX":"GMX11857-USD",
  "CAKE":"CAKE-USD", "PANCAKESWAP":"CAKE-USD",
  "RON":"RON14101-USD", "RONIN":"RON14101-USD",
  "XMR":"XMR-USD", "MONERO":"XMR-USD",
  "FLOKI":"FLOKI-USD",
  "AKT":"AKT-USD", "AKASH":"AKT-USD",
  "ENJ":"ENJ-USD", "ENJIN":"ENJ-USD",
  "BTT":"BTT-USD", "BITTORRENT":"BTT-USD",
  "IOTX":"IOTX-USD",
  "ZIL":"ZIL-USD", "ZILLIQA":"ZIL-USD",
  "KSM":"KSM-USD", "KUSAMA":"KSM-USD"
};

/** Normaliza um nome/ticker de cripto e devolve o ticker Yahoo (XXX-USD), ou null. */
function cryptoToYahoo(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  // Já está no formato Yahoo (BTC-USD, ETH-USD, etc)
  if (/^[A-Z0-9]{2,8}-USD$/.test(s)) return s;
  // Sufixo .CC → remover e acrescentar -USD
  if (s.endsWith(".CC")) return s.slice(0, -3) + "-USD";
  // Lookup directo na tabela
  if (CRYPTO_YAHOO_MAP[s]) return CRYPTO_YAHOO_MAP[s];
  // Tentar sem espaços/hífens
  const compact = s.replace(/[\s\-]/g, "");
  if (CRYPTO_YAHOO_MAP[compact]) return CRYPTO_YAHOO_MAP[compact];
  return null;
}

let state = safeClone(DEFAULT_STATE);
let currentView = "dashboard";
const RENDERABLE_VIEWS = ["dashboard", "assets", "cashflow", "dividends", "analysis", "settings", "import"];
const dirtyViews = new Set(RENDERABLE_VIEWS);
const renderedViews = new Set();
let pendingViewRenderToken = 0;
let pendingViewRenderFrame = null;
let showingLiabs = false;
let summaryExpanded = false;
let txExpanded = false;
let distDetailExpanded = false;
let editingItemId = null;
let bankCsvSelectedFile = null;

// Chart instances
let distChart = null, trendChart = null, fireChart = null, compoundChart = null, forecastChart = null, compareChart = null;

/* ─── RENDER CACHE — memoização por ciclo de render ──────────
   Evita recalcular calcTotals/calcPortfolioYield/calcTWR/calcPortfolioRealMetrics
   múltiplas vezes durante o mesmo frame de render.
   Invalidado automaticamente após a micro-task atual.
   Chamar invalidateRenderCache() sempre que o state muda.
────────────────────────────────────────────────────────────── */
let _rc = null;
let _rcScheduled = false;

function _scheduleRcInvalidate() {
  if (_rcScheduled) return;
  _rcScheduled = true;
  Promise.resolve().then(() => { _rc = null; _rcScheduled = false; });
}

function invalidateRenderCache() {
  _rc = null;
  _rcScheduled = false;
  buildDividendStatsIndex._cache = null;
  buildDividendStatsIndex._sig = "";
  // Clear content hash guards so next render is fresh
  if (renderHealthRatios) renderHealthRatios._lastHash = null;
  if (renderPortfolioQuality) renderPortfolioQuality._lastHash = null;
  if (renderBrokerImportStatus) renderBrokerImportStatus._lastHash = null;
  if (renderPortfolioSourcesCard) renderPortfolioSourcesCard._lastHash = null;
  if (renderAlerts) renderAlerts._lastHash = null;
  if (renderDivYTD) renderDivYTD._lastHash = null;
}

function getRenderCache() {
  if (_rc) return _rc;
  // Calcular tudo uma única vez por ciclo — funções pesadas só aqui
  const totals      = calcTotals();
  const py          = calcPortfolioYield();
  const twr         = calcTWR();
  const realMetrics = calcPortfolioRealMetrics();
  const divScore    = calcDiversificationScore();
  _rc = { totals, py, twr, realMetrics, divScore };
  _scheduleRcInvalidate();
  return _rc;
}

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

function prepareChartCanvas(canvas, fallbackHeight = 220) {
  if (!canvas || canvas._missing || typeof canvas.getContext !== "function") return null;
  const raw = parseInt(canvas.getAttribute("height") || canvas.dataset.chartHeight || fallbackHeight, 10);
  const height = Number.isFinite(raw) && raw > 80 ? raw : fallbackHeight;
  const wrap = canvas.closest ? canvas.closest(".chartWrap") : null;
  if (wrap) {
    wrap.style.position = "relative";
    wrap.style.minHeight = `${height}px`;
    if (!wrap.style.height || wrap.style.height === "auto") wrap.style.height = `${height}px`;
  }
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = `${height}px`;
  return canvas;
}

function ensureChartCtx(id, fallbackHeight = 220) {
  if (typeof Chart === "undefined") {
    renderChartUnavailable(id, "Biblioteca de gráficos não carregada");
    return null;
  }
  const canvas = prepareChartCanvas(document.getElementById(id), fallbackHeight);
  if (!canvas) return null;
  return canvas.getContext("2d");
}

function ensureAllChartCanvasesReady() {
  document.querySelectorAll(".chartWrap canvas").forEach(c => prepareChartCanvas(c));
}

function renderChartUnavailable(canvasId, message = "Gráfico indisponível") {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas && canvas.closest ? canvas.closest(".chartWrap") : null;
  if (!wrap) return;
  let note = wrap.querySelector(".chartFallback");
  if (!note) {
    note = document.createElement("div");
    note.className = "chartFallback";
    note.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;min-height:140px;font-size:12px;color:var(--muted);text-align:center;padding:12px";
    wrap.appendChild(note);
  }
  note.textContent = message;
}

function clearChartUnavailable(canvasId) {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas && canvas.closest ? canvas.closest(".chartWrap") : null;
  if (!wrap) return;
  const note = wrap.querySelector(".chartFallback");
  if (note) note.remove();
}

/* ─── SAVE / LOAD ─────────────────────────────────────────── */
async function loadStateAsync() {
  try {
    const raw = await storageGet();
    if (!raw) return safeClone(DEFAULT_STATE);
    const p = JSON.parse(raw);
    const assets = Array.isArray(p.assets) ? p.assets.map(a => {
      const out = { ...a };
      if ((!out.yieldType || out.yieldType === "none") && parseNum(out.yieldValue) <= 0) {
        const legacy = getLegacyPassiveMeta(out);
        if (legacy.type !== "none") {
          out.yieldType = legacy.type;
          out.yieldValue = parseNum(legacy.value);
        }
      }
      if ((out.appreciationPct === undefined || out.appreciationPct === null || String(out.appreciationPct).trim() === "")) {
        const legacyApp = parseNum(out.appreciationRatePct ?? out.expectedAppreciationPct ?? out.capitalReturnPct ?? out.returnPct);
        if (legacyApp) out.appreciationPct = legacyApp;
      }
      return out;
    }) : [];
    return {
      settings: { currency: "EUR", goalMonthly: 0, returnDefaults: safeClone(DEFAULT_RETURN_SETTINGS), ...( p.settings || {}) },
      assets,
      liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
      transactions: Array.isArray(p.transactions) ? p.transactions : [],
      dividends: Array.isArray(p.dividends) ? p.dividends : [],
      divSummaries: Array.isArray(p.divSummaries) ? p.divSummaries : [],
      history: Array.isArray(p.history) ? p.history : [],
      priceHistory: (p.priceHistory && typeof p.priceHistory === "object") ? p.priceHistory : {},
      fxHistory: (p.fxHistory && typeof p.fxHistory === "object") ? p.fxHistory : {},
      brokerData: {
        files: Array.isArray(p.brokerData && p.brokerData.files) ? p.brokerData.files : [],
        events: Array.isArray(p.brokerData && p.brokerData.events) ? p.brokerData.events : [],
        positions: Array.isArray(p.brokerData && p.brokerData.positions) ? p.brokerData.positions : []
      }
    };
  } catch { return safeClone(DEFAULT_STATE); }
}

function saveState() { invalidateRenderCache(); return storageSet(JSON.stringify(state)); }
async function saveStateAsync() { invalidateRenderCache(); await storageSet(JSON.stringify(state)); }

/* ─── TOTALS ──────────────────────────────────────────────── */
function getLegacyPassiveMeta(it) {
  if (!it) return { type: "none", value: 0 };
  const yearlyCandidates = [
    it.annualIncome, it.passiveAnnual, it.annualYieldEur,
    it.annualInterestEur, it.incomeYear, it.jurosAno
  ].map(parseNum).filter(v => v > 0);
  if (yearlyCandidates.length) return { type: "yield_eur_year", value: yearlyCandidates[0] };

  const monthlyRentCandidates = [it.rentMonthly, it.monthlyRent, it.rendaMensal].map(parseNum).filter(v => v > 0);
  if (monthlyRentCandidates.length) return { type: "rent_month", value: monthlyRentCandidates[0] };

  const pctCandidates = [
    it.yieldPct, it.passivePct, it.interestPct, it.ratePct,
    it.apy, it.couponPct, it.taxaJuro, it.taxa
  ].map(parseNum).filter(v => v > 0);
  if (pctCandidates.length) return { type: "yield_pct", value: pctCandidates[0] };

  return { type: "none", value: 0 };
}

function passiveFromItem(it) {
  if (it && isDividendAsset(it)) {
    const stats = getDividendStatsForAsset(it);
    if (stats.ttmNet > 0) return stats.ttmNet;
  }
  const v = parseNum(it && it.value), yv = parseNum(it && it.yieldValue), yt = it && it.yieldType || "none";
  if (yt === "yield_pct") return v * (yv / 100);
  if (yt === "yield_eur_year") return yv;
  if (yt === "rent_month") return yv * 12;
  const legacy = getLegacyPassiveMeta(it);
  if (legacy.type === "yield_pct") return v * (parseNum(legacy.value) / 100);
  if (legacy.type === "yield_eur_year") return parseNum(legacy.value);
  if (legacy.type === "rent_month") return parseNum(legacy.value) * 12;
  return 0;
}


function getDividendGross(d) {
  const tax = Math.max(0, parseNum(d && d.taxWithheld || 0));
  if (!d) return 0;
  if (d.grossAmount !== undefined && d.grossAmount !== null && d.grossAmount !== "") return Math.max(0, parseNum(d.grossAmount));
  if (d.generatedFromBroker && !("grossAmount" in d) && !("netAmount" in d)) {
    // Legacy broker imports stored amount as NET; reconstruct gross
    return Math.max(0, parseNum(d.amount) + tax);
  }
  if (d.netAmount !== undefined && d.netAmount !== null && d.netAmount !== "") return Math.max(0, parseNum(d.netAmount) + tax);
  return Math.max(0, parseNum(d.amount));
}

function getDividendNet(d) {
  const tax = Math.max(0, parseNum(d && d.taxWithheld || 0));
  if (!d) return 0;
  if (d.netAmount !== undefined && d.netAmount !== null && d.netAmount !== "") return Math.max(0, parseNum(d.netAmount));
  if (d.generatedFromBroker && !("grossAmount" in d) && !("netAmount" in d)) {
    // Legacy broker imports stored amount as NET
    return Math.max(0, parseNum(d.amount));
  }
  return Math.max(0, getDividendGross(d) - tax);
}

function normalizeDividendRecord(d) {
  if (!d || typeof d !== "object") return d;
  const tax = Math.max(0, parseNum(d.taxWithheld || 0));

  if (d.generatedFromBroker) {
    if (!("grossAmount" in d) && !("netAmount" in d)) {
      const legacyNet = Math.max(0, parseNum(d.amount));
      d.grossAmount = legacyNet + tax;
      d.netAmount = legacyNet;
      d.amount = d.grossAmount; // normalize storage to GROSS
      return d;
    }
    const gross = ("grossAmount" in d) ? Math.max(0, parseNum(d.grossAmount)) : Math.max(0, parseNum(d.amount));
    const net = ("netAmount" in d) ? Math.max(0, parseNum(d.netAmount)) : Math.max(0, gross - tax);
    d.grossAmount = gross;
    d.netAmount = net;
    d.amount = gross;
    return d;
  }

  // Manual / other sources: amount is gross by convention
  const gross = ("grossAmount" in d) ? Math.max(0, parseNum(d.grossAmount)) : Math.max(0, parseNum(d.amount));
  const net = ("netAmount" in d) ? Math.max(0, parseNum(d.netAmount)) : Math.max(0, gross - tax);
  d.grossAmount = gross;
  d.netAmount = net;
  d.amount = gross;
  return d;
}

function migrateDividendRecords() {
  if (!Array.isArray(state.dividends)) return false;
  let changed = false;
  for (const d of state.dividends) {
    const before = JSON.stringify({ amount: d.amount, grossAmount: d.grossAmount, netAmount: d.netAmount, taxWithheld: d.taxWithheld });
    normalizeDividendRecord(d);
    const after = JSON.stringify({ amount: d.amount, grossAmount: d.grossAmount, netAmount: d.netAmount, taxWithheld: d.taxWithheld });
    if (before !== after) changed = true;
  }
  return changed;
}

const PASSIVE_DEFAULTS = {
  "acoes/etfs": 1.8,
  "fundos": 1.2,
  "ppr": 0.4,
  "imobiliario": 4,
  "ouro": 0,
  "prata": 0,
  "cripto": 0,
  "liquidez": 0,
  "depositos": 2,
  "obrigacoes": 3,
  "outros": 0
};

const APPRECIATION_DEFAULTS = {
  "acoes/etfs": 6,
  "fundos": 4,
  "ppr": 3.5,
  "imobiliario": 2,
  "ouro": 2,
  "prata": 1.5,
  "cripto": 0,
  "liquidez": 0,
  "depositos": 0,
  "obrigacoes": 0,
  "outros": 0
};

const BROKER_REBUILD_SCHEMA_VERSION = 6;

const DEFAULT_RETURN_SETTINGS = {
  classPassivePct: { ...PASSIVE_DEFAULTS },
  classAppreciationPct: { ...APPRECIATION_DEFAULTS },
  preferTWR: true,
  twrMinYears: 0.5
};

function getReturnSettings() {
  const s = (state && state.settings && state.settings.returnDefaults) || {};
  return {
    classPassivePct: { ...PASSIVE_DEFAULTS, ...(s.classPassivePct || {}) },
    classAppreciationPct: { ...APPRECIATION_DEFAULTS, ...(s.classAppreciationPct || {}) },
    preferTWR: s.preferTWR !== false,
    twrMinYears: Number.isFinite(parseNum(s.twrMinYears)) && parseNum(s.twrMinYears) > 0 ? parseNum(s.twrMinYears) : DEFAULT_RETURN_SETTINGS.twrMinYears
  };
}

function saveReturnSettings(partial = {}) {
  if (!state.settings) state.settings = {};
  const cur = getReturnSettings();
  state.settings.returnDefaults = {
    classPassivePct: { ...cur.classPassivePct, ...(partial.classPassivePct || {}) },
    classAppreciationPct: { ...cur.classAppreciationPct, ...(partial.classAppreciationPct || {}) },
    preferTWR: partial.preferTWR !== undefined ? !!partial.preferTWR : cur.preferTWR,
    twrMinYears: partial.twrMinYears !== undefined ? parseNum(partial.twrMinYears) : cur.twrMinYears
  };
}

function getDividendYieldDisplayMode() {
  const mode = (((state || {}).settings || {}).dividendYieldMode || 'gross').toLowerCase();
  return mode === 'net' ? 'net' : 'gross';
}

function setDividendYieldDisplayMode(mode) {
  if (!state.settings) state.settings = {};
  state.settings.dividendYieldMode = mode === 'net' ? 'net' : 'gross';
  saveState();
  markViewsDirty(["dividends", "dashboard"]);
  scheduleRenderView(currentView, { force: true, sync: true });
}

function getDividendSourceLabel(source) {
  if (source === 'broker_ttm')  return 'Corretora (TTM real)';
  if (source === 'summary')     return 'Resumo anual manual';
  if (source === 'individual')  return 'Dividendos registados (TTM)';
  if (source === 'estimated')   return 'Estimativa pelos activos';
  return 'Automático';
}

function getRealDividendRecords(opts = {}) {
  const all = Array.isArray(state.dividends) ? state.dividends.slice().filter(Boolean) : [];
  const broker = all.filter(d => d && d.generatedFromBroker);
  const manual = all.filter(d => d && !d.generatedFromBroker);
  if (opts.source === 'broker') return broker;
  if (opts.source === 'manual') return manual;
  if (opts.source === 'all') return all;
  if (opts.preferBrokerOnly && broker.length) return broker;
  return all;
}

function getDividendBaseAssetsForRecords(divRecords, opts = {}) {
  const records = Array.isArray(divRecords) ? divRecords.filter(Boolean) : [];
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const brokerOnly = !!opts.brokerOnly;
  const allowConfigured = opts.allowConfigured !== false;
  return assets.filter(a => {
    if (!isDividendAsset(a) || parseNum(a.value) <= 0) return false;
    if (brokerOnly && !a.generatedFromBroker) return false;
    const hasRecord = records.some(d => assetMatchesDividend(a, d));
    const yt = a.yieldType || 'none';
    const hasConfiguredDividend = allowConfigured && (yt === 'yield_eur_year') && parseNum(a.yieldValue) > 0;
    return hasRecord || hasConfiguredDividend;
  });
}

function pruneGeneratedDividendSummaries() {
  if (!Array.isArray(state.divSummaries)) state.divSummaries = [];
  const validYears = new Set(getRealDividendRecords({ source: 'broker' }).map(d => String(d.date || '').slice(0, 4)).filter(Boolean));
  const before = state.divSummaries.length;
  state.divSummaries = state.divSummaries.filter(s => !s.generatedFromBroker || validYears.has(String(s.year)));
  return state.divSummaries.length !== before;
}

function getPreferredDividendYieldData() {
  const d = calcDividendYield();
  const mode = getDividendYieldDisplayMode();
  const selectedYieldPct = mode === 'net'
    ? parseNum(d.netYieldPct || 0)
    : parseNum(d.grossYieldPct || d.yieldPct || 0);
  return {
    ...d,
    selectedMode: mode,
    selectedModeLabel: mode === 'net' ? 'líquido' : 'bruto',
    selectedYieldPct,
    sourceLabel: getDividendSourceLabel(d.source)
  };
}

function getLegacyWholePortfolioDividendYieldPct() {
  const divData = calcDividendYield();
  const totals = calcTotals();
  const base = parseNum(totals && totals.assetsTotal);
  return base > 0 ? (parseNum(divData.gross) / base * 100) : 0;
}

function syncDividendProjectionField(opts = {}) {
  const field = $('divProjYield');
  if (!field) return;
  const pref = getPreferredDividendYieldData();
  if (!(pref.selectedYieldPct > 0)) return;
  const current = parseNum(field.value);
  const legacyWhole = getLegacyWholePortfolioDividendYieldPct();
  const shouldReplace = !!opts.force
    || !String(field.value || '').trim()
    || current <= 0
    || (
      legacyWhole > 0
      && Math.abs(current - legacyWhole) < 0.05
      && Math.abs(pref.selectedYieldPct - legacyWhole) > 0.15
    );
  if (shouldReplace) field.value = fmt(pref.selectedYieldPct, 2);
}

function applyPreferredDividendYieldToProjection() {
  const pref = getPreferredDividendYieldData();
  syncDividendProjectionField({ force: true });
  const field = $('divProjYield');
  const tag = pref.selectedMode === 'net' ? 'líquido' : 'bruto';
  toast(pref.selectedYieldPct > 0
    ? `Yield ${tag} aplicado à projeção: ${fmtPct(pref.selectedYieldPct)}`
    : 'Sem yield automático disponível.');
  if (field && field.focus) {
    try { field.focus(); } catch(_) {}
  }
}

function assetClassKey(asset) {
  const c = normStr(asset && asset.class || "");
  if (c.includes("acoes") || c.includes("etf")) return "acoes/etfs";
  if (c.includes("fundo")) return "fundos";
  if (c.includes("ppr")) return "ppr";
  if (c.includes("imobili")) return "imobiliario";
  if (c.includes("ouro")) return "ouro";
  if (c.includes("prata")) return "prata";
  if (c.includes("cripto")) return "cripto";
  if (c.includes("liquidez")) return "liquidez";
  if (c.includes("deposit")) return "depositos";
  if (c.includes("obrig")) return "obrigacoes";
  return "outros";
}

function hasExplicitAppreciationPct(asset) {
  const raw = asset && (asset.appreciationPct ?? asset.expectedAppreciationPct ?? asset.capitalReturnPct);
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

function hasExplicitPassiveYield(asset) {
  if (!asset) return false;
  const yt = asset.yieldType || "none";
  if (yt !== "none") return true;
  return getLegacyPassiveMeta(asset).type !== "none";
}

function getAssetPassiveRatePct(asset, opts = {}) {
  const v = parseNum(asset && asset.value);
  if (v <= 0) return 0;
  const allowClassFallback = opts.allowClassFallback !== false;
  if (asset && isDividendAsset(asset)) {
    const stats = getDividendStatsForAsset(asset);
    if (stats.ttmNet > 0) return stats.ttmNet / Math.max(1, v) * 100;
  }
  const yt = asset && asset.yieldType || "none";
  const yv = parseNum(asset && asset.yieldValue);
  if (yt === "yield_pct") return yv;
  if (yt === "yield_eur_year") return yv / Math.max(1, v) * 100;
  if (yt === "rent_month") return yv * 12 / Math.max(1, v) * 100;
  const legacy = getLegacyPassiveMeta(asset);
  if (legacy.type === "yield_pct") return parseNum(legacy.value);
  if (legacy.type === "yield_eur_year") return parseNum(legacy.value) / Math.max(1, v) * 100;
  if (legacy.type === "rent_month") return parseNum(legacy.value) * 12 / Math.max(1, v) * 100;
  if (!allowClassFallback) return 0;
  const rs = getReturnSettings();
  return parseNum(rs.classPassivePct[assetClassKey(asset)] || 0);
}

function getAssetAppreciationPct(asset, opts = {}) {
  const allowClassFallback = opts.allowClassFallback !== false;
  const raw = asset && (asset.appreciationPct ?? asset.expectedAppreciationPct ?? asset.capitalReturnPct);
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return Math.max(-100, Math.min(100, parseNum(raw)));
  }
  if (!allowClassFallback) return 0;
  const rs = getReturnSettings();
  return parseNum(rs.classAppreciationPct[assetClassKey(asset)] || 0);
}

function getAssetTotalReturnPct(asset, opts = {}) {
  return getAssetPassiveRatePct(asset, opts) + getAssetAppreciationPct(asset, opts);
}

function calcPassiveAnnualSummary() {
  const divData = calcDividendYield();
  const breakdownReal = {};
  const breakdownProjected = {};
  let realAnnual = 0;
  let projectedAnnual = 0;

  const cutoff = new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).toISOString().slice(0, 10);
  const matchedDividendIds = new Set();

  for (const a of (state.assets || [])) {
    if (!a) continue;
    const val = parseNum(a.value);
    if (val <= 0) continue;
    const cls = a.class || "Outros";
    const isDiv = isDividendAsset(a);

    let real = 0;
    if (isDiv) {
      const stats = getDividendStatsForAsset(a);
      if (stats.ttmNet > 0) {
        real = Math.max(0, parseNum(stats.ttmNet));
        (state.dividends || []).forEach(d => {
          if (String(d.date || "") >= cutoff && assetMatchesDividend(a, d)) matchedDividendIds.add(d.id || `${d.date}|${d.assetName}|${d.amount}`);
        });
      } else {
        real = Math.max(0, passiveFromItem(a));
      }
    } else {
      real = Math.max(0, passiveFromItem(a));
    }

    let projected = 0;
    if (isDiv && real > 0) {
      projected = real;
    } else {
      const ratePct = Math.max(0, getAssetPassiveRatePct(a, { allowClassFallback: true }));
      projected = val * (ratePct / 100);
    }

    if (real > 0) {
      realAnnual += real;
      breakdownReal[cls] = (breakdownReal[cls] || 0) + real;
    }
    if (projected > 0) {
      projectedAnnual += projected;
      breakdownProjected[cls] = (breakdownProjected[cls] || 0) + projected;
    }
  }

  let unmatchedDividendNet = 0;
  for (const d of (state.dividends || [])) {
    if (String(d.date || "") < cutoff) continue;
    const key = d.id || `${d.date}|${d.assetName}|${d.amount}`;
    if (matchedDividendIds.has(key)) continue;
    unmatchedDividendNet += Math.max(0, getDividendNet(d));
  }
  if (unmatchedDividendNet > 0) {
    realAnnual += unmatchedDividendNet;
    projectedAnnual += unmatchedDividendNet;
    breakdownReal["Dividendos (não reconciliados)"] = (breakdownReal["Dividendos (não reconciliados)"] || 0) + unmatchedDividendNet;
    breakdownProjected["Dividendos (não reconciliados)"] = (breakdownProjected["Dividendos (não reconciliados)"] || 0) + unmatchedDividendNet;
  }

  return {
    divData,
    realAnnual,
    projectedAnnual: Math.max(projectedAnnual, realAnnual),
    breakdownReal,
    breakdownProjected
  };
}


function calcTotals() {
  const assetsTotal = state.assets.reduce((a, x) => a + parseNum(x.value), 0);
  const liabsTotal = state.liabilities.reduce((a, x) => a + parseNum(x.value), 0);
  const net = assetsTotal - liabsTotal;

  const passive = calcPassiveAnnualSummary();
  const passiveAnnualReal = passive.realAnnual;
  const passiveAnnualProjected = passive.projectedAnnual > 0 ? passive.projectedAnnual : passiveAnnualReal;

  return {
    assetsTotal,
    liabsTotal,
    net,
    passiveAnnual: passiveAnnualProjected,
    passiveAnnualReal,
    passiveAnnualProjected,
    theoreticalPassive: passiveAnnualProjected,
    realDividends12m: passive.divData.period === "ttm" ? Math.max(0, parseNum(passive.divData.net)) : 0,
    summaryNet: passive.divData.source === "summary" ? Math.max(0, parseNum(passive.divData.net)) : 0,
    passiveBreakdown: passive.breakdownProjected,
    passiveBreakdownReal: passive.breakdownReal
  };
}

/* ─── COMPOUND INTEREST ENGINE ────────────────────────────── */
// Returns array of {year, value} for n years with compound interest
function compoundGrowth(principal, rateAnnual, years, freq = 12, contributions = 0) {
  const r = rateAnnual / 100;
  const result = [];
  let v = principal;
  for (let y = 0; y <= years; y++) {
    result.push({ year: y, value: v });
    // Compound once per year using the effective annual rate
    // This avoids the bug where freq=1 would apply interest 12 times
    if (freq <= 1) {
      // Annual: apply once, add annual contributions
      v = v * (1 + r) + contributions * 12;
    } else {
      // Sub-annual: apply freq times per year with monthly contributions
      for (let m = 0; m < freq; m++) {
        v = v * (1 + r / freq) + contributions * (12 / freq);
      }
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
function markViewsDirty(views = RENDERABLE_VIEWS) {
  const list = Array.isArray(views) ? views : [views];
  list.forEach(v => { if (v) dirtyViews.add(v); });
}

function markViewRendered(view) {
  if (!view) return;
  renderedViews.add(view);
  dirtyViews.delete(view);
}

function renderView(view, opts = {}) {
  const force = !!(opts && opts.force);
  if (!force && renderedViews.has(view) && !dirtyViews.has(view)) return;
  if (view === "dashboard") renderDashboard();
  if (view === "assets") { renderItems(); renderEquityPnL(); updateQuoteErrorIndicator(); }
  if (view === "cashflow") renderCashflow();
  if (view === "analysis") renderAnalysis();
  if (view === "dividends") renderDividends();
  if (view === "settings") renderReturnSettingsCard();
  if (view === "import") { checkDuplicateWarning(); renderBrokerImportStatus(); }
  markViewRendered(view);
}

function scheduleRenderView(view, opts = {}) {
  pendingViewRenderToken += 1;
  const token = pendingViewRenderToken;
  if (pendingViewRenderFrame) {
    try { cancelAnimationFrame(pendingViewRenderFrame); } catch (_) {}
    pendingViewRenderFrame = null;
  }
  const run = () => {
    pendingViewRenderFrame = null;
    if (token !== pendingViewRenderToken) return;
    renderView(view, opts);
  };
  if (opts && opts.sync) run();
  else pendingViewRenderFrame = requestAnimationFrame(run);
}

// v18: cache de elementos DOM para setView — evita querySelectorAll em cada navegação
let _viewEls = null, _navEls = null;
function _initViewCache() {
  if (!_viewEls) _viewEls = Array.from(document.querySelectorAll(".view"));
  if (!_navEls) _navEls = Array.from(document.querySelectorAll(".navbtn"));
}

function setView(view) {
  const prevView = currentView;
  currentView = view;
  if (view === "dashboard" && prevView !== "dashboard") summaryExpanded = false;
  if (view === "assets" && prevView !== "assets") {
    itemsExpanded = false;
    window._pnlExpanded = false;
  }
  _initViewCache();
  for (const s of _viewEls) s.hidden = s.dataset.view !== view;
  for (const b of _navEls) b.classList.toggle("navbtn--active", b.dataset.view === view);
  if (view === "assets") updateQuoteErrorIndicator();
  scheduleRenderView(view, { force: false, sync: false });
  try { window.scrollTo(0, 0); } catch (_) {}
}

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}
function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.setAttribute("aria-hidden", "true");
  if (![...document.querySelectorAll(".modal")].some(m => m.getAttribute("aria-hidden") === "false")) {
    document.body.classList.remove("modal-open");
  }
}


function wireModalClosers() {
  document.body.addEventListener("click", e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const close = t.getAttribute("data-close");
    if (close) closeModal(close);
  });
}

/* ─── RENDER ALL ──────────────────────────────────────────── */

/* ─── SECTOR & GEOGRAPHY CHARTS ──────────────────────────── */

const SECTOR_MAP = {
  "Technology":            "Tecnologia",
  "Financial Services":    "Financials",
  "Healthcare":            "Saúde",
  "Real Estate":           "Imobiliário",
  "Consumer Cyclical":     "Consumo Cíclico",
  "Consumer Defensive":    "Consumo Defensivo",
  "Industrials":           "Industriais",
  "Basic Materials":       "Materiais",
  "Communication Services":"Comunicação",
  "Energy":                "Energia",
  "Utilities":             "Utilities",
};

const EXCHANGE_TO_GEO = {
  // USA
  "NMS":"USA","NYQ":"USA","NGM":"USA","PCX":"USA","ASE":"USA","NCM":"USA","BTS":"USA",
  // Europe
  "GER":"Europa","FRA":"Europa","XET":"Europa","HAM":"Europa","BER":"Europa","MUN":"Europa",
  "LSE":"Europa","IOB":"Europa","ENX":"Europa","PAR":"Europa","AMS":"Europa","BRU":"Europa",
  "MIL":"Europa","MCE":"Europa","VIE":"Europa","STO":"Europa","OSL":"Europa","HEL":"Europa",
  "LIS":"Europa","WSE":"Europa","SWX":"Europa",
  // Asia/Pacific
  "TKS":"Asia","OSA":"Asia","HKG":"Asia","SHH":"Asia","SHZ":"Asia",
  "KSC":"Asia","TAI":"Asia","NSI":"Asia","BSE":"Asia",
  "ASX":"Asia/Pac","NZE":"Asia/Pac",
  // Americas (ex-USA)
  "TSX":"Canadá","MEX":"LatAm","SAO":"LatAm","BUE":"LatAm",
};

const COUNTRY_TO_GEO = {
  "United States":"USA","Canada":"Canadá",
  "United Kingdom":"Europa","Germany":"Europa","France":"Europa","Switzerland":"Europa",
  "Netherlands":"Europa","Spain":"Europa","Italy":"Europa","Belgium":"Europa",
  "Sweden":"Europa","Norway":"Europa","Denmark":"Europa","Finland":"Europa",
  "Austria":"Europa","Portugal":"Europa","Poland":"Europa","Ireland":"Europa",
  "Japan":"Asia","China":"Asia","South Korea":"Asia","Taiwan":"Asia",
  "Hong Kong":"Asia","India":"Asia","Singapore":"Asia","Australia":"Asia/Pac",
  "New Zealand":"Asia/Pac","Brazil":"LatAm","Mexico":"LatAm","Argentina":"LatAm",
};

let sectorChart = null, geoChart = null;

function classifyGeo(asset) {
  const meta = asset.meta || {};
  // 1. country field (most reliable)
  if (meta.country && COUNTRY_TO_GEO[meta.country]) return COUNTRY_TO_GEO[meta.country];
  // 2. exchange field
  const exch = (meta.exchange || "").toUpperCase();
  if (exch && EXCHANGE_TO_GEO[exch]) return EXCHANGE_TO_GEO[exch];
  // 3. ticker suffix heuristic
  const name = (asset.name || "").toUpperCase();
  if (name.endsWith(".L") || name.endsWith(".GB")) return "Europa";
  if (name.endsWith(".DE") || name.endsWith(".FR") || name.endsWith(".PA") ||
      name.endsWith(".AS") || name.endsWith(".MC") || name.endsWith(".MI") ||
      name.endsWith(".LS") || name.endsWith(".PT") || name.endsWith(".WA") ||
      name.endsWith(".SW") || name.endsWith(".CH") || name.endsWith(".CO") ||
      name.endsWith(".DK") || name.endsWith(".ST") || name.endsWith(".SE") ||
      name.endsWith(".OL") || name.endsWith(".HE") || name.endsWith(".BR")) return "Europa";
  if (name.endsWith(".TO") || name.endsWith(".CA")) return "Canadá";
  if (name.endsWith(".AX") || name.endsWith(".AU")) return "Asia/Pac";
  if (name.endsWith("-USD") || name.endsWith(".CC")) return "Cripto";
  // 4. quoteType
  if (meta.quoteType === "CRYPTOCURRENCY") return "Cripto";
  // 5. Default: if no suffix and no data, likely US
  if (!name.includes(".")) return "USA";
  return "Outros";
}

function classifySector(asset) {
  const meta = asset.meta || {};
  // Crypto
  const name = (asset.name || "").toUpperCase();
  if ((name.endsWith("-USD") && !name.includes(".")) || name.endsWith(".CC") ||
      meta.quoteType === "CRYPTOCURRENCY") return "Cripto";
  // ETF — no sector from Yahoo; classify by name/exchange
  if (meta.quoteType === "ETF" || meta.quoteType === "MUTUALFUND") return "ETF / Fundo";
  // Mapped sector
  if (meta.sector && SECTOR_MAP[meta.sector]) return SECTOR_MAP[meta.sector];
  if (meta.sector) return meta.sector; // unmapped sector, use as-is
  // No metadata yet — show as "Sem dados (⟳)"
  return null;
}

function renderSectorChart() {
  const ctx = prepareChartCanvas(document.getElementById("sectorChart"), 220);
  if (!ctx || typeof Chart === "undefined") { renderChartUnavailable("sectorChart"); return; }
  clearChartUnavailable("sectorChart");

  const EQUITY_CLASSES = ["Ações/ETFs","Cripto"];
  const assets = state.assets.filter(a => EQUITY_CLASSES.includes(a.class) && parseNum(a.value) > 0);

  const by = {};
  let noData = 0;
  for (const a of assets) {
    const s = classifySector(a);
    if (!s) { noData += parseNum(a.value); continue; }
    by[s] = (by[s] || 0) + parseNum(a.value);
  }
  if (noData > 0) by["Sem dados (⟳)"] = noData;

  const labels = Object.keys(by).sort((a,b) => by[b]-by[a]);
  const values = labels.map(k => by[k]);
  const total  = values.reduce((a,b) => a+b, 0);

  const PALETTE = ["#5b5ce6","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
                   "#ec4899","#06b6d4","#84cc16","#f97316","#64748b","#0ea5e9",
                   "#a855f7","#14b8a6"];

  if (sectorChart) sectorChart.destroy();
  sectorChart = new Chart(ctx.getContext("2d"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(total>0?c.raw/total*100:0)})` } }
      }
    }
  });

  // Update count label
  const lbl = document.getElementById("sectorChartLabel");
  if (lbl) lbl.textContent = `${assets.length} activos · ${labels.length} sectores`;
}

function renderGeoChart() {
  const ctx = prepareChartCanvas(document.getElementById("geoChart"), 220);
  if (!ctx || typeof Chart === "undefined") { renderChartUnavailable("geoChart"); return; }
  clearChartUnavailable("geoChart");

  const EQUITY_CLASSES = ["Ações/ETFs","Cripto"];
  const assets = state.assets.filter(a => EQUITY_CLASSES.includes(a.class) && parseNum(a.value) > 0);

  const by = {};
  for (const a of assets) {
    const g = classifyGeo(a);
    by[g] = (by[g] || 0) + parseNum(a.value);
  }

  const GEO_COLORS = {
    "USA":"#3b82f6","Europa":"#10b981","Asia":"#f59e0b","Asia/Pac":"#f97316",
    "Canadá":"#8b5cf6","LatAm":"#ef4444","Cripto":"#64748b","Outros":"#94a3b8"
  };

  const labels = Object.keys(by).sort((a,b) => by[b]-by[a]);
  const values = labels.map(k => by[k]);
  const colors = labels.map(k => GEO_COLORS[k] || "#94a3b8");
  const total  = values.reduce((a,b) => a+b, 0);

  if (geoChart) geoChart.destroy();
  geoChart = new Chart(ctx.getContext("2d"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(total>0?c.raw/total*100:0)})` } }
      }
    }
  });

  const lbl = document.getElementById("geoChartLabel");
  if (lbl) lbl.textContent = `${assets.length} activos · ${labels.length} regiões`;
}

function getDisplayedPassiveAnnual(totals) {
  const t = totals || (_rc ? _rc.totals : calcTotals());
  const real = parseNum(t && (t.passiveAnnualReal != null ? t.passiveAnnualReal : t.passiveAnnual));
  const projected = parseNum(t && (t.passiveAnnualProjected != null ? t.passiveAnnualProjected : t.passiveAnnual));
  return real > 0 ? real : projected;
}

function renderAll(opts = {}) {
  const force = !!(opts && opts.force);
  invalidateRenderCache(); // v18: garantir cálculos frescos
  ensureAllChartCanvasesReady();
  // v18: updatePassiveBar e renderBrokerImportStatus removidos daqui —
  // são chamados dentro de renderDashboard/renderView para evitar trabalho duplo
  updateQuoteErrorIndicator();

  // Marcar todas as views como sujas
  markViewsDirty(RENDERABLE_VIEWS);

  // v18: usar requestAnimationFrame (async) em vez de sync
  // Permite ao browser pintar o esqueleto antes de bloquear no render de dados
  scheduleRenderView(currentView, { force: true, sync: false });
}

/* ─── DASHBOARD ───────────────────────────────────────────── */
function updatePassiveBar() {
  const t = _rc ? _rc.totals : calcTotals();
  const barA = document.getElementById("barPassiveAnnual");
  const barM = document.getElementById("barPassiveMonthly");
  const passiveAnnualDisplay = getDisplayedPassiveAnnual(t);
  if (barA) barA.textContent = fmtEUR(passiveAnnualDisplay);
  if (barM) barM.textContent = fmtEUR(passiveAnnualDisplay / 12);
}

/* ─── 1. OBJETIVO DE RENDIMENTO PASSIVO ───────────────────── */
function renderGoal() {
  const goal = parseNum(state.settings.goalMonthly || 0);
  const t = _rc ? _rc.totals : calcTotals();
  const passiveAnnualDisplay = getDisplayedPassiveAnnual(t);
  const monthly = passiveAnnualDisplay / 12;
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

  // Breakdown: where does the passive income come from?
  const breakEl = document.getElementById("goalBreakdown");
  if (breakEl && t.passiveBreakdown) {
    const entries = Object.entries(t.passiveBreakdown).sort((a,b) => b[1]-a[1]);
    if (!entries.length) { breakEl.style.display = "none"; }
    else {
      // Compact 2-column grid — no run-on inline text
      const rows = entries.map(([cls, v]) => {
        const pct = passiveAnnualDisplay > 0 ? (v / passiveAnnualDisplay * 100) : 0;
        const barW = Math.round(pct);
        return `<div style="display:flex;align-items:center;justify-content:space-between;
            padding:4px 0;border-bottom:1px solid var(--line);gap:6px">
          <div style="font-size:11px;color:var(--muted);flex:1;min-width:0;white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis">${escapeHtml(cls)}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <div style="width:40px;height:4px;background:var(--line);border-radius:2px;overflow:hidden">
              <div style="height:4px;background:#6366f1;border-radius:2px;width:${barW}%"></div>
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--text);min-width:50px;text-align:right">
              ${fmtEUR(v)}</div>
          </div>
        </div>`;
      }).join("");
      const totalRow = `<div style="display:flex;justify-content:space-between;padding:5px 0;font-weight:800;font-size:12px">
        <span>Total anual</span><span style="color:#6366f1">${fmtEUR(passiveAnnualDisplay)}</span>
      </div>`;
      breakEl.innerHTML = rows + totalRow;
      breakEl.style.display = "";
    }
  }

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
  const cardEl = card.querySelector(".card");
  if (cardEl) { cardEl.style.borderColor = "#f59e0b"; cardEl.style.background = "#fffbeb"; }
  const title = card.querySelector(".card__title");
  if (title) title.textContent = "⚠️ Vencimentos próximos";
  list.innerHTML = alerts.map(a => {
    const days = Math.round((new Date(a.maturityDate) - today) / 86400000);
    return `<div class="item" style="cursor:default">
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
  const notInternal = t => !isInterAccountTransfer(t);
  const m2 = String($("cfMonth").value).padStart(2, "0");
  const monthKey2 = `${y}-${m2}`;
  if (gran === "year") {
    txs = expandRecurring(state.transactions).filter(t => String(t.date || "").slice(0,4) === y && t.type === "out" && notInternal(t));
  } else if (gran === "all") {
    txs = expandRecurring(state.transactions).filter(t => t.type === "out" && notInternal(t));
  } else {
    // month (default)
    txs = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === monthKey2 && t.type === "out" && notInternal(t));
  }

  const byCat = {};
  for (const t of txs) {
    const k = t.category || "Outros";
    byCat[k] = (byCat[k] || 0) + parseNum(t.amount);
  }
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const ctx = ensureChartCtx("catChart", 180);
  if (!ctx) { renderChartUnavailable("catChart"); return; }
  clearChartUnavailable("catChart");
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
      results.push({ type: "Dividendo", label: d.assetName || "Manual", sub: `${d.date} · ${fmtEUR2(getDividendGross(d))}`, action: () => { setView("dividends"); openDivModal(d.id); toggleSearch(); } });
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

function renderDivYTD() {
  // v18: skip se dividendos não mudaram
  const _dytdHash = `${(state.dividends||[]).length}|${(state.divSummaries||[]).length}`;
  if (renderDivYTD._lastHash === _dytdHash) return;
  renderDivYTD._lastHash = _dytdHash;

  const now = new Date();
  const currentYear = now.getFullYear();
  const yearStart = currentYear + "-01-01";

  // Prefer divSummaries for current year
  const currentSummary = (state.divSummaries || []).find(s => s.year === currentYear);
  const prevSummary = (state.divSummaries || []).find(s => s.year === currentYear - 1);

  let divYTD = 0;
  let label = "";

  if (currentSummary) {
    divYTD = parseNum(currentSummary.gross) - parseNum(currentSummary.tax);
    label = `Yield ${fmtPct(parseNum(currentSummary.yieldPct))} · Resumo ${currentYear} · ${fmtEUR(divYTD)}/ano líquido`;
  } else if (prevSummary) {
    // Use last year as reference
    divYTD = parseNum(prevSummary.gross) - parseNum(prevSummary.tax);
    label = `Ref. ${currentYear - 1} · Atualiza em Dividendos`;
  } else {
    // Fall back to individual dividends
    divYTD = (state.dividends || [])
      .filter(d => d.date >= yearStart)
      .reduce((a, d) => a + getDividendNet(d), 0);
    const count = (state.dividends || []).filter(d => d.date >= yearStart).length;
    label = count > 0 ? `${count} pagamento${count !== 1 ? "s" : ""} em ${currentYear}` : "";
  }

  const divEl = $("kpiDivYTD");
  if (divEl) divEl.textContent = fmtEUR(divYTD);
  const divCountEl = $("kpiDivCount");
  if (divCountEl) divCountEl.textContent = label;
}

function renderDashboard() {
  // v18: usar render cache — calcTotals/calcPortfolioYield/calcTWR/calcPortfolioRealMetrics
  // calculados UMA vez por ciclo de render, partilhados por todas as sub-funções.
  const rc = getRenderCache();
  const t = rc.totals;

  // ── Hero ──────────────────────────────────────────────────
  $("kpiNet").textContent = fmtEUR(t.net);
  $("kpiAP").textContent = `Ativos ${fmtEUR(t.assetsTotal)} | Passivos ${fmtEUR(t.liabsTotal)}`;

  // Variação MoM e YoY a partir do histórico
  const h = state.history.slice().sort((a,b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const changesEl = document.getElementById("kpiChanges");
  if (changesEl && h.length >= 2) {
    const last = h[h.length-1];
    const prev = h[h.length-2];
    const yearAgo = h.find(x => {
      const d = new Date(x.dateISO), now = new Date(last.dateISO);
      return Math.abs((now - d) / (1000*60*60*24*365) - 1) < 0.15;
    });
    const chips = [];
    const chip = (label, val, ref) => {
      if (ref == null || ref === 0) return "";
      const diff = val - ref, pct = diff / Math.abs(ref) * 100;
      const pos = diff >= 0;
      const color = pos ? "#059669" : "#ef4444";
      const arrow = pos ? "▲" : "▼";
      return `<div style="background:${pos?"#f0fdf4":"#fff1f2"};border-radius:8px;padding:5px 10px;font-size:12px">
        <span style="color:#64748b">${label} </span>
        <span style="color:${color};font-weight:700">${arrow} ${fmtEUR(Math.abs(diff))} (${Math.abs(pct).toFixed(1)}%)</span>
      </div>`;
    };
    if (prev) chips.push(chip("vs mês ant.", t.net, parseNum(prev.net)));
    if (yearAgo) chips.push(chip("vs ano ant.", t.net, parseNum(yearAgo.net)));
    changesEl.innerHTML = chips.join("") || "";
    changesEl.style.display = chips.some(Boolean) ? "flex" : "none";
  } else if (changesEl) {
    changesEl.style.display = "none";
  }

  // ── KPIs secundários ──────────────────────────────────────
  const passiveAnnualDisplay = getDisplayedPassiveAnnual(t);
  $("kpiPassiveAnnual").textContent = fmtEUR(passiveAnnualDisplay);
  $("kpiPassiveMonthly").textContent = fmtEUR(passiveAnnualDisplay / 12);

  const pm2 = document.getElementById("kpiPassiveMonthly2");
  const pa2 = document.getElementById("kpiPassiveAnnualSub");
  if (pm2) pm2.textContent = fmtEUR(passiveAnnualDisplay / 12);
  if (pa2) pa2.textContent = fmtEUR(passiveAnnualDisplay) + "/ano";

  // Yield de dividendos
  const yieldEl = document.getElementById("kpiYield");
  if (yieldEl) {
    const prefDiv = getPreferredDividendYieldData();
    yieldEl.textContent = fmtPct(prefDiv.selectedYieldPct || 0);
  }

  // P&L realizado — usa cache
  const autEl = document.getElementById("kpiAutonomy");
  if (autEl) {
    const rm0b = rc.realMetrics;
    if (rm0b.hasData && rm0b.totalRealizedPnL !== 0) {
      autEl.textContent = (rm0b.totalRealizedPnL >= 0 ? "+" : "") + fmtEUR(rm0b.totalRealizedPnL);
      autEl.style.color = rm0b.totalRealizedPnL >= 0 ? "#059669" : "#dc2626";
    } else {
      const byMonth = new Map();
      for (const tx of (state.transactions||[])) {
        if (isInterAccountTransfer(tx)) continue;
        const d = (tx.date||"").slice(0,7); if (!d) continue;
        const cur = byMonth.get(d)||{out:0}; if (tx.type==="out") cur.out += parseNum(tx.amount);
        byMonth.set(d, cur);
      }
      const last6 = [...byMonth.keys()].sort().slice(-6);
      const avgOut = last6.length ? last6.reduce((s,k)=>s+(byMonth.get(k).out||0),0)/last6.length : 0;
      const exp12 = avgOut * 12;
      const passiveAnnualDisplay = getDisplayedPassiveAnnual(t);
      const pct = exp12 > 0 ? Math.min(999, passiveAnnualDisplay / exp12 * 100) : 0;
      autEl.textContent = pct > 0 ? fmtPct(pct) : "—";
      autEl.style.color = pct >= 100 ? "#059669" : pct >= 50 ? "#f59e0b" : "#8b5cf6";
    }
  }

  updatePassiveBar();
  renderPortfolioSourcesCard();
  renderGoal();
  renderAlerts();
  renderDivYTD();
  const d2 = document.getElementById("kpiDivYTD2");
  const dc2 = document.getElementById("kpiDivCount2");
  if (d2) d2.textContent = $("kpiDivYTD").textContent;
  if (dc2) dc2.textContent = $("kpiDivCount").textContent;

  renderSummary();
  renderDistChart();
  renderTrendChart();
  renderSnapshotTable();
  renderIRSCard();
  renderHealthRatios(rc);
  renderRiskAlerts(rc);
  renderMilestones();
  renderMaturityAlerts();
  renderPortfolioQuality(rc);
  checkNegativeReturn(rc);
}

/* ─── ALERTA: RENTABILIDADE NEGATIVA ────────────────────────── */
function checkNegativeReturn(rc) {
  const twr = rc ? rc.twr : calcTWR();
  if (!twr) return;
  const el = document.getElementById("negReturnAlert");
  if (!el) return;
  if (parseNum(twr.annualised) < -5) {
    el.style.display = "";
    el.innerHTML = `⚠️ TWR anualizado negativo: <b>${fmt(parseNum(twr.annualised),1)}%/ano</b> — o portfólio está a perder valor acima da inflação.`;
  } else {
    el.style.display = "none";
  }
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
    const sourceBadge = it.generatedFromBroker
      ? `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe">Corretora</span>`
      : ``;
    row.innerHTML = `<div class="item__l"><div class="item__t">${escapeHtml(it.name || "—")} ${badge} ${sourceBadge}${ccyBadge(it)}</div><div class="item__s">${escapeHtml(it.class || "")}</div></div><div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", () => { setView("assets"); editItem(it.id); });
    list.appendChild(row);
  }
  const toggleBtn = $("btnSummaryToggle");
  if (toggleBtn) {
    toggleBtn.style.display = items.length > 10 ? "inline-flex" : "none";
    toggleBtn.textContent = summaryExpanded
      ? "▲ Ver menos"
      : `▼ Ver mais (${items.length - 10} de ${items.length} ativos)`;
  }
  // Update subtitle with total count
  const sub = document.getElementById("itemsSub") || document.querySelector("#viewDashboard .card__muted");
  const dashSub = document.querySelector("#summaryList")?.closest(".card")?.querySelector(".card__muted");
  if (dashSub) dashSub.textContent = `Por valor · ${items.length} ativos · clica para editar`;
}

const PALETTE = ["#5b5ce6","#3b82f6","#39d6d8","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#64748b"];

function renderDistChart() {
  const by = {};
  for (const a of state.assets) { const k = a.class || "Outros"; by[k] = (by[k] || 0) + parseNum(a.value); }
  const labels = Object.keys(by);
  const values = labels.map(k => by[k]);
  const ctx = ensureChartCtx("distChart", 220);
  if (!ctx) { renderChartUnavailable("distChart"); return; }
  clearChartUnavailable("distChart");
  // v18: update em vez de destroy+recreate (muito mais rápido, sem animação de entrada)
  if (distChart && distChart.config && labels.length > 0) {
    distChart.data.labels = labels;
    distChart.data.datasets[0].data = values;
    distChart.data.datasets[0].backgroundColor = PALETTE;
    distChart.update("none"); // "none" = sem animação
    return;
  }
  if (distChart) { distChart.destroy(); distChart = null; }
  if (!labels.length) {
    distChart = new Chart(ctx, { type: "doughnut", data: { labels: ["Sem dados"], datasets: [{ data: [1], backgroundColor: ["#e6e9f0"] }] }, options: { animation: false, plugins: { legend: { display: false } }, cutout: "72%" } });
    return;
  }
  distChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 0 }] },
    options: {
      animation: { duration: 400, easing: "easeOutQuart" },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmtEUR(c.raw)} (${fmtPct(c.raw / values.reduce((a,b)=>a+b,0)*100)})` } } },
      cutout: "72%"
    }
  });
}

function renderTrendChart() {
  const ctx = ensureChartCtx("trendChart", 240);
  if (!ctx) { renderChartUnavailable("trendChart"); return; }
  clearChartUnavailable("trendChart");
  const h = state.history.slice().sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const hint = $("historyHint");
  const snapTable = document.getElementById("snapshotTable");
  const trendSub = document.getElementById("trendSubtitle");

  if (!h.length) {
    if (hint) hint.style.display = "block";
    if (snapTable) snapTable.innerHTML = "";
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    return;
  }
  if (hint) hint.style.display = "none";
  if (trendSub) trendSub.textContent = `${h.length} snapshot${h.length!==1?"s":""} · ${h[0].dateISO.slice(0,7)} → ${h[h.length-1].dateISO.slice(0,7)}`;

  const labels = h.map(x => x.dateISO.slice(0, 7));
  const netData = h.map(x => parseNum(x.net));
  const assetData = h.map(x => parseNum(x.assets));
  const passData = h.map(x => parseNum(x.passiveAnnual||0));

  // v18: update em vez de destroy+recreate
  if (trendChart && trendChart.data) {
    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = netData;
    trendChart.data.datasets[0].pointRadius = h.length <= 12 ? 4 : 2;
    trendChart.data.datasets[1].data = assetData;
    trendChart.data.datasets[2].data = passData;
    trendChart.update("none");
  } else {
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    trendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Património líquido", data: netData, tension: .4, pointRadius: h.length <= 12 ? 4 : 2, borderColor: "#5b5ce6", backgroundColor: "rgba(91,92,230,.08)", fill: true, borderWidth: 2 },
          { label: "Total ativos", data: assetData, tension: .4, pointRadius: 0, borderDash: [4,4], borderColor: "#39d6d8", borderWidth: 1.5 },
          { label: "Rend. passivo/ano", data: passData, tension: .4, pointRadius: 0, borderColor: "#10b981", borderWidth: 1.5 }
        ]
      },
      options: {
        animation: { duration: 400, easing: "easeOutQuart" },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } }
        },
        scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v), font:{size:10} } } }
      }
    });
  }

  // Mini table: last 6 snapshots with MoM change
  if (snapTable) {
    const recent = h.slice(-6).reverse();
    const rows = recent.map((s, i) => {
      const prev = recent[i+1];
      const net = parseNum(s.net);
      const diff = prev ? net - parseNum(prev.net) : null;
      const pct = (diff != null && parseNum(prev.net) !== 0) ? diff / Math.abs(parseNum(prev.net)) * 100 : null;
      const changeHtml = pct != null
        ? `<span style="color:${diff>=0?"#059669":"#ef4444"};font-size:12px">${diff>=0?"▲":"▼"} ${Math.abs(pct).toFixed(1)}%</span>`
        : `<span style="color:#94a3b8;font-size:12px">—</span>`;
      return `<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b;min-width:70px">${s.dateISO.slice(0,7)}</span>
        <span style="flex:1;font-weight:700">${fmtEUR(net)}</span>
        ${changeHtml}
      </div>`;
    }).join("");
    snapTable.innerHTML = rows
      ? `<div style="margin-top:8px"><div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Últimos snapshots</div>${rows}</div>`
      : "";
  }
}

function snapshotMonth() {
  const t = _rc ? _rc.totals : calcTotals();
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

let itemsExpanded = false;

function renderItems() {
  rebuildClassFilter();
  const list = $("itemsList");
  list.innerHTML = "";
  const q = ($("qSearch").value || "").trim().toLowerCase();
  const cfilter = $("qClass").value || "";
  const sort = $("qSort").value;
  const isSearching = q.length > 0 || cfilter.length > 0;

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
    const tog = document.getElementById("btnItemsToggle");
    if (tog) tog.style.display = "none";
    return;
  }

  // Mostrar 10 por defeito, excepto se está a pesquisar
  const LIMIT = 10;
  const shown = (itemsExpanded || isSearching) ? src : src.slice(0, LIMIT);

  for (const it of shown) {
    const row = document.createElement("div");
    row.className = "item";
    const badge = !showingLiabs ? yieldBadge(it) : "";
    const gainBadge = !showingLiabs ? renderGainLossBadge(it) : "";
    const cBadge = !showingLiabs ? ccyBadge(it) : "";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(it.name || "—")}${gainBadge}${cBadge}</div>
      <div class="item__s">${escapeHtml(it.class || "")}${badge}${!showingLiabs ? appreciationBadge(it) : ""}</div>
    </div><div class="item__v">${fmtEUR(parseNum(it.value))}</div>`;
    row.addEventListener("click", () => editItem(it.id));
    list.appendChild(row);
  }

  // Botão Ver todos / Ver menos
  const tog = document.getElementById("btnItemsToggle");
  if (tog) {
    if (src.length > LIMIT && !isSearching) {
      tog.style.display = "";
      tog.textContent = itemsExpanded
        ? "▲ Ver menos"
        : `▼ Ver mais (${src.length})`;
    } else {
      tog.style.display = "none";
    }
  }
}

function yieldBadge(it) {
  const yt = it.yieldType || "none", yv = parseNum(it.yieldValue);
  if (yt === "yield_pct" && yv > 0) return ` · <span class="badge badge--green">${fmtPct(yv)}</span>`;
  if (yt === "yield_eur_year" && yv > 0) return ` · <span class="badge badge--green">${fmtEUR(yv)}/ano</span>`;
  if (yt === "rent_month" && yv > 0) return ` · <span class="badge badge--green">${fmtEUR(yv)}/mês</span>`;
  return "";
}

function appreciationBadge(it) {
  const r = getAssetAppreciationPct(it, { allowClassFallback: false });
  if (Math.abs(r) < 1e-9) return "";
  return ` · <span class="badge badge--purple">↑ ${fmtPct(r)}</span>`;
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
  const curSel = document.getElementById("mCurrency");
  if (curSel) curSel.value = "EUR";
  const vlEl = document.getElementById("mValueLocal");
  if (vlEl) vlEl.value = "";
  const fxNote = document.getElementById("mFxNote");
  if (fxNote) fxNote.style.display = "none";
  $("mYieldType").value = "none";
  $("mYieldValue").value = "";
  $("mAppreciationPct").value = "";
  $("mMaturity").value = "";
  $("mCompound").value = "12";
  $("mNotes").value = "";
  const _cbEl = document.getElementById("mCostBasis");
  if (_cbEl) _cbEl.value = "";
  // v21: limpar campos de mercado
  const _tkEl  = document.getElementById("mTicker");
  const _qtyEl = document.getElementById("mQty");
  const _lsEl  = document.getElementById("mLookupStatus");
  if (_tkEl)  _tkEl.value  = "";
  if (_qtyEl) _qtyEl.value = "";
  if (_lsEl)  { _lsEl.style.display = "none"; _lsEl.textContent = ""; }
  toggleYieldFields(kind);
  toggleMarketFields(kind);
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
  wireCurrencyModal();
  wireMarketLookup();
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
  $("mAppreciationPct").disabled = isLiab;
  $("mMaturity").disabled = isLiab;
  $("mCompound").disabled = isLiab;
  const yieldRow = document.getElementById("yieldRow");
  if (yieldRow) yieldRow.style.display = isLiab ? "none" : "";
}

/* v21: Mostrar campos Ticker+Qty só quando a classe selecionada é de mercado */
const MARKET_CLASSES_FOR_TICKER = new Set(["Ações/ETFs","Cripto","Fundos","Obrigações","Ouro","Prata"]);
function toggleMarketFields(kind) {
  const mr = document.getElementById("marketRow");
  if (!mr) return;
  if (kind === "liab") { mr.style.display = "none"; return; }
  const cls = ($("mClass").value || "").trim();
  mr.style.display = MARKET_CLASSES_FOR_TICKER.has(cls) ? "" : "none";
}

/* v21: Ligar classe change → toggle + botão Buscar cotação */
function wireMarketLookup() {
  const clsEl = document.getElementById("mClass");
  if (clsEl && !clsEl._mktWired) {
    clsEl.addEventListener("change", () => {
      const k = $("btnSaveItem").dataset.kind || "asset";
      toggleMarketFields(k);
    });
    clsEl._mktWired = true;
  }
  const btn = document.getElementById("btnLookupQuote");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", async () => {
    const tk  = (($("mTicker") || {}).value || "").trim().toUpperCase();
    const qty = parseNum(($("mQty") || {}).value);
    const status = document.getElementById("mLookupStatus");
    if (!tk) { if (status) { status.style.display=""; status.textContent="Introduz o ticker primeiro."; } return; }
    const workerUrl = (state.settings && state.settings.workerUrl) || "";
    if (!workerUrl) {
      if (status) { status.style.display=""; status.textContent="⚠️ Worker URL não configurado. Clica em ⟳ Cotações para configurar."; }
      return;
    }
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = "⏳ A procurar…";
    if (status) { status.style.display=""; status.textContent="A consultar Yahoo Finance…"; }
    try {
      // Resolver candidatos (inclui cripto + overrides + ISIN map)
      // Criar um "asset temporário" com a classe + ticker para reaproveitar buildYahooTickerCandidates
      const fakeAsset = {
        class: $("mClass").value || "Outros",
        ticker: tk,
        name: ($("mName").value || "").trim() || tk,
        isin: ""
      };
      let candidates = [];
      // Cripto: resolver directamente via CRYPTO_YAHOO_MAP
      const clsNorm = String(fakeAsset.class).toLowerCase();
      if (clsNorm === "cripto" || clsNorm === "crypto") {
        const cTk = (typeof cryptoToYahoo === "function") ? cryptoToYahoo(tk) : null;
        if (cTk) candidates.push(cTk);
      }
      // Adicionar também o ticker raw e variantes conhecidas
      if (!candidates.includes(tk)) candidates.push(tk);
      // Tentar com sufixos comuns se é cripto não listada
      if (clsNorm === "cripto" && !tk.includes("-")) {
        const fallback = tk + "-USD";
        if (!candidates.includes(fallback)) candidates.push(fallback);
      }

      let quote = null, usedTk = null, lastErr = null;
      for (const cand of candidates) {
        try {
          const q = await fetchQuote(cand, workerUrl);
          if (q && Number.isFinite(q.price) && q.price > 0) { quote = q; usedTk = cand; break; }
        } catch (e) { lastErr = e; }
      }
      if (!quote) throw lastErr || new Error("Sem cotação disponível para esse ticker");

      // FX para EUR se preciso
      const ccy = (quote.currency || "EUR").toUpperCase();
      let fxToEur = 1;
      if (ccy !== "EUR") {
        try {
          const fxQ = await fetchQuote(`EUR${ccy}=X`, workerUrl);
          if (fxQ && fxQ.price > 0) fxToEur = 1 / fxQ.price;
        } catch(_) {
          const FX_LOCAL = {USD:0.92, GBP:1.17, CHF:1.05, CAD:0.68, AUD:0.59,
            DKK:0.134, SEK:0.087, NOK:0.085, PLN:0.23, JPY:0.006};
          fxToEur = FX_LOCAL[ccy] || 1;
        }
      }
      const priceEur = quote.price * fxToEur;

      // Preencher moeda e valor
      const curSel = document.getElementById("mCurrency");
      if (curSel) curSel.value = ccy;
      const vlEl = document.getElementById("mValueLocal");
      const valEl = document.getElementById("mValue");
      if (qty > 0) {
        // qty × preço (moeda original) → valor local
        if (vlEl)  vlEl.value  = (quote.price * qty).toFixed(2);
        if (valEl) valEl.value = (priceEur * qty).toFixed(2);
      } else {
        // sem qty → só preço unitário
        if (vlEl)  vlEl.value  = String(quote.price);
        if (valEl) valEl.value = priceEur.toFixed(2);
      }
      // Preencher nome se estiver vazio
      const nmEl = document.getElementById("mName");
      if (nmEl && !nmEl.value.trim() && quote.name) nmEl.value = quote.name;

      if (status) {
        const qtyPart = qty > 0 ? `${qty} × ` : "";
        const ccyPart = ccy === "EUR" ? "" : ` (${quote.price.toFixed(4)} ${ccy})`;
        status.style.display = "";
        status.textContent = `✅ ${usedTk}: ${qtyPart}${fmtEUR2(priceEur)}${ccyPart}`;
      }
    } catch (e) {
      if (status) { status.style.display=""; status.textContent = `❌ ${e.message || "Erro na consulta"}`; }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
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
  const curSel2 = document.getElementById("mCurrency");
  if (curSel2) curSel2.value = it.currency || "EUR";
  const vlEl2 = document.getElementById("mValueLocal");
  if (vlEl2) vlEl2.value = it.valueLocal ? String(it.valueLocal) : "";
  $("mNotes").value = it.notes || "";
  toggleYieldFields(kind);
  wireCurrencyModal();
  if (!showingLiabs) {
    $("mYieldType").value = it.yieldType || "none";
    $("mYieldValue").value = it.yieldValue != null ? String(it.yieldValue) : "";
    const appEl = document.getElementById("mAppreciationPct");
    if (appEl) appEl.value = hasExplicitAppreciationPct(it) ? String(parseNum(it.appreciationPct)) : "";
    $("mMaturity").value = it.maturityDate || "";
    $("mCompound").value = String(it.compoundFreq || 12);
    const cbEl = document.getElementById("mCostBasis");
    if (cbEl) cbEl.value = it.costBasis ? String(it.costBasis) : "";
    // v21: ticker + qty
    const tkEl = document.getElementById("mTicker");
    const qtyEl = document.getElementById("mQty");
    if (tkEl)  tkEl.value  = it.ticker || "";
    if (qtyEl) qtyEl.value = it.qty ? String(it.qty) : "";
    toggleMarketFields(kind);
    wireMarketLookup();
  } else {
    $("mYieldType").value = "none";
    $("mYieldValue").value = "";
    const appEl = document.getElementById("mAppreciationPct");
    if (appEl) appEl.value = "";
    $("mMaturity").value = "";
    $("mCompound").value = "12";
  }
  $("btnSaveItem").dataset.kind = kind;
  openModal("modalItem");
}

function saveItemFromModal() {
  const kind = $("btnSaveItem").dataset.kind;
  const isLiab = kind === "liab";
  const curSelS = document.getElementById("mCurrency");
  const savedCcy = curSelS ? (curSelS.value || "EUR") : "EUR";
  const vlElS    = document.getElementById("mValueLocal");
  const savedVL  = vlElS ? parseNum(vlElS.value) : 0;
  // If user entered a local value and currency != EUR, auto-convert to EUR
  let eurValue = parseNum($("mValue").value);
  if (savedCcy !== "EUR" && savedVL > 0) {
    eurValue = toEUR(savedVL, savedCcy);
  }
  const obj = {
    id: editingItemId || uid(),
    class: $("mClass").value || "Outros",
    name: ($("mName").value || "").trim(),
    value: eurValue,
    currency: savedCcy || "EUR",
    valueLocal: savedVL || 0,
    notes: ($("mNotes").value || "").trim()
  };
  // v21: Ticker + quantidade para classes de mercado
  const tkEl  = document.getElementById("mTicker");
  const qtyEl = document.getElementById("mQty");
  const tk    = tkEl  ? String(tkEl.value  || "").trim().toUpperCase() : "";
  const qty   = qtyEl ? parseNum(qtyEl.value || 0) : 0;
  if (tk)  obj.ticker = tk;
  if (qty > 0) obj.qty = qty;
  // Se preencheu ticker + qty + valor, calcula PM (preço médio original) automaticamente
  if (tk && qty > 0 && obj.value > 0) {
    obj.pmOriginal = obj.value / qty;
    obj.pmCcy = savedCcy || "EUR";
  }
  if (!obj.name) { toast("Nome é obrigatório."); return; }
  if (!isLiab) {
    obj.yieldType = $("mYieldType").value || "none";
    obj.yieldValue = parseNum($("mYieldValue").value);
    const appRaw = ((document.getElementById("mAppreciationPct") || {}).value || "").trim();
    if (appRaw) obj.appreciationPct = parseNum(appRaw); else delete obj.appreciationPct;
    obj.maturityDate = $("mMaturity").value || "";
    obj.compoundFreq = parseInt($("mCompound").value) || 12;
    const cb = parseNum((document.getElementById("mCostBasis") || {}).value || "");
    if (cb > 0) obj.costBasis = cb; else delete obj.costBasis;
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
const TX_PREVIEW_COUNT = 10;

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
  const all = expandRecurring(state.transactions).filter(t => parseNum(t.amount) > 0 && !isInterAccountTransfer(t));
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

function isInterAccountTransfer(t) {
  const cat = normStr(t.category || "");
  const note = normStr(t.notes || "");
  // Categorias explicitamente internas
  const internalCats = [
    "transferencia entre contas",
    "transferencia interna",
    "poupanca propria",
    "constituicao dp",
    "mesada",             // transferência para filho — interno ao agregado
  ];
  if (internalCats.some(k => cat.includes(k))) return true;
  // Detectar por notas/descrição importada
  const internalNoteKw = [
    "transferencia entre contas",
    "constituicao de d.p",
    "constituicao de dp",
    "poupanca noutra",
    "mesada pedro",
    "mesada miudos",
    "trf.imed. p/ pedro nunes",
  ];
  if (internalNoteKw.some(k => note.includes(k))) return true;
  return false;
}

function renderCashflow() {
  ensureMonthYearOptions();
  const y = $("cfYear").value;
  const m = String($("cfMonth").value).padStart(2, "0");
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const monthKey = `${y}-${m}`;

  // Filter transactions by selected period AND exclude internal transfers
  const allExpanded = expandRecurring(state.transactions).filter(t => !isInterAccountTransfer(t));

  let periodTx;
  if (gran === "year") {
    periodTx = allExpanded.filter(t => String(t.date || "").slice(0, 4) === y);
  } else if (gran === "all") {
    periodTx = allExpanded;
  } else {
    // month (default) — or day/week still show monthly summary totals
    periodTx = allExpanded.filter(t => monthKeyFromDateISO(t.date) === monthKey);
  }

  const totalIn  = periodTx.filter(t => t.type === "in" ).reduce((a, t) => a + parseNum(t.amount), 0);
  const totalOut = periodTx.filter(t => t.type === "out").reduce((a, t) => a + parseNum(t.amount), 0);
  const net  = totalIn - totalOut;
  const rate = totalIn > 0 ? (net / totalIn) * 100 : 0;

  $("cfIn").textContent  = fmtEUR(totalIn);
  $("cfOut").textContent = fmtEUR(totalOut);
  $("cfNet").textContent = fmtEUR(net);
  $("cfRate").textContent = `${Math.round(rate)}%`;

  // Period label
  const periodLabel = gran === "year" ? `Ano ${y}` :
                      gran === "all"  ? "Todo o período" :
                      `${m}/${y}`;
  const cfTitle = document.getElementById("cfPeriodLabel");
  if (cfTitle) cfTitle.textContent = periodLabel;

  renderSavingsRate(totalIn, totalOut);
  renderTxList();
  renderCashflowChart();
  renderCatChart();
}

function renderBalance() { renderCashflow(); }

function renderCashflowChart() {
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const { keys, data } = cfGranData(gran);
  const ctx = ensureChartCtx("cfChart", 200);
  if (!ctx) { renderChartUnavailable("cfChart"); return; }
  clearChartUnavailable("cfChart");
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
  const y = $("cfYear") ? $("cfYear").value : String(new Date().getFullYear());
  const m = $("cfMonth") ? String($("cfMonth").value).padStart(2,"0") : String(new Date().getMonth()+1).padStart(2,"0");
  const key = `${y}-${m}`;

  // Mostrar TODOS os movimentos originais (não expandidos) do mês seleccionado
  const gran2 = ($("cfGranularity") && $("cfGranularity").value) || "month";
  let txFilter;
  if (gran2 === "year") {
    txFilter = t => String(t.date || "").slice(0,4) === y;
  } else if (gran2 === "all") {
    txFilter = t => true;
  } else {
    txFilter = t => monthKeyFromDateISO(t.date) === key;
  }
  const tx = state.transactions
    .filter(t => txFilter(t) && parseNum(t.amount) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!tx.length) {
    wrap.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem movimentos</div><div class="item__s">Importa o extracto ou adiciona manualmente.</div></div><div class="item__v">—</div></div>`;
    $("btnTxToggle").style.display = "none";
    return;
  }

  const shown = txExpanded ? tx : tx.slice(0, TX_PREVIEW_COUNT);
  for (const t of shown) {
    const isTransfer = isInterAccountTransfer(t);
    const sign = isTransfer ? "⇄" : (t.type === "in" ? "+" : "−");
    const signColor = isTransfer ? "#94a3b8" : (t.type === "in" ? "#059669" : "#dc2626");
    const typeLabel = isTransfer ? "⇄ Transf. interna (neutra)" : (t.type === "in" ? "Entrada" : "Saída");
    const notesTxt = t.notes && t.notes !== t.category ? t.notes.slice(0,50) : "";

    const row = document.createElement("div");
    row.className = "item";
    row.style.cssText = "position:relative;overflow:hidden;cursor:pointer;";

    row.innerHTML = `
      <div class="item__l" style="flex:1;min-width:0">
        <div class="item__t" style="color:${signColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${sign} ${escapeHtml(t.category)}
        </div>
        <div class="item__s">${escapeHtml(typeLabel)} · ${escapeHtml(t.date)}${t.recurring !== "none" ? " · ↻" : ""}${notesTxt ? `<br><span style="opacity:.7">${escapeHtml(notesTxt)}</span>` : ""}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div class="item__v" style="color:${signColor}">${fmtEUR(parseNum(t.amount))}</div>
        <button data-txid="${t.id}" class="tx-del-btn" style="
          border:0;background:#fee2e2;color:#dc2626;border-radius:10px;
          padding:6px 10px;font-weight:900;font-size:16px;cursor:pointer;flex-shrink:0
        " title="Apagar">🗑</button>
      </div>`;

    // Clicar na área de texto abre edição
    row.querySelector(".item__l").addEventListener("click", () => openTxModal(t.id));

    // Botão apagar inline — sem modal, com confirmação rápida
    row.querySelector(".tx-del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      if (btn.dataset.confirm === "1") {
        // Segunda vez — apagar
        state.transactions = state.transactions.filter(x => x.id !== t.id);
        saveState();
        renderCashflow();
        toast("Movimento apagado.");
      } else {
        // Primeira vez — pedir confirmação visual
        btn.dataset.confirm = "1";
        btn.textContent = "✓ Confirmar";
        btn.style.background = "#dc2626";
        btn.style.color = "#fff";
        btn.style.padding = "6px 8px";
        btn.style.fontSize = "12px";
        setTimeout(() => {
          if (btn.dataset.confirm === "1") {
            btn.dataset.confirm = "0";
            btn.textContent = "🗑";
            btn.style.background = "#fee2e2";
            btn.style.color = "#dc2626";
            btn.style.padding = "6px 10px";
            btn.style.fontSize = "16px";
          }
        }, 3000);
      }
    });

    wrap.appendChild(row);
  }

  if (tx.length > TX_PREVIEW_COUNT) {
    $("btnTxToggle").style.display = "inline";
    $("btnTxToggle").textContent = txExpanded ? "▲ Ver menos" : `▼ Ver mais (${tx.length})`;
  } else {
    $("btnTxToggle").style.display = "none";
  }
}

/* ─── DIVIDENDOS — MODO RESUMO ANUAL ─────────────────────── */
let divMode = "summary"; // "summary" | "detail"
let editingDivSummaryId = null;
let divProjChart = null;
let divSummaryChart = null;

function initDivSummaryYearSelect() {
  const sel = $("divSummaryYear");
  if (!sel) return;
  const now = new Date().getFullYear();
  sel.innerHTML = "";
  for (let y = now; y >= now - 10; y--) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  }
  // Pre-fill from existing summary for selected year
  sel.addEventListener("change", () => prefillDivSummaryFromYear(parseInt(sel.value)));
  prefillDivSummaryFromYear(now);
}

function prefillDivSummaryFromYear(year) {
  const existing = (state.divSummaries || []).find(s => s.year === year);
  const delBtn = document.getElementById("btnDeleteDivSummary");
  const saveBtn = $("btnSaveDivSummary");

  if (existing) {
    const radio = document.querySelector('input[name="divInputMode"][value="gross_tax"]');
    if (radio) { radio.checked = true; showDivFields("gross_tax"); }
    $("divSummaryGross").value = String(parseNum(existing.gross) || "");
    $("divSummaryTax").value = String(parseNum(existing.tax) || "");
    const yv = String(parseNum(existing.yieldPct) || "");
    ["divSummaryYield_gt","divSummaryYield_net","divSummaryYield_py","divSummaryYield_yo"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = yv;
    });
    $("divSummaryNotes").value = existing.notes || "";
    editingDivSummaryId = existing.id;
    if (saveBtn) saveBtn.textContent = `Atualizar ${year}`;
    if (delBtn) delBtn.style.display = "";
    updateDivSummaryLive();
  } else {
    $("divSummaryGross").value = "";
    $("divSummaryTax").value = "";
    $("divSummaryNet").value = "";
    const prevSummary = (state.divSummaries || [])
      .filter(s => s.year < year).sort((a, b) => b.year - a.year)[0];
    const prefYield = getPreferredDividendYieldData().selectedYieldPct;
    const yieldVal = prevSummary
      ? String(parseNum(prevSummary.yieldPct))
      : (prefYield > 0 ? fmt(prefYield, 2) : "");
    ["divSummaryYield_gt","divSummaryYield_net","divSummaryYield_py","divSummaryYield_yo"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = yieldVal;
    });
    $("divSummaryNotes").value = "";
    editingDivSummaryId = null;
    if (saveBtn) saveBtn.textContent = `Guardar resumo ${year}`;
    if (delBtn) delBtn.style.display = "none";
    const liveEl = document.getElementById("divSummaryLive");
    if (liveEl) liveEl.style.display = "none";
  }
  const pEl = $("divProjYield");
  if (pEl && !pEl.value && existing) pEl.value = String(parseNum(existing.yieldPct));
}

function getDivInputMode() {
  const checked = document.querySelector('input[name="divInputMode"]:checked');
  return checked ? checked.value : "gross_tax";
}

function showDivFields(mode) {
  ["gross_tax","net_only","portfolio_yield","yield_only"].forEach(m => {
    const el = document.getElementById("divFields_" + m);
    if (el) el.style.display = m === mode ? "" : "none";
  });
  // Update portfolio value display for yield_only mode
  if (mode === "yield_only") {
    const divData = calcDividendYield();
    const el = document.getElementById("divYoPortfolioVal");
    if (el) {
      const src = divData.source === "summary" ? " (via resumo anual)" :
                  divData.source === "individual" ? " (via dividendos registados)" : " (via yields dos ativos)";
      el.textContent = divData.divPortfolioVal > 0
        ? fmtEUR(divData.divPortfolioVal) + src
        : "Sem ativos com yield %";
    }
  }
}

function calcDivFromInputs() {
  const mode = getDivInputMode();
  let gross = 0, tax = 0, net = 0, yieldPct = 0;

  if (mode === "gross_tax") {
    gross = parseNum($("divSummaryGross").value);
    tax = parseNum($("divSummaryTax").value);
    net = gross - tax;
    yieldPct = parseNum($("divSummaryYield_gt").value);

  } else if (mode === "net_only") {
    net = parseNum($("divSummaryNet").value);
    const retRate = parseNum($("divSummaryRetRate").value) || 0;
    gross = retRate > 0 ? net / (1 - retRate / 100) : net;
    tax = gross - net;
    yieldPct = parseNum($("divSummaryYield_net").value);

  } else if (mode === "portfolio_yield") {
    const portfolio = parseNum($("divSummaryPortfolio").value);
    yieldPct = parseNum($("divSummaryYield_py").value);
    const retRate = parseNum($("divSummaryRetRate_py").value) || 28;
    gross = portfolio * (yieldPct / 100);
    tax = gross * (retRate / 100);
    net = gross - tax;

  } else if (mode === "yield_only") {
    // Usa só os ativos com yield_pct (ações/ETFs que pagam dividendos)
    const divData = calcDividendYield();
    const portfolioDiv = divData.divPortfolioVal;
    yieldPct = parseNum($("divSummaryYield_yo").value);
    const retRate = parseNum($("divSummaryRetRate_yo").value) || 28;
    gross = portfolioDiv * (yieldPct / 100);
    tax = gross * (retRate / 100);
    net = gross - tax;
  }

  return { gross, tax, net, yieldPct };
}

function updateDivSummaryLive() {
  const { gross, tax, net, yieldPct } = calcDivFromInputs();
  const liveEl = document.getElementById("divSummaryLive");
  if (!liveEl) return;
  if (!gross && !net) { liveEl.style.display = "none"; return; }
  liveEl.style.display = "";
  const retPct = gross > 0 ? (tax / gross * 100) : 0;
  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT("divSummaryLiveGross", fmtEUR2(gross));
  setT("divSummaryLiveNet", fmtEUR2(net));
  setT("divSummaryLiveMth", fmtEUR2(net / 12));
  setT("divSummaryLiveRet", tax > 0 ? `${fmtEUR2(tax)} (${fmtPct(retPct)})` : "Sem retenção");
}

function deleteDivSummary() {
  if (!editingDivSummaryId) return;
  const s = (state.divSummaries || []).find(x => x.id === editingDivSummaryId);
  if (!s) return;
  if (!confirm(`Apagar resumo de ${s.year}?`)) return;
  state.divSummaries = state.divSummaries.filter(x => x.id !== editingDivSummaryId);
  editingDivSummaryId = null;
  saveState();
  renderDividends();
  renderDashboard();
  initDivSummaryYearSelect();
  toast("Resumo apagado.");
}

function saveDivSummary() {
  const year = parseInt($("divSummaryYear").value);
  const { gross, tax, net, yieldPct } = calcDivFromInputs();
  const notes = ($("divSummaryNotes").value || "").trim();

  if (!gross || gross <= 0) { toast("Não foi possível calcular o bruto. Verifica os valores."); return; }
  if (!yieldPct || yieldPct <= 0) { toast("Introduz o Dividend Yield da corretora."); return; }

  if (!Array.isArray(state.divSummaries)) state.divSummaries = [];

  const obj = { id: editingDivSummaryId || uid(), year, gross, tax: tax || 0, yieldPct, notes };
  const ix = state.divSummaries.findIndex(s => s.id === obj.id || s.year === year);
  if (ix >= 0) state.divSummaries[ix] = obj;
  else state.divSummaries.push(obj);

  saveState();
  renderDividends();
  renderDashboard();
  // Auto-fill projection yield field
  const projYieldEl = $("divProjYield");
  if (projYieldEl && !projYieldEl.value) {
    const pref = getPreferredDividendYieldData();
    projYieldEl.value = pref.selectedYieldPct > 0 ? fmt(pref.selectedYieldPct, 2) : String(yieldPct);
  }
  toast(`Resumo ${year} guardado. Líquido: ${fmtEUR2(net)}`);
}

function renderDivSummaryKPIs() {
  const el = $("divSummaryKPIs");
  if (!el) return;

  const pref = getPreferredDividendYieldData();
  const divPortfolioVal = pref.divPortfolioVal;
  const selectedYield   = pref.selectedYieldPct;
  const selectedLabel   = pref.selectedModeLabel;
  const selectedMode    = pref.selectedMode;
  const sourceLabel     = pref.sourceLabel;

  // Real dividend stats from imported data (all years)
  const sourceDivs = getRealDividendRecords();
  const realStats = calcDividendStatsByYear(sourceDivs);
  const hasRealData = realStats.length > 0 && realStats[0].gross > 0;

  // Annual summaries (mix of auto-generated and manual)
  const summaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  const latest    = summaries[0];

  // Key metrics for the hero card
  const now    = new Date();
  const curY   = now.getFullYear();
  const curYSt = realStats.find(s => s.year === curY);
  const prevYSt= realStats.find(s => s.year === curY - 1);

  // TTM = last 12 months (rolling)
  const cutoff12m = new Date(now.getFullYear()-1, now.getMonth(), now.getDate()).toISOString().slice(0,10);
  const ttmDivs   = sourceDivs.filter(d => String(d.date||"") >= cutoff12m);
  const ttmGross  = ttmDivs.reduce((s,d) => s + getDividendGross(d), 0);
  const ttmNet    = ttmDivs.reduce((s,d) => s + getDividendNet(d), 0);
  const ttmWh     = ttmGross - ttmNet;
  const ttmYieldG = divPortfolioVal > 0 ? (ttmGross / divPortfolioVal * 100) : selectedYield;
  const ttmYieldN = divPortfolioVal > 0 ? (ttmNet   / divPortfolioVal * 100) : 0;
  const ttmYield  = selectedMode === "net" ? ttmYieldN : ttmYieldG;

  // YoY growth (last full year vs year before)
  let yoyGrowth = null;
  if (prevYSt && curYSt) {
    // Compare current YTD annualised vs prev full year
    const monthsIn = now.getMonth() + 1;
    const curAnnual = curYSt.gross * (12 / monthsIn);
    yoyGrowth = prevYSt.gross > 0 ? ((curAnnual - prevYSt.gross) / prevYSt.gross * 100) : null;
  } else if (summaries.length >= 2) {
    yoyGrowth = parseNum(summaries[1].gross) > 0
      ? ((parseNum(latest.gross) - parseNum(summaries[1].gross)) / parseNum(summaries[1].gross) * 100) : null;
  }

  // Source badge
  const usingBrokerReal = sourceDivs.length > 0 && sourceDivs.every(d => d && d.generatedFromBroker);
  const sourceBadge = usingBrokerReal
    ? `<span style="background:#d1fae5;color:#065f46;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px">✅ Dados reais da corretora</span>`
    : hasRealData
      ? `<span style="background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px">📒 Dividendos registados</span>`
      : `<span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px">Manual</span>`;

  el.innerHTML = `
    <!-- HERO: dividendos TTM -->
    <div class="card" style="margin-top:0;padding:0;overflow:hidden">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:16px 16px 14px;color:#fff">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;opacity:.75;margin-bottom:8px">
          Rendimento de dividendos · TTM${sourceBadge}
        </div>
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
          <div style="font-size:36px;font-weight:900;letter-spacing:-1px;line-height:1">${fmtEUR(ttmNet)}</div>
          <div>
            <div style="font-size:14px;font-weight:800">líquido / 12 meses</div>
            <div style="font-size:11px;opacity:.7">${fmtEUR(ttmNet/12)}/mês estimado</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
          <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
            <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Bruto TTM</div>
            <div style="font-size:13px;font-weight:900;margin-top:1px">${fmtEUR(ttmGross)}</div>
          </div>
          <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
            <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Retenção</div>
            <div style="font-size:13px;font-weight:900;margin-top:1px">-${fmtEUR(ttmWh)}</div>
          </div>
          <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
            <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Yield ${selectedLabel}</div>
            <div style="font-size:13px;font-weight:900;margin-top:1px">${fmtPct(ttmYield)}</div>
          </div>
          <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
            <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Crescim. YoY</div>
            <div style="font-size:13px;font-weight:900;margin-top:1px;color:${yoyGrowth===null?"#fff":yoyGrowth>=0?"#a7f3d0":"#fca5a5"}">
              ${yoyGrowth===null?"—":(yoyGrowth>=0?"+":"")+fmtPct(yoyGrowth)}
            </div>
          </div>
        </div>
        <div style="font-size:11px;opacity:.78;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>Carteira de dividendos: <b>${fmtEUR(divPortfolioVal)}</b> · ${ttmDivs.length} pagamentos TTM</span>
          <button class="btn btn--outline btn--sm" type="button" onclick="openDividendBaseModal()" style="padding:4px 8px;font-size:11px;border-color:rgba(255,255,255,.35);color:#fff;background:rgba(255,255,255,.08)">Ver base</button>
        </div>
      </div>

      <!-- Selector yield modo + botão projeção -->
      <div style="padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line)">
        <div class="seg" style="margin:0;flex:1;min-width:200px;max-width:280px">
          <button class="seg__btn ${selectedMode==='gross'?'seg__btn--active':''}" type="button" data-divyield-mode="gross">Yield bruto TTM</button>
          <button class="seg__btn ${selectedMode==='net'?'seg__btn--active':''}" type="button" data-divyield-mode="net">Yield líquido TTM</button>
        </div>
        <button class="btn btn--primary btn--sm" type="button" data-divyield-apply="1">📈 Usar na projeção</button>
      </div>
    </div>

    <!-- Por ano (todos os anos com dados) -->
    ${realStats.length > 0 ? `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:12px 16px 8px;font-weight:800;font-size:13px">
        📅 Por ano — dados reais
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--card2);color:var(--muted);font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.4px">
              <th style="padding:8px 16px;text-align:left">Ano</th>
              <th style="padding:8px 8px;text-align:right">Bruto</th>
              <th style="padding:8px 8px;text-align:right">Retenção</th>
              <th style="padding:8px 8px;text-align:right">Líquido</th>
              <th style="padding:8px 8px;text-align:right">Yield</th>
              <th style="padding:8px 16px;text-align:right">Pagamentos</th>
            </tr>
          </thead>
          <tbody>
            ${realStats.map((s, i) => {
              const yld = divPortfolioVal > 0 ? (s.gross/divPortfolioVal*100) : 0;
              const isCurrentYear = s.year === new Date().getFullYear();
              const prev = realStats[i+1];
              const yoy = prev && prev.gross > 0 ? ((s.gross - prev.gross)/prev.gross*100) : null;
              const rowStyle = i % 2 === 0 ? "" : "background:var(--card2)";
              return `<tr style="${rowStyle}">
                <td style="padding:9px 16px;font-weight:800">
                  ${s.year}
                  ${isCurrentYear ? '<span style="font-size:9px;background:#ede9fe;color:#6d28d9;padding:1px 5px;border-radius:999px;font-weight:700;margin-left:4px">YTD</span>' : ''}
                </td>
                <td style="padding:9px 8px;text-align:right;font-weight:700">${fmtEUR2(s.gross)}</td>
                <td style="padding:9px 8px;text-align:right;color:var(--red)">-${fmtEUR2(s.wh)}</td>
                <td style="padding:9px 8px;text-align:right;color:var(--green);font-weight:900">${fmtEUR2(s.net)}</td>
                <td style="padding:9px 8px;text-align:right">${yld>0?fmtPct(yld):"—"}</td>
                <td style="padding:9px 16px;text-align:right;color:var(--muted)">${s.count}${yoy!==null?` <span style="font-size:10px;color:${yoy>=0?"var(--green)":"var(--red)"}">${yoy>=0?"+":""}${yoy.toFixed(0)}%</span>`:""}</td>
              </tr>`;
            }).join("")}
          </tbody>
          <tfoot>
            <tr style="background:var(--card2);font-weight:900;border-top:2px solid var(--line)">
              <td style="padding:9px 16px">Total</td>
              <td style="padding:9px 8px;text-align:right">${fmtEUR2(realStats.reduce((s,r)=>s+r.gross,0))}</td>
              <td style="padding:9px 8px;text-align:right;color:var(--red)">-${fmtEUR2(realStats.reduce((s,r)=>s+r.wh,0))}</td>
              <td style="padding:9px 8px;text-align:right;color:var(--green)">${fmtEUR2(realStats.reduce((s,r)=>s+r.net,0))}</td>
              <td style="padding:9px 8px;text-align:right">—</td>
              <td style="padding:9px 16px;text-align:right;color:var(--muted)">${realStats.reduce((s,r)=>s+r.count,0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>` : `
    <div class="note" style="margin-top:10px">
      Sem dados de dividendos importados. Importa o CSV da corretora (Trading 212, XTB) em <b>Importar → Importar corretoras</b>.
    </div>`}

    <!-- Top tickers por dividendo (all time) -->
    ${(function() {
      const byTicker = {};
      for (const d of sourceDivs) {
        const rawTk = String(d.assetName || d.assetId || "").trim();
        const tk = rawTk.split(" — ")[0].trim();
        if (!tk) continue;
        if (!byTicker[tk]) byTicker[tk] = { gross: 0, net: 0, count: 0 };
        byTicker[tk].gross += getDividendGross(d);
        byTicker[tk].net   += getDividendNet(d);
        byTicker[tk].count++;
      }
      const sorted = Object.entries(byTicker)
        .sort((a,b) => b[1].gross - a[1].gross)
        .slice(0, 10);
      if (!sorted.length) return "";
      return `<div class="card" style="padding:0;overflow:hidden">
        <div style="padding:12px 16px 8px;font-weight:800;font-size:13px">🏆 Top 10 pagadores (todo o período)</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--card2);color:var(--muted);font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.4px">
              <th style="padding:7px 16px;text-align:left">Ticker</th>
              <th style="padding:7px 8px;text-align:right">Bruto</th>
              <th style="padding:7px 8px;text-align:right">Líquido</th>
              <th style="padding:7px 16px;text-align:right">Pagam.</th>
            </tr></thead>
            <tbody>
              ${sorted.map(([tk, d], i) => `<tr style="${i%2===0?"":"background:var(--card2)"}">
                <td style="padding:8px 16px;font-weight:800">${escapeHtml(tk)}</td>
                <td style="padding:8px 8px;text-align:right;font-weight:700">${fmtEUR2(d.gross)}</td>
                <td style="padding:8px 8px;text-align:right;color:var(--green)">${fmtEUR2(d.net)}</td>
                <td style="padding:8px 16px;text-align:right;color:var(--muted)">${d.count}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
    })()}`;

  el.querySelectorAll('[data-divyield-mode]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      const mode = btn.dataset.divyieldMode === 'net' ? 'net' : 'gross';
      setDividendYieldDisplayMode(mode);
      renderDividends();
    });
  });
  const applyBtn = el.querySelector('[data-divyield-apply]');
  if (applyBtn) applyBtn.addEventListener('click', ev => {
    ev.preventDefault();
    applyPreferredDividendYieldToProjection();
  });
  syncDividendProjectionField({ force: false });
}

function renderDivSummaryList() {
  const list = $("divSummaryList");
  if (!list) return;
  // Only show manual (non-auto-generated) summaries in this list
  const allSummaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  const summaries = allSummaries.filter(s => !s.generatedFromBroker);
  // Show/hide the card
  const card = document.getElementById("divSummaryListCard");
  if (card) card.style.display = summaries.length ? "" : "none";
  if (!summaries.length) {
    list.innerHTML = "";
    return;
  }
  const DIVSUM_LIMIT = 10;
  if (!window._divSumExpanded) window._divSumExpanded = false;
  const shownSummaries = window._divSumExpanded ? summaries : summaries.slice(0, DIVSUM_LIMIT);
  list.innerHTML = shownSummaries.map((s, i) => {
    const net = parseNum(s.gross) - parseNum(s.tax);
    const prev = summaries[summaries.indexOf(s) + 1];
    const yoy = prev ? ((parseNum(s.gross) - parseNum(prev.gross)) / Math.max(1, parseNum(prev.gross)) * 100) : null;
    return `<div class="item" data-summary-id="${s.id}" style="cursor:pointer">
      <div class="item__l">
        <div class="item__t">${s.year} ${s.notes ? `· ${escapeHtml(s.notes)}` : ""}</div>
        <div class="item__s">Yield ${fmtPct(parseNum(s.yieldPct))} · Bruto ${fmtEUR2(parseNum(s.gross))}${parseNum(s.tax) > 0 ? ` · Ret. ${fmtEUR2(parseNum(s.tax))}` : ""}${yoy !== null ? ` · YoY ${yoy >= 0 ? "+" : ""}${fmtPct(yoy)}` : ""}</div>
      </div>
      <div class="item__v" style="text-align:right">
        <div>${fmtEUR2(net)}</div>
        <div class="item__s">${fmtEUR2(net/12)}/mês</div>
      </div>
    </div>`;
  }).join("");
  if (summaries.length > DIVSUM_LIMIT) {
    const btn = document.createElement("div");
    btn.style.cssText = "text-align:center;margin-top:10px";
    btn.innerHTML = `<button class="btn btn--ghost btn--sm" style="font-size:13px">
      ${window._divSumExpanded ? "▲ Ver menos" : "▼ Ver mais (" + summaries.length + ")"}
    </button>`;
    btn.querySelector("button").addEventListener("click", () => {
      window._divSumExpanded = !window._divSumExpanded;
      renderDivSummaryList();
    });
    list.appendChild(btn);
  }

  // Click to edit
  list.querySelectorAll(".item[data-summary-id]").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.summaryId;
      const s = (state.divSummaries || []).find(x => x.id === id);
      if (!s) return;
      $("divSummaryYear").value = String(s.year);
      $("divSummaryGross").value = String(parseNum(s.gross));
      $("divSummaryTax").value = String(parseNum(s.tax));
      // Preencher o campo correto conforme o modo activo (default: gross_tax)
      $("divSummaryGross").value = String(parseNum(s.gross));
      $("divSummaryTax").value = String(parseNum(s.tax));
      $("divSummaryYield_gt").value = String(parseNum(s.yieldPct));
      // Garantir que o modo visível é gross_tax
      const modeRadio = document.querySelector('input[name="divInputMode"][value="gross_tax"]');
      if (modeRadio) { modeRadio.checked = true; modeRadio.dispatchEvent(new Event("change")); }
      $("divSummaryNotes").value = s.notes || "";
      editingDivSummaryId = s.id;
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast(`A editar ${s.year} — altera e guarda.`);
    });
  });
}

function renderDivSummaryChart() {
  const ctx = ensureChartCtx("divSummaryChart", 220);
  if (!ctx) { renderChartUnavailable("divSummaryChart"); return; }
  clearChartUnavailable("divSummaryChart");
  if (divSummaryChart) divSummaryChart.destroy();

  // Prefer real data from imports over manual summaries
  const realStats = calcDividendStatsByYear();
  const manualSummaries = (state.divSummaries || []).slice().sort((a, b) => a.year - b.year);
  const useReal = realStats.length > 0;

  const summaries = useReal
    ? realStats.slice().sort((a,b) => a.year - b.year).map(s => ({ year: s.year, gross: s.gross, tax: s.wh, net: s.net }))
    : manualSummaries.map(s => ({ year: s.year, gross: parseNum(s.gross), tax: parseNum(s.tax), net: parseNum(s.gross)-parseNum(s.tax) }));

  if (!summaries.length) return;

  const labels = summaries.map(s => String(s.year));
  const grossData = summaries.map(s => +(parseNum(s.gross||0)).toFixed(2));
  const netData   = summaries.map(s => +(parseNum(s.net || (s.gross - (s.tax||s.wh||0)))).toFixed(2));
  const taxData   = summaries.map(s => +(parseNum(s.tax || s.wh || 0)).toFixed(2));
  // yieldPct may be missing in real stats - compute if possible
  const divPV = getPreferredDividendYieldData().divPortfolioVal;
  const yieldData = summaries.map(s =>
    parseNum(s.yieldPct) || (divPV > 0 && s.gross > 0 ? +(s.gross/divPV*100).toFixed(2) : 0)
  );

  divSummaryChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Líquido", data: netData, backgroundColor: "#10b981", stack: "s" },
        { label: "Retenção", data: taxData, backgroundColor: "#f59e0b", stack: "s" },
        {
          label: "Yield (%)",
          data: yieldData,
          type: "line",
          yAxisID: "y2",
          borderColor: "#5b5ce6",
          backgroundColor: "transparent",
          pointRadius: 5,
          pointBackgroundColor: "#5b5ce6",
          borderWidth: 2,
          tension: 0.3
        }
      ]
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => c.dataset.yAxisID === "y2"
              ? `${c.dataset.label}: ${fmtPct(c.raw)}`
              : `${c.dataset.label}: ${fmtEUR2(c.raw)}`
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmtEUR(v) } },
        y2: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => fmtPct(v) }
        }
      }
    }
  });
}

function renderDivProjection() {
  const summaries = (state.divSummaries || []).slice().sort((a, b) => b.year - a.year);
  const latest = summaries[0];
  const pref = getPreferredDividendYieldData();

  // Keep the projection field aligned with the same dividend-base yield shown in the hero card.
  syncDividendProjectionField({ force: false });
  const projYieldEl = $("divProjYield");

  const projYieldField = parseNum($("divProjYield").value);
  const baseYield = projYieldField > 0 ? projYieldField : pref.selectedYieldPct;

  if (!baseYield) { toast("Introduz o Dividend Yield no campo acima."); return; }

  const portfolioGrowth = parseNum($("divProjGrowth").value) || 7;
  const contrib = parseNum($("divProjContrib").value) || 0;
  const years = parseInt($("divProjYears").value) || 20;

  const divData = calcDividendYield();
  const useNetYield = getDividendYieldDisplayMode() === 'net';

  let portfolioVal, baseNet, baseGross, effectiveRetRate;

  if (divData.gross > 0 && divData.divPortfolioVal > 0) {
    baseGross = parseNum(divData.gross);
    baseNet = parseNum(divData.net);
    portfolioVal = parseNum(divData.divPortfolioVal);
    effectiveRetRate = baseGross > 0 ? Math.max(0, Math.min(0.9, 1 - (baseNet / baseGross))) : 0;
  } else if (latest) {
    const gross = parseNum(latest.gross);
    const tax = parseNum(latest.tax);
    baseGross = gross;
    baseNet = gross - tax;
    effectiveRetRate = gross > 0 ? (tax / gross) : 0;
    const refIncome = useNetYield ? baseNet : baseGross;
    portfolioVal = baseYield > 0 ? refIncome / (baseYield / 100) : 0;
  } else {
    const userRetRate = parseNum($("divProjRet").value) || 0;
    effectiveRetRate = userRetRate / 100;
    portfolioVal = parseNum(divData.divPortfolioVal);
    baseGross = parseNum(divData.gross);
    baseNet = divData.net > 0 ? parseNum(divData.net) : baseGross * (1 - effectiveRetRate);
  }

  if (!portfolioVal || portfolioVal <= 0) {
    toast("Guarda um resumo anual com o bruto e o yield da corretora.");
    return;
  }

  // Usar retenção do campo se preenchida, senão a do resumo
  const userRetField = parseNum($("divProjRet").value);
  const retRate = userRetField > 0 ? (userRetField / 100) : effectiveRetRate;

  // 3 cenários: yield -1%, yield mantido, yield +1%
  const scenarios = [
    { name: "Conservador", yield: Math.max(0.1, baseYield - 1), color: "#f59e0b" },
    { name: "Base (yield mantido)", yield: baseYield, color: "#10b981" },
    { name: "Otimista", yield: baseYield + 1, color: "#5b5ce6" }
  ];

  const allData = scenarios.map(sc => {
    const labels = [], netArr = [], grossArr = [];
    let curPortfolio = portfolioVal;
    for (let y = 0; y <= years; y++) {
      labels.push(y === 0 ? (latest ? String(latest.year) : "Hoje") : `+${y}a`);
      if (y === 0) {
        // Ano 0: valores REAIS do resumo, não calculados
        grossArr.push(baseGross);
        netArr.push(baseNet);
      } else {
        // Anos seguintes: carteira cresce, aplica yield e retenção
        const projGross = curPortfolio * (sc.yield / 100);
        const projNet = projGross * (1 - retRate);
        grossArr.push(projGross);
        netArr.push(projNet);
      }
      curPortfolio = curPortfolio * (1 + portfolioGrowth / 100) + contrib * 12;
    }
    return { ...sc, labels, netArr, grossArr };
  });

  const base = allData[1]; // cenário base
  const finalNet = base.netArr[years];
  const doubleYear = base.netArr.findIndex(v => v >= baseNet * 2);
  const tripleYear = base.netArr.findIndex(v => v >= baseNet * 3);

  // KPIs
  const kpiEl = $("divProjKPIs");
  const scenEl = document.getElementById("divProjScenarios");
  if (kpiEl && scenEl) {
    scenEl.style.display = "";
    kpiEl.innerHTML = `
      <div class="kpi kpi--in">
        <div class="kpi__k">Dividendo anual em ${years}a</div>
        <div class="kpi__v">${fmtEUR2(finalNet)}</div>
        <div class="kpi__s">${fmtEUR2(finalNet/12)}/mês líquido</div>
      </div>
      <div class="kpi kpi--net">
        <div class="kpi__k">Duplica em</div>
        <div class="kpi__v">${doubleYear > 0 ? doubleYear + " anos" : "> " + years + "a"}</div>
        <div class="kpi__s">Yield ${getDividendYieldDisplayMode() === 'net' ? 'líquido' : 'bruto'} ${fmtPct(baseYield)} mantido</div>
      </div>
      <div class="kpi">
        <div class="kpi__k">Triplica em</div>
        <div class="kpi__v">${tripleYear > 0 ? tripleYear + " anos" : "> " + years + "a"}</div>
        <div class="kpi__s">vs ${fmtEUR2(baseNet)} hoje</div>
      </div>`;
  }

  // Milestones
  const mlEl = document.getElementById("divProjMilestones");
  if (mlEl) {
    const targets = [1,2,5,10,15,20].filter(y => y <= years);
    mlEl.innerHTML = targets.map(y => {
      const net = base.netArr[y];
      const growth = baseNet > 0 ? ((net - baseNet) / baseNet * 100) : 0;
      return `<div class="item" style="cursor:default">
        <div class="item__l">
          <div class="item__t">+${y} ano${y>1?"s":""}</div>
          <div class="item__s">+${fmtPct(growth)} vs hoje · ${fmtEUR2(net/12)}/mês</div>
        </div>
        <div class="item__v">${fmtEUR2(net)}/ano</div>
      </div>`;
    }).join("");
  }

  // Chart — 3 cenários
  const ctx = ensureChartCtx("divProjChart", 240);
  if (!ctx) { renderChartUnavailable("divProjChart"); return; }
  clearChartUnavailable("divProjChart");
  if (divProjChart) divProjChart.destroy();

  divProjChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: base.labels,
      datasets: allData.map((sc, i) => ({
        label: `${sc.name} (${fmtPct(sc.yield)})`,
        data: sc.netArr,
        borderColor: sc.color,
        backgroundColor: i === 1 ? "rgba(16,185,129,.07)" : "transparent",
        fill: i === 1,
        tension: .4,
        pointRadius: 0,
        borderWidth: i === 1 ? 2.5 : 1.5,
        borderDash: i === 1 ? [] : [5, 4]
      }))
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${fmtEUR2(c.raw)}/ano (${fmtEUR2(c.raw/12)}/mês)`
          }
        }
      },
      scales: { y: { ticks: { callback: v => fmtEUR(v) } } }
    }
  });
}

function setDivMode(mode) {
  divMode = mode;
  const summary = document.getElementById("paneDivSummary");
  const detail = document.getElementById("paneDivDetail");
  const calendar = document.getElementById("paneDivCalendar");
  const segS = $("segDivSummary");
  const segD = $("segDivDetail");
  const segC = $("segDivCalendar");
  if (summary) summary.style.display = mode === "summary" ? "" : "none";
  if (detail) detail.style.display = mode === "detail" ? "" : "none";
  if (calendar) calendar.style.display = mode === "calendar" ? "" : "none";
  segS.classList.toggle("seg__btn--active", mode === "summary");
  segD.classList.toggle("seg__btn--active", mode === "detail");
  if (segC) segC.classList.toggle("seg__btn--active", mode === "calendar");
  if (mode === "calendar") renderDivCalendar();
  if (mode === "summary") {
    initDivSummaryYearSelect();
    renderDivSummaryKPIs();
    renderDivSummaryList();
    renderDivSummaryChart();
  }
}

/* ─── DIVIDENDOS — MODO INDIVIDUAL (existente) ──────────── */
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

  const obj = normalizeDividendRecord({ id: editingDivId || uid(), assetId, assetName, amount, grossAmount: amount, netAmount: Math.max(0, amount - taxWithheld), taxWithheld, date, notes });
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


/* ─── DIVIDEND STATS BY YEAR ─────────────────────────────────
   Computes real dividend statistics directly from imported data.
   Works with both manually added dividends and broker imports.
──────────────────────────────────────────────────────────────── */
function calcDividendStatsByYear(divRecords = null) {
  const byYear = {};
  const divs = Array.isArray(divRecords) ? divRecords : getRealDividendRecords();

  for (const d of divs) {
    const year = String(d.date || '').slice(0, 4);
    if (!year || year.length < 4) continue;
    if (!byYear[year]) byYear[year] = {
      year: parseInt(year), gross: 0, net: 0, wh: 0, count: 0, tickers: new Set()
    };
    const gross = getDividendGross(d);
    const net   = getDividendNet(d);
    const wh    = Math.max(0, gross - net);
    byYear[year].gross += gross;
    byYear[year].net   += net;
    byYear[year].wh    += wh;
    byYear[year].count++;
    const tk = String(d.assetName || d.assetId || '').trim();
    if (tk) byYear[year].tickers.add(tk);
  }

  return Object.values(byYear)
    .map(y => ({ ...y, tickerCount: y.tickers.size, tickers: [...y.tickers] }))
    .sort((a, b) => b.year - a.year);
}

/* Auto-generate divSummaries from real imported data.
   Called after broker import rebuild. Safe to call multiple times — idempotent.
   Only creates/updates entries marked generatedFromBroker=true; manual entries are preserved. */
function autoSyncDivSummariesFromImportedData() {
  const stats = calcDividendStatsByYear(getRealDividendRecords({ source: 'broker' }));
  if (!stats.length) return;

  // Only process years where we have broker-imported dividends
  const brokerDivYears = new Set();
  for (const d of (state.dividends || [])) {
    if (d.generatedFromBroker && d.date) brokerDivYears.add(String(d.date).slice(0, 4));
  }
  if (!brokerDivYears.size) return;

  if (!Array.isArray(state.divSummaries)) state.divSummaries = [];

  const linkedAssets = getDividendLinkedAssets({ source: 'broker', period: 'all' });
  const divPortfolioVal = linkedAssets.reduce((s, a) => s + parseNum(a.value), 0);

  for (const stat of stats) {
    const y = String(stat.year);
    if (!brokerDivYears.has(y)) continue; // only sync broker years
    if (stat.gross <= 0) continue;

    const yieldPct = divPortfolioVal > 0 ? (stat.gross / divPortfolioVal * 100) : 0;
    const existing = state.divSummaries.find(s => String(s.year) === y);

    if (existing) {
      // Only overwrite if it was auto-generated (not manually entered)
      if (existing.generatedFromBroker) {
        existing.gross   = +stat.gross.toFixed(4);
        existing.tax     = +stat.wh.toFixed(4);
        existing.yieldPct = +yieldPct.toFixed(4);
        existing.notes   = `Auto · ${stat.count} dividendos · ${stat.tickerCount} tickers`;
      }
      // Manual entries are left untouched
    } else {
      state.divSummaries.push({
        id: uid(),
        year: stat.year,
        gross: +stat.gross.toFixed(4),
        tax:   +stat.wh.toFixed(4),
        yieldPct: +yieldPct.toFixed(4),
        notes: `Auto · ${stat.count} dividendos · ${stat.tickerCount} tickers`,
        generatedFromBroker: true
      });
    }
  }
}

/* ─── REAL PORTFOLIO PERFORMANCE METRICS ─────────────────────
   Calculates ground-truth metrics from broker-imported events.
   Single source of truth used across Compound, FIRE, Analysis.
──────────────────────────────────────────────────────────────── */
function calcPortfolioRealMetrics() {
  const bd = (state.brokerData) || { events:[], positions:[] };
  const events = (bd.events || []).slice().sort((a,b) =>
    String(a.dateTime||a.date).localeCompare(String(b.dateTime||b.date))
  );

  let totalEverInvested = 0;   // cumulative BUY costs
  let totalRealizedPnL  = 0;   // from SELL Result fields
  let totalDivsGross    = 0;   // dividend gross EUR
  let totalDivsNet      = 0;   // dividend net EUR (after withholding)
  let totalWithholding  = 0;
  let totalFees         = 0;
  let sellCount         = 0;
  let buyCount          = 0;
  const sellDetails     = []; // {date, ticker, qty, proceedsEUR, pnlEUR}
  const divByYear       = {}; // {year: {gross, net, wh, count}}
  const gainsByTicker   = {}; // {ticker: {realized, divs}}

  for (const e of events) {
    const tk = String(e.ticker || e.name || "").trim();
    if (!gainsByTicker[tk]) gainsByTicker[tk] = { realized: 0, divs: 0 };

    if (e.type === "BUY") {
      const cost = parseNum(e.totalEUR) + parseNum(e.feeEUR);
      totalEverInvested += cost;
      totalFees += parseNum(e.feeEUR);
      buyCount++;
    } else if (e.type === "SELL") {
      const pnl = parseNum(e.resultEUR);
      totalRealizedPnL += pnl;
      totalFees += parseNum(e.feeEUR);
      sellCount++;
      sellDetails.push({
        date: e.date, ticker: tk,
        qty: parseNum(e.qty),
        proceedsEUR: parseNum(e.totalEUR),
        pnlEUR: pnl
      });
      gainsByTicker[tk].realized += pnl;
    } else if (e.type === "DIVIDEND" || e.type === "ROC" || e.type === "DIVIDEND_ADJ") {
      const gross = parseNum(e.totalEUR);
      const wh    = parseNum(e.taxEUR);
      const net   = gross - wh;
      totalDivsGross   += gross;
      totalDivsNet     += net;
      totalWithholding += wh;
      gainsByTicker[tk].divs += net;
      const y = String(e.date || "").slice(0,4);
      if (y && y.length===4) {
        if (!divByYear[y]) divByYear[y] = { gross:0, net:0, wh:0, count:0 };
        divByYear[y].gross += gross;
        divByYear[y].net   += net;
        divByYear[y].wh    += wh;
        divByYear[y].count++;
      }
    }
  }

  // Also include manually-registered dividends (state.dividends not from broker)
  for (const d of (state.dividends || [])) {
    if (d.generatedFromBroker) continue; // already counted above
    const gross = getDividendGross(d);
    const net   = getDividendNet(d);
    totalDivsGross   += gross;
    totalDivsNet     += net;
    totalWithholding += gross - net;
    const y = String(d.date || "").slice(0,4);
    if (y && y.length===4) {
      if (!divByYear[y]) divByYear[y] = { gross:0, net:0, wh:0, count:0 };
      divByYear[y].gross += gross;
      divByYear[y].net   += net;
      divByYear[y].wh    += gross - net;
      divByYear[y].count++;
    }
  }

  // Realized gains/losses split
  const realizedGains  = sellDetails.filter(s => s.pnlEUR > 0).reduce((s,x) => s+x.pnlEUR, 0);
  const realizedLosses = sellDetails.filter(s => s.pnlEUR < 0).reduce((s,x) => s+x.pnlEUR, 0);

  // Current equity portfolio cost basis (still-held)
  const currentEquityCost = state.assets
    .filter(a => a.generatedFromBroker)
    .reduce((s,a) => s + parseNum(a.costBasis||0), 0);

  // Grand total return = unrealized gain + realized + dividends
  const currentEquityValue = state.assets
    .filter(a => a.generatedFromBroker)
    .reduce((s,a) => s + parseNum(a.value), 0);
  const unrealizedGain = currentEquityValue - currentEquityCost;
  const grandTotalReturn = unrealizedGain + totalRealizedPnL + totalDivsNet;
  const grandTotalReturnPct = currentEquityCost > 0 ? (grandTotalReturn / currentEquityCost) * 100 : 0;

  // TTM dividends
  const cutoff12m = new Date();
  cutoff12m.setFullYear(cutoff12m.getFullYear()-1);
  const cutoff12mISO = cutoff12m.toISOString().slice(0,10);
  const ttmDivs = (state.dividends||[]).filter(d => String(d.date||"") >= cutoff12mISO);
  const ttmDivGross = ttmDivs.reduce((s,d) => s+getDividendGross(d), 0);
  const ttmDivNet   = ttmDivs.reduce((s,d) => s+getDividendNet(d),   0);

  // Yield na mesma base distribuidora usada em toda a app
  const divData = calcDividendYield();
  const distributingValue = parseNum(divData.divPortfolioVal);
  const ttmYieldGross = distributingValue > 0 ? (ttmDivGross / distributingValue * 100) : 0;
  const ttmYieldNet   = distributingValue > 0 ? (ttmDivNet   / distributingValue * 100) : 0;

  return {
    totalEverInvested, currentEquityCost, currentEquityValue,
    unrealizedGain, unrealizedGainPct: currentEquityCost>0?(unrealizedGain/currentEquityCost*100):0,
    totalRealizedPnL, realizedGains, realizedLosses,
    totalDivsGross, totalDivsNet, totalWithholding,
    grandTotalReturn, grandTotalReturnPct,
    sellCount, buyCount, sellDetails,
    divByYear, gainsByTicker,
    ttmDivGross, ttmDivNet, ttmYieldGross, ttmYieldNet,
    distributingValue,
    hasData: events.length > 0 || (state.dividends||[]).length > 0
  };
}
function renderDividends() {
  if (divMode === "summary") {
    // Auto-sync from broker data before rendering
    autoSyncDivSummariesFromImportedData();
    initDivSummaryYearSelect();
    renderDivSummaryKPIs();
    renderDivSummaryList();
    renderDivSummaryChart();
    return;
  }
  // Detail mode
  const wrap = $("divList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const divs = (state.dividends || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!divs.length) {
    wrap.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Sem dividendos registados</div><div class="item__s">Usa "+ Dividendo" para registar.</div></div><div class="item__v">—</div></div>`;
    $("btnDivToggle").style.display = "none";
    return;
  }

  const DIV_LIMIT = 10;
  const shown = divExpanded ? divs : divs.slice(0, DIV_LIMIT);
  for (const d of shown) {
    const net = getDividendNet(d);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div class="item__l">
      <div class="item__t">${escapeHtml(d.assetName || "Manual")}</div>
      <div class="item__s">${escapeHtml(d.date)}${parseNum(d.taxWithheld) > 0 ? ` · Ret. ${fmtEUR2(d.taxWithheld)}` : ""}${d.notes ? ` · ${escapeHtml(d.notes)}` : ""}</div>
    </div>
    <div class="item__v" style="text-align:right">
      <div>${fmtEUR2(net)}</div>
      ${parseNum(d.taxWithheld) > 0 ? `<div class="item__s">Bruto ${fmtEUR2(getDividendGross(d))}</div>` : ""}
    </div>`;
    row.addEventListener("click", () => openDivModal(d.id));
    wrap.appendChild(row);
  }

  if (divs.length > DIV_LIMIT) {
    $("btnDivToggle").style.display = "inline";
    $("btnDivToggle").textContent = divExpanded ? "▲ Ver menos" : `▼ Ver mais (${divs.length})`;
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

  const ytd = divs.filter(d => d.date >= yrStart).reduce((a, d) => a + getDividendNet(d), 0);
  const mtd = divs.filter(d => d.date.slice(0, 7) === mStart).reduce((a, d) => a + getDividendNet(d), 0);
  const total = divs.reduce((a, d) => a + getDividendNet(d), 0);
  const taxTotal = divs.reduce((a, d) => a + parseNum(d.taxWithheld || 0), 0);

  // By asset
  const byAsset = {};
  for (const d of divs) {
    const k = d.assetName || "Manual";
    byAsset[k] = (byAsset[k] || 0) + getDividendNet(d);
  }
  const topAsset = Object.entries(byAsset).sort((a, b) => b[1] - a[1])[0];

  const el = $("divKPIs");
  if (!el) return;
  el.innerHTML = `
    <div class="kpiRow healthKpiRow">
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
  const ctx = ensureChartCtx("divChart", 220);
  if (!ctx) { renderChartUnavailable("divChart"); return; }
  clearChartUnavailable("divChart");
  if (window._divChart) window._divChart.destroy();
  if (!divs.length) return;

  // Group by month
  const byMonth = {};
  for (const d of divs) {
    const m = d.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { gross: 0, net: 0 };
    byMonth[m].gross += getDividendGross(d);
    byMonth[m].net += getDividendNet(d);
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


const DIV_CALENDAR_DB = {
  "AAPL": {freq:"quarterly",months:[2, 5, 8, 11],yield:0.5,name:"Apple"},
  "ABEV": {freq:"semi",months:[4, 9],yield:6.4,name:"Ambev"},
  "ABR": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:13.8,name:"Arbor Realty"},
  "ABT": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.0,name:"Abbott"},
  "ADC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:4.2,name:"Agree Realty"},
  "ADM": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.1,name:"Archer-Daniels"},
  "ADP": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.2,name:"ADP"},
  "AFL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"Aflac"},
  "AGNC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:14.5,name:"AGNC Investment"},
  "AIR.FR": {freq:"annual",months:[4],yield:1.2,name:"Airbus"},
  "ARE": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.1,name:"Alexandria RE"},
  "BAC": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.4,name:"Bank of America"},
  "BAYN.DE": {freq:"annual",months:[5],yield:6.8,name:"Bayer"},
  "BCP.PT": {freq:"annual",months:[5],yield:4.5,name:"BCP"},
  "BEN": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.1,name:"Franklin Templeton"},
  "BMY": {freq:"quarterly",months:[2, 5, 8, 11],yield:5.1,name:"Bristol-Myers Squibb"},
  "BP.GB": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.8,name:"BP"},
  "CB": {freq:"quarterly",months:[1, 4, 7, 10],yield:1.4,name:"Chubb"},
  "CL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.3,name:"Colgate-Palmolive"},
  "CMCSA": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"Comcast"},
  "COR.PT": {freq:"annual",months:[5],yield:3.5,name:"Corticeira Amorim"},
  "CSCO": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"Cisco"},
  "CVX": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.2,name:"Chevron"},
  "EDP.PT": {freq:"annual",months:[5],yield:6.5,name:"EDP"},
  "EMR": {freq:"quarterly",months:[3, 6, 9, 12],yield:1.9,name:"Emerson Electric"},
  "EOG": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.1,name:"EOG Resources"},
  "EQNR": {freq:"quarterly",months:[2, 5, 8, 11],yield:8.1,name:"Equinor"},
  "FDX": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.1,name:"FedEx"},
  "FMC": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.2,name:"FMC Corp"},
  "GAIN": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:7.1,name:"Gladstone Investment"},
  "GALP.PT": {freq:"semi",months:[5, 10],yield:5.2,name:"Galp"},
  "GD": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.1,name:"General Dynamics"},
  "GILD": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.7,name:"Gilead"},
  "GIS": {freq:"quarterly",months:[2, 5, 8, 11],yield:3.8,name:"General Mills"},
  "GOOD": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:8.2,name:"Gladstone Commercial"},
  "GSK.GB": {freq:"semi",months:[4, 10],yield:4.2,name:"GSK"},
  "GTY": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.5,name:"Getty Realty"},
  "HAL": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"Halliburton"},
  "HD": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.5,name:"Home Depot"},
  "HRL": {freq:"quarterly",months:[2, 5, 8, 11],yield:3.8,name:"Hormel"},
  "IBM": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.1,name:"IBM"},
  "IMB.GB": {freq:"semi",months:[4, 10],yield:9.1,name:"Imperial Brands"},
  "INTC": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.2,name:"Intel"},
  "ITW": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.3,name:"Illinois Tool Works"},
  "JMT.PT": {freq:"annual",months:[4],yield:2.1,name:"Jerónimo Martins"},
  "KHC": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.5,name:"Kraft Heinz"},
  "KMB": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.7,name:"Kimberly-Clark"},
  "KO": {freq:"quarterly",months:[4, 7, 10, 12],yield:3.1,name:"Coca-Cola"},
  "KVUE": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.8,name:"Kenvue"},
  "LAND": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.8,name:"Gladstone Land"},
  "LGEN.GB": {freq:"semi",months:[6, 11],yield:8.5,name:"Legal & General"},
  "LMT": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.8,name:"Lockheed Martin"},
  "LTC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:6.1,name:"LTC Properties"},
  "LYB": {freq:"quarterly",months:[3, 6, 9, 12],yield:7.2,name:"LyondellBasell"},
  "MAIN": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.9,name:"Main Street Capital"},
  "MCD": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.3,name:"McDonald\'s"},
  "MDLZ": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.8,name:"Mondelez"},
  "MDT": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.5,name:"Medtronic"},
  "MET": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.2,name:"MetLife"},
  "MMM": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.1,name:"3M"},
  "MPT": {freq:"quarterly",months:[1, 4, 7, 10],yield:16.0,name:"Medical Properties"},
  "MRK": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.7,name:"Merck"},
  "MSFT": {freq:"quarterly",months:[3, 6, 9, 12],yield:0.8,name:"Microsoft"},
  "NEE": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.3,name:"NextEra Energy"},
  "NESN.CH": {freq:"annual",months:[4],yield:3.1,name:"Nestlé"},
  "NGAS.GB": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.5,name:"National Grid"},
  "NOVO-B.DK": {freq:"semi",months:[3, 8],yield:1.8,name:"Novo Nordisk"},
  "NUE": {freq:"quarterly",months:[2, 5, 8, 11],yield:1.5,name:"Nucor"},
  "O": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:5.8,name:"Realty Income"},
  "PEP": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.2,name:"PepsiCo"},
  "PFE": {freq:"quarterly",months:[3, 6, 9, 12],yield:6.8,name:"Pfizer"},
  "PG": {freq:"quarterly",months:[2, 5, 8, 11],yield:2.4,name:"Procter & Gamble"},
  "PKN.PL": {freq:"annual",months:[6],yield:8.2,name:"PKN Orlen"},
  "PLD": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.0,name:"Prologis"},
  "PPG": {freq:"quarterly",months:[3, 6, 9, 12],yield:2.2,name:"PPG Industries"},
  "PSEC": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:11.2,name:"Prospect Capital"},
  "RENE.PT": {freq:"annual",months:[5],yield:7.2,name:"REN"},
  "REXR": {freq:"quarterly",months:[1, 4, 7, 10],yield:3.9,name:"Rexford Industrial"},
  "RIO": {freq:"semi",months:[3, 9],yield:6.8,name:"Rio Tinto"},
  "SAP.DE": {freq:"annual",months:[5],yield:1.5,name:"SAP"},
  "SBUX": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.1,name:"Starbucks"},
  "SLB": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.5,name:"Schlumberger"},
  "SPGI": {freq:"quarterly",months:[3, 6, 9, 12],yield:0.8,name:"S&P Global"},
  "STAG": {freq:"monthly",months:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],yield:4.1,name:"STAG Industrial"},
  "SU.FR": {freq:"annual",months:[5],yield:4.5,name:"Schneider Electric"},
  "SWKS": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.2,name:"Skyworks"},
  "SYY": {freq:"quarterly",months:[1, 4, 7, 10],yield:2.8,name:"Sysco"},
  "T": {freq:"quarterly",months:[2, 5, 8, 11],yield:5.6,name:"AT&T"},
  "TGT": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.8,name:"Target"},
  "TROW": {freq:"quarterly",months:[3, 6, 9, 12],yield:4.8,name:"T. Rowe Price"},
  "TTE.FR": {freq:"quarterly",months:[1, 4, 7, 10],yield:4.8,name:"TotalEnergies"},
  "VFC": {freq:"quarterly",months:[3, 6, 9, 12],yield:7.1,name:"VF Corp"},
  "VICI": {freq:"quarterly",months:[1, 4, 7, 10],yield:5.2,name:"VICI Properties"},
  "VOD.GB": {freq:"semi",months:[2, 8],yield:10.2,name:"Vodafone"},
  "VOW.DE": {freq:"annual",months:[5],yield:7.5,name:"Volkswagen"},
  "VZ": {freq:"quarterly",months:[2, 5, 8, 11],yield:6.5,name:"Verizon"},
  "WEN": {freq:"quarterly",months:[3, 6, 9, 12],yield:5.1,name:"Wendy\'s"},
  "XOM": {freq:"quarterly",months:[3, 6, 9, 12],yield:3.5,name:"ExxonMobil"},
};

/* ─── DIVIDEND CALENDAR ──────────────────────────────────────────────────── */

function renderDivCalendar() {
  const container = document.getElementById("divCalendarContent");
  if (!container) return;

  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // Get all equity assets
  const EQUITY_CLS = new Set(["ações/etfs","acoes/etfs"]);
  const equityAssets = state.assets.filter(a => {
    const c = (a.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
    return EQUITY_CLS.has(c) && parseNum(a.value) > 0;
  });

  // Build upcoming payments for next 12 months
  const payments = [];
  for (const asset of equityAssets) {
    const ticker = (asset.name||"").toUpperCase().trim();
    const db = DIV_CALENDAR_DB[ticker];
    if (!db || db.freq === 'none' || !db.months.length) continue;

    const value = parseNum(asset.value);
    // Estimate annual dividend
    // First check if asset has a yield configured
    const configuredYield = asset.yieldType === 'yield_pct' ? parseNum(asset.yieldValue) : 0;
    const yieldPct = configuredYield > 0 ? configuredYield : db.yield;
    const annualDiv = value * (yieldPct / 100);
    const perPayment = annualDiv / db.months.length;

    // Add upcoming payment months
    for (let mi = 0; mi < 12; mi++) {
      let m = currentMonth + mi;
      let y = currentYear;
      if (m > 12) { m -= 12; y++; }
      if (db.months.includes(m)) {
        payments.push({
          ticker, name: db.name, month: m, year: y,
          amount: perPayment, freq: db.freq, yieldPct
        });
      }
    }
  }

  // Sort by year+month
  payments.sort((a,b) => a.year !== b.year ? a.year-b.year : a.month-b.month);

  if (!payments.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b">
      <div style="font-size:32px;margin-bottom:8px">📅</div>
      <div style="font-weight:600">Sem dividendos previstos</div>
      <div style="font-size:13px;margin-top:4px">Importa o CSV do DivTracker para ver o calendário</div>
    </div>`;
    return;
  }

  // Group by month
  const byMonth = {};
  for (const p of payments) {
    const key = `${p.year}-${String(p.month).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = {year:p.year, month:p.month, total:0, items:[]};
    byMonth[key].total += p.amount;
    byMonth[key].items.push(p);
  }

  const MONTHS_PT = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const FREQ_LABEL = {monthly:'Mensal',quarterly:'Trimestral',semi:'Semestral',annual:'Anual'};

  let html = '';
  for (const key of Object.keys(byMonth).sort()) {
    const grp = byMonth[key];
    const isCurrentMonth = grp.month === currentMonth && grp.year === currentYear;
    const headerBg = isCurrentMonth ? '#eef2ff' : '#f8fafc';
    const headerColor = isCurrentMonth ? '#4f46e5' : '#475569';

    html += `<div style="margin-bottom:16px">
      <div style="background:${headerBg};border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:800;font-size:15px;color:${headerColor}">
          ${isCurrentMonth ? '📍 ' : ''}${MONTHS_PT[grp.month]} ${grp.year}
        </div>
        <div style="font-weight:700;font-size:15px;color:#059669">~${fmtEUR(grp.total)}</div>
      </div>`;

    // Sort items by amount desc
    grp.items.sort((a,b) => b.amount-a.amount);
    for (const item of grp.items) {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #f1f5f9">
        <div style="font-weight:700;font-size:13px;font-family:monospace;min-width:80px;color:#0f172a">${escapeHtml(item.ticker)}</div>
        <div style="flex:1;font-size:12px;color:#64748b">${escapeHtml(item.name)} · ${FREQ_LABEL[item.freq]||item.freq}</div>
        <div style="font-weight:600;font-size:13px;color:#059669">~${fmtEUR(item.amount)}</div>
      </div>`;
    }
    html += `</div>`;
  }

  // Summary stats
  const totalAnnual = payments.reduce((s,p) => s + (p.amount * 12 / byMonth[`${p.year}-${String(p.month).padStart(2,'0')}`].items.length), 0);
  const uniqueTickers = [...new Set(payments.map(p=>p.ticker))].length;

  container.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:100px;background:#f0fdf4;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:2px">Próximos 12 meses</div>
        <div style="font-weight:800;font-size:16px;color:#059669">${fmtEUR(payments.reduce((s,p)=>s+p.amount,0))}</div>
      </div>
      <div style="flex:1;min-width:100px;background:#eff6ff;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:2px">Ações com dividendo</div>
        <div style="font-weight:800;font-size:16px;color:#4f46e5">${uniqueTickers}</div>
      </div>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">⚠️ Estimativas baseadas em yields históricos. Datas e valores aproximados.</div>
    ${html}`;
}

const TICKER_DB = {
  "2B76.DE": {s:"Tecnologia",r:"Europa"},
  "2B7D.DE": {s:"ETF",r:"Europa"},
  "3SUE.DE": {s:"ETF",r:"Europa"},
  "4BRZ.DE": {s:"ETF",r:"Europa"},
  "AAKI.DE": {s:"Tecnologia",r:"Europa"},
  "AAPL": {s:"Tecnologia",r:"EUA"},
  "ABEV": {s:"Consumo Básico",r:"Europa"},
  "ABR": {s:"Financeiros",r:"EUA"},
  "ABT": {s:"Saúde",r:"EUA"},
  "ACHR": {s:"Tecnologia",r:"EUA"},
  "ADC": {s:"Imobiliário",r:"EUA"},
  "ADM": {s:"Mat. Básicos",r:"EUA"},
  "AES": {s:"Energia",r:"EUA"},
  "AFL": {s:"Financeiros",r:"EUA"},
  "AGN.NL": {s:"Financeiros",r:"Europa"},
  "AGNC": {s:"Financeiros",r:"EUA"},
  "AGRO": {s:"Industriais",r:"EUA"},
  "AI": {s:"Tecnologia",r:"EUA"},
  "AI.FR": {s:"Tecnologia",r:"Europa"},
  "AIR": {s:"Industriais",r:"EUA"},
  "AIR.FR": {s:"Industriais",r:"Europa"},
  "AKZOF": {s:"Mat. Básicos",r:"EUA"},
  "ALAB": {s:"Tecnologia",r:"EUA"},
  "ALGIL.FR": {s:"Financeiros",r:"Europa"},
  "ALGO.CC": {s:"Cripto",r:"Cripto"},
  "ALUM.IT": {s:"Mat. Básicos",r:"Europa"},
  "AMAT": {s:"Tecnologia",r:"EUA"},
  "AMD": {s:"Tecnologia",r:"EUA"},
  "AMKR": {s:"Tecnologia",r:"EUA"},
  "AMZN": {s:"Tecnologia",r:"EUA"},
  "ANAV.DE": {s:"ETF",r:"Europa"},
  "APT.CC": {s:"Cripto",r:"Cripto"},
  "AR.CC": {s:"Cripto",r:"Cripto"},
  "ARB.CC": {s:"Cripto",r:"Cripto"},
  "ARE": {s:"Imobiliário",r:"EUA"},
  "ARM": {s:"Tecnologia",r:"EUA"},
  "ARRY": {s:"Tecnologia",r:"EUA"},
  "ATKR": {s:"Industriais",r:"EUA"},
  "ATOM.CC": {s:"Cripto",r:"Cripto"},
  "BA.GB": {s:"Industriais",r:"Europa"},
  "BABA": {s:"Consumo Cíclico",r:"Ásia-Pac."},
  "BAC": {s:"Financeiros",r:"EUA"},
  "BAM": {s:"Financeiros",r:"EUA"},
  "BAS.DE": {s:"Mat. Básicos",r:"Europa"},
  "BAYN.DE": {s:"Saúde",r:"Europa"},
  "BBAI": {s:"Tecnologia",r:"EUA"},
  "BCP.PT": {s:"Financeiros",r:"Europa"},
  "BEN": {s:"Financeiros",r:"EUA"},
  "BHP": {s:"Mat. Básicos",r:"EUA"},
  "BKH": {s:"Utilidades",r:"EUA"},
  "BMY": {s:"Saúde",r:"EUA"},
  "BORR": {s:"Energia",r:"EUA"},
  "BOTZ.GB": {s:"Tecnologia",r:"Europa"},
  "BP.GB": {s:"Energia",r:"Europa"},
  "BSX": {s:"Saúde",r:"EUA"},
  "BTC.CC": {s:"Cripto",r:"Cripto"},
  "BULL": {s:"Industriais",r:"EUA"},
  "CB": {s:"Financeiros",r:"EUA"},
  "CE": {s:"Mat. Básicos",r:"EUA"},
  "CEBS.DE": {s:"ETF",r:"Europa"},
  "CHRG.GB": {s:"Energia",r:"Europa"},
  "CL": {s:"Consumo Básico",r:"EUA"},
  "CLNX.ES": {s:"Comunicações",r:"Europa"},
  "CLSK": {s:"Tecnologia",r:"EUA"},
  "CMCSA": {s:"Comunicações",r:"EUA"},
  "COPA.GB": {s:"ETF",r:"Europa"},
  "CRML": {s:"Tecnologia",r:"EUA"},
  "CRSP": {s:"Tecnologia",r:"EUA"},
  "CRWV": {s:"Tecnologia",r:"EUA"},
  "CSAI": {s:"Tecnologia",r:"EUA"},
  "CSCO": {s:"Tecnologia",r:"EUA"},
  "CSG.NL": {s:"Financeiros",r:"Europa"},
  "CVS": {s:"Saúde",r:"EUA"},
  "CVV": {s:"Energia",r:"EUA"},
  "CVX": {s:"Energia",r:"EUA"},
  "DD": {s:"Industriais",r:"EUA"},
  "DHL.DE": {s:"Industriais",r:"Europa"},
  "DIS": {s:"Consumo Cíclico",r:"EUA"},
  "DISH": {s:"Comunicações",r:"EUA"},
  "DNN": {s:"Energia",r:"EUA"},
  "DOT.CC": {s:"Cripto",r:"Cripto"},
  "DPRO": {s:"Tecnologia",r:"EUA"},
  "DSY.FR": {s:"Tecnologia",r:"Europa"},
  "DVN": {s:"Energia",r:"EUA"},
  "EBRO.ES": {s:"Consumo Básico",r:"Europa"},
  "EDP.PT": {s:"Energia",r:"Europa"},
  "EDV.GB": {s:"Energia",r:"Europa"},
  "EGL.PT": {s:"Comunicações",r:"Europa"},
  "EGLN.GB": {s:"Energia",r:"Europa"},
  "ELE.ES": {s:"Comunicações",r:"Europa"},
  "EMR": {s:"Industriais",r:"EUA"},
  "ENS": {s:"Industriais",r:"EUA"},
  "EOG": {s:"Energia",r:"EUA"},
  "EOSE": {s:"Energia",r:"EUA"},
  "EQNR": {s:"Energia",r:"Europa"},
  "EQS.FR": {s:"Financeiros",r:"Europa"},
  "ES": {s:"Utilidades",r:"EUA"},
  "ETH.CC": {s:"Cripto",r:"Cripto"},
  "EVTL": {s:"Tecnologia",r:"EUA"},
  "FAST": {s:"Industriais",r:"EUA"},
  "FDX": {s:"Industriais",r:"EUA"},
  "FET.CC": {s:"Cripto",r:"Cripto"},
  "FIL.CC": {s:"Cripto",r:"Cripto"},
  "FMC": {s:"Mat. Básicos",r:"EUA"},
  "FRU.CA": {s:"Energia",r:"EUA"},
  "FTNT": {s:"Tecnologia",r:"EUA"},
  "FWIA.DE": {s:"ETF",r:"Europa"},
  "G2XJ.DE": {s:"ETF",r:"Europa"},
  "GAIN": {s:"Financeiros",r:"EUA"},
  "GALP.PT": {s:"Energia",r:"Europa"},
  "GCLX.GB": {s:"Energia",r:"Europa"},
  "GCTS": {s:"Tecnologia",r:"EUA"},
  "GD": {s:"Industriais",r:"EUA"},
  "GFC.FR": {s:"Financeiros",r:"Europa"},
  "GFS": {s:"Tecnologia",r:"EUA"},
  "GILD": {s:"Saúde",r:"EUA"},
  "GIS": {s:"Consumo Básico",r:"EUA"},
  "GOOD": {s:"Imobiliário",r:"EUA"},
  "GOOG": {s:"Tecnologia",r:"EUA"},
  "GSK.GB": {s:"Saúde",r:"Europa"},
  "GTY": {s:"Imobiliário",r:"EUA"},
  "GWW": {s:"Industriais",r:"EUA"},
  "HAL": {s:"Energia",r:"EUA"},
  "HBAR.CC": {s:"Cripto",r:"Cripto"},
  "HD": {s:"Consumo Cíclico",r:"EUA"},
  "HIMS": {s:"Consumo Cíclico",r:"EUA"},
  "HIVE.CC": {s:"Cripto",r:"Cripto"},
  "HOLO": {s:"Tecnologia",r:"EUA"},
  "HRL": {s:"Consumo Básico",r:"EUA"},
  "HTOO": {s:"Tecnologia",r:"EUA"},
  "HTWO.GB": {s:"Energia",r:"Europa"},
  "IB1T.DE": {s:"ETF",r:"Europa"},
  "IBM": {s:"Tecnologia",r:"EUA"},
  "IFX.DE": {s:"Tecnologia",r:"Europa"},
  "INDI": {s:"Tecnologia",r:"EUA"},
  "INJ.CC": {s:"Cripto",r:"Cripto"},
  "INTC": {s:"Tecnologia",r:"EUA"},
  "IONQ": {s:"Tecnologia",r:"EUA"},
  "IP": {s:"Industriais",r:"EUA"},
  "IPDM.GB": {s:"Imobiliário",r:"Europa"},
  "IPLT.GB": {s:"ETF",r:"Europa"},
  "ISAG.GB": {s:"ETF",r:"Europa"},
  "ISLN.GB": {s:"Imobiliário",r:"Europa"},
  "ITW": {s:"Industriais",r:"EUA"},
  "KHC": {s:"Consumo Básico",r:"EUA"},
  "KMB": {s:"Consumo Básico",r:"EUA"},
  "KO": {s:"Consumo Básico",r:"EUA"},
  "KVUE": {s:"Consumo Básico",r:"EUA"},
  "KWEB.GB": {s:"ETF",r:"Europa"},
  "LAES": {s:"Tecnologia",r:"EUA"},
  "LAND": {s:"Imobiliário",r:"EUA"},
  "LFWD": {s:"Tecnologia",r:"EUA"},
  "LGEN.GB": {s:"Imobiliário",r:"Europa"},
  "LINE": {s:"Imobiliário",r:"EUA"},
  "LINK.CC": {s:"Cripto",r:"Cripto"},
  "LMT": {s:"Industriais",r:"EUA"},
  "LND": {s:"Imobiliário",r:"EUA"},
  "LPTH": {s:"Tecnologia",r:"EUA"},
  "LRC.CC": {s:"Cripto",r:"Cripto"},
  "LTC": {s:"Imobiliário",r:"EUA"},
  "LW": {s:"Consumo Básico",r:"EUA"},
  "LYB": {s:"Mat. Básicos",r:"EUA"},
  "MAIN": {s:"Financeiros",r:"EUA"},
  "MARA": {s:"Tecnologia",r:"EUA"},
  "MAS": {s:"Industriais",r:"EUA"},
  "MBG.DE": {s:"Consumo Cíclico",r:"Europa"},
  "MBLY": {s:"Tecnologia",r:"EUA"},
  "MCD": {s:"Consumo Cíclico",r:"EUA"},
  "MCHP": {s:"Tecnologia",r:"EUA"},
  "MDLZ": {s:"Consumo Básico",r:"EUA"},
  "MDT": {s:"Saúde",r:"EUA"},
  "MET": {s:"Financeiros",r:"EUA"},
  "MGAM.GB": {s:"ETF",r:"Europa"},
  "MLGO": {s:"Tecnologia",r:"EUA"},
  "MMM": {s:"Industriais",r:"EUA"},
  "MPT": {s:"Imobiliário",r:"EUA"},
  "MRK": {s:"Saúde",r:"EUA"},
  "MRVL": {s:"Tecnologia",r:"EUA"},
  "MSFT": {s:"Tecnologia",r:"EUA"},
  "NBIS": {s:"Tecnologia",r:"EUA"},
  "NEAR.CC": {s:"Cripto",r:"Cripto"},
  "NEE": {s:"Utilidades",r:"EUA"},
  "NESN.CH": {s:"Saúde",r:"Europa"},
  "NET": {s:"Tecnologia",r:"EUA"},
  "NFE": {s:"Energia",r:"EUA"},
  "NFG": {s:"Energia",r:"EUA"},
  "NGAS.GB": {s:"Energia",r:"Europa"},
  "NKE": {s:"Consumo Cíclico",r:"EUA"},
  "NNE": {s:"Energia",r:"EUA"},
  "NONOF": {s:"Saúde",r:"Europa"},
  "NOVO-B.DK": {s:"Saúde",r:"Europa"},
  "NOW": {s:"Tecnologia",r:"EUA"},
  "NUE": {s:"Mat. Básicos",r:"EUA"},
  "NVDA": {s:"Tecnologia",r:"EUA"},
  "NXE": {s:"Energia",r:"EUA"},
  "O": {s:"Imobiliário",r:"EUA"},
  "OC": {s:"Industriais",r:"EUA"},
  "OMV.DE": {s:"Industriais",r:"Europa"},
  "OP.CC": {s:"Cripto",r:"Cripto"},
  "ORCL": {s:"Tecnologia",r:"EUA"},
  "OSCR": {s:"Saúde",r:"EUA"},
  "OTIS": {s:"Industriais",r:"EUA"},
  "OUST": {s:"Tecnologia",r:"EUA"},
  "PANW": {s:"Tecnologia",r:"EUA"},
  "PATH": {s:"Tecnologia",r:"EUA"},
  "PDYN": {s:"Tecnologia",r:"EUA"},
  "PEP": {s:"Consumo Básico",r:"EUA"},
  "PFE": {s:"Saúde",r:"EUA"},
  "PG": {s:"Consumo Básico",r:"EUA"},
  "PGNY": {s:"Saúde",r:"EUA"},
  "PK": {s:"Imobiliário",r:"EUA"},
  "PKN.PL": {s:"Energia",r:"Europa"},
  "PLD": {s:"Imobiliário",r:"EUA"},
  "PNR": {s:"Industriais",r:"EUA"},
  "POET": {s:"Tecnologia",r:"EUA"},
  "POL.CC": {s:"Cripto",r:"Cripto"},
  "PPG": {s:"Mat. Básicos",r:"EUA"},
  "PROP": {s:"Imobiliário",r:"EUA"},
  "PSEC": {s:"Financeiros",r:"EUA"},
  "PSKY": {s:"Tecnologia",r:"EUA"},
  "PYPL": {s:"Consumo Cíclico",r:"EUA"},
  "PYTH.CC": {s:"Cripto",r:"Cripto"},
  "QBTS": {s:"Tecnologia",r:"EUA"},
  "QCOM": {s:"Tecnologia",r:"EUA"},
  "QDV5.DE": {s:"ETF",r:"Europa"},
  "QDVE.DE": {s:"ETF",r:"Europa"},
  "QNT.CC": {s:"Cripto",r:"Cripto"},
  "QSR": {s:"Consumo Cíclico",r:"EUA"},
  "QUBT": {s:"Tecnologia",r:"EUA"},
  "RCAT": {s:"Tecnologia",r:"EUA"},
  "RDW": {s:"Tecnologia",r:"EUA"},
  "RENDER.CC": {s:"Cripto",r:"Cripto"},
  "RENE.PT": {s:"Energia",r:"Europa"},
  "REXR": {s:"Imobiliário",r:"EUA"},
  "RGTI": {s:"Tecnologia",r:"EUA"},
  "RIO": {s:"Mat. Básicos",r:"EUA"},
  "RIO1.DE": {s:"Mat. Básicos",r:"Europa"},
  "RIOT": {s:"Tecnologia",r:"EUA"},
  "ROG.CH": {s:"Saúde",r:"Europa"},
  "ROP": {s:"Financeiros",r:"EUA"},
  "RR.GB": {s:"Industriais",r:"Europa"},
  "RY": {s:"Financeiros",r:"EUA"},
  "S": {s:"Industriais",r:"EUA"},
  "SAP.DE": {s:"Tecnologia",r:"Europa"},
  "SATL": {s:"Tecnologia",r:"EUA"},
  "SBUX": {s:"Consumo Cíclico",r:"EUA"},
  "SEI.CC": {s:"Cripto",r:"Cripto"},
  "SES": {s:"Tecnologia",r:"EUA"},
  "SHA0.DE": {s:"ETF",r:"Europa"},
  "SIDU": {s:"Tecnologia",r:"EUA"},
  "SLB": {s:"Energia",r:"EUA"},
  "SMR": {s:"Energia",r:"EUA"},
  "SNOW": {s:"Tecnologia",r:"EUA"},
  "SOL.CC": {s:"Cripto",r:"Cripto"},
  "SON.PT": {s:"Comunicações",r:"Europa"},
  "SOUN": {s:"Tecnologia",r:"EUA"},
  "SPGI": {s:"Financeiros",r:"EUA"},
  "SPIR": {s:"Tecnologia",r:"EUA"},
  "SPY4.DE": {s:"ETF",r:"Europa"},
  "SPYD.DE": {s:"ETF",r:"Europa"},
  "SPYL.DE": {s:"ETF",r:"Europa"},
  "STAG": {s:"Imobiliário",r:"EUA"},
  "STLA": {s:"Consumo Cíclico",r:"Europa"},
  "STX.CC": {s:"Cripto",r:"Cripto"},
  "SUI.CC": {s:"Cripto",r:"Cripto"},
  "SWKS": {s:"Tecnologia",r:"EUA"},
  "SYY": {s:"Consumo Básico",r:"EUA"},
  "T": {s:"Comunicações",r:"EUA"},
  "TAO.CC": {s:"Cripto",r:"Cripto"},
  "TD": {s:"Financeiros",r:"EUA"},
  "TGT": {s:"Consumo Básico",r:"EUA"},
  "TRAC.CC": {s:"Cripto",r:"Cripto"},
  "TROW": {s:"Financeiros",r:"EUA"},
  "TSLA": {s:"Tecnologia",r:"EUA"},
  "TSSI": {s:"Tecnologia",r:"EUA"},
  "TTE.FR": {s:"Energia",r:"Europa"},
  "UAVS": {s:"Tecnologia",r:"EUA"},
  "UEC": {s:"Energia",r:"EUA"},
  "UMAC": {s:"Tecnologia",r:"EUA"},
  "UNA.NL": {s:"Consumo Básico",r:"Europa"},
  "URNU.DE": {s:"ETF",r:"Europa"},
  "UROY": {s:"Energia",r:"EUA"},
  "USAR": {s:"ETF",r:"Europa"},
  "UUUU": {s:"Energia",r:"EUA"},
  "V60A.DE": {s:"ETF",r:"Europa"},
  "VETH.DE": {s:"ETF",r:"Europa"},
  "VFC": {s:"Consumo Cíclico",r:"EUA"},
  "VGWD.DE": {s:"ETF",r:"Europa"},
  "VIB3.DE": {s:"Financeiros",r:"Europa"},
  "VICI": {s:"Imobiliário",r:"EUA"},
  "VIE.FR": {s:"Energia",r:"Europa"},
  "VOW.DE": {s:"Consumo Cíclico",r:"Europa"},
  "VOW3.DE": {s:"Consumo Cíclico",r:"Europa"},
  "VRLA.FR": {s:"Industriais",r:"Europa"},
  "VUAA.DE": {s:"ETF",r:"Europa"},
  "VUSA.DE": {s:"ETF",r:"Europa"},
  "VVMX.DE": {s:"ETF",r:"Europa"},
  "VVSM.DE": {s:"ETF",r:"Europa"},
  "VWCE.DE": {s:"ETF",r:"Europa"},
  "VZ": {s:"Comunicações",r:"EUA"},
  "WBD": {s:"Comunicações",r:"EUA"},
  "WCP.CA": {s:"Energia",r:"EUA"},
  "WEN": {s:"Consumo Básico",r:"EUA"},
  "WHR": {s:"Consumo Cíclico",r:"EUA"},
  "WTAI.GB": {s:"Tecnologia",r:"Europa"},
  "WULF": {s:"Tecnologia",r:"EUA"},
  "XDC.CC": {s:"Cripto",r:"Cripto"},
  "XDWH.DE": {s:"ETF",r:"Europa"},
  "XMLD.DE": {s:"ETF",r:"Europa"},
  "XOM": {s:"Energia",r:"EUA"},
  "XTZ.CC": {s:"Cripto",r:"Cripto"},
  "XYL": {s:"Industriais",r:"EUA"},
  "ZPRR.DE": {s:"ETF",r:"Europa"},
  "ZS": {s:"Tecnologia",r:"EUA"},
  "ZTS": {s:"Saúde",r:"EUA"},
};

/* ─── PORTFOLIO ANALYSIS: SECTOR + GEOGRAPHY CHARTS ─────────────────────── */

// Sector + region from static DB first, then from meta (⟳ Cotações), then from ticker suffix
function getTickerMeta(asset) {
  const ticker = (asset.ticker || "").trim().toUpperCase();
  const name = (asset.name || "").trim().toUpperCase();
  const lookup = ticker || name;
  // 1. Static DB (most comprehensive)
  const db = TICKER_DB[lookup] || TICKER_DB[name] || TICKER_DB[ticker];
  if (db) return { sector: db.s, region: db.r };

  // 2. meta from ⟳ Cotações
  const meta = asset.meta || {};
  if (meta.sector || meta.quoteType) {
    const SECTOR_PT = {
      "Technology":"Tecnologia","Financial Services":"Financeiros",
      "Healthcare":"Saúde","Consumer Cyclical":"Consumo Cíclico",
      "Consumer Defensive":"Consumo Básico","Industrials":"Industriais",
      "Basic Materials":"Mat. Básicos","Energy":"Energia",
      "Real Estate":"Imobiliário","Utilities":"Utilidades",
      "Communication Services":"Comunicações",
    };
    const qt = (meta.quoteType||"").toUpperCase();
    const s = qt === "CRYPTOCURRENCY" ? "Cripto"
            : qt === "ETF" ? "ETF"
            : (SECTOR_PT[meta.sector] || meta.sector || "");
    const cc = (meta.country||"").toLowerCase();
    const ex = (meta.exchange||"").toUpperCase();
    const r = qt === "CRYPTOCURRENCY" ? "Cripto"
            : cc.includes("united states") ? "EUA"
            : ["united kingdom","germany","france","italy","spain","netherlands",
               "portugal","belgium","sweden","norway","denmark","finland",
               "switzerland","austria","ireland","poland"].some(c=>cc.includes(c)) ? "Europa"
            : ["japan","china","hong kong","south korea","taiwan",
               "singapore","australia","india"].some(c=>cc.includes(c)) ? "Ásia-Pac."
            : cc.includes("brazil")||cc.includes("mexico") ? "Lat. América"
            : cc ? "Outros" : null;
    if (s || r) return { sector: s, region: r };
  }

  // 3. Infer from ticker suffix
  const cls = (asset.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
  if (cls === "cripto") return { sector: "Cripto", region: "Cripto" };
  const suffixes = [[".LS","Europa"],[".L","Europa"],[".DE","Europa"],[".PA","Europa"],
    [".MI","Europa"],[".AS","Europa"],[".MC","Europa"],[".BR","Europa"],
    [".WA","Europa"],[".SW","Europa"],[".ST","Europa"],[".OL","Europa"],
    [".HE","Europa"],[".CO","Europa"],[".AX","Ásia-Pac."],["-USD","Cripto"]];
  for (const [sfx, rgn] of suffixes)
    if (lookup.endsWith(sfx)) return { sector: lookup.includes("ETF") || ticker.length <= 6 ? "ETF" : "", region: rgn };

  // Plain ticker (no suffix) = US equity
  return { sector: "", region: "EUA" };
}

const SECTOR_PALETTE = [
  "#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#84cc16","#f97316","#ec4899","#64748b","#14b8a6","#a855f7","#f43f5e"
];
const GEO_PALETTE = ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16"];

let sectorChartInst = null, geoChartInst = null;

function makeLegendRow(label, value, total, color) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9">
    <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0"></div>
    <div style="flex:1;font-size:13px;font-weight:600">${escapeHtml(label)}</div>
    <div style="font-size:13px;color:#64748b">${fmtEUR(value)}</div>
    <div style="font-size:12px;font-weight:700;min-width:44px;text-align:right">${pct.toFixed(1)}%</div>
  </div>`;
}

function svgDonut(data, palette, totalLabel) {
  // data = [{label, value, pct}], returns SVG string
  const R = 90, cx = 110, cy = 110, stroke = 22;
  const r = R - stroke / 2;
  const circ = 2 * Math.PI * r;
  let offset = -Math.PI / 2; // start at top
  let paths = '';
  let total = data.reduce((s, d) => s + d.value, 0);

  data.forEach((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(offset);
    const y1 = cy + r * Math.sin(offset);
    const x2 = cx + r * Math.cos(offset + angle - 0.01);
    const y2 = cy + r * Math.sin(offset + angle - 0.01);
    const color = palette[i % palette.length];
    paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}"
      fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="butt"/>`;
    offset += angle;
  });

  return `<svg viewBox="0 0 220 220" style="width:100%;max-width:260px;display:block;margin:0 auto">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    ${paths}
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">Total</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="13" font-weight="800" fill="var(--text)">${totalLabel}</text>
  </svg>`;
}

function legendRow(label, value, pct, color) {
  const bar = Math.round(pct * 1.2); // max ~120px
  return `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;color:var(--text)">
      <span style="width:11px;height:11px;border-radius:2px;background:${color};flex-shrink:0;display:inline-block"></span>
      <span style="flex:1;font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(label)}</span>
      <span style="font-size:13px;color:var(--muted)">${fmtEUR(value)}</span>
      <span style="font-size:12px;font-weight:700;min-width:40px;text-align:right;color:var(--text)">${pct.toFixed(1)}%</span>
    </div>
    <div style="height:4px;background:var(--line);border-radius:2px;margin-left:19px">
      <div style="height:4px;width:${Math.min(100,pct)}%;background:${color};border-radius:2px"></div>
    </div>
  </div>`;
}

function renderPortfolioCharts() {
  const EQUITY_CLS = new Set(["ações/etfs","acoes/etfs","cripto"]);
  const equityAssets = state.assets.filter(a => {
    const c = (a.class||"").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/õ/g,"o");
    return EQUITY_CLS.has(c) && parseNum(a.value) > 0;
  });

  const sectorWrap = document.getElementById("sectorChartWrap");
  const geoWrap    = document.getElementById("geoChartWrap");
  const sectorND   = document.getElementById("sectorNoData");
  const geoND      = document.getElementById("geoNoData");

  if (!equityAssets.length) {
    if (sectorND) sectorND.style.display = "";
    if (sectorWrap) sectorWrap.style.display = "none";
    if (geoND) geoND.style.display = "";
    if (geoWrap) geoWrap.style.display = "none";
    return;
  }

  if (sectorND) sectorND.style.display = "none";
  if (sectorWrap) sectorWrap.style.display = "";
  if (geoND) geoND.style.display = "none";
  if (geoWrap) geoWrap.style.display = "";

  // ── SECTOR ──────────────────────────────────────
  const bySector = {};
  for (const a of equityAssets) {
    const { sector } = getTickerMeta(a);
    const key = sector || "Outros";
    bySector[key] = (bySector[key] || 0) + parseNum(a.value);
  }
  const sEntries = Object.entries(bySector).sort((a,b) => b[1]-a[1]);
  const sTotal = sEntries.reduce((s,[,v]) => s+v, 0);
  const sData = sEntries.map(([l,v]) => ({label:l, value:v, pct:v/sTotal*100}));

  if (sectorWrap) {
    sectorWrap.innerHTML =
      svgDonut(sData, SECTOR_PALETTE, fmtEUR(sTotal)) +
      '<div style="margin-top:12px">' +
      sData.map((d,i) => legendRow(d.label, d.value, d.pct, SECTOR_PALETTE[i%SECTOR_PALETTE.length])).join("") +
      '</div>';
  }

  // ── GEOGRAPHY ───────────────────────────────────
  const byRegion = {};
  for (const a of equityAssets) {
    const { region } = getTickerMeta(a);
    const key = region || "Outros";
    byRegion[key] = (byRegion[key] || 0) + parseNum(a.value);
  }
  const gEntries = Object.entries(byRegion).sort((a,b) => b[1]-a[1]);
  const gTotal = gEntries.reduce((s,[,v]) => s+v, 0);
  const gData = gEntries.map(([l,v]) => ({label:l, value:v, pct:v/gTotal*100}));

  if (geoWrap) {
    geoWrap.innerHTML =
      svgDonut(gData, GEO_PALETTE, fmtEUR(gTotal)) +
      '<div style="margin-top:12px">' +
      gData.map((d,i) => legendRow(d.label, d.value, d.pct, GEO_PALETTE[i%GEO_PALETTE.length])).join("") +
      '</div>';
  }
}


/* ─── ANALYSIS VIEW ───────────────────────────────────────── */
function renderAnalysis() {
  const activeBtn = document.querySelector(".analysis-tab.analysis-tab--active");
  const selectVal = ($("analysisTab") && $("analysisTab").value) || "";
  const tab = (activeBtn && activeBtn.dataset && activeBtn.dataset.tab) || selectVal || "compound";
  document.querySelectorAll(".analysisPanelTab").forEach(p => { p.style.display = "none"; });
  const panel = document.getElementById("analysisPanelTab_" + tab);
  if (panel) panel.style.display = "";
  if (tab === "portfolio") renderPortfolioCharts();
  if (tab === "compound") renderCompoundPanel();
  if (tab === "forecast") renderForecastPanel();
  if (tab === "compare") renderComparePanel();
  if (tab === "pricehistory") { renderPriceHistoryPanel(); renderFXHistoryPanel(); }
  if (tab === "allocation") renderAllocationPanel();
  if (tab === "fire") renderFire();
  if (tab === "fiscal") renderFiscalPanel();
  if (tab === "performance") { renderRealPerformancePanel(); renderBenchmarkComparison(); renderRebalancing(); }
  if (tab === "drawdown") renderDrawdownPanel();
  if (tab === "ai") renderAIHistory();
}

/* ── Compound Interest Panel ── */

// Calcula o yield médio ponderado real da carteira
/* ─── CÁLCULOS DE RENDIMENTO SEPARADOS ────────────────────────
   calcDividendYield()  → só ações/ETFs/Fundos com dividend yield
                          usado na aba Dividendos
   calcPortfolioYield() → TODOS os ativos com rendimento passivo
                          (dividendos + rendas + depósitos + PPR…)
                          usado na aba Análise → Juro Composto
─────────────────────────────────────────────────────────────── */

// Ativo é "dividendo" se for ação/ETF/Fundo/Cripto com yield %
function isDividendAsset(a) {
  const key = assetClassKey(a);
  return key === "acoes/etfs" || key === "fundos";
}


function normalizeDividendKey(x) {
  return String(x || "").toUpperCase().replace(/\s+/g, " ").trim();
}

function getAssetIdentityKeys(asset) {
  const keys = new Set();
  if (!asset || typeof asset !== "object") return keys;
  const push = (prefix, value) => {
    const v = String(value || "").trim();
    if (!v) return;
    keys.add(`${prefix}:${normalizeDividendKey(v)}`);
  };

  if (asset.id) push("ASSET", asset.id);

  const isin = normalizeISIN(asset.isin);
  if (isin) push("ISIN", isin);

  const inferredYahoo = inferYahooTickerFromIdentity(asset);
  if (asset.yahooTicker) push("YAHOO", asset.yahooTicker);
  if (inferredYahoo) push("YAHOO", inferredYahoo);

  const tickerBase = canonicalBrokerTickerBase(asset.ticker || asset.yahooTicker || "");
  if (tickerBase) push("TICKER", tickerBase);
  if (asset.ticker) push("TICKER", asset.ticker);

  const fullName = normalizeSecurityNameKey(asset.name || "");
  const headName = normalizeSecurityNameKey(String(asset.name || "").split(" — ")[0] || "");
  if (fullName) push("NAME", fullName);
  if (headName) push("NAME", headName);

  return keys;
}

function getDividendIdentityKeys(dividend) {
  const keys = new Set();
  if (!dividend || typeof dividend !== "object") return keys;

  const push = (prefix, value) => {
    const v = String(value || "").trim();
    if (!v) return;
    keys.add(`${prefix}:${normalizeDividendKey(v)}`);
  };

  if (dividend.assetId) push("ASSET", dividend.assetId);

  const notes = String(dividend.notes || "");
  const noteIsin = notes.match(/ISIN=([A-Z0-9]+)/i);
  const noteTicker = notes.match(/Ticker=([A-Z0-9.\-]+)/i);
  const noteYahoo = notes.match(/Yahoo=([A-Z0-9.\-=^]+)/i);

  if (noteIsin && noteIsin[1]) push("ISIN", noteIsin[1]);
  if (noteYahoo && noteYahoo[1]) push("YAHOO", noteYahoo[1]);

  const noteTickerBase = canonicalBrokerTickerBase(noteTicker ? noteTicker[1] : "");
  if (noteTicker && noteTicker[1]) push("TICKER", noteTicker[1]);
  if (noteTickerBase) push("TICKER", noteTickerBase);

  const assetName = String(dividend.assetName || "");
  if (assetName) {
    const head = String(assetName.split(" — ")[0] || "").trim();
    const nameKey = normalizeSecurityNameKey(assetName);
    const headKey = normalizeSecurityNameKey(head);
    if (nameKey) push("NAME", nameKey);
    if (headKey) push("NAME", headKey);

    const assetNameBase = canonicalBrokerTickerBase(assetName);
    if (assetNameBase && /^[A-Z0-9.\-]{1,16}$/.test(assetNameBase)) push("TICKER", assetNameBase);
  }

  return keys;
}

function assetMatchesDividend(asset, dividend) {
  if (!asset || !dividend) return false;
  if (asset.id && dividend.assetId && String(asset.id) === String(dividend.assetId)) return true;
  const aKeys = getAssetIdentityKeys(asset);
  const dKeys = getDividendIdentityKeys(dividend);
  for (const k of aKeys) if (dKeys.has(k)) return true;
  return false;
}

function buildDividendStatsIndex() {
  const divs = Array.isArray(state.dividends) ? state.dividends : [];
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const sig = `${divs.length}|${assets.length}|${(((state||{}).settings||{}).brokerRebuildSig)||""}|${divs.length ? (divs[divs.length-1].id||divs[divs.length-1].date||"") : ""}`;
  if (buildDividendStatsIndex._cache && buildDividendStatsIndex._sig === sig) return buildDividendStatsIndex._cache;

  const cutoff = new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).toISOString().slice(0, 10);
  const tokenToAssetIds = new Map();
  const statsByAssetId = new Map();

  for (const asset of assets) {
    if (!asset || !asset.id) continue;
    statsByAssetId.set(asset.id, { allGross: 0, allNet: 0, allTax: 0, allCount: 0, ttmGross: 0, ttmNet: 0, ttmTax: 0, ttmCount: 0 });
    for (const key of getAssetIdentityKeys(asset)) {
      if (!tokenToAssetIds.has(key)) tokenToAssetIds.set(key, new Set());
      tokenToAssetIds.get(key).add(asset.id);
    }
  }

  for (const d of divs) {
    if (!d) continue;
    const matched = new Set();
    if (d.assetId && statsByAssetId.has(d.assetId)) matched.add(d.assetId);
    for (const key of getDividendIdentityKeys(d)) {
      const ids = tokenToAssetIds.get(key);
      if (ids) ids.forEach(id => matched.add(id));
    }
    if (!matched.size) continue;
    const gross = getDividendGross(d);
    const net = getDividendNet(d);
    const tax = Math.max(0, parseNum(d.taxWithheld || 0));
    const inTTM = String(d.date || "") >= cutoff;
    matched.forEach(id => {
      const s = statsByAssetId.get(id);
      if (!s) return;
      s.allGross += gross;
      s.allNet += net;
      s.allTax += tax;
      s.allCount += 1;
      if (inTTM) {
        s.ttmGross += gross;
        s.ttmNet += net;
        s.ttmTax += tax;
        s.ttmCount += 1;
      }
    });
  }

  buildDividendStatsIndex._sig = sig;
  buildDividendStatsIndex._cache = { cutoff, statsByAssetId };
  return buildDividendStatsIndex._cache;
}

function getDividendStatsForAsset(asset) {
  if (!asset || !asset.id) return { allGross: 0, allNet: 0, allTax: 0, allCount: 0, ttmGross: 0, ttmNet: 0, ttmTax: 0, ttmCount: 0 };
  const idx = buildDividendStatsIndex();
  return idx.statsByAssetId.get(asset.id) || { allGross: 0, allNet: 0, allTax: 0, allCount: 0, ttmGross: 0, ttmNet: 0, ttmTax: 0, ttmCount: 0 };
}

function syncBrokerAssetDividendYieldsFromRecords() {
  let changed = false;
  for (const asset of (state.assets || [])) {
    if (!asset || !asset.generatedFromBroker || !isDividendAsset(asset) || parseNum(asset.value) <= 0) continue;
    const stats = getDividendStatsForAsset(asset);
    const annual = Math.max(0, parseNum(stats.ttmNet));
    if (annual > 0) {
      if (asset.yieldType !== "yield_eur_year" || Math.abs(parseNum(asset.yieldValue) - annual) > 0.01) {
        asset.yieldType = "yield_eur_year";
        asset.yieldValue = +annual.toFixed(4);
        changed = true;
      }
    }
  }
  return changed;
}

function getDividendBaseAssetsForRecords(divRecords, opts = {}) {
  const records = Array.isArray(divRecords) ? divRecords.filter(Boolean) : [];
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const brokerOnly = !!opts.brokerOnly;
  const allowConfigured = opts.allowConfigured !== false;

  const recordKeys = new Set();
  records.forEach(d => {
    for (const k of getDividendIdentityKeys(d)) recordKeys.add(k);
  });

  return assets.filter(a => {
    if (!isDividendAsset(a) || parseNum(a.value) <= 0) return false;
    if (brokerOnly && !a.generatedFromBroker) return false;

    let hasRecord = false;
    for (const k of getAssetIdentityKeys(a)) {
      if (recordKeys.has(k)) { hasRecord = true; break; }
    }

    const yt = a.yieldType || 'none';
    const hasConfiguredDividend = allowConfigured && (yt === 'yield_eur_year') && parseNum(a.yieldValue) > 0;
    return hasRecord || hasConfiguredDividend;
  });
}

function getDividendLinkedAssets(opts = {}) {
  const sourceRecords = getRealDividendRecords(opts);
  const now = new Date();
  const cutoffTTM = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const relevant = opts.period === 'all'
    ? sourceRecords
    : sourceRecords.filter(d => String(d.date || '') >= cutoffTTM);
  const brokerOnly = (opts.source === 'broker') || (!opts.source && sourceRecords.some(d => d && d.generatedFromBroker));
  return getDividendBaseAssetsForRecords(relevant, { brokerOnly, allowConfigured: true });
}

// Rendimento anual de dividendos (bruto) da carteira
// Usa dividendos reais da corretora quando existem; caso contrário, summaries manuais ou estimativa conservadora.
function calcDividendYield() {
  const now = new Date();
  const cutoffTTM = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);

  const sourceDivs = getRealDividendRecords();
  const brokerOnly = sourceDivs.length > 0 && sourceDivs.every(d => d && d.generatedFromBroker);
  const ttmDivs = sourceDivs.filter(d => String(d.date || '') >= cutoffTTM);
  const ttmGross = ttmDivs.reduce((s, d) => s + getDividendGross(d), 0);
  const ttmNet = ttmDivs.reduce((s, d) => s + getDividendNet(d), 0);

  const baseAssetsTTM = getDividendBaseAssetsForRecords(ttmDivs.length ? ttmDivs : sourceDivs, { brokerOnly, allowConfigured: true });
  let divPortfolioVal = baseAssetsTTM.reduce((s, a) => s + parseNum(a.value), 0);

  const latestSummary = (state.divSummaries || [])
    .filter(s => !s.generatedFromBroker)
    .slice()
    .sort((a, b) => parseNum(b.year) - parseNum(a.year))[0];

  if (ttmGross > 0) {
    const grossYieldPct = divPortfolioVal > 0 ? (ttmGross / divPortfolioVal * 100) : 0;
    const netYieldPct = divPortfolioVal > 0 ? (ttmNet / divPortfolioVal * 100) : 0;
    return {
      gross: ttmGross,
      net: ttmNet,
      yieldPct: grossYieldPct,
      grossYieldPct,
      netYieldPct,
      weightedYield: grossYieldPct,
      divPortfolioVal,
      source: brokerOnly ? 'broker_ttm' : 'individual',
      period: 'ttm',
      linkedAssets: baseAssetsTTM,
      linkedDividends: ttmDivs
    };
  }

  if (sourceDivs.length > 0) {
    const grossAll = sourceDivs.reduce((s, d) => s + getDividendGross(d), 0);
    const netAll = sourceDivs.reduce((s, d) => s + getDividendNet(d), 0);
    if (grossAll > 0 || netAll > 0) {
      const baseAssetsAll = getDividendBaseAssetsForRecords(sourceDivs, { brokerOnly, allowConfigured: true });
      const baseAll = baseAssetsAll.reduce((s, a) => s + parseNum(a.value), 0);
      const grossYieldPct = baseAll > 0 ? (grossAll / baseAll * 100) : 0;
      const netYieldPct = baseAll > 0 ? (netAll / baseAll * 100) : 0;
      return {
        gross: grossAll,
        net: netAll,
        yieldPct: grossYieldPct,
        grossYieldPct,
        netYieldPct,
        weightedYield: grossYieldPct,
        divPortfolioVal: baseAll,
        source: brokerOnly ? 'broker_ttm' : 'individual',
        period: 'all',
        linkedAssets: baseAssetsAll,
        linkedDividends: sourceDivs
      };
    }
  }

  if (latestSummary) {
    const gross = parseNum(latestSummary.gross);
    const net = gross - parseNum(latestSummary.tax);
    const inferredBase = parseNum(latestSummary.yieldPct) > 0 ? gross / (parseNum(latestSummary.yieldPct) / 100) : 0;
    const grossYieldPct = inferredBase > 0 ? (gross / inferredBase * 100) : parseNum(latestSummary.yieldPct);
    const netYieldPct = inferredBase > 0 ? (net / inferredBase * 100) : 0;
    return {
      gross,
      net,
      yieldPct: grossYieldPct,
      grossYieldPct,
      netYieldPct,
      weightedYield: grossYieldPct,
      divPortfolioVal: inferredBase,
      source: 'summary',
      period: 'annual_summary',
      linkedAssets: [],
      linkedDividends: []
    };
  }

  const estimatedAssets = (state.assets || []).filter(a => isDividendAsset(a) && parseNum(a.value) > 0 && ['yield_eur_year','yield_pct'].includes(a.yieldType || 'none'));
  let estimatedGross = 0;
  let estimatedNet = 0;
  for (const a of estimatedAssets) {
    const yt = a.yieldType || 'none';
    if (yt === 'yield_eur_year') {
      const annual = parseNum(a.yieldValue);
      if (a.generatedFromBroker) {
        estimatedGross += annual;
        estimatedNet += annual;
      } else {
        estimatedGross += annual;
        estimatedNet += annual * 0.72;
      }
      continue;
    }
    if (yt === 'yield_pct') {
      const gross = parseNum(a.value) * (parseNum(a.yieldValue) / 100);
      estimatedGross += gross;
      estimatedNet += gross * 0.72;
    }
  }
  const estimatedBase = estimatedAssets.reduce((s, a) => s + parseNum(a.value), 0);
  const grossYieldPct = estimatedBase > 0 ? (estimatedGross / estimatedBase * 100) : 0;
  const netYieldPct = estimatedBase > 0 ? (estimatedNet / estimatedBase * 100) : 0;
  return {
    gross: estimatedGross,
    net: estimatedNet,
    yieldPct: grossYieldPct,
    grossYieldPct,
    netYieldPct,
    weightedYield: grossYieldPct,
    divPortfolioVal: estimatedBase,
    source: 'estimated',
    period: 'estimated',
    linkedAssets: estimatedAssets,
    linkedDividends: []
  };
}

// Rendimento passivo total de TODOS os ativos (dividendos + rendas + depósitos + PPR + obrigações)
// Usado no simulador de Juro Composto
// Separa yield passivo (juros/rendas/dividendos) do retorno total (inclui valorização acções)
function calcPortfolioYield() {

  // v18: usar cache se disponível para evitar calcTotals() redundante
  const totals = _rc ? _rc.totals : calcTotals();
  const assetRows = state.assets.map(a => {
    const value = parseNum(a.value);
    const passiveRatePct = getAssetPassiveRatePct(a, { allowClassFallback: true });
    const appreciationPct = getAssetAppreciationPct(a, { allowClassFallback: true });
    const totalRatePct = passiveRatePct + appreciationPct;
    return {
      id: a.id,
      name: a.name || "",
      cls: a.class || "Outros",
      classKey: assetClassKey(a),
      value,
      passiveRatePct,
      appreciationPct,
      totalRatePct,
      hasExplicitPassive: hasExplicitPassiveYield(a),
      hasExplicitAppreciation: hasExplicitAppreciationPct(a),
      compoundFreq: a.compoundFreq || 12
    };
  }).filter(r => r.value > 0);

  const totalValue = assetRows.reduce((s, r) => s + r.value, 0);
  const totalPassiveActual = parseNum(totals.passiveAnnualReal != null ? totals.passiveAnnualReal : totals.passiveAnnual);
  const totalPassiveProjectedFromTotals = parseNum(totals.passiveAnnualProjected != null ? totals.passiveAnnualProjected : totals.passiveAnnual);
  const actualPassiveYieldPct = totalValue > 0 ? (totalPassiveActual / totalValue) * 100 : 0;
  const weightedProjectedPassivePct = totalValue > 0
    ? assetRows.reduce((s, r) => s + r.value * r.passiveRatePct, 0) / totalValue
    : 0;
  const weightedAppreciationPct = totalValue > 0
    ? assetRows.reduce((s, r) => s + r.value * r.appreciationPct, 0) / totalValue
    : 0;
  const fallbackTotalReturn = weightedProjectedPassivePct + weightedAppreciationPct;

  const twr = calcTWR ? calcTWR() : null;
  const rs = getReturnSettings();
  const hasRobustTWR = !!(rs.preferTWR && twr && twr.years >= rs.twrMinYears && Math.abs(twr.annualised) < 80);
  const totalReturnAnnual = hasRobustTWR ? twr.annualised : fallbackTotalReturn;

  const projectedPassiveAnnual = totalPassiveProjectedFromTotals > 0
    ? totalPassiveProjectedFromTotals
    : totalValue * weightedProjectedPassivePct / 100;

  return {
    totalValue,
    totalPassive: projectedPassiveAnnual,
    actualPassiveAnnual: totalPassiveActual,
    actualPassiveYieldPct,
    projectedPassiveAnnual,
    weightedProjectedPassivePct,
    weightedYield: weightedProjectedPassivePct,
    passiveYieldPct: weightedProjectedPassivePct,
    weightedAppreciationPct,
    totalReturnAnnual,
    totalReturnBlended: totalReturnAnnual,
    totalReturnSource: hasRobustTWR ? "twr" : "fallback",
    twr: hasRobustTWR ? twr.annualised : null,
    classFallbackUsed: assetRows.some(r => (!r.hasExplicitPassive && Math.abs(r.passiveRatePct) > 1e-9) || (!r.hasExplicitAppreciation && Math.abs(r.appreciationPct) > 1e-9)),
    assetRows
  };
}

// Estima contribuição mensal média dos últimos 6 meses de cashflow
function getPortfolioReturnMeta(py = null) {
  const p = py || calcPortfolioYield();
  return {
    totalValue: p.totalValue || 0,
    totalPassive: p.totalPassive || 0,
    actualPassiveAnnual: p.actualPassiveAnnual || 0,
    actualPassiveYieldPct: p.actualPassiveYieldPct || 0,
    projectedPassiveAnnual: p.projectedPassiveAnnual || 0,
    weightedYield: p.weightedYield || 0,
    weightedProjectedPassivePct: p.weightedProjectedPassivePct || 0,
    weightedAppreciationPct: p.weightedAppreciationPct || 0,
    totalReturnAnnual: p.totalReturnAnnual || 0,
    sourceTag: p.totalReturnSource === "twr" ? "TWR real" : "Estimativa ponderada",
    sourceLine: p.totalReturnSource === "twr"
      ? `TWR anualizado real da carteira · base projectada ${fmtPct(p.weightedProjectedPassivePct)} · passivo actual ${fmtPct(p.actualPassiveYieldPct)}`
      : `Rendimento base projectado ${fmtPct(p.weightedProjectedPassivePct)} + valorização esperada ${fmtPct(p.weightedAppreciationPct)}`
  };
}

function buildPortfolioEngineSummary(py = null, extraTiles = [], footnote = "") {
  const meta = getPortfolioReturnMeta(py);
  const tiles = [
    { k: "Retorno total", v: fmtPct(meta.totalReturnAnnual), tone: "vio" },
    { k: "Rend. base proj.", v: fmtPct(meta.weightedYield), tone: "green" },
    { k: "Valorização", v: fmtPct(meta.weightedAppreciationPct), tone: "purple" },
    { k: "Origem", v: meta.sourceTag, tone: "slate" },
    ...extraTiles
  ];
  return `
    <div class="return-mini-grid">
      ${tiles.map(t => `
        <div class="return-mini return-mini--${t.tone || "slate"}">
          <div class="return-mini__k">${escapeHtml(t.k)}</div>
          <div class="return-mini__v">${escapeHtml(String(t.v ?? "—"))}</div>
        </div>`).join("")}
    </div>
    <div class="return-mini__foot">${meta.sourceLine}${footnote ? ` · ${footnote}` : ""}</div>`;
}

function calcAvgMonthlySavings(months = 6) {
  const now = new Date();
  const byMonth = new Map();
  for (const t of state.transactions) {
    if (isInterAccountTransfer(t)) continue;
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

  const portfolio = calcPortfolioYield();
  const avgSavings = calcAvgMonthlySavings(6);

  const prev = sel.value;
  sel.innerHTML = `<option value="__portfolio__">📊 Carteira completa (automático)</option>
    <option value="__custom__">✏️ Personalizado…</option>`;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const rate = getAssetTotalReturnPct(a, { allowClassFallback: true });
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.name} · ${fmtPct(rate)} · ${fmtEUR(v)}`;
    sel.appendChild(o);
  }

  const newVal = prev && prev !== "__portfolio__" ? prev : "__portfolio__";
  sel.value = newVal;
  syncCompoundFromAsset(portfolio, avgSavings);

  const note = document.getElementById("compPortfolioNote");
  if (note) {
    if (portfolio.totalValue > 0) {
      note.style.display = "";
      const explicit = portfolio.assetRows.filter(r => r.hasExplicitAppreciation).length;
      const rm = calcPortfolioRealMetrics();
      const realRow = rm.hasData ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          <div style="background:var(--card);border-radius:8px;padding:7px 8px;text-align:center">
            <div style="font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase">Retorno real</div>
            <div style="font-size:13px;font-weight:900;color:${rm.grandTotalReturn>=0?"#059669":"#dc2626"}">${rm.grandTotalReturn>=0?"+":""}${fmtPct(rm.grandTotalReturnPct)}</div>
          </div>
          <div style="background:var(--card);border-radius:8px;padding:7px 8px;text-align:center">
            <div style="font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase">Yield (distrib.)</div>
            <div style="font-size:13px;font-weight:900;color:#6366f1">${fmtPct(rm.ttmYieldNet)}</div>
          </div>
          <div style="background:var(--card);border-radius:8px;padding:7px 8px;text-align:center">
            <div style="font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase">P&L realizado</div>
            <div style="font-size:13px;font-weight:900;color:${rm.totalRealizedPnL>=0?"#059669":"#dc2626"}">${rm.totalRealizedPnL>=0?"+":""}${fmtEUR(rm.totalRealizedPnL)}</div>
          </div>
        </div>` : "";
      note.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div style="font-weight:800">Carteira completa</div>
            <div style="font-size:12px;color:var(--muted)">Motor único usado em Compound, Previsão e FIRE</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:900;font-size:18px;color:var(--text)">${fmtEUR(portfolio.totalValue)}</div>
            <div style="font-size:11px;color:var(--muted)">capital investido</div>
          </div>
        </div>
        ${buildPortfolioEngineSummary(portfolio, [
          { k: "Rendimento anual", v: fmtEUR(portfolio.totalPassive), tone: "green" },
          { k: "Poupança/mês", v: avgSavings > 0 ? fmtEUR(avgSavings) : "—", tone: "slate" }
        ], `Ativos com valorização explícita: ${explicit}${portfolio.classFallbackUsed ? ' · restantes usam pressupostos por classe' : ''}`)
        }${realRow}`;
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
    const p = portfolioData || calcPortfolioYield();
    const s = avgSavings !== undefined ? avgSavings : calcAvgMonthlySavings(6);
    $("compPrincipal").value = String(Math.round(p.totalValue));
    // Use real total return if available from broker data, else estimated
    const rm = calcPortfolioRealMetrics();
    const rateToUse = (rm.hasData && Math.abs(rm.grandTotalReturnPct) < 100 && rm.currentEquityCost > 1000)
      ? p.totalReturnAnnual  // keep blended rate (includes non-equity assets)
      : p.totalReturnAnnual;
    $("compRate").value = fmt(rateToUse, 2);
    $("compFreq").value = "12";
    $("compContrib").value = String(Math.round(s));
    return;
  }

  if (id === "__custom__") return;

  const a = state.assets.find(x => x.id === id);
  if (!a) return;
  $("compPrincipal").value = String(Math.round(parseNum(a.value)));
  $("compRate").value = String(fmt(getAssetTotalReturnPct(a, { allowClassFallback: true }), 2));
  $("compFreq").value = String(a.compoundFreq || 12);
  $("compContrib").value = "0";
}

/* ─── INTEGRAÇÃO P&L → COMPOUND + FIRE ─────────────────────── */
/* ─── CAGR por posição (retorno anualizado real) ─────────────── */
function calcPositionCAGR(pos, asset) {
  // Usar TWR do portfólio se disponível — é o mais rigoroso
  const twr = calcTWR();
  if (twr && Math.abs(twr.annualised) < 100 && twr.years >= 0.5) {
    return twr.annualised; // já anualizado e time-weighted
  }
  // Fallback: CAGR da posição individual
  // gainPct é ganho total acumulado. Precisa da duração em anos.
  // Temos lastUpdated mas não a data de compra — usar 1 ano como estimativa conservadora
  // se não há data. Isto sub-estima o CAGR (mais conservador que sobre-estimar).
  const years = asset.buyDate
    ? (new Date() - new Date(asset.buyDate)) / (365.25 * 86400000)
    : 1; // conservador: assume 1 ano se sem data
  const yrs = Math.max(years, 0.5); // mínimo 6 meses
  const totalReturn = pos.gainPct / 100;
  const cagr = (Math.pow(1 + totalReturn, 1 / yrs) - 1) * 100;
  return Math.max(-50, Math.min(cagr, 100)); // cap ±100% para segurança
}

function usePnLInCompound() {
  const t = calcTotals();
  $("compPrincipal").value = String(Math.round(t.net));

  const py = calcPortfolioYield();
  const twr = calcTWR();
  let rate, rateSource;

  if (twr && twr.years >= 0.5 && Math.abs(twr.annualised) < 80) {
    rate = twr.annualised;
    rateSource = `TWR anualizado (${twr.years} anos)`;
  } else {
    rate = py.totalReturnAnnual;
    rateSource = py.totalReturnSource === "fallback"
      ? "retorno anual estimado ponderado"
      : "retorno anual ponderado";
  }

  $("compRate").value = fmt(Math.max(0.1, Math.min(rate, 50)), 2);

  const savings = calcAvgMonthlySavings(6);
  const monthlyInvest = parseNum((document.getElementById("fireMonthlyInvest")||{}).value || 0);
  $("compContrib").value = String(Math.round(savings + monthlyInvest));

  const sel = $("compAsset");
  if (sel) sel.value = "__portfolio__";

  toast(`✅ Taxa: ${fmt(Math.min(rate,50),2)}% (${rateSource})`);
  calcAndRenderCompound();
  renderCompoundWithDCAPanel();
  renderReturnBreakdown();
}

function usePnLInFIRE() {
  const twr = calcTWR();
  const retEl = document.getElementById("fireCustomReturn");
  const py = calcPortfolioYield();

  if (twr && twr.years >= 0.5 && Math.abs(twr.annualised) < 80) {
    const safeRate = Math.max(0.1, Math.min(twr.annualised, 50));
    if (retEl) retEl.value = fmt(safeRate, 2);
    toast(`✅ FIRE: ${fmt(safeRate,2)}%/ano (TWR anualizado ${twr.years}a)`);
  } else {
    const fallback = Math.max(0.1, Math.min(py.totalReturnAnnual, 30));
    if (retEl) retEl.value = fmt(fallback, 2);
    toast(`⚠️ Sem TWR suficiente. FIRE usa ${fmt(fallback,2)}%/ano ponderado.`);
  }

  const monthlyEl = document.getElementById("fireSaveInput");
  const savings = calcAvgMonthlySavings(6);
  if (monthlyEl && savings > 0) monthlyEl.value = String(Math.round(savings));

  renderFire();
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
      const assetsWithYield = state.assets.filter(a => parseNum(a.value) > 0);
      if (assetsWithYield.length > 0) {
        const COMPOUND_LIMIT = 10;
        if (window._compoundExpanded == null) window._compoundExpanded = false;
        const shownAssets = window._compoundExpanded ? assetsWithYield : assetsWithYield.slice(0, COMPOUND_LIMIT);
        const rows = shownAssets.map(a => {
          const v0 = parseNum(a.value);
          const r = getAssetTotalReturnPct(a, { allowClassFallback: true });
          const fq = a.compoundFreq || 1;
          const vN = compoundGrowth(v0, r, years, fq, 0)[years].value;
          return `<div class="item" style="cursor:default">
            <div class="item__l">
              <div class="item__t">${escapeHtml(a.name)}</div>
              <div class="item__s">${escapeHtml(a.class)} · retorno total ${fmtPct(r)}/ano · cap. ${fq}×/ano</div>
            </div>
            <div class="item__v" style="text-align:right">
              <div>${fmtEUR(vN)}</div>
              <div class="item__s" style="color:#059669">+${fmtEUR(vN - v0)}</div>
            </div>
          </div>`;
        }).join("");
        const toggle = assetsWithYield.length > COMPOUND_LIMIT ? `<div style="text-align:center;margin-top:10px"><button class="btn btn--ghost btn--sm" onclick="window._compoundExpanded=!window._compoundExpanded;calcAndRenderCompound()" style="font-size:13px">${window._compoundExpanded ? "▲ Ver menos" : "▼ Ver mais (" + assetsWithYield.length + ")"}</button></div>` : "";
        tb.innerHTML += `<div style="margin-top:14px"><div class="card__title" style="font-size:16px;margin-bottom:8px">Decomposição por ativo (${years}a)</div><div class="list">${rows}</div>${toggle}</div>`;
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

  // Chart — 3 linhas
  // GARANTIA MATEMÁTICA:
  // Juro composto (freq>1): P*(1+r/n)^(n*t) — exponencial
  // Juro simples: P*(1+r*t) — linear, SEMPRE abaixo do composto para r>0, t>0
  // Só capital: P+C*t — linha recta sem qualquer juro
  const ctx = ensureChartCtx("compoundChart", 240);
  if (!ctx) { renderChartUnavailable("compoundChart"); return; }
  clearChartUnavailable("compoundChart");
  if (compoundChart) compoundChart.destroy();

  // Juro simples ANUAL: sempre calculado com taxa efectiva anual sobre capital inicial
  // Fórmula: P*(1 + r*t) + contribuições*t (sem reinvestimento)
  const effRateDecimal = effectiveRate(rate, freq) / 100; // taxa efectiva anual real
  const simpleLine = data.map((_, i) => {
    // Juro simples: juros calculados sobre o principal original × número de anos
    const interest = principal * effRateDecimal * i;
    const contribs = contrib * 12 * i;
    return principal + interest + contribs;
  });

  // Só capital: zero rendimento, apenas principal + contribuições
  const contribLine = data.map((_, i) => principal + contrib * 12 * i);

  // Verificação: se algum ponto do composto ficar abaixo do simples (não devia acontecer),
  // é sinal que a taxa é muito pequena — avisamos no tooltip
  const maxSimple = Math.max(...simpleLine);
  const maxCompound = Math.max(...data.map(d => d.value));

  compoundChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(d => `+${d.year}a`),
      datasets: [
        {
          label: "Juro composto",
          data: data.map(d => d.value),
          tension: .4, borderColor: "#5b5ce6",
          backgroundColor: "rgba(91,92,230,.09)", fill: true,
          pointRadius: 0, borderWidth: 2.5
        },
        {
          label: "Juro simples",
          data: simpleLine,
          tension: 0, borderDash: [6, 4], borderColor: "#f59e0b",
          borderWidth: 1.8, pointRadius: 0, fill: false
        },
        {
          label: "Só capital",
          data: contribLine,
          tension: 0, borderDash: [2, 6], borderColor: "#94a3b8",
          borderWidth: 1.5, pointRadius: 0, fill: false
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { weight: "bold" } } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}`,
            afterBody: (items) => {
              const yr = items[0]?.dataIndex || 0;
              if (yr === 0) return [];
              const comp = data[yr]?.value || 0;
              const simp = simpleLine[yr] || 0;
              const diff = comp - simp;
              if (diff > 1) return [`✅ Vantagem do composto: +${fmtEUR(diff)}`];
              return [];
            }
          }
        }
      },
      scales: {
        y: { ticks: { callback: v => fmtEUR(v) } },
        x: { ticks: { maxTicksLimit: 10 } }
      }
    }
  });
}

/* ── Forecast / Rentabilidade Panel ── */
function renderForecastPanel() {
  const years = parseInt($("forecastYears") && $("forecastYears").value) || 10;
  const t = calcTotals();
  const py = calcPortfolioYield();

  const rows = state.assets.filter(a => parseNum(a.value) > 0);

  const note = $("forecastPortfolioNote");
  if (note) {
    if (!rows.length) {
      note.style.display = "none";
    } else {
      note.style.display = "";
      note.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div style="font-weight:800">Motor de retorno da carteira</div>
            <div style="font-size:12px;color:var(--muted)">A projeção global usa a mesma lógica do Compound e do FIRE</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:900;font-size:18px;color:var(--text)">${fmtEUR(py.totalValue)}</div>
            <div style="font-size:11px;color:var(--muted)">valor actual</div>
          </div>
        </div>
        ${buildPortfolioEngineSummary(py, [
          { k: "Horizonte", v: `${years} anos`, tone: "slate" },
          { k: "Ativos", v: String(rows.length), tone: "slate" }
        ], rows.some(a => !hasExplicitAppreciationPct(a)) ? 'Sem valorização explícita nalguns ativos, a app usa pressupostos por classe.' : '')}`;
    }
  }

  const tbl = $("forecastTable");
  if (tbl) {
    if (!rows.length) {
      tbl.innerHTML = `<div class="item"><div class="item__l"><div class="item__t">Nenhum ativo disponível</div><div class="item__s">Adiciona ativos para projetar o património.</div></div><div class="item__v">—</div></div>`;
    } else {
      const FORECAST_LIMIT = 10;
      if (!window._forecastExpanded) window._forecastExpanded = false;
      const shownRows = window._forecastExpanded ? rows : rows.slice(0, FORECAST_LIMIT);
      tbl.innerHTML = shownRows.map(a => {
        const v0 = parseNum(a.value);
        const passiveRate = getAssetPassiveRatePct(a);
        const appreciation = getAssetAppreciationPct(a, { allowClassFallback: true });
        const rate = passiveRate + appreciation;
        const freq = a.compoundFreq || 1;
        const vN = compoundGrowth(v0, rate, years, freq, 0)[years].value;
        const gain = vN - v0;
        return `<div class="item">
          <div class="item__l">
            <div class="item__t">${escapeHtml(a.name)}</div>
            <div class="item__s">${escapeHtml(a.class)} · base ${fmtPct(passiveRate)} + valorização ${fmtPct(appreciation)} = ${fmtPct(rate)}/ano</div>
          </div>
          <div class="item__v" style="text-align:right">
            <div>${fmtEUR(vN)}</div>
            <div class="item__s">+${fmtEUR(gain)}</div>
          </div>
        </div>`;
      }).join("");
      if (rows.length > FORECAST_LIMIT) {
        const btn = document.createElement("div");
        btn.style.cssText = "text-align:center;margin-top:10px";
        btn.innerHTML = `<button class="btn btn--ghost btn--sm" style="font-size:13px">
          ${window._forecastExpanded ? "▲ Ver menos" : "▼ Ver mais (" + rows.length + ")"}
        </button>`;
        btn.querySelector("button").addEventListener("click", () => {
          window._forecastExpanded = !window._forecastExpanded;
          renderForecastPanel();
        });
        tbl.appendChild(btn);
      }
    }
  }

  const ctx = ensureChartCtx("forecastChart", 240);
  if (!ctx) { renderChartUnavailable("forecastChart"); return; }
  clearChartUnavailable("forecastChart");
  if (forecastChart) forecastChart.destroy();

  const aggData = compoundGrowth(py.totalValue, py.totalReturnAnnual, years, 12, 0).map(d => d.value);
  const flatLine = Array(years + 1).fill(t.assetsTotal);
  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array.from({ length: years + 1 }, (_, i) => `+${i}a`),
      datasets: [
        { label: "Carteira projetada", data: aggData, tension: .4, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.08)", fill: true, pointRadius: 0, borderWidth: 2.2 },
        { label: "Atual (sem crescimento)", data: flatLine, borderDash: [6, 4], borderColor: "#94a3b8", borderWidth: 1.5, pointRadius: 0 }
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

  const ctx = ensureChartCtx("compareChart", 220);
  if (!ctx) { renderChartUnavailable("compareChart"); return; }
  clearChartUnavailable("compareChart");
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
    const COMPARE_LIMIT = 10;
    if (!window._compareExpanded) window._compareExpanded = false;
    const allRows = displayData.slice().reverse();
    const shownRows = window._compareExpanded ? allRows : allRows.slice(0, COMPARE_LIMIT);
    tbl.innerHTML = shownRows.map(d => {
      const sign = (d.delta || 0) >= 0 ? "+" : "";
      const cls = (d.delta || 0) >= 0 ? "kpi--in" : "kpi--out";
      return `<div class="item">
        <div class="item__l"><div class="item__t">${escapeHtml(d.label)}</div><div class="item__s">Valor: ${fmtEUR(d.cur)}</div></div>
        <div class="item__v ${cls}">${sign}${fmtEUR(d.delta || 0)}</div>
      </div>`;
    }).join("");
    if (allRows.length > COMPARE_LIMIT) {
      const btn = document.createElement("div");
      btn.style.cssText = "text-align:center;margin-top:10px";
      btn.innerHTML = `<button class="btn btn--ghost btn--sm" style="font-size:13px">
        ${window._compareExpanded ? "▲ Ver menos" : "▼ Ver mais (" + allRows.length + ")"}
      </button>`;
      btn.querySelector("button").addEventListener("click", () => {
        window._compareExpanded = !window._compareExpanded;
        renderComparePanel();
      });
      tbl.appendChild(btn);
    }
  }
}

/* ── FIRE Panel ── */
function renderFire() {
  const W = parseInt($("fireWindow").value || "6", 10);
  const H = parseInt($("fireHorizon").value || "30", 10);

  const rm = calcPortfolioRealMetrics();

  // Capital investível (excluindo habitação própria)
  const isHome = a => {
    const nm = (a.name||"").toLowerCase(), cl = (a.class||"").toLowerCase();
    return cl.includes("imob") && (nm.includes("casa")||nm.includes("habita")||nm.includes("home")||nm.includes("própri"));
  };
  const investible = state.assets.filter(a => !isHome(a)).reduce((s,a) => s + parseNum(a.value), 0);
  const debt = state.liabilities.reduce((s,a) => s + Math.abs(parseNum(a.value)), 0);
  const cap0 = Math.max(0, investible - debt);

  // Cashflow from transactions
  const byMonth = new Map();
  for (const t of (state.transactions||[])) {
    if (isInterAccountTransfer(t)) continue;
    const d = t.date||""; if (d.length < 7) continue;
    const ym = d.slice(0,7);
    const cur = byMonth.get(ym) || {inc:0,out:0};
    const v = parseNum(t.amount);
    if (t.type==="out") cur.out += v; else cur.inc += v;
    byMonth.set(ym, cur);
  }
  const mKeys = [...byMonth.keys()].sort().slice(-W);
  const avg = k => mKeys.length ? mKeys.reduce((s,m) => s + (byMonth.get(m)?.[k]||0), 0) / mKeys.length : 0;

  // Allow manual override
  const expInputVal    = parseNum($("fireExpInput").value);
  const saveInputVal   = parseNum($("fireSaveInput").value);
  const monthlyInvest  = parseNum((document.getElementById("fireMonthlyInvest")||{}).value || 0);
  const outM  = expInputVal  > 0 ? expInputVal  : avg("out");
  // Poupança = campo manual OR automático do balanço + investimento mensal programado
  const saveM = (saveInputVal > 0 ? saveInputVal : Math.max(0, avg("inc") - avg("out"))) + monthlyInvest;

  // Auto-fill inputs if empty
  if (!$("fireExpInput").value  && outM  > 0) $("fireExpInput").placeholder  = fmtEUR(outM).replace("€","").trim() + " (auto)";
  if (!$("fireSaveInput").value && saveM > 0) $("fireSaveInput").placeholder = fmtEUR(saveM).replace("€","").trim() + " (auto)";

  const exp0 = outM * 12;
  const totals = calcTotals();
  const passiveAnnual = totals.passiveAnnual;
  const passiveYieldRate = cap0 > 0 ? passiveAnnual / cap0 : 0;

  // Update KPIs
  $("fireCap").textContent  = fmtEUR(cap0);
  $("fireExp").textContent  = fmtEUR(exp0);
  $("firePass").textContent = fmtEUR(passiveAnnual);
  // Annotate with real yield if broker data available
  if (rm && rm.hasData && rm.ttmYieldNet > 0) {
    const passEl = document.getElementById("firePass");
    if (passEl && passEl.parentElement) {
      let sub = passEl.parentElement.querySelector(".kpi__s");
      if (!sub) { sub = document.createElement("div"); sub.className = "kpi__s"; passEl.parentElement.appendChild(sub); }
      sub.textContent = `Yield real (distrib.): ${fmtPct(rm.ttmYieldNet)}`;
    }
  }
  $("fireSave").textContent = fmtEUR(saveM) + "/mês" + (monthlyInvest > 0 ? ` (incl. ${fmtEUR(monthlyInvest)} DCA)` : "");

  // Progress bars (base scenario FIRE number = exp0 / 0.0375)
  const baseFireNum = exp0 > 0 ? exp0 / 0.0375 : 0;
  const capPct  = baseFireNum > 0 ? Math.min(100, cap0 / baseFireNum * 100) : 0;
  const passPct = exp0 > 0 ? Math.min(100, passiveAnnual / exp0 * 100) : 0;
  $("fireCapPct").textContent  = capPct.toFixed(1) + "%";
  $("firePassPct").textContent = passPct.toFixed(1) + "%";
  const capBar  = document.getElementById("fireCapBar");
  const passBar = document.getElementById("firePassBar");
  if (capBar)  setTimeout(() => capBar.style.width  = capPct  + "%", 50);
  if (passBar) setTimeout(() => passBar.style.width = passPct + "%", 50);

  // Scenarios
  const py = calcPortfolioYield();
  const customReturnEl = document.getElementById("fireCustomReturn");
  const customInflEl   = document.getElementById("fireCustomInflation");
  const customR   = customReturnEl ? parseNum(customReturnEl.value) : 0;
  const customInf = customInflEl   ? parseNum(customInflEl.value)   : 0;
  const baseReturnPct = Math.max(0.5, Math.min(customR > 0 ? customR : (py.totalReturnAnnual || 6), 18));
  const baseInflPct   = customInf > 0 ? customInf : 2.5;

  const scenarios = [
    { name:"Conservador", emoji:"🐢", r:Math.max(0.005, (baseReturnPct - 2) / 100), inf:(baseInflPct + 0.5) / 100, swr:0.0325, color:"#f59e0b" },
    { name:"Base",        emoji:"⚖️", r:baseReturnPct / 100,                  inf:baseInflPct / 100,        swr:0.0375, color:"#6366f1" },
    { name:"Optimista",   emoji:"🚀", r:Math.min(0.25, (baseReturnPct + 2) / 100), inf:Math.max(0, (baseInflPct - 0.5) / 100), swr:0.04, color:"#10b981" },
  ];

  const fireEngineNote = $("fireEngineNote");
  if (fireEngineNote) {
    fireEngineNote.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div style="font-weight:800">Motor de retorno FIRE</div>
          <div style="font-size:12px;color:var(--muted)">${customR > 0 ? 'Estás a usar um retorno manual.' : 'Em modo automático, o FIRE usa o mesmo motor da carteira.'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:900;font-size:18px;color:var(--text)">${fmtPct(baseReturnPct)}</div>
          <div style="font-size:11px;color:var(--muted)">retorno base do cenário central</div>
        </div>
      </div>
      ${buildPortfolioEngineSummary(py, [
        { k: 'Retorno FIRE', v: fmtPct(baseReturnPct), tone: 'vio' },
        { k: 'Inflação', v: fmtPct(baseInflPct), tone: 'slate' }
      ], customR > 0 ? 'O retorno FIRE foi sobreposto manualmente.' : 'Sem override manual, FIRE herda o retorno total da carteira.')}`;
  }

  const results = [];
  for (const sc of scenarios) {
    let cap = cap0, exp = exp0, hit = null;
    const fireNum = sc.swr > 0 ? exp0 / sc.swr : Infinity;
    for (let t = 0; t <= H; t++) {
      const pass = passiveYieldRate * cap;
      const fn = sc.swr > 0 ? exp / sc.swr : Infinity;
      if (!hit && cap >= fn) hit = {t, cap, exp, pass, fireNum: fn};
      if (t < H) {
        cap = cap * (1 + sc.r) + saveM * 12;
        exp = exp * (1 + sc.inf);
      }
    }
    results.push({sc, hit, fireNum});
  }

  // Results list
  const list = $("fireResults");
  list.innerHTML = results.map(r => {
    const hitLabel = r.hit
      ? `<span style="color:#059669;font-weight:700">🎯 FIRE em ${r.hit.t} anos</span><br><span style="font-size:11px;color:#64748b">Capital: ${fmtEUR(r.hit.cap)} · Rend: ${fmtEUR(r.hit.pass)}/ano</span>`
      : `<span style="color:#ef4444;font-weight:600">Não atinge em ${H}a</span>`;
    return `<div style="padding:12px;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:18px">${r.sc.emoji}</span>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${r.sc.name}</div>
          <div style="font-size:11px;color:#94a3b8">Retorno ${fmtPct(r.sc.r*100)} · Inflação ${fmtPct(r.sc.inf*100)} · SWR ${fmtPct(r.sc.swr*100)}</div>
        </div>
        <div style="text-align:right">${hitLabel}</div>
      </div>
      <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden">
        <div style="height:5px;background:${r.sc.color};border-radius:3px;width:${Math.min(100,cap0/r.fireNum*100).toFixed(1)}%"></div>
      </div>
    </div>`;
  }).join("");

  // FIRE numbers card
  const numsEl = document.getElementById("fireNumbers");
  if (numsEl) {
    numsEl.innerHTML = scenarios.map(sc => {
      const fn = sc.swr > 0 ? exp0 / sc.swr : Infinity;
      const gap = Math.max(0, fn - cap0);
      return `<div style="padding:10px;border-bottom:1px solid #f1f5f9">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:600">${sc.emoji} ${sc.name} (SWR ${fmtPct(sc.swr*100)})</div>
          <div style="font-weight:800;color:#0f172a">${fmtEUR(fn)}</div>
        </div>
        <div style="font-size:12px;color:${gap > 0 ? "#ef4444" : "#059669"};margin-top:2px">
          ${gap > 0 ? `Faltam ${fmtEUR(gap)}` : "✅ Já atingiste!"}
        </div>
      </div>`;
    }).join("");
  }

  // Partial independence
  const partialEl = document.getElementById("firePartial");
  if (partialEl && exp0 > 0) {
    const coverPct = Math.min(100, passiveAnnual / exp0 * 100);
    const uncovered = Math.max(0, exp0 - passiveAnnual);
    partialEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px">O teu rendimento passivo cobre</span>
        <span style="font-weight:800;font-size:15px;color:${coverPct>=100?"#059669":"#6366f1"}">${coverPct.toFixed(1)}%</span>
      </div>
      <div style="height:10px;background:#e2e8f0;border-radius:5px;overflow:hidden;margin-bottom:10px">
        <div style="height:10px;background:linear-gradient(90deg,#10b981,#6366f1);border-radius:5px;width:${coverPct}%;transition:width .6s"></div>
      </div>
      <div style="font-size:13px;color:#475569">
        ${coverPct >= 100
          ? "🎉 O teu rendimento passivo já cobre todas as despesas — estás financeiramente independente!"
          : `Faltam <b>${fmtEUR(uncovered)}/ano</b> (${fmtEUR(uncovered/12)}/mês) para cobertura total.`}
      </div>
      <div style="margin-top:10px;font-size:12px;color:#94a3b8">
        💡 Reduzir despesas em ${fmtEUR(uncovered/12)}/mês <b>ou</b> aumentar rendimento passivo ao mesmo valor = independência financeira.
      </div>`;
  }

  // Chart
  const canvas = prepareChartCanvas(document.getElementById("fireChart"), 260);
  if (!canvas || typeof Chart === "undefined") { renderChartUnavailable("fireChart"); return; }
  clearChartUnavailable("fireChart");
  const base = scenarios[1];
  let cap = cap0, exp = exp0;
  const labels = [], capS = [], fireS = [], passS = [], cap2 = [], cap3 = [];
  let cap_cons = cap0, exp_cons = exp0;
  let cap_opt  = cap0, exp_opt  = exp0;
  for (let t = 0; t <= H; t++) {
    labels.push(t === 0 ? "Hoje" : "+" + t + "a");
    capS.push(Math.round(cap));
    fireS.push(base.swr > 0 ? Math.round(exp / base.swr) : null);
    passS.push(Math.round(passiveYieldRate * cap));
    cap2.push(Math.round(cap_cons));
    cap3.push(Math.round(cap_opt));
    if (t < H) {
      cap      = cap      * (1 + base.r)         + saveM * 12; exp      = exp      * (1 + base.inf);
      cap_cons = cap_cons * (1 + scenarios[0].r)  + saveM * 12; exp_cons = exp_cons * (1 + scenarios[0].inf);
      cap_opt  = cap_opt  * (1 + scenarios[2].r)  + saveM * 12; exp_opt  = exp_opt  * (1 + scenarios[2].inf);
    }
  }

  const ctx = canvas.getContext("2d");
  if (fireChart) fireChart.destroy();
  fireChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Capital (Base)", data: capS, tension:.3, borderColor:"#6366f1", backgroundColor:"rgba(99,102,241,.08)", fill:true, pointRadius:0, borderWidth:2 },
        { label: "Capital (Cons.)", data: cap2, tension:.3, borderColor:"#f59e0b", borderDash:[3,3], pointRadius:0, borderWidth:1.5 },
        { label: "Capital (Opt.)",  data: cap3, tension:.3, borderColor:"#10b981", borderDash:[3,3], pointRadius:0, borderWidth:1.5 },
        { label: "FIRE número", data: fireS, tension:.3, borderColor:"#ef4444", borderDash:[8,4], pointRadius:0, borderWidth:2 },
      ]
    },
    options: {
      plugins: {
        legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEUR(c.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v), font:{size:10} } } }
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
    tog.textContent = distDetailExpanded ? "▲ Ver menos" : "▼ Ver mais ("+entries.length+")";
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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents: símbolo→simbolo
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
      const appPct = parseNumberSmart(r.valorizacao_esperada_pct || r.expected_appreciation_pct || r.appreciation_pct || r.capital_return_pct || r.growth_pct);
      const item = { id: uid(), class: normalizeClassName(className), name, value: Math.abs(value), yieldType: normalizeYieldType(r.yield_tipo || r.yield_type || ""), yieldValue: Number.isFinite(yv) ? yv : 0, compoundFreq: 12, notes: "" };
      if (Number.isFinite(appPct) && Math.abs(appPct) > 1e-9) item.appreciationPct = appPct;
      if (kind === "passivo") { state.liabilities.push(item); addedL++; }
      else { state.assets.push(item); addedA++; }
      continue;
    }
    unknown++;
  }

  // Convert trades to assets
  // Step 1: merge multi-currency positions for same ticker into one asset
  const FX_TO_EUR = {
    EUR:1, USD:0.92, GBP:1.17, DKK:0.134, CHF:1.05, PLN:0.23,
    SEK:0.087, NOK:0.085, CAD:0.68, AUD:0.59, JPY:0.006,
    HKD:0.118, SGD:0.68, BRL:0.17, MXN:0.046, ZAR:0.052
  };
  const mergedPos = new Map();
  for (const p of posMap.values()) {
    if (!(p.qty > 0) || !(p.cost > 0)) continue;
    const t = p.ticker;
    if (!mergedPos.has(t)) mergedPos.set(t, { ticker:t, qty:0, cost:0, comm:0, ccys:[] });
    const m = mergedPos.get(t);
    m.qty  += p.qty;
    m.cost += p.cost;
    m.comm += p.comm || 0;
    if (!m.ccys.includes(p.ccy)) m.ccys.push(p.ccy);
  }

  // Step 2: create or update one asset per ticker with FX-converted cost
  for (const p of mergedPos.values()) {
    const upper = String(p.ticker).toUpperCase();
    const isCrypto = upper.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(upper.replace(/\.CC$/, ""));
    const cls = isCrypto ? "Cripto" : "Ações/ETFs";
    const ccyLabel = p.ccys.join("/");

    // Convert cost to EUR — re-iterate posMap to apply per-currency FX
    let costEUR = 0;
    for (const [, pos] of posMap.entries()) {
      if (pos.ticker !== p.ticker || pos.qty <= 0) continue;
      costEUR += pos.cost * (FX_TO_EUR[pos.ccy] || 1);
    }
    costEUR += p.comm || 0;

    const fxNote = p.ccys.some(c => c !== "EUR")
      ? " · ⚠️ Custo histórico (FX aprox.) — actualiza via ⟳ Cotações" : "";
    const notes = `Importado trades. Qty=${String(Math.round(p.qty*1e6)/1e6)} · PM=${p.cost > 0 ? String(Math.round(p.cost/p.qty*1e4)/1e4) : "—"} ${ccyLabel}${fxNote}`;

    const existingIx = state.assets.findIndex(a => (a.name||"").toUpperCase() === upper && a.class === cls);
    const assetObj = {
      id: existingIx >= 0 ? state.assets[existingIx].id : uid(),
      class: cls, name: p.ticker, value: costEUR,
      yieldType: "none", yieldValue: 0, compoundFreq: 12, notes,
      // Campos dedicados para P&L
      qty: p.qty,
      costBasis: costEUR,
      pmOriginal: p.qty > 0 ? p.cost / p.qty : 0,
      pmCcy: p.ccys[0] || "EUR"
    };
    if (existingIx >= 0) {
      state.assets[existingIx] = { ...state.assets[existingIx], ...assetObj };
    } else {
      state.assets.push(assetObj);
      addedA++;
    }
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

function ensureBrokerData() {
  if (!state.brokerData || typeof state.brokerData !== "object") state.brokerData = { files: [], events: [], positions: [] };
  if (!Array.isArray(state.brokerData.files)) state.brokerData.files = [];
  if (!Array.isArray(state.brokerData.events)) state.brokerData.events = [];
  if (!Array.isArray(state.brokerData.positions)) state.brokerData.positions = [];
  return state.brokerData;
}

function getBrokerDataSignature() {
  const bd = ensureBrokerData();
  const fileHashes = (bd.files || []).map(f => String(f.hash || '')).sort().join('|');
  return [
    (bd.files || []).length,
    (bd.events || []).length,
    (bd.positions || []).length,
    fileHashes
  ].join('::');
}

function hasBrokerGeneratedMirror() {
  return !!(
    (state.assets || []).some(a => a && a.generatedFromBroker) ||
    (state.dividends || []).some(d => d && d.generatedFromBroker) ||
    (state.transactions || []).some(t => t && t.generatedFromBroker)
  );
}

async function hashFile(file) {
  try {
    if (crypto && crypto.subtle && file && typeof file.arrayBuffer === "function") {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (_) {}
  return [file?.name || "", file?.size || 0, file?.lastModified || 0].join("|");
}

async function fileToObjectRows(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    if (typeof XLSX === "undefined") throw new Error("Biblioteca Excel não carregada.");
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array", raw: false, cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  }
  const text = await fileToText(file);
  return csvToObjects(text);
}

function xtbWorkbookSheetToRows(ws) {
  if (typeof XLSX === "undefined" || !ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (!Array.isArray(aoa) || !aoa.length) return [];

  const HEADER_HINTS = new Set([
    "id","position","posicao","symbol","simbolo","instrumento","type","tipo","volume","qty","quantity","quantidade",
    "open_time","opentime","close_time","closetime","open_price","close_price","market_price",
    "hora_de_abertura","hora_abertura","hora_de_fecho","hora_fecho",
    "preco_de_abertura","preco_de_fecho","preco_atual","preco_de_mercado",
    "purchase_value","amount","montante","comment","comentario","time","date","data","profit","lucro",
    "commission","comissao","swap","margin","market price","open price","close price"
  ]);

  let bestIdx = -1;
  let bestScore = 0;
  const maxScan = Math.min(aoa.length, 40);

  for (let i = 0; i < maxScan; i++) {
    const row = Array.isArray(aoa[i]) ? aoa[i] : [];
    const normed = row.map(v => normKey(v)).filter(Boolean);
    if (!normed.length) continue;
    let score = 0;
    normed.forEach(k => {
      if (HEADER_HINTS.has(k) || HEADER_HINTS.has(k.replace(/_/g, " "))) score += 2;
    });
    if (normed.includes("symbol") || normed.includes("simbolo") || normed.includes("instrumento")) score += 4;
    if (normed.includes("type") || normed.includes("tipo")) score += 3;
    if (normed.includes("amount") || normed.includes("montante")) score += 3;
    if (normed.includes("open_time") || normed.includes("close_time") ||
        normed.includes("hora_de_abertura") || normed.includes("hora_de_fecho")) score += 3;
    if (normed.includes("market_price") || normed.includes("open_price") ||
        normed.includes("preco_de_abertura") || normed.includes("preco_atual")) score += 3;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestIdx < 0 || bestScore < 5) return [];

  const headerRow = Array.isArray(aoa[bestIdx]) ? aoa[bestIdx] : [];
  let startCol = 0;
  while (startCol < headerRow.length && !String(headerRow[startCol] || "").trim()) startCol++;

  const rawHeaders = headerRow.slice(startCol).map(v => String(v || "").trim());
  const headers = rawHeaders.map((h, idx) => h || `__col_${idx}`);
  const out = [];

  for (let r = bestIdx + 1; r < aoa.length; r++) {
    const row = Array.isArray(aoa[r]) ? aoa[r].slice(startCol, startCol + headers.length) : [];
    if (!row.some(v => String(v || "").trim() !== "")) continue;
    const obj = {};
    headers.forEach((h, c) => { obj[h] = row[c] ?? ""; });
    out.push(obj);
  }
  return out;
}

function xtbExtractSheetMeta(ws, sheetName = "") {
  const meta = { asOfDate: "", sheetName: String(sheetName || "") };
  try {
    if (typeof XLSX === "undefined" || !ws) return meta;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    const nameMatch = String(sheetName || "").match(/(\d{2})(\d{2})(\d{4})/);
    if (nameMatch) meta.asOfDate = `${nameMatch[3]}-${nameMatch[2]}-${nameMatch[1]}`;
    if (!meta.asOfDate) {
      for (let i = 0; i < Math.min(15, aoa.length); i++) {
        const row = Array.isArray(aoa[i]) ? aoa[i] : [];
        for (const cell of row) {
          const s = String(cell || "").trim();
          const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (m) { meta.asOfDate = `${m[3]}-${m[2]}-${m[1]}`; break; }
        }
        if (meta.asOfDate) break;
      }
    }
  } catch(_) {}
  return meta;
}

function workbookToBrokerBlocks(wb) {
  const blocks = [];
  if (typeof XLSX === "undefined" || !wb || !Array.isArray(wb.SheetNames)) return blocks;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = xtbWorkbookSheetToRows(ws);
    if (!rows.length) continue;
    const format = detectBrokerRowsFormat(rows);
    if (format === "unknown") continue;
    blocks.push({ sheetName, format, rows, meta: xtbExtractSheetMeta(ws, sheetName) });
  }
  return blocks;
}

const FX_FALLBACK_STATIC = {
  EUR:1, USD:0.92, GBP:1.17, GBX:0.0117, CHF:1.05, CAD:0.68, AUD:0.59,
  DKK:0.134, SEK:0.087, NOK:0.085, PLN:0.23, JPY:0.006, HKD:0.118,
  SGD:0.68, BRL:0.17, MXN:0.046, ZAR:0.052
};

function brokerApproxFxToEUR(ccy) {
  const c = String(ccy || "EUR").toUpperCase();
  // Prefer live rates stored after last ⟳ Cotações
  const live = state && state.settings && state.settings.lastFxRates;
  if (live && live[c]) return live[c];
  return FX_FALLBACK_STATIC[c] || 1;
}

/** Convert amount in any currency to EUR */
function toEUR(amount, ccy) {
  if (!ccy || String(ccy).toUpperCase() === "EUR") return amount;
  return amount * brokerApproxFxToEUR(ccy);
}

/** Format a value in its native currency */
function fmtCcy(amount, ccy) {
  const c = String(ccy || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("pt-PT", { style:"currency", currency:c, maximumFractionDigits:2 }).format(amount);
  } catch(_) { return `${(+amount).toFixed(2)} ${c}`; }
}

/** Badge showing native currency value for non-EUR assets */
function ccyBadge(item) {
  const c = String(item.currency || item.priceCurrency || "").toUpperCase();
  if (!c || c === "EUR") return "";
  const v = parseNum(item.valueLocal || 0) || parseNum(item.value);
  if (!v) return "";
  return ` <span class="badge" style="background:#dbeafe;color:#1e40af;font-size:10px;border:1px solid #93c5fd">${fmtCcy(v, c)}</span>`;
}

function normalizeISIN(v) {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s) ? s : "";
}

function normalizeSecurityNameKey(v) {
  return String(v || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|SA|S A|SGPS|PLC|LTD|LIMITED|NV|N V|AG|SE|ETF|ETFS|FUND|FUNDO|CLASS [A-Z]|ORDINARY SHARES|SHARES)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


const KNOWN_BROKER_YAHOO_OVERRIDES = {
  "AT0000A3EPA4|AMS": "AMS2.VI",
  "AU0000185993|IREN": "IREN",
  "BRVALEACNOR0|XVALO": "XVALO.MC",
  "CH0334081137|CRSP": "CRSP",
  "GB0007188757|RIO1": "RIO.L",
  "GB00BVZK7T90|UNA": "UNA.AS",
  "IE00045C7B38|HTOO": "HTOO",
  "IE00BLS09M33|PNR": "PNR",
  "IE00BTN1Y115|MDT": "MDT",
  "IE00BY7QL619|JCI": "JCI",
  "IT0003128367|ENL": "ENEL.MI",
  "NL0009434992|LYB": "LYB",
  "NL0009805522|NBIS": "NBIS",
  "NL00150001Q9|STLA": "STLA",
  "AT0000A3EPA4|AMS-OSRAM": "AMS2.VI",
  "|MPW.US": "MPW",
  "|MPW": "MPW",
  "|CRSP": "CRSP",
  "|NZYMB.DK": "NSIS-B.CO",
  "|STM.FR": "STMPA.PA",
  "|RIO1": "RIO.L",
  "|UNA": "UNA.AS",
  "|ENL": "ENEL.MI",
  "|XVALO": "XVALO.MC"
};

function getKnownBrokerYahooOverride({ isin = "", ticker = "", name = "", currency = "", priceCurrency = "" } = {}) {
  const i = String(isin || "").trim().toUpperCase();
  const t = String(ticker || "").trim().toUpperCase();
  const n = normalizeSecurityNameKey(name || "");
  const ccy = String(priceCurrency || currency || "").trim().toUpperCase();
  const pair = `${i}|${t}`;
  if (KNOWN_BROKER_YAHOO_OVERRIDES[pair]) return KNOWN_BROKER_YAHOO_OVERRIDES[pair];
  if (KNOWN_BROKER_YAHOO_OVERRIDES[`|${t}`]) return KNOWN_BROKER_YAHOO_OVERRIDES[`|${t}`];

  if (t === "STM.FR" || /\bSTMICROELECTRONICS\b/.test(n)) return "STMPA.PA";
  if (t === "NZYMB.DK" || /\bNOVOZYMES\b/.test(n)) return "NSIS-B.CO";
  if ((t === "AMS" || /\bAMS[ -]OSRAM\b/.test(n)) && (ccy === "CHF" || i === "AT0000A3EPA4")) return "AMS2.VI";
  if ((t === "XVALO" || /\bVALE\b/.test(n)) && i === "BRVALEACNOR0") return "XVALO.MC";
  if ((t === "UNA" || /\bUNILEVER\b/.test(n)) && i === "GB00BVZK7T90") return "UNA.AS";
  if ((t === "RIO1" || /\bRIO TINTO\b/.test(n)) && i === "GB0007188757") return "RIO.L";
  if ((t === "NBIS" || /\bNEBIUS\b/.test(n)) && i === "NL0009805522") return "NBIS";
  if ((t === "STLA" || /\bSTELLANTIS\b/.test(n)) && i === "NL00150001Q9") return "STLA";
  if ((t === "PNR" || /\bPENTAIR\b/.test(n)) && i === "IE00BLS09M33") return "PNR";
  if ((t === "LYB" || /\bLYONDELLBASELL\b/.test(n)) && i === "NL0009434992") return "LYB";
  if ((t === "JCI" || /\bJOHNSON CONTROLS\b/.test(n)) && i === "IE00BY7QL619") return "JCI";
  if ((t === "MDT" || /\bMEDTRONIC\b/.test(n)) && i === "IE00BTN1Y115") return "MDT";
  if ((t === "CRSP" || /\bCRISPR THERAPEUTICS\b/.test(n)) && i === "CH0334081137") return "CRSP";
  if ((t === "IREN" || n === "IREN") && i === "AU0000185993") return "IREN";
  if ((t === "ENL" || /\bENEL\b/.test(n)) && i === "IT0003128367") return "ENEL.MI";
  if ((t === "HTOO" || /\bFUSION FUEL GREEN\b/.test(n)) && i === "IE00045C7B38") return "HTOO";
  if (t === "MPW.US" || (t === "MPW" && ccy === "USD")) return "MPW";
  return "";
}

function canonicalBrokerTickerBase(v) {
  let t = String(v || "").trim().toUpperCase();
  if (!t) return "";
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/^[A-Z0-9.-]+\.US$/.test(t)) return t.replace(/\.US$/, "");
  if (/^[A-Z0-9.-]+\.(NYSE|NASDAQ|XNAS|XNYS|ARCA|AMEX)$/.test(t)) return t.replace(/\.(NYSE|NASDAQ|XNAS|XNYS|ARCA|AMEX)$/, "");
  return t;
}

function inferPreferredVenueTicker(rawTicker = "", venue = "") {
  const t = String(rawTicker || "").trim().toUpperCase();
  const v = String(venue || "").trim().toUpperCase();
  if (!t || !v || /[=\-]/.test(t) || t.includes(".")) return "";
  return `${t}.${v}`;
}

function venueFromIsinAndCurrency(isin = "", currency = "", name = "", rawTicker = "") {
  const prefix = String(isin || "").trim().toUpperCase().slice(0, 2);
  const ccy = String(currency || "").trim().toUpperCase();
  const nm = normalizeSecurityNameKey(name || "");
  const raw = String(rawTicker || "").trim().toUpperCase();
  const isAccFund = /\bACC\b/.test(nm) || /\bISHARES\b/.test(nm) || /\bXTRACKERS\b/.test(nm) ||
    /\bWISDOMTREE\b/.test(nm) || /\bVANECK\b/.test(nm) || /\bKRANESHARES\b/.test(nm) ||
    /\bGLOBAL X\b/.test(nm) || /\bETF\b/.test(nm) || /\bFUND\b/.test(nm);

  if (prefix === "PT") return "LS";
  if (prefix === "ES") return "MC";
  if (prefix === "FR") return "PA";
  if (prefix === "IT") return "MI";
  if (prefix === "DE") return "DE";
  if (prefix === "AT") return "VI";
  if (prefix === "CH") return "SW";
  if (prefix === "DK") return "CO";
  if (prefix === "SE") return "ST";
  if (prefix === "NO") return "OL";
  if (prefix === "FI") return "HE";
  if (prefix === "BE") return "BR";
  if (prefix === "GB") return "L";
  if (prefix === "AU") return "AX";
  if (prefix === "CA") return "TO";

  if (/\bAIRBUS\b/.test(nm)) return "PA";
  if (/\bARCELORMITTAL\b/.test(nm)) return "AS";

  if (prefix === "NL") {
    if (ccy === "USD" && raw && /^[A-Z0-9.-]{1,10}$/.test(raw) && !isAccFund) return "";
    return "AS";
  }
  if (prefix === "LU") {
    if (ccy === "USD" && raw && /^[A-Z0-9.-]{1,10}$/.test(raw) && !isAccFund) return "";
    if (/\bARCELORMITTAL\b/.test(nm) || raw === "MT") return "AS";
    return "LU";
  }
  if (prefix === "IE") {
    if (isAccFund) {
      if (ccy === "GBP" || ccy === "GBX" || ccy === "USD") return "L";
      if (ccy === "EUR" || !ccy) return "DE";
    }
    if (ccy === "USD" && raw && /^[A-Z0-9.-]{1,10}$/.test(raw)) return "";
    if (ccy === "GBP" || ccy === "GBX") return "L";
  }
  return "";
}

function inferYahooTickerFromIdentity({ isin = "", ticker = "", yahooTicker = "", name = "", currency = "", priceCurrency = "" } = {}) {
  const i = normalizeISIN(isin);
  const direct = String(yahooTicker || "").trim().toUpperCase();
  const t = String(ticker || "").trim().toUpperCase();
  const n = normalizeSecurityNameKey(name);
  const ccy = String(priceCurrency || currency || "").trim().toUpperCase();

  const knownOverride = getKnownBrokerYahooOverride({ isin: i, ticker: t, yahooTicker: direct, name, currency, priceCurrency });
  if (knownOverride) return String(knownOverride).trim().toUpperCase();

  if (direct) {
    if (/^[A-Z0-9.-]+\.US$/.test(direct)) return direct.replace(/\.US$/, "");
    if (/^[A-Z0-9.-]+\.CH$/.test(direct)) return direct.replace(/\.CH$/, ".SW");
    if (/^[A-Z0-9.-]+\.PT$/.test(direct)) return direct.replace(/\.PT$/, ".LS");
    if (/\.(LS|L|PA|AS|MC|SW|CO|ST|OL|HE|BR|MI|AX|TO|DE|F|VI|IR)$/.test(direct) || /[=\-]/.test(direct)) return direct;
  }

  if (/\bCORTICEIRA\b/.test(n) || /\bAMORIM\b/.test(n)) return "COR.LS";
  if (/\bSONAE\b/.test(n)) return "SON.LS";
  if (/\bREALTY\b/.test(n) && /\bINCOME\b/.test(n)) return "O";
  if (/\bAIRBUS\b/.test(n)) return "AIR.PA";
  if (/\bARCELORMITTAL\b/.test(n)) return "MT.AS";

  if (/^[A-Z0-9.-]+\.US$/.test(t)) return t.replace(/\.US$/, "");
  if (/^[A-Z0-9.-]+\.CH$/.test(t)) return t.replace(/\.CH$/, ".SW");
  if (/^[A-Z0-9.-]+\.PT$/.test(t)) return t.replace(/\.PT$/, ".LS");
  if (/^[A-Z0-9.-]+\.GB$/.test(t)) return t.replace(/\.GB$/, ".L");
  if (/^[A-Z0-9.-]+\.FR$/.test(t)) return t.replace(/\.FR$/, ".PA");
  if (/^[A-Z0-9.-]+\.NL$/.test(t)) return t.replace(/\.NL$/, ".AS");
  if (/^[A-Z0-9.-]+\.ES$/.test(t)) return t.replace(/\.ES$/, ".MC");
  if (/^[A-Z0-9.-]+\.DK$/.test(t)) return t.replace(/\.DK$/, ".CO");
  if (/\.(LS|L|PA|AS|MC|SW|CO|ST|OL|HE|BR|MI|AX|TO|DE|F|VI|IR)$/.test(t) || /[=\-]/.test(t)) return t;

  const rawPlain = canonicalBrokerTickerBase(t);
  const isAccFund = /\bACC\b/.test(n) || /\bETF\b/.test(n) || /\bFUND\b/.test(n) || /\bISHARES\b/.test(n) || /\bXTRACKERS\b/.test(n) || /\bWISDOMTREE\b/.test(n) || /\bVANECK\b/.test(n) || /\bGLOBAL X\b/.test(n) || /\bKRANESHARES\b/.test(n);
  if (rawPlain && /^[A-Z0-9.-]{1,10}$/.test(rawPlain) && ccy === "USD" && !isAccFund) return rawPlain;
  if (rawPlain && /^[A-Z0-9.-]{1,10}$/.test(rawPlain)) {
    const venue = venueFromIsinAndCurrency(i, ccy, n, rawPlain);
    if (venue) return inferPreferredVenueTicker(rawPlain, venue);
  }

  if (i && ISIN_YAHOO_MAP[i]) return String(ISIN_YAHOO_MAP[i] || "").trim().toUpperCase();

  return "";
}

function sameSecurityName(a, b) {
  const na = normalizeSecurityNameKey(a);
  const nb = normalizeSecurityNameKey(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

function sameBrokerSecurityIdentity(a, b) {
  const ia = normalizeISIN(a && a.isin);
  const ib = normalizeISIN(b && b.isin);
  if (ia && ib) return ia === ib;

  const ya = inferYahooTickerFromIdentity(a || {});
  const yb = inferYahooTickerFromIdentity(b || {});
  if (ya && yb && ya === yb) return true;

  const ta = canonicalBrokerTickerBase((a && (a.ticker || a.yahooTicker)) || "");
  const tb = canonicalBrokerTickerBase((b && (b.ticker || b.yahooTicker)) || "");
  if (ta && tb && ta === tb && sameSecurityName(a && a.name, b && b.name)) return true;

  if (sameSecurityName(a && a.name, b && b.name) && (!ta || !tb || ta === tb)) return true;
  return false;
}

function makeBrokerSecurityKey({ isin = "", ticker = "", name = "", currency = "", priceCurrency = "", totalCurrency = "", yahooTicker = "" } = {}) {
  const i = normalizeISIN(isin);
  if (i) return `ISIN:${i}`;
  const y = inferYahooTickerFromIdentity({ isin, ticker, yahooTicker, name });
  if (y) return `YAHOO:${y}`;
  const t = canonicalBrokerTickerBase(ticker || yahooTicker || "");
  const n = normalizeSecurityNameKey(name || "");
  const c = String(currency || priceCurrency || totalCurrency || "").trim().toUpperCase();
  if (t && n) return `TICKER_NAME:${t}|${n}`;
  if (t && c) return `TICKER_CCY:${t}|${c}`;
  if (t) return `TICKER:${t}`;
  return `NAME:${n}`;
}

function detectBrokerRowsFormat(rows) {
  if (!Array.isArray(rows) || !rows.length) return "unknown";
  const sample = rows.slice(0, 8).map(normalizeRow);
  const keys = new Set();
  sample.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
  const has = (...arr) => arr.some(k => keys.has(k));
  // Trading 212 ledger
  if (has("action") && has("time") && has("ticker", "isin") && has("total")) return "broker_ledger";
  // Generic positions CSV (cost per share)
  if (has("ticker", "symbol") && has("quantity", "qty", "shares", "no_of_shares") && has("cost_per_share", "price_share", "price", "preco")) return "positions";
  // XTB trade history CSV (closed trades)
  // EN cols: Symbol,Type,Open time,Close time,Open price,Close price,Volume,Profit,Commission,Swap
  // PT cols (after normKey accent strip): simbolo,tipo,data_de_abertura,data_de_fecho,preco_de_abertura,preco_de_fecho,volume,lucro,comissao,swap
  const hasSymbolOrSimb = has("symbol","simbolo","instrumento");
  const hasOpenTime  = has("open_time","opentime","data_de_abertura","data_abertura","abertura",
                          "hora_de_abertura","hora_abertura","hora de abertura","open_hour");
  const hasCloseTime = has("close_time","closetime","data_de_fecho","data_fecho","fecho",
                          "hora_de_fecho","hora_fecho","hora de fecho","close_hour");
  const hasVolume    = has("volume","qty","quantity","quantidade");
  const hasProfit    = has("profit","lucro","resultado","pl","profit_loss");
  if (hasSymbolOrSimb && has("type","tipo") && hasOpenTime && hasCloseTime && hasVolume) return "xtb_trades";
  // XTB open positions / portfolio snapshot
  // EN: Symbol,Volume,Open price,Market price  PT: simbolo,volume,preco_de_abertura,preco_atual
  const hasOpenPx  = has("open_price","openprice","preco_de_abertura","preco_abertura","preco_entrada");
  const hasMktPx   = has("market_price","marketprice","preco_atual","preco_mercado","current_price");
  if (hasSymbolOrSimb && hasVolume && hasOpenPx && hasMktPx) return "xtb_positions";
  // XTB cash operations (Tipo, Símbolo/Comentário, Montante, Data)
  // PT: tipo,simbolo,montante,comentario,data  EN: type,symbol,amount,comment,date
  if ((has("tipo","type")) && has("montante","amount","valor") && (hasSymbolOrSimb || has("comentario","comment"))) return "xtb_cash";
  return "unknown";
}

function detectBrokerTextFormat(text) {
  const n = normStr(text || "");
  if (!n) return "unknown";
  // Trading 212 holdings PDF
  if ((n.includes("confirmacao de ativos") || n.includes("confirmation of holdings") || n.includes("trading 212 invest")) && n.includes("valor dos ativos") && n.includes("isin") && n.includes("quantity") && n.includes("price")) {
    return "holdings_pdf";
  }
  // XTB account statement / trade confirmation PDF
  // XTB PDFs typically contain "xtb" in header and have Symbol/Volume/Open/Close columns
  if ((n.includes("xtb") || n.includes("x-trade brokers")) &&
      (n.includes("symbol") || n.includes("simbolo") || n.includes("instrumento")) &&
      (n.includes("volume") || n.includes("profit") || n.includes("lucro"))) {
    return "xtb_pdf";
  }
  return "unknown";
}

function normalizeBrokerNameFromFile(fileName) {
  const n = normStr(fileName || "");
  if (n.includes("divtracker")) return "DivTracker";
  if (n.includes("confirmation-of-holdings") || n.includes("confirmacao") || n.includes("holdings") || n.includes("trading212") || n.includes("trade212")) return "Trading 212";
  if (n.includes("trade republic") || n.includes("from_")) return "Corretora CSV";
  if (n.includes("xtb")) return "XTB";
  return "Corretora";
}

function normalizeBrokerAction(raw) {
  const n = normStr(raw || "");
  if (n.includes("market buy") || n.includes("limit buy")) return "BUY";
  if (n.includes("market sell") || n.includes("limit sell")) return "SELL";
  if (n === "deposit") return "DEPOSIT";
  if (n.includes("withdraw")) return "WITHDRAWAL";
  if (n.includes("interest on cash")) return "CASH_INTEREST";
  if (n.includes("lending interest")) return "LENDING_INTEREST";
  if (n.includes("dividend adjustment")) return "DIVIDEND_ADJ";
  if (n.includes("return of capital")) return "ROC";
  if (n.startsWith("dividend")) return "DIVIDEND";
  if (n.includes("stock split open")) return "SPLIT_OPEN";
  if (n.includes("stock split close")) return "SPLIT_CLOSE";
  if (n.includes("stock distribution") || n.includes("custom stock distribution")) return "STOCK_DISTRIBUTION";
  if (n.includes("spin off") || n.includes("spin_off")) return "STOCK_DISTRIBUTION"; // treat spin-off as stock event
  return "OTHER";
}

function brokerPositionClassFromTicker(ticker) {
  const upper = String(ticker || "").toUpperCase();
  const plain = upper.replace(/\.CC$/, "");
  const isCrypto = upper.endsWith(".CC") || ["BTC","ETH","SOL","ADA","XRP","DOT","BNB"].includes(plain);
  return isCrypto ? "Cripto" : "Ações/ETFs";
}

function brokerEventKey(evt) {
  return [
    evt.type || "", evt.dateTime || evt.date || "", evt.ticker || "", evt.isin || "", evt.name || "",
    Math.round(parseNum(evt.qty) * 1e8) / 1e8,
    Math.round(parseNum(evt.totalEUR) * 100) / 100,
    Math.round(parseNum(evt.grossLocal) * 1e8) / 1e8,
    evt.actionRaw || "", evt.notes || ""
  ].join("|");
}

function brokerPositionKey(pos) {
  return [
    makeBrokerSecurityKey(pos),
    Math.round(parseNum(pos.qty) * 1e8) / 1e8,
    Math.round(parseNum(pos.costBasisEUR) * 100) / 100,
    Math.round(parseNum(pos.marketValueEUR) * 100) / 100,
    pos.positionKind || "",
    pos.snapshotDate || "",
    pos.sourceName || ""
  ].join("|");
}

function estimateEURFactorFromRow(r, grossLocal, totalEUR, ccy) {
  const cur = String(ccy || "EUR").toUpperCase();
  if (!cur || cur === "EUR") return 1;
  if (grossLocal > 0 && totalEUR > 0) return totalEUR / grossLocal;
  const fx = parseNumberSmart(r.exchange_rate);
  if (Number.isFinite(fx) && fx > 0 && fx < 10) return fx;
  return brokerApproxFxToEUR(cur);
}

function parseBrokerLedgerRows(rows, meta) {
  const events = [];
  for (const raw of (rows || [])) {
    const r = normalizeRow(raw);
    const type = normalizeBrokerAction(r.action);
    if (type === "OTHER") continue;
    const qty = parseNumberSmart(r.no_of_shares || r.quantity || r.qty || r.shares);
    const price = parseNumberSmart(r.price_share || r.price || r.price_per_share);
    const totalEUR = parseNumberSmart(r.total);
    const grossLocal = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0);
    const ccy = String(r.currency_price_share || r.currency || "EUR").trim().toUpperCase() || "EUR";
    const factor = estimateEURFactorFromRow(r, grossLocal, totalEUR, ccy);
    const taxLocal = parseNumberSmart(r.withholding_tax);
    const taxEUR = Number.isFinite(taxLocal) && taxLocal > 0 ? taxLocal * factor : 0;
    const feeEUR = [r.currency_conversion_fee, r.stamp_duty_reserve_tax, r.french_transaction_tax]
      .map(parseNumberSmart)
      .filter(v => Number.isFinite(v) && v > 0)
      .reduce((a, b) => a + b, 0);
    const when = String(r.time || r.date || "").trim();
    const date = normalizeDate(when.slice(0, 10)) || normalizeDate(when) || isoToday();
    const evt = {
      id: uid(),
      sourceHash: meta.hash,
      sourceName: meta.name,
      broker: meta.broker,
      type,
      actionRaw: String(r.action || "").trim(),
      date,
      dateTime: when || date,
      isin: String(r.isin || "").trim(),
      ticker: String(r.ticker || r.symbol || "").trim(),
      name: String(r.name || r.instrument || "").trim(),
      notes: String(r.notes || "").trim(),
      qty: Number.isFinite(qty) ? qty : 0,
      pricePerShare: Number.isFinite(price) ? price : 0,
      totalEUR: Number.isFinite(totalEUR) ? totalEUR : 0,
      totalCurrency: String(r.currency_total || "EUR").trim().toUpperCase() || "EUR",
      grossLocal: Number.isFinite(grossLocal) ? grossLocal : 0,
      localCurrency: ccy,
      taxEUR,
      feeEUR,
      resultEUR: parseNumberSmart(r.result),
      key: ""
    };
    evt.key = brokerEventKey(evt);
    events.push(evt);
  }
  return events;
}

function parseBrokerPositionRows(rows, meta) {
  const positions = [];
  for (const raw of (rows || [])) {
    const r = normalizeRow(raw);
    const ticker = String(r.ticker || r.symbol || "").trim();
    const qty = parseNumberSmart(r.quantity || r.qty || r.shares || r.no_of_shares || r.units);
    const cps = parseNumberSmart(r.cost_per_share || r.price_share || r.price || r.preco);
    if ((!ticker && !normalizeISIN(r.isin)) || !Number.isFinite(qty) || !Number.isFinite(cps) || qty <= 0) continue;
    const ccy = String(r.currency || r.ccy || r.currency_price_share || "EUR").trim().toUpperCase() || "EUR";
    const costBasisEUR = qty * cps * brokerApproxFxToEUR(ccy);
    const pos = {
      id: uid(),
      sourceHash: meta.hash,
      sourceName: meta.name,
      broker: meta.broker,
      ticker,
      isin: normalizeISIN(r.isin),
      name: String(r.name || r.security || ticker || r.isin).trim(),
      qty,
      costBasisEUR,
      marketValueEUR: parseNumberSmart(r.market_value || r.market_value_eur || r.valor_mercado_eur) || 0,
      pricePerShare: cps,
      priceCurrency: ccy,
      class: brokerPositionClassFromTicker(ticker),
      positionKind: "cost_snapshot",
      snapshotDate: normalizeDate(r.date || r.as_of || meta.asOfDate || "") || "",
      key: ""
    };
    pos.key = brokerPositionKey(pos);
    positions.push(pos);
  }
  return positions;
}


/* ─── XTB PARSERS ─────────────────────────────────────────────
   XTB exports 3 CSV types:
   1. Trade history (closed):  Symbol, Type, Open time, Close time,
      Open price, Close price, Volume, Profit, Commission, Swap, Comment
   2. Open positions:          Symbol, Volume, Open price, Market price,
      Profit/Loss, Commission, Swap, Margin
   3. Cash operations:         Tipo, Símbolo, Montante, Comentário, Data
──────────────────────────────────────────────────────────────── */

function parseXTBNormalizeAction(type, comment) {
  const t = normStr(type || "");
  const c = normStr(comment || "");
  // Closed trade types
  if (t === "buy" || t === "compra" || t === "bought" || t === "compra_mercado" || t === "compra_limite") return "BUY";
  if (t === "sell" || t === "venda" || t === "sold" || t === "venda_mercado" || t === "venda_limite") return "SELL";
  // Cash operations
  if (t.includes("deposit") || t.includes("deposito") || t.includes("depositar") || c.includes("deposit")) return "DEPOSIT";
  if (t.includes("withdraw") || t.includes("levantamento") || t.includes("retirada") || t.includes("levantar")) return "WITHDRAWAL";
  // XTB often exports the typo "DIVIDENT"; also PT "Dividendo"
  if (t.includes("divident") || t.includes("dividend") || t.includes("dividendo") ||
      c.includes("dividend") || c.includes("dividendo")) return "DIVIDEND";
  // Withholding tax — PT: "Imposto retido na fonte", "Retenção na fonte"
  if (t.includes("withholding") || t.includes("wht") || t.includes("imposto retido") ||
      t.includes("retencao na fonte") || t.includes("retencao") ||
      c.includes(" wht ") || c.includes("retido na fonte")) return "DIVIDEND_TAX";
  // Swap = overnight/financing cost → treat as cost (WITHDRAWAL)
  if (t === "swap" || t.includes("rollover") || t.includes("overnight") || t.includes("financiamento")) return "WITHDRAWAL";
  // Interest on cash balance — PT: "Juros sobre saldo", "Juro sobre saldo"
  if ((t.includes("juro") || t.includes("interest")) &&
      !t.includes("swap") && !t.includes("tax") && !t.includes("imposto") && !t.includes("retencao")) return "CASH_INTEREST";
  if (c.includes("interest on") && !c.includes("swap")) return "CASH_INTEREST";
  // Interest tax
  if ((t.includes("interest") && t.includes("tax")) || c.includes("interest tax")) return "CASH_INTEREST_TAX";
  // Commission as separate cash op
  if (t.includes("commission") || t.includes("comissao") || t === "taxa") return "OTHER";
  // "Stock purchase" / "Stock sale" in XTB cash ledger = accounting records for positions
  // already tracked in OPEN/CLOSED sheets → skip to avoid duplicates
  if (t.includes("stock purchase") || t.includes("stock sale")) return "OTHER";
  // "close trade" = closed CFD/position record → skip (P&L from CLOSED sheet)
  if (t.includes("close trade") || t.includes("fechar") || t.includes("closing")) return "OTHER";
  // "fractional shares" = fractional DRS credit → skip
  if (t.includes("fractional")) return "OTHER";
  // Spin-off = corporate action → skip (no cash in/out)
  if (t.includes("spin") || t.includes("spin_off")) return "OTHER";
  // Transaction taxes / fees → skip
  if (t.includes("stamp") || t.includes("sec fee") || t.includes("iftt") || t.includes("tobin")) return "OTHER";
  // XTB EN: "Free-funds Interest" → CASH_INTEREST (already handled by interest check above, this is a fallback)
  // XTB PT: "Correcao de saldo" or "Ajuste de saldo"
  if (t.includes("correc") || t.includes("ajuste") || t.includes("adjustment") || t.includes("correction")) return "OTHER";
  // Legacy: some XTB exports mark stock ops as "stock" type → skip
  if (t.includes("stock") || t.includes("acao") || t.includes("etf")) return "OTHER";
  return "OTHER";
}

function xtbTickerToYahoo(symbol) {
  // XTB uses suffixes like AAPL.US, VOW3.DE, VWCE.DE, etc.
  if (!symbol) return symbol;
  const s = symbol.toUpperCase().trim();
  const directMap = {
    // Brookfield Asset Management — XTB exports "BAM1.US", Yahoo uses "BAM" (NYSE)
    "BAM1.US":"BAM",
    "BAM1":"BAM",
    // Volkswagen preference shares — XTB "VOW1.DE", Yahoo Xetra is VOW3.DE (VOW.DE is delisted)
    "VOW1.DE":"VOW3.DE",
    "VOW1":"VOW3.DE",
    // VanEck Junior Gold Miners UCITS — Xetra symbol G2XJ
    "GDXJ.DE":"G2XJ.DE",
    // Novo Nordisk B — Copenhagen uses hyphen in Yahoo
    "NOVOB.DK":"NOVO-B.CO",
    "NOVOB":"NOVO-B.CO",
    // STMicroelectronics Paris listing
    "STM.FR":"STMPA.PA",
    // Medical Properties Trust NYSE
    "MPW.US":"MPW",
    "MPW":"MPW",
    // Novonesis / legacy Novozymes B code used by XTB
    "NZYMB.DK":"NSIS-B.CO",
    // AMS-OSRAM Vienna listing
    "AMS":"AMS2.VI",
    // iShares NASDAQ US Biotech UCITS — listed in London, not Xetra
    "BTEC.DE":"BTEC.L"
  };
  if (directMap[s]) return directMap[s];
  // Remove .US suffix – Yahoo uses bare ticker for US stocks
  if (s.endsWith(".US")) return s.slice(0, -3);
  // .PT → .LS (Euronext Lisbon)
  if (s.endsWith(".PT")) return s.slice(0, -3) + ".LS";
  // .UK → .L (London)
  if (s.endsWith(".UK")) return s.slice(0, -3) + ".L";
  // .HK → .HK (Hong Kong — same)
  // .CN → .SS or .SZ (China — can't determine, keep as-is)
  // .SG → .SI (Singapore)
  if (s.endsWith(".SG")) return s.slice(0, -3) + ".SI";
  // .AU → .AX (Australia)
  if (s.endsWith(".AU")) return s.slice(0, -3) + ".AX";
  // .JP → .T (Tokyo)
  if (s.endsWith(".JP")) return s.slice(0, -3) + ".T";
  return s;
}

function xtbSymbolCurrency(symbol) {
  const s = String(symbol || "").toUpperCase().trim();
  const suff = s.includes('.') ? s.split('.').pop() : '';
  const map = {
    US: 'USD', UK: 'GBP', PT: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', NL: 'EUR', IT: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR',
    CH: 'CHF', PL: 'PLN', DK: 'DKK', SE: 'SEK', NO: 'NOK', TO: 'CAD', V: 'CAD', NE: 'CAD',
    AU: 'AUD', AX: 'AUD', BR: 'EUR', LS: 'EUR', L: 'GBP', SW: 'CHF', MC: 'EUR', VI: 'EUR', PA: 'EUR', F: 'EUR', T: 'JPY'
  };
  return map[suff] || 'EUR';
}

/** XTB Trade History CSV (closed positions) */
function parseXTBTradesRows(rows, meta) {
  const events = [];
  for (const raw of (rows || [])) {
    const r = normalizeRow(raw);
    const symbol   = String(r.symbol || r.simbolo || r.instrumento || r.ticker || "").trim();
    const typeRaw  = String(r.type || r.tipo || r.direction || r.direcao || "").trim();
    const openTime = String(r.open_time || r.opentime || r.hora_de_abertura || r.hora_abertura ||
                             r.data_de_abertura || r.data_abertura || r.abertura || "").trim();
    const closeTime= String(r.close_time || r.closetime || r.hora_de_fecho || r.hora_fecho ||
                            r.data_de_fecho || r.data_fecho || r.fecho || "").trim();
    const openPx   = parseNumberSmart(r.open_price || r.openprice || r.preco_de_abertura || r.preco_abertura || r.preco_entrada);
    const closePx  = parseNumberSmart(r.close_price || r.closeprice || r.preco_de_fecho || r.preco_fecho || r.preco_saida);
    const vol      = parseNumberSmart(r.volume || r.qty || r.quantity || r.quantidade || r.units);
    const profit   = parseNumberSmart(r.profit || r.lucro || r.resultado || r.pl || r.profit_loss || r.gross_p_l || r.gross_pl);
    const commission = parseNumberSmart(r.commission || r.comissao || r.comissoes || 0);
    const swap     = parseNumberSmart(r.swap || r.swap_points || 0);
    const purchaseValue = parseNumberSmart(r.purchase_value || r["purchase value"] || r.valor_de_compra || r.valor_compra);
    const saleValue = parseNumberSmart(r.sale_value || r["sale value"] || r.valor_de_venda || r.valor_venda);
    const comment  = String(r.comment || r.comentario || r.comments || r.descricao || "").trim();

    if (!symbol || !Number.isFinite(vol) || vol <= 0) continue;

    const dateStr = normalizeDate((closeTime || openTime || "").slice(0, 10)) || isoToday();
    const ticker  = xtbTickerToYahoo(symbol);
    const ccy = xtbSymbolCurrency(symbol);
    const fx = brokerApproxFxToEUR(ccy);
    const pricePerShare = Number.isFinite(closePx) && closePx > 0 ? closePx : openPx;
    const swapCost = Number.isFinite(swap) && swap < 0 ? Math.abs(swap) : 0;
    const feeEUR   = Math.abs(commission) + swapCost;
    // XTB: purchase_value and sale_value are in account currency (EUR) — do NOT apply fx
    // Only apply fx when computing from price×qty (native currency)
    const costEUR  = Number.isFinite(purchaseValue) && purchaseValue > 0
      ? purchaseValue  // already in EUR
      : vol * (Number.isFinite(openPx) && openPx > 0 ? openPx : pricePerShare) * fx;
    const proceedsEUR = Number.isFinite(saleValue) && saleValue > 0
      ? saleValue  // already in EUR
      : vol * (Number.isFinite(closePx) && closePx > 0 ? closePx : pricePerShare) * fx;
    // Prefer broker-reported Gross P/L; fallback to computed
    const pnlEUR = Number.isFinite(profit) && profit !== 0 ? profit : (proceedsEUR - costEUR - feeEUR);

    const evt = {
      id: uid(), sourceHash: meta.hash, sourceName: meta.name, broker: "XTB",
      type: "REALIZED_TRADE", actionRaw: typeRaw || "Closed position",
      date: dateStr, dateTime: closeTime || dateStr,
      ticker, isin: "", name: symbol,
      qty: vol,
      pricePerShare: Number.isFinite(pricePerShare) ? pricePerShare : 0,
      totalEUR: proceedsEUR,
      totalCurrency: "EUR",
      grossLocal: Number.isFinite(saleValue) && saleValue > 0 ? saleValue : vol * (Number.isFinite(closePx) && closePx > 0 ? closePx : pricePerShare),
      localCurrency: ccy,
      taxEUR: 0, feeEUR,
      costBasisEUR: costEUR,
      resultEUR: pnlEUR,
      notes: comment, key: ""
    };
    evt.key = brokerEventKey(evt);
    events.push(evt);
  }
  return events;
}

/** XTB Open Positions CSV (portfolio snapshot) */
function parseXTBPositionsRows(rows, meta) {
  const positions = [];
  for (const raw of (rows || [])) {
    const r = normalizeRow(raw);
    const symbol   = String(r.symbol || r.simbolo || r.instrumento || "").trim();
    const vol      = parseNumberSmart(r.volume || r.qty || r.quantity);
    const openPx   = parseNumberSmart(r.open_price || r["open price"] || r.openprice || r.preco_de_abertura || r.preco_abertura || r.preco_entrada);
    const mktPx    = parseNumberSmart(r.market_price || r["market price"] || r.marketprice || r["current price"] || r.preco_atual || r.preco_de_mercado);
    const purchaseValue = parseNumberSmart(r.purchase_value || r["purchase value"] || r.valor_de_compra || r.valor_compra);

    if (!symbol || !Number.isFinite(vol) || vol <= 0) continue;
    const ticker = xtbTickerToYahoo(symbol);
    const nativeCcy = xtbSymbolCurrency(symbol);
    const fx = brokerApproxFxToEUR(nativeCcy);
    const usePrice = Number.isFinite(mktPx) && mktPx > 0 ? mktPx : (Number.isFinite(openPx) ? openPx : 0);
    // v19: purchase_value é o valor EUR real pago pela XTB (usa o FX do dia da compra).
    // Para manter o market value ancorado em EUR (sem depender de FX estáticos),
    // aplicamos a RAZÃO entre preço actual e preço de abertura nativo.
    // market_value_EUR ≈ purchase_value_EUR × (preço_actual / preço_abertura)
    // Isto herda o FX real da XTB e captura apenas a variação de preço.
    const hasPV = Number.isFinite(purchaseValue) && purchaseValue > 0;
    const costBasisEUR = hasPV
      ? purchaseValue  // valor EUR exacto já pago
      : vol * (Number.isFinite(openPx) && openPx > 0 ? openPx : usePrice) * fx;
    let marketValueEUR;
    if (hasPV && Number.isFinite(openPx) && openPx > 0 && Number.isFinite(usePrice) && usePrice > 0) {
      // Método proporcional — preserva o FX implícito da XTB
      marketValueEUR = purchaseValue * (usePrice / openPx);
    } else {
      // Fallback: usar FX estático
      marketValueEUR = vol * usePrice * fx;
    }

    const pos = {
      id: uid(), sourceHash: meta.hash, sourceName: meta.name, broker: "XTB",
      ticker, isin: "", name: symbol,
      qty: vol, costBasisEUR, marketValueEUR,
      pricePerShare: usePrice, priceCurrency: nativeCcy,
      class: brokerPositionClassFromTicker(ticker),
      positionKind: "market_snapshot",
      snapshotDate: meta.asOfDate || isoToday(),
      key: ""
    };
    pos.key = brokerPositionKey(pos);
    positions.push(pos);
  }
  return positions;
}

/** XTB Cash Operations CSV (deposits, dividends, interest) */
function parseXTBCashRows(rows, meta) {
  const events = [];
  for (const raw of (rows || [])) {
    const r = normalizeRow(raw);
    const typeRaw = String(r.tipo || r.type || r.tipo_de_operacao || r.tipo_operacao || r.descricao_tipo || "").trim();
    const symbol  = String(r.simbolo || r.symbol || r.ticker || r.instrumento || r.ativo || "").trim();
    const amount  = parseNumberSmart(r.montante || r.amount || r.valor || r.lucro || r.profit || r.resultado);
    const comment = String(r.comentario || r.comment || r.comments || r.descricao || r.observacoes || "").trim();
    const dateRaw = String(r.data || r.date || r.datetime || r.time || r.hora || r.data_operacao || "").trim();

    if (!Number.isFinite(amount) || amount === 0) continue;
    let type = parseXTBNormalizeAction(typeRaw, comment);
    if (type === "OTHER") continue;
    const dateStr = normalizeDate(dateRaw.slice(0, 10)) || normalizeDate(dateRaw) || isoToday();
    const ticker  = symbol ? xtbTickerToYahoo(symbol) : "";
    const evt = {
      id: uid(), sourceHash: meta.hash, sourceName: meta.name, broker: "XTB",
      type, actionRaw: typeRaw,
      date: dateStr, dateTime: dateRaw || dateStr,
      ticker, isin: "", name: symbol || typeRaw,
      qty: 0, pricePerShare: 0,
      totalEUR: Math.abs(amount), totalCurrency: "EUR",
      grossLocal: Math.abs(amount), localCurrency: "EUR",
      taxEUR: 0, feeEUR: 0, resultEUR: amount,
      notes: comment, key: ""
    };
    if (type === "DIVIDEND_TAX") {
      evt.type = "DIVIDEND_ADJ";
      evt.totalEUR = 0;
      evt.grossLocal = 0;
      evt.taxEUR = Math.abs(amount);
      evt.resultEUR = -Math.abs(amount);
    } else if (type === "CASH_INTEREST_TAX") {
      evt.type = "WITHDRAWAL";
      evt.totalEUR = Math.abs(amount);
      evt.grossLocal = Math.abs(amount);
      evt.resultEUR = -Math.abs(amount);
    }
    evt.key = brokerEventKey(evt);
    events.push(evt);
  }
  return events;
}
async function parseBrokerImportFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".pdf")) {
    const text = await extractTextFromPDF(file);
    const format = detectBrokerTextFormat(text);
    return { format, text, rows: [], textLength: text.length };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    if (typeof XLSX === "undefined") throw new Error("Biblioteca Excel não carregada.");
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array", raw: false, cellDates: true });
    const blocks = workbookToBrokerBlocks(wb);
    if (blocks.length > 1) return { format: "workbook_multi", rows: [], text: "", blocks };
    if (blocks.length === 1) return { format: blocks[0].format, rows: blocks[0].rows, text: "", blocks };
  }
  const rows = await fileToObjectRows(file);
  const format = detectBrokerRowsFormat(rows);
  return { format, rows, text: "" };
}

function parseTrading212HoldingsPdf(text, meta) {
  const rawText = String(text || "");
  const lines = rawText
    .split(/\r?\n/)
    .map(s => String(s || "").replace(/	+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const totalMatch = rawText.match(/Valor dos ativos:\s*([0-9.,]+)\s*EUR/i);
  const asOfMatch = rawText.match(/as of\s+(\d{2}\/\d{2}\/\d{4})/i);
  meta.snapshotTotalEUR = totalMatch ? parseNumberSmart(totalMatch[1]) : 0;
  meta.asOfDate = asOfMatch ? normalizeDate(asOfMatch[1]) : "";

  const positions = [];
  const seen = new Set();
  const ignore = (s) => {
    const n = normStr(s || "");
    return !n || n === "instrument" || n === "isin" || n === "quantity" || n === "price" ||
      n.includes("nif") || n.includes("id de cliente") || n.includes("nome do cliente") ||
      n.includes("confirmacao de ativos") || n.includes("trading 212 invest") || n.includes("trading 212 crypto") ||
      n.includes("valor dos ativos") || n.includes("este documento") || n.includes("a informacao aqui apresentada") ||
      n.includes("trading 212 e a denominacao") || n.includes("sem dados disponiveis") || /^\d+\/\d+$/.test(String(s || ""));
  };
  const rowRe = /^(.*?)\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+([0-9][0-9.,]*)\s+([A-Z]{3})\s+([0-9][0-9.,]*)$/;
  const pushPos = (name, isin, qtyLine, priceLine) => {
    const isinNorm = normalizeISIN(isin);
    const qty = parseNumberSmart(qtyLine);
    const m = String(priceLine || "").match(/^([A-Z]{3})\s+([0-9][0-9.,]*)$/);
    if (!isinNorm || !Number.isFinite(qty) || qty <= 0 || !m) return false;
    const ccy = String(m[1] || "EUR").toUpperCase();
    const px = parseNumberSmart(m[2]);
    if (!Number.isFinite(px)) return false;
    const pos = {
      id: uid(),
      sourceHash: meta.hash,
      sourceName: meta.name,
      broker: meta.broker,
      ticker: "",
      isin: isinNorm,
      name: String(name || isinNorm).trim(),
      qty,
      costBasisEUR: 0,
      marketValueEUR: qty * px * brokerApproxFxToEUR(ccy),
      pricePerShare: px,
      priceCurrency: ccy,
      class: "Ações/ETFs",
      positionKind: "market_snapshot",
      snapshotDate: meta.asOfDate || "",
      key: ""
    };
    pos.key = brokerPositionKey(pos);
    if (seen.has(pos.key)) return false;
    seen.add(pos.key);
    positions.push(pos);
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ignore(line)) continue;
    const m = line.match(rowRe);
    if (m) {
      pushPos(m[1], m[2], m[3], `${m[4]} ${m[5]}`);
      continue;
    }
    const isin = normalizeISIN(line);
    if (!isin) continue;
    let j = i - 1;
    while (j >= 0 && ignore(lines[j])) j -= 1;
    let k = i + 1;
    while (k < lines.length && ignore(lines[k])) k += 1;
    let l = k + 1;
    while (l < lines.length && ignore(lines[l])) l += 1;
    if (j >= 0 && k < lines.length && l < lines.length) {
      pushPos(lines[j], isin, lines[k], lines[l]);
    }
  }
  const parsedTotal = positions.reduce((s, p) => s + Math.max(0, parseNum(p.marketValueEUR)), 0);
  if (meta.snapshotTotalEUR > 0 && parsedTotal > 0) {
    const scale = meta.snapshotTotalEUR / parsedTotal;
    if (Math.abs(scale - 1) > 0.001) {
      positions.forEach(p => { p.marketValueEUR = Math.max(0, parseNum(p.marketValueEUR)) * scale; p.key = brokerPositionKey(p); });
    }
  }
  return positions;
}

function rebuildBrokerGeneratedData() {
  const bd = ensureBrokerData();
  state.assets = (state.assets || []).filter(a => !a.generatedFromBroker);
  state.dividends = (state.dividends || []).filter(d => !d.generatedFromBroker);
  state.transactions = (state.transactions || []).filter(t => !t.generatedFromBroker);

  const posMap = new Map();
  const touchPos = ({ ticker = "", isin = "", name = "", cls = "", currency = "EUR", sourceName = "" } = {}) => {
    const isinNorm = normalizeISIN(isin);
    const tickerNorm = String(ticker || "").trim().toUpperCase();
    const nameNorm = String(name || "").trim();
    const currencyNorm = String(currency || "EUR").trim().toUpperCase();
    const inferredYahoo = inferYahooTickerFromIdentity({ isin: isinNorm, ticker: tickerNorm, name: nameNorm });
    let key = makeBrokerSecurityKey({ isin: isinNorm, ticker: tickerNorm, name: nameNorm, currency: currencyNorm, yahooTicker: inferredYahoo });

    if (!posMap.has(key)) {
      for (const [k, existing] of posMap.entries()) {
        if (!sameBrokerSecurityIdentity(existing, { isin: isinNorm, ticker: tickerNorm, yahooTicker: inferredYahoo, name: nameNorm })) continue;
        const existingCurrency = String(existing.currency || '').trim().toUpperCase();
        const sameCurrency = !currencyNorm || !existingCurrency || existingCurrency === currencyNorm;
        if (sameCurrency) { key = k; break; }
      }
    }

    if (!posMap.has(key) && !isinNorm && tickerNorm) {
      const matches = [];
      for (const [k, existing] of posMap.entries()) {
        const sameTicker = canonicalBrokerTickerBase(existing.ticker || existing.yahooTicker) === canonicalBrokerTickerBase(tickerNorm);
        if (!sameTicker) continue;
        const sameName = !nameNorm || !existing.name || sameSecurityName(existing.name, nameNorm);
        const sameCurrency = !currencyNorm || !existing.currency || String(existing.currency || '').trim().toUpperCase() === currencyNorm;
        if (sameName || sameCurrency) matches.push(k);
      }
      if (matches.length === 1) key = matches[0];
    } else if (isinNorm && !posMap.has(key) && tickerNorm) {
      for (const [k, existing] of posMap.entries()) {
        const existingIsin = normalizeISIN(existing.isin);
        if (existingIsin) continue;
        if (sameBrokerSecurityIdentity(existing, { isin: isinNorm, ticker: tickerNorm, yahooTicker: inferredYahoo, name: nameNorm })) { key = k; break; }
      }
    }

    const prev = posMap.get(key) || {
      ticker: String(tickerNorm || ticker || "").trim(),
      yahooTicker: inferredYahoo || "",
      isin: isinNorm,
      name: String(nameNorm || ticker || isin || "").trim(),
      class: cls || brokerPositionClassFromTicker(ticker),
      qty: 0,
      costBasis: 0,
      marketValueEUR: 0,
      snapshotQty: 0,
      snapshotDate: "",
      currency: currencyNorm || "EUR",
      priceCurrency: currencyNorm || "EUR",
      sourceNames: new Set(),
      hasSnapshot: false
    };
    if (!prev.ticker && tickerNorm) prev.ticker = tickerNorm;
    if (!prev.yahooTicker && inferredYahoo) prev.yahooTicker = inferredYahoo;
    if (!prev.isin && isinNorm) prev.isin = isinNorm;
    if ((!prev.name || prev.name === prev.isin || prev.name === prev.ticker) && nameNorm) prev.name = String(nameNorm).trim();
    if (!prev.class && cls) prev.class = cls;
    if (currencyNorm) { prev.currency = currencyNorm; prev.priceCurrency = currencyNorm; }
    if (sourceName) prev.sourceNames.add(sourceName);
    posMap.set(key, prev);
    return prev;
  };

  for (const p of (bd.positions || [])) {
    const cls = p.class || brokerPositionClassFromTicker(p.ticker);
    const pos = touchPos({ ticker: p.ticker, isin: p.isin, name: p.name, cls, sourceName: p.sourceName, currency: p.priceCurrency || "EUR" });
    if (p.positionKind === "market_snapshot") {
      const d = String(p.snapshotDate || "");
      if (!pos.hasSnapshot || !pos.snapshotDate || (d && d > pos.snapshotDate)) {
        // Newer snapshot date → reset and use this one
        pos.snapshotDate = d;
        pos.snapshotQty = parseNum(p.qty);
        pos.marketValueEUR = Math.max(0, parseNum(p.marketValueEUR));
        pos.costBasis = Math.max(0, parseNum(p.costBasisEUR));
        pos.hasSnapshot = pos.marketValueEUR > 0 || pos.snapshotQty > 0;
      } else if (d === pos.snapshotDate) {
        // SAME snapshot date → ACCUMULATE across lots (e.g. XTB has 1 row per open lot)
        pos.snapshotQty += parseNum(p.qty);
        pos.marketValueEUR += Math.max(0, parseNum(p.marketValueEUR));
        pos.costBasis += Math.max(0, parseNum(p.costBasisEUR));
        pos.hasSnapshot = true;
      }
    } else {
      pos.qty += parseNum(p.qty);
      pos.costBasis += Math.max(0, parseNum(p.costBasisEUR));
      if (!pos.marketValueEUR && parseNum(p.marketValueEUR) > 0) pos.marketValueEUR = parseNum(p.marketValueEUR);
    }
  }

  let events = (bd.events || []).slice().sort((a, b) => String(a.dateTime || a.date).localeCompare(String(b.dateTime || b.date)));

  // v19: Merge XTB Withholding Tax (DIVIDEND_ADJ with taxEUR>0, totalEUR=0) into the
  // adjacent DIVIDEND event for the same ticker+date. XTB exports them as two rows.
  // Without merge: dividend records are duplicated AND gross is understated by WHT.
  {
    const merged = [];
    const consumed = new Set();
    for (let i = 0; i < events.length; i++) {
      if (consumed.has(i)) continue;
      const e = events[i];
      if (e && e.type === "DIVIDEND" && parseNum(e.totalEUR) > 0) {
        // Look ahead for a DIVIDEND_ADJ with same ticker+date, taxEUR>0, totalEUR=0
        for (let j = i + 1; j < Math.min(i + 5, events.length); j++) {
          if (consumed.has(j)) continue;
          const a = events[j];
          if (!a || a.type !== "DIVIDEND_ADJ") continue;
          const sameTicker = String(a.ticker || "").toUpperCase() === String(e.ticker || "").toUpperCase();
          const sameDate = String(a.date || "").slice(0,10) === String(e.date || "").slice(0,10);
          if (sameTicker && sameDate && parseNum(a.taxEUR) > 0 && parseNum(a.totalEUR) === 0) {
            // Merge: e becomes gross=(net+wht), tax=wht
            const net = parseNum(e.totalEUR);
            const wht = parseNum(a.taxEUR);
            e.totalEUR = net + wht;  // gross = net received + WHT
            e.taxEUR = (parseNum(e.taxEUR) || 0) + wht;
            e.notes = (e.notes || "") + (e.notes ? " · " : "") + `WHT merged: ${fmtEUR2(wht)}`;
            consumed.add(j);
            break;
          }
        }
      }
      merged.push(e);
    }
    events = merged;
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const cls = brokerPositionClassFromTicker(e.ticker);
    if (e.type === "BUY") {
      const pos = touchPos({ ticker: e.ticker, isin: e.isin, name: e.name, cls, sourceName: e.sourceName, currency: e.localCurrency || e.totalCurrency || "EUR" });
      pos.qty += parseNum(e.qty);
      pos.costBasis += Math.max(0, parseNum(e.totalEUR) + parseNum(e.feeEUR));
      continue;
    }
    if (e.type === "SELL") {
      const pos = touchPos({ ticker: e.ticker, isin: e.isin, name: e.name, cls, sourceName: e.sourceName, currency: e.localCurrency || e.totalCurrency || "EUR" });
      const sellQty = Math.abs(parseNum(e.qty));
      const avg = pos.qty > 0 ? pos.costBasis / pos.qty : 0;
      pos.qty = Math.max(0, pos.qty - sellQty);
      pos.costBasis = Math.max(0, pos.costBasis - sellQty * avg);
      // Accumulate realised P&L: use broker-reported Result when available (T212 provides this exactly)
      const brokerPnL = parseNum(e.resultEUR);
      if (!pos.realizedPnL) pos.realizedPnL = 0;
      if (Number.isFinite(brokerPnL) && brokerPnL !== 0) {
        pos.realizedPnL += brokerPnL;
      } else {
        // Fallback: proceeds - avg_cost * qty
        const proceeds = parseNum(e.totalEUR);
        if (proceeds > 0 && avg > 0) pos.realizedPnL += proceeds - sellQty * avg;
      }
      if (!pos.sellTrades) pos.sellTrades = [];
      pos.sellTrades.push({ date: e.date, qty: sellQty, proceedsEUR: parseNum(e.totalEUR), pnlEUR: brokerPnL || 0 });
      continue;
    }
    if (e.type === "SPLIT_OPEN" || e.type === "SPLIT_CLOSE") {
      const next = events[i + 1];
      const sameGroup = next && (makeBrokerSecurityKey(next) === makeBrokerSecurityKey(e)) && String(next.dateTime || next.date) === String(e.dateTime || e.date) && ((e.type === "SPLIT_OPEN" && next.type === "SPLIT_CLOSE") || (e.type === "SPLIT_CLOSE" && next.type === "SPLIT_OPEN"));
      if (sameGroup) {
        const openEvt = e.type === "SPLIT_OPEN" ? e : next;
        const closeEvt = e.type === "SPLIT_CLOSE" ? e : next;
        const pos = touchPos({ ticker: e.ticker || next.ticker, isin: e.isin || next.isin, name: e.name || next.name, cls, sourceName: e.sourceName || next.sourceName, currency: e.localCurrency || next.localCurrency || e.totalCurrency || next.totalCurrency || "EUR" });
        pos.qty = Math.max(0, pos.qty - parseNum(closeEvt.qty)) + parseNum(openEvt.qty);
        i++;
      }
      continue;
    }
    if (e.type === "STOCK_DISTRIBUTION") {
      const pos = touchPos({ ticker: e.ticker, isin: e.isin, name: e.name, cls, sourceName: e.sourceName, currency: e.localCurrency || e.totalCurrency || "EUR" });
      pos.qty += Math.max(0, parseNum(e.qty));
      continue;
    }
    if (e.type === "REALIZED_TRADE") {
      const pnl = parseNum(e.resultEUR);
      if (pnl !== 0) {
        state.transactions.push({
          id: uid(), date: e.date,
          type: pnl >= 0 ? "in" : "out",
          category: pnl >= 0 ? "Mais-valias corretora" : "Menos-valias corretora",
          amount: Math.abs(pnl), recurring: "none",
          notes: `${e.name || e.ticker || "Trade"} · ${e.actionRaw || e.type} · ${e.broker || "Corretora"}${e.sourceName ? " · " + e.sourceName : ""}`,
          generatedFromBroker: true, sourceHash: e.sourceHash, eventKey: e.key
        });
      }
      continue;
    }

    if (e.type === "DIVIDEND" || e.type === "ROC" || e.type === "DIVIDEND_ADJ") {
      const gross = Math.max(0, parseNum(e.totalEUR));
      const tax = Math.max(0, parseNum(e.taxEUR));
      const net = Math.max(0, gross - tax);
      const divNoteParts = [e.actionRaw || e.type, e.broker || "Corretora"];
      if (e.sourceName) divNoteParts.push(e.sourceName);
      if (e.ticker) divNoteParts.push(`Ticker=${String(e.ticker).trim().toUpperCase()}`);
      if (e.isin) divNoteParts.push(`ISIN=${String(e.isin).trim().toUpperCase()}`);
      const divYahoo = inferYahooTickerFromIdentity(e);
      if (divYahoo) divNoteParts.push(`Yahoo=${divYahoo}`);
      state.dividends.push(normalizeDividendRecord({
        id: uid(), assetId: "", assetName: e.ticker || e.name || e.isin || "Dividendo",
        amount: gross, grossAmount: gross, netAmount: net, taxWithheld: tax,
        date: e.date, notes: divNoteParts.join(' · '),
        generatedFromBroker: true, sourceHash: e.sourceHash, eventKey: e.key
      }));
      continue;
    }
    if (e.type === "CASH_INTEREST" || e.type === "LENDING_INTEREST") {
      state.transactions.push({
        id: uid(), date: e.date, type: "in", category: e.type === "LENDING_INTEREST" ? "Juros empréstimo títulos" : "Juros corretora",
        amount: Math.max(0, parseNum(e.totalEUR)), recurring: "none",
        notes: `${e.actionRaw || e.type} · ${e.broker || "Corretora"}${e.sourceName ? " · " + e.sourceName : ""}`,
        generatedFromBroker: true, sourceHash: e.sourceHash, eventKey: e.key
      });
      continue;
    }
    if (e.type === "DEPOSIT" || e.type === "WITHDRAWAL") {
      state.transactions.push({
        id: uid(), date: e.date, type: e.type === "DEPOSIT" ? "in" : "out", category: e.type === "DEPOSIT" ? "Transferência corretora" : "Levantamento corretora",
        amount: Math.max(0, parseNum(e.totalEUR)), recurring: "none",
        notes: `${e.actionRaw || e.type} · ${e.broker || "Corretora"}${e.sourceName ? " · " + e.sourceName : ""}`,
        generatedFromBroker: true, sourceHash: e.sourceHash, eventKey: e.key
      });
    }
  }

  const cutoffDiv12m = new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).toISOString().slice(0, 10);
  const divNet12mBySecurity = new Map();
  for (const e of (bd.events || [])) {
    if (!(e && (e.type === "DIVIDEND" || e.type === "ROC" || e.type === "DIVIDEND_ADJ"))) continue;
    if (String(e.date || "") < cutoffDiv12m) continue;
    const secKey = makeBrokerSecurityKey(e);
    if (!secKey) continue;
    const net = Math.max(0, parseNum(e.totalEUR) - parseNum(e.taxEUR));
    if (net <= 0) continue;
    divNet12mBySecurity.set(secKey, (divNet12mBySecurity.get(secKey) || 0) + net);
  }

  for (const p of posMap.values()) {
    const finalQty = p.hasSnapshot && p.snapshotQty > 0 ? p.snapshotQty : p.qty;
    const finalValue = p.hasSnapshot && p.marketValueEUR > 0 ? p.marketValueEUR : (p.marketValueEUR > 0 ? p.marketValueEUR : p.costBasis);
    if (!(finalQty > 0) || !(finalValue > 0 || p.costBasis > 0)) continue;
    // Use full name when available (e.g. "Corticeira Amorim" not just "COR")
    const displayName = p.name && p.name !== p.ticker ? p.name :
      (p.ticker ? `${p.ticker}${p.name ? " — " + p.name : ""}` : p.isin || "Ativo");
    const noteBits = [];
    if (p.isin) noteBits.push(`ISIN=${p.isin}`);
    noteBits.push(`Qty=${fmt(finalQty, 6)}`);
    // Store the correct Yahoo ticker (ISIN-resolved) for quote fetching reference
    const correctYahoo = inferYahooTickerFromIdentity({ isin: p.isin, ticker: p.yahooTicker || p.ticker, yahooTicker: p.yahooTicker, name: p.name, currency: p.priceCurrency || p.currency || "", priceCurrency: p.priceCurrency || p.currency || "" }) || (p.ticker || "");
    if (correctYahoo && correctYahoo !== p.ticker) noteBits.push(`Yahoo=${correctYahoo}`);
    if (p.costBasis > 0) noteBits.push(`Custo=${fmtEUR2(p.costBasis)}`);
    if (p.hasSnapshot && p.marketValueEUR > 0) noteBits.push(`Valor snapshot=${fmtEUR2(p.marketValueEUR)}${p.snapshotDate ? ` @ ${p.snapshotDate}` : ""}`);
    noteBits.push(`Fontes=${Array.from(p.sourceNames || []).join(", ") || "import"}`);
    // ── Compute annualised dividend yield from imported dividend events
    const secKey  = makeBrokerSecurityKey(p);
    const totalDivEUR12m = divNet12mBySecurity.get(secKey) || 0;

    // Annualised yield = net dividends last 12m / current value
    let assetYieldType = "none", assetYieldValue = 0;
    if (totalDivEUR12m > 0 && finalValue > 0) {
      assetYieldType  = "yield_eur_year";
      assetYieldValue = +totalDivEUR12m.toFixed(4);
      noteBits.push(`Div(12m)=${fmtEUR2(totalDivEUR12m)}/ano · Yield≈${fmtPct(totalDivEUR12m / finalValue * 100)}`);
    }

    if (p.realizedPnL !== undefined && p.realizedPnL !== 0) {
      noteBits.push(`P&L realizado=${p.realizedPnL >= 0 ? "+" : ""}${fmtEUR2(p.realizedPnL)}`);
    }
    state.assets.push({
      id: uid(), class: p.class || brokerPositionClassFromTicker(p.ticker), name: displayName, value: finalValue,
      yieldType: assetYieldType, yieldValue: assetYieldValue, compoundFreq: 12,
      notes: `Gerado por importação de corretora. ${noteBits.join(" · ")}`,
      qty: finalQty, costBasis: p.costBasis, pmOriginal: finalQty > 0 && p.costBasis > 0 ? p.costBasis / finalQty : 0, pmCcy: "EUR",
      ticker: p.ticker || "", yahooTicker: correctYahoo || "", isin: p.isin || "", priceCurrency: p.priceCurrency || p.currency || "", brokerMarketSnapshot: !!p.hasSnapshot, brokerSnapshotDate: p.snapshotDate || "",
      realizedPnL: p.realizedPnL || 0, sellTrades: p.sellTrades || [],
      generatedFromBroker: true
    });
  }
  if (!state.settings) state.settings = {};
  state.settings.brokerRebuildSig = getBrokerDataSignature();
  state.settings.brokerRebuildSchemaVersion = BROKER_REBUILD_SCHEMA_VERSION;
}


function getBrokerImportDiagnostics() {
  const bd = ensureBrokerData();
  const files = (bd.files || []).slice();
  const events = (bd.events || []).slice();
  const positions = (bd.positions || []).slice();
  const byHash = new Map();
  files.forEach(f => byHash.set(f.hash, {
    ...f,
    years: new Set(),
    currencies: new Set(),
    eventTypes: {},
    firstDate: "",
    lastDate: "",
    actualEvents: 0,
    actualPositions: 0
  }));

  events.forEach(e => {
    const rec = byHash.get(e.sourceHash);
    if (!rec) return;
    rec.actualEvents += 1;
    const d = String(e.date || e.dateTime || "").slice(0, 10);
    if (d) {
      if (!rec.firstDate || d < rec.firstDate) rec.firstDate = d;
      if (!rec.lastDate || d > rec.lastDate) rec.lastDate = d;
      rec.years.add(d.slice(0, 4));
    }
    const ty = String(e.type || "OTHER");
    rec.eventTypes[ty] = (rec.eventTypes[ty] || 0) + 1;
    if (e.totalCurrency) rec.currencies.add(String(e.totalCurrency).toUpperCase());
    if (e.localCurrency) rec.currencies.add(String(e.localCurrency).toUpperCase());
  });

  positions.forEach(p => {
    const rec = byHash.get(p.sourceHash);
    if (!rec) return;
    rec.actualPositions += 1;
    const d = String(p.snapshotDate || "").slice(0, 10);
    if (d) {
      if (!rec.firstDate || d < rec.firstDate) rec.firstDate = d;
      if (!rec.lastDate || d > rec.lastDate) rec.lastDate = d;
      rec.years.add(d.slice(0, 4));
    }
    if (p.priceCurrency) rec.currencies.add(String(p.priceCurrency).toUpperCase());
  });

  const fileRecs = Array.from(byHash.values()).sort((a, b) => String(a.firstDate || a.importedAt || "").localeCompare(String(b.firstDate || b.importedAt || "")));
  const brokers = new Map();
  fileRecs.forEach(r => {
    const key = r.broker || "Corretora";
    const prev = brokers.get(key) || { broker: key, files: 0, events: 0, positions: 0, years: new Set(), firstDate: "", lastDate: "" };
    prev.files += 1;
    prev.events += r.actualEvents || r.events || 0;
    prev.positions += r.actualPositions || r.positions || 0;
    (r.years || []).forEach(y => prev.years.add(y));
    if (r.firstDate && (!prev.firstDate || r.firstDate < prev.firstDate)) prev.firstDate = r.firstDate;
    if (r.lastDate && (!prev.lastDate || r.lastDate > prev.lastDate)) prev.lastDate = r.lastDate;
    brokers.set(key, prev);
  });

  const years = new Set();
  fileRecs.forEach(r => (r.years || []).forEach(y => years.add(y)));
  const sortedYears = Array.from(years).filter(Boolean).sort();
  const missingYears = [];
  if (sortedYears.length >= 2) {
    const minY = parseInt(sortedYears[0], 10);
    const maxY = parseInt(sortedYears[sortedYears.length - 1], 10);
    if (Number.isFinite(minY) && Number.isFinite(maxY) && maxY >= minY) {
      for (let y = minY; y <= maxY; y++) {
        if (!years.has(String(y))) missingYears.push(String(y));
      }
    }
  }

  let overlapCount = 0;
  for (let i = 0; i < fileRecs.length; i++) {
    for (let j = i + 1; j < fileRecs.length; j++) {
      const a = fileRecs[i], b = fileRecs[j];
      if ((a.broker || "") !== (b.broker || "")) continue;
      if (!a.firstDate || !a.lastDate || !b.firstDate || !b.lastDate) continue;
      if (a.firstDate <= b.lastDate && b.firstDate <= a.lastDate) overlapCount += 1;
    }
  }

  const importedAssets = (state.assets || []).filter(a => a.generatedFromBroker);
  const importedValue = importedAssets.reduce((s, a) => s + parseNum(a.value), 0);
  const importedCost = importedAssets.reduce((s, a) => s + parseNum(a.costBasis), 0);
  const importedDivs = (state.dividends || []).filter(d => d.generatedFromBroker).reduce((s, d) => s + getDividendGross(d), 0);
  const importedInterest = (state.transactions || []).filter(t => t.generatedFromBroker && /juros/i.test(String(t.category || ""))).reduce((s, t) => s + parseNum(t.amount), 0);
  const snapshotDeclared = fileRecs.reduce((s, f) => s + Math.max(0, parseNum(f.snapshotTotalEUR)), 0);
  const snapshotFiles = fileRecs.filter(f => parseNum(f.snapshotTotalEUR) > 0).length;

  return {
    files: fileRecs,
    brokers: Array.from(brokers.values()).sort((a, b) => b.files - a.files || String(a.broker).localeCompare(String(b.broker))),
    brokerCount: brokers.size,
    years: sortedYears,
    missingYears,
    overlapCount,
    importedAssets: importedAssets.length,
    importedValue,
    importedCost,
    snapshotDeclared,
    snapshotFiles,
    importedDivs,
    importedInterest,
    firstDate: fileRecs.find(r => r.firstDate)?.firstDate || "",
    lastDate: fileRecs.slice().reverse().find(r => r.lastDate)?.lastDate || ""
  };
}

function renderBrokerImportAudit() {
  const el = document.getElementById("brokerImportAudit");
  if (!el) return;
  const d = getBrokerImportDiagnostics();
  if (!d || !d.files.length) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const warning = d.overlapCount > 0;
  const coverage = d.firstDate && d.lastDate ? `${d.firstDate} → ${d.lastDate}` : (d.years.join(", ") || "—");
  const missing = d.missingYears.length ? ` · anos em falta: ${d.missingYears.join(", ")}` : "";
  const brokerRows = d.brokers.map(b => {
    const years = Array.from(b.years || []).sort().join(", ") || "—";
    const range = b.firstDate && b.lastDate ? `${b.firstDate} → ${b.lastDate}` : years;
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(b.broker || "Corretora")}</div>
        <div class="item__s">${b.files} ficheiro${b.files !== 1 ? "s" : ""} · ${b.events} eventos · ${b.positions} posições · ${escapeHtml(range)}</div>
      </div>
      <div class="item__r"><span class="pill">${escapeHtml(years)}</span></div>
    </div>`;
  }).join("");
  el.style.display = "";
  el.style.border = `1px solid ${warning ? "#fdba74" : "#bfdbfe"}`;
  el.style.background = warning ? "#fff7ed" : "#eff6ff";
  el.style.borderRadius = "14px";
  el.style.padding = "12px 14px";
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-weight:900;color:${warning ? "#9a3412" : "#1d4ed8"}">${warning ? "⚠️ Auditoria dos imports" : "🔎 Auditoria dos imports"}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">Cobertura temporal: ${escapeHtml(coverage)}${escapeHtml(missing)}</div>
      </div>
      <div style="font-size:12px;color:#475569">${warning ? `Sobreposições detectadas: <b>${d.overlapCount}</b>` : "Sem sobreposições temporais detectadas entre ficheiros da mesma corretora."}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:10px">
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Corretoras</div><div style="font-weight:900">${d.brokerCount}</div></div>
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Ativos gerados</div><div style="font-weight:900">${d.importedAssets}</div></div>
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Valor importado</div><div style="font-weight:900">${fmtEUR(d.importedValue)}</div></div>
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Custo reconstruído</div><div style="font-weight:900">${fmtEUR(d.importedCost)}</div></div>
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Passivo real</div><div style="font-weight:900">${fmtEUR(d.importedDivs + d.importedInterest)}</div></div>
    </div>
    <div style="font-size:11px;color:#64748b;margin-top:8px">Valor importado = valor actual gerado pelos snapshots/posições importadas. Custo reconstruído = base de custo inferida do histórico; pode divergir do valor actual de mercado.</div>
    ${d.snapshotFiles ? `<div style="font-size:11px;color:#64748b;margin-top:6px">Snapshots declarados pelo broker: ${d.snapshotFiles} · total declarado ${fmtEUR(d.snapshotDeclared)}</div>` : ""}
    <div class="list" style="margin-top:10px">${brokerRows}</div>`;
}

function renderPortfolioSourcesCard() {
  const card = document.getElementById("portfolioSourcesCard");
  const body = document.getElementById("portfolioSourcesBody");
  if (!card || !body) return;
  const totalAssets = (state.assets || []).slice();
  const brokerAssets = totalAssets.filter(a => a.generatedFromBroker);
  const manualAssets = totalAssets.filter(a => !a.generatedFromBroker);

  // v18: skip se dados iguais
  const _pscHash = `${brokerAssets.length}|${manualAssets.length}|${totalAssets.reduce((s,a)=>s+a.value,0).toFixed(0)}`;
  if (renderPortfolioSourcesCard._lastHash === _pscHash) return;
  renderPortfolioSourcesCard._lastHash = _pscHash;
  const brokerValue = brokerAssets.reduce((s, a) => s + parseNum(a.value), 0);
  const manualValue = manualAssets.reduce((s, a) => s + parseNum(a.value), 0);
  const total = brokerValue + manualValue;
  const brokerPct = total > 0 ? (brokerValue / total * 100) : 0;
  const d = getBrokerImportDiagnostics();
  const show = brokerAssets.length > 0 || (d && d.files.length > 0);
  if (!show) {
    card.style.display = "none";
    body.innerHTML = "";
    return;
  }
  card.style.display = "";
  const sourceLine = d && d.files.length
    ? `${d.files.length} ficheiro${d.files.length !== 1 ? "s" : ""} · ${d.brokerCount} corretora${d.brokerCount !== 1 ? "s" : ""}${d.firstDate && d.lastDate ? ` · ${d.firstDate} → ${d.lastDate}` : ""}`
    : "Sem ficheiros activos de corretora";
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:12px;color:var(--text)">
        <div style="font-size:11px;color:var(--muted)">Manual</div>
        <div style="font-weight:900;font-size:18px;margin-top:4px;color:var(--text)">${fmtEUR(manualValue)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${manualAssets.length} ativo${manualAssets.length !== 1 ? "s" : ""}</div>
      </div>
      <div style="background:var(--card2);border:1px solid rgba(124,127,239,.45);border-radius:14px;padding:12px;color:var(--text)">
        <div style="font-size:11px;color:var(--muted)">Corretoras</div>
        <div style="font-weight:900;font-size:18px;margin-top:4px;color:var(--text)">${fmtEUR(brokerValue)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${brokerAssets.length} ativo${brokerAssets.length !== 1 ? "s" : ""} · ${fmtPct(brokerPct)}</div>
      </div>
      <div style="background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:12px;color:var(--text)">
        <div style="font-size:11px;color:var(--muted)">Cobertura importada</div>
        <div style="font-weight:900;font-size:18px;margin-top:4px;color:var(--text)">${d ? d.years.length : 0} ano${d && d.years.length !== 1 ? "s" : ""}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${escapeHtml(sourceLine)}</div>
      </div>
    </div>
    ${d && d.overlapCount > 0 ? `<div style="margin-top:10px;font-size:12px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:8px 10px">Há ${d.overlapCount} sobreposição${d.overlapCount !== 1 ? "ões" : ""} temporal${d.overlapCount !== 1 ? "ais" : ""} entre ficheiros da mesma corretora. A deduplicação está activa, mas vale a pena rever os imports.</div>` : ""}`;
}

function renderBrokerImportStatus() {
  const box = document.getElementById("brokerImportResult");
  const list = document.getElementById("brokerImportList");
  if (!box || !list) return;
  const bd = ensureBrokerData();

  // v18: skip se nada mudou
  const _bisHash = `${(bd.files||[]).length}|${(bd.events||[]).length}|${(bd.positions||[]).length}`;
  if (renderBrokerImportStatus._lastHash === _bisHash) return;
  renderBrokerImportStatus._lastHash = _bisHash;
  const files = (bd.files || []).slice().sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
  const yearsSet = new Set();
  (bd.events || []).forEach(e => { const y = String(e.date || "").slice(0, 4); if (y) yearsSet.add(y); });
  (bd.positions || []).forEach(p => { const y = String(p.snapshotDate || "").slice(0, 4); if (y) yearsSet.add(y); });
  const stats = {
    files: files.length,
    events: (bd.events || []).length,
    positions: (bd.positions || []).length,
    years: yearsSet.size
  };
  if (!files.length) {
    box.style.display = "none";
    renderBrokerImportAudit();
    list.innerHTML = `<div class="item" style="cursor:default"><div class="item__l"><div class="item__t">Sem imports de corretoras</div><div class="item__s">Podes juntar vários CSV/Excel de anos diferentes e a app reconstrói a parte importada da carteira.</div></div></div>`;
    return;
  }
  box.style.display = "";
  box.style.background = "var(--card2)";
  box.style.border = "1px solid rgba(34,197,94,.35)";
  box.style.borderRadius = "14px";
  box.style.padding = "12px 14px";
  box.innerHTML = `
    <div style="font-weight:900;margin-bottom:6px;color:var(--text)">✅ Imports de corretoras activos</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px">
      <div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Ficheiros</div><div style="font-weight:900">${stats.files}</div></div>
      <div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Eventos</div><div style="font-weight:900">${stats.events}</div></div>
      <div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Posições</div><div style="font-weight:900">${stats.positions}</div></div>
      <div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center;color:var(--text)"><div style="font-size:11px;color:var(--muted)">Anos</div><div style="font-weight:900">${stats.years}</div></div>
    </div>`;
  const BROKER_LIMIT = 10;
  if (!window._brokerListExpanded) window._brokerListExpanded = false;
  const shownFiles = window._brokerListExpanded ? files : files.slice(0, BROKER_LIMIT);
  list.innerHTML = shownFiles.map(f => `
    <div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(f.name || "Ficheiro")}</div>
        <div class="item__s">${escapeHtml(f.broker || "Corretora")} · ${escapeHtml(f.format || "—")} · ${f.rows || 0} linhas · ${f.events || 0} eventos · ${f.positions || 0} posições${f.snapshotTotalEUR ? ` · snapshot ${fmtEUR(f.snapshotTotalEUR)}` : ""}</div>
      </div>
      <div class="item__r"><span class="pill">${escapeHtml(f.importedAt ? String(f.importedAt).slice(0, 10) : "")}</span></div>
    </div>
  `).join("");
  if (files.length > BROKER_LIMIT) {
    const btn = document.createElement("div");
    btn.style.cssText = "text-align:center;margin-top:10px";
    btn.innerHTML = `<button class="btn btn--ghost btn--sm" style="font-size:13px">
      ${window._brokerListExpanded ? "▲ Ver menos" : "▼ Ver mais (" + files.length + ")"}
    </button>`;
    btn.querySelector("button").addEventListener("click", () => {
      window._brokerListExpanded = !window._brokerListExpanded;
      renderBrokerImportStatus();
  updateQuoteErrorIndicator();
    });
    list.appendChild(btn);
  }
  renderBrokerImportAudit();
}

async function importBrokerFiles(files) {
  const fileArr = Array.from(files || []);
  if (!fileArr.length) throw new Error("Sem ficheiros.");
  const bd = ensureBrokerData();
  let addedFiles = 0, replacedFiles = 0, addedEvents = 0, addedPositions = 0, unknownFiles = 0;
  const existingEventKeys = new Set();
  const existingPosKeys = new Set();
  const refreshKeySets = () => {
    existingEventKeys.clear();
    existingPosKeys.clear();
    (bd.events || []).forEach(e => existingEventKeys.add(e.key));
    (bd.positions || []).forEach(p => existingPosKeys.add(p.key));
  };
  refreshKeySets();

  for (const file of fileArr) {
    const hash = await hashFile(file);
    const parsed = await parseBrokerImportFile(file);
    const format = parsed.format;
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const broker = normalizeBrokerNameFromFile(file.name);
    const meta = {
      hash,
      name: file.name,
      broker,
      format,
      importedAt: new Date().toISOString(),
      rows: rows.length || 0,
      events: 0,
      positions: 0,
      snapshotTotalEUR: 0,
      asOfDate: ""
    };

    const prevCount = (bd.files || []).filter(f => f.hash === hash).length;
    bd.files = (bd.files || []).filter(f => f.hash !== hash);
    bd.events = (bd.events || []).filter(e => e.sourceHash !== hash);
    bd.positions = (bd.positions || []).filter(p => p.sourceHash !== hash);
    refreshKeySets();
    if (prevCount) replacedFiles++;

    if (format === "workbook_multi") {
      let fileEvents = 0, filePositions = 0, fileRows = 0, recognizedBlocks = 0;
      for (const block of (parsed.blocks || [])) {
        const blockRows = Array.isArray(block.rows) ? block.rows : [];
        const blockMeta = { ...meta, ...(block.meta || {}), name: `${file.name} — ${block.sheetName || block.format}`, format: block.format, rows: blockRows.length || 0 };
        fileRows += blockRows.length || 0;
        if (block.format === "broker_ledger") {
          const evts = parseBrokerLedgerRows(blockRows, blockMeta);
          for (const evt of evts) {
            if (existingEventKeys.has(evt.key)) continue;
            existingEventKeys.add(evt.key);
            bd.events.push(evt);
            addedEvents++; fileEvents++;
          }
          recognizedBlocks++;
          continue;
        }
        if (block.format === "positions") {
          const positions = parseBrokerPositionRows(blockRows, blockMeta);
          for (const pos of positions) {
            if (existingPosKeys.has(pos.key)) continue;
            existingPosKeys.add(pos.key);
            bd.positions.push(pos);
            addedPositions++; filePositions++;
          }
          recognizedBlocks++;
          continue;
        }
        if (block.format === "xtb_trades") {
          const evts = parseXTBTradesRows(blockRows, blockMeta);
          for (const evt of evts) {
            if (existingEventKeys.has(evt.key)) continue;
            existingEventKeys.add(evt.key); bd.events.push(evt); addedEvents++; fileEvents++;
          }
          recognizedBlocks++;
          continue;
        }
        if (block.format === "xtb_positions") {
          const positions = parseXTBPositionsRows(blockRows, blockMeta);
          for (const pos of positions) {
            if (existingPosKeys.has(pos.key)) continue;
            existingPosKeys.add(pos.key); bd.positions.push(pos); addedPositions++; filePositions++;
          }
          recognizedBlocks++;
          continue;
        }
        if (block.format === "xtb_cash") {
          const evts = parseXTBCashRows(blockRows, blockMeta);
          for (const evt of evts) {
            if (existingEventKeys.has(evt.key)) continue;
            existingEventKeys.add(evt.key); bd.events.push(evt); addedEvents++; fileEvents++;
          }
          recognizedBlocks++;
          continue;
        }
      }
      if (recognizedBlocks) {
        meta.events = fileEvents;
        meta.positions = filePositions;
        meta.rows = fileRows;
        meta.format = "workbook_multi";
        meta.sheetNames = (parsed.blocks || []).map(b => b.sheetName).filter(Boolean).join(", ");
        bd.files.push(meta);
        addedFiles++;
        continue;
      }
    }
    if (format === "broker_ledger") {
      const evts = parseBrokerLedgerRows(rows, meta);
      for (const evt of evts) {
        if (existingEventKeys.has(evt.key)) continue;
        existingEventKeys.add(evt.key);
        bd.events.push(evt);
        addedEvents++;
      }
      meta.events = evts.length;
      bd.files.push(meta);
      addedFiles++;
      continue;
    }
    if (format === "positions") {
      const positions = parseBrokerPositionRows(rows, meta);
      for (const pos of positions) {
        if (existingPosKeys.has(pos.key)) continue;
        existingPosKeys.add(pos.key);
        bd.positions.push(pos);
        addedPositions++;
      }
      meta.positions = positions.length;
      bd.files.push(meta);
      addedFiles++;
      continue;
    }
    if (format === "holdings_pdf") {
      const positions = parseTrading212HoldingsPdf(parsed.text, meta);
      for (const pos of positions) {
        if (existingPosKeys.has(pos.key)) continue;
        existingPosKeys.add(pos.key);
        bd.positions.push(pos);
        addedPositions++;
      }
      meta.positions = positions.length;
      meta.rows = positions.length;
      bd.files.push(meta);
      addedFiles++;
      continue;
    }
    // ── XTB trade history (closed trades)
    if (format === "xtb_trades") {
      const evts = parseXTBTradesRows(rows, meta);
      for (const evt of evts) {
        if (existingEventKeys.has(evt.key)) continue;
        existingEventKeys.add(evt.key); bd.events.push(evt); addedEvents++;
      }
      meta.events = evts.length;
      bd.files.push(meta); addedFiles++;
      continue;
    }
    // ── XTB open positions (portfolio snapshot)
    if (format === "xtb_positions") {
      const positions = parseXTBPositionsRows(rows, meta);
      for (const pos of positions) {
        if (existingPosKeys.has(pos.key)) continue;
        existingPosKeys.add(pos.key); bd.positions.push(pos); addedPositions++;
      }
      meta.positions = positions.length;
      bd.files.push(meta); addedFiles++;
      continue;
    }
    // ── XTB cash operations (deposits, dividends, interest)
    if (format === "xtb_cash") {
      const evts = parseXTBCashRows(rows, meta);
      for (const evt of evts) {
        if (existingEventKeys.has(evt.key)) continue;
        existingEventKeys.add(evt.key); bd.events.push(evt); addedEvents++;
      }
      meta.events = evts.length;
      bd.files.push(meta); addedFiles++;
      continue;
    }
    // ── XTB PDF account statement (text extracted)
    if (format === "xtb_pdf") {
      // Parse as text — extract tabular lines with symbol/volume/profit pattern
      const xtbRows = parseXTBPdfText(parsed.text || "", meta);
      for (const evt of xtbRows.events || []) {
        if (existingEventKeys.has(evt.key)) continue;
        existingEventKeys.add(evt.key); bd.events.push(evt); addedEvents++;
      }
      for (const pos of xtbRows.positions || []) {
        if (existingPosKeys.has(pos.key)) continue;
        existingPosKeys.add(pos.key); bd.positions.push(pos); addedPositions++;
      }
      meta.events = (xtbRows.events||[]).length;
      meta.positions = (xtbRows.positions||[]).length;
      bd.files.push(meta); addedFiles++;
      continue;
    }
    // Show debug info for unrecognized files
    const diagEl2 = document.getElementById("brokerImportDiag");
    if (diagEl2) {
      const sampleHeaders = (rows.slice(0,1)[0] ? Object.keys(rows[0]).slice(0,8).join(", ") : "—");
      console.warn(`[Import] Ficheiro não reconhecido: ${file.name} | formato detectado: ${format} | colunas: ${sampleHeaders}`);
    }
    unknownFiles++;
  }

  const uniqueFiles = new Map();
  for (const f of (bd.files || [])) uniqueFiles.set(f.hash, f);
  bd.files = Array.from(uniqueFiles.values());

  rebuildBrokerGeneratedData();
  if (!state.settings) state.settings = {};
  state.settings.brokerRebuildSig = getBrokerDataSignature();
  syncBrokerAssetDividendYieldsFromRecords();
  autoSyncDivSummariesFromImportedData(); // auto-fill annual summaries from real data
  await saveStateAsync();
  renderAll({ force: true });

  const msg = `Corretoras: ${addedFiles} ficheiro${addedFiles !== 1 ? 's' : ''} · ${addedEvents} evento${addedEvents !== 1 ? 's' : ''} · ${addedPositions} posição${addedPositions !== 1 ? 'ões' : ''}${replacedFiles ? ` · ${replacedFiles} substituído${replacedFiles !== 1 ? 's' : ''}` : ''}${unknownFiles ? ` · ${unknownFiles} não reconhecido${unknownFiles !== 1 ? 's' : ''}` : ''}`;
  toast(msg, 4500);
  return { addedFiles, replacedFiles, addedEvents, addedPositions, unknownFiles };
}


function clearBrokerImports() {
  const bd = ensureBrokerData();
  const n = (bd.files || []).length;
  if (!n) { toast("Sem imports de corretoras para limpar."); return; }
  state.assets = (state.assets || []).filter(a => !a.generatedFromBroker);
  state.dividends = (state.dividends || []).filter(d => !d.generatedFromBroker);
  state.transactions = (state.transactions || []).filter(t => !t.generatedFromBroker);
  // Also clear auto-generated annual summaries
  state.divSummaries = (state.divSummaries || []).filter(s => !s.generatedFromBroker);
  state.brokerData = { files: [], events: [], positions: [] };
  if (!state.settings) state.settings = {};
  delete state.settings.brokerRebuildSig;
  saveState();
  renderAll();
  toast(`🗑️ ${n} import${n !== 1 ? 's' : ''} de corretora apagado${n !== 1 ? 's' : ''}.`, 4000);
}

/* ─── IMPORTAÇÃO UNIVERSAL DE EXTRACTOS ──────────────────────
   Suporta: CSV/TXT · Excel (.xlsx) · PDF
   Detecta formato automaticamente pelo nome/tipo do ficheiro
─────────────────────────────────────────────────────────────── */

/* ─── CATEGORIZAÇÃO AUTOMÁTICA ────────────────────────────────
   Reconhece padrões comuns em descrições de extractos bancários PT
─────────────────────────────────────────────────────────────── */
function autoCategorise(desc, dir) {
  const d = normStr(desc || "");

  // Entradas específicas
  if (dir === "in") {
    if (/salario|vencimento|remuneracao|ordenado/.test(d)) return "Salário";
    if (/subsidio|sub\. ?ferias|sub\. ?natal/.test(d)) return "Subsídio";
    if (/renda|aluguer|arrendamento/.test(d)) return "Renda recebida";
    if (/dividendo|dividend/.test(d)) return "Dividendos";
    if (/reembolso|devolucao|devol\./.test(d)) return "Reembolso";
    if (/transferencia de|trf\. de|trf\.imed\. de|recebido de/.test(d)) return "Transferência recebida";
    if (/mb way/.test(d) && dir === "in") return "MB Way recebido";
    if (/transferencia entre contas/.test(d)) return "Transferência entre contas";
    if (/^poupan|pouoanca|poupanca noutra/.test(d)) return "Poupança própria";
    if (/mesada pedro|mesada miudos/.test(d)) return "Mesada";
    if (/constituicao de d\.p|constituicao de dp/.test(d)) return "Constituição DP";
    if (/irs|at |autoridade tributaria/.test(d)) return "Reembolso IRS";
    if (/seguranca social|seg\. social/.test(d)) return "Segurança Social";
    if (/pensao|reforma/.test(d)) return "Pensão";
  }

  // Saídas — habitação
  if (/hipoteca|credito habitacao|credito \/ habitacao|ch /.test(d)) return "Crédito habitação";
  if (/condominio|cond\./.test(d)) return "Condomínio";
  if (/renda|aluguer/.test(d) && dir === "out") return "Renda";
  if (/agua|aguas de|aguas do/.test(d)) return "Água";
  if (/luz|eletricidade|edp|ibelectra|e\.on/.test(d)) return "Electricidade";
  if (/gas |galp|gas natural/.test(d)) return "Gás";
  if (/internet|meo|nos |vodafone|nowo|altice/.test(d)) return "Telecomunicações";

  // Saídas — seguros
  if (/seguro de vida/.test(d)) return "Seguro de vida";
  if (/seguro multi.riscos|seguro multiriscos/.test(d)) return "Seguro multirriscos";
  if (/seguro |ageas|fidelidade|tranquilidade|zurich|allianz|chubb/.test(d)) return "Seguros";

  // Saídas — transportes
  if (/via verde|autoestrada/.test(d)) return "Via Verde";
  if (/combustivel|galp|bp |repsol|shell/.test(d)) return "Combustível";
  if (/comboio|cp |metro |autocarro|uber|bolt/.test(d)) return "Transportes";
  if (/estacionamento|parque/.test(d)) return "Estacionamento";
  if (/levantamento|atm|multibanco/.test(d)) return "Levantamento";

  // Saídas — alimentação
  if (/continente|pingo doce|lidl|aldi|minipreco|minipreço|mercadona|supermercado/.test(d)) return "Supermercado";
  if (/restaurante|cafe |snack|pizza|mcdonalds|kfc|nandos|sushi/.test(d)) return "Restaurante";
  if (/padaria|pastelaria|confeitaria/.test(d)) return "Padaria";

  // Saídas — saúde
  if (/farmacia|farmácia|medicina|clinica|hospital|dentista|consultorio/.test(d)) return "Saúde";
  if (/ginasio|gym|fitness|coolgym|holmes|virgin/.test(d)) return "Ginásio";

  // Saídas — finanças
  if (/imposto|irs |iva |iuc |imt |at |fisco|tributaria/.test(d)) return "Impostos";
  if (/comissao|comissão|manutencao conta/.test(d)) return "Comissões bancárias";
  if (/deposito a prazo|constituicao de d\.p|dp |d\.p\./.test(d)) return "Constituição DP";
  if (/ppr |plano poupanca|subscricao ppr/.test(d)) return "PPR";
  if (/investimento|subscricao|fundo/.test(d)) return "Investimento";
  // Transferências internas (poupança, entre contas próprias, mesadas)
  if (/^poupan|pouoanca|poupanca noutra/.test(d)) return "Poupança própria";
  if (/mesada pedro|mesada miudos/.test(d)) return "Mesada";
  if (/transferencia entre contas/.test(d)) return "Transferência entre contas";
  if (/cred\.|credito consumo|credito pessoal/.test(d)) return "Crédito pessoal";
  if (/cartao|pagamento de conta cartao/.test(d)) return "Cartão de crédito";

  // Saídas — educação
  if (/escola|colegio|universidade|propina|aulas|explicador/.test(d)) return "Educação";

  // Saídas — lazer
  if (/netflix|spotify|amazon|apple\.com|google|disney|hbo/.test(d)) return "Subscrições";
  if (/cinema|teatro|concerto|bilhete/.test(d)) return "Lazer";

  // Transferências e MB Way genéricos
  if (/mb way para|mb way emitida|trf\. mb way para/.test(d)) return "MB Way enviado";
  if (/transferencia para|trf\. para|transferencia emitida|trf\. emitida/.test(d)) return "Transferência enviada";
  if (/transferencia entre contas/.test(d)) return "Transferência entre contas";

  // Serviços municipais
  if (/servicos municip|camara|municipal/.test(d)) return "Serviços municipais";

  // Fallback
  return dir === "in" ? "Outros recebimentos" : "Outras despesas";
}

async function importBankFile(file) {
  if (!file) throw new Error("Sem ficheiro.");
  const name = file.name.toLowerCase();
  let text = "";

  // Tenta parsers em cascata — do mais específico para o mais genérico
  let parsed = [];

  if (name.endsWith(".pdf")) {
    text = await extractTextFromPDF(file);
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    parsed = await parseXLSXBankRows(file);
    if (!parsed.length) { text = await extractTextFromXLSX(file); }
  } else {
    text = await fileToText(file);
  }

  // v15: detectar banco automaticamente pelo conteúdo
  const bankFmt = detectBankFormat(text || "");
  const bankNames = { cgd:"CGD", millennium:"Millennium BCP", novobanco:"Novo Banco",
    montepio:"Montepio", bpi:"BPI", santander:"Santander", generic:"Genérico" };
  const bankLabel = bankNames[bankFmt] || "Genérico";

  // Parsers específicos por banco detectado
  if (!parsed.length && bankFmt === "millennium")  parsed = parseMillenniumCSV(text);
  if (!parsed.length && bankFmt === "cgd")         parsed = parseCGDCSV(text);
  if (!parsed.length && bankFmt === "novobanco")   parsed = parseNovoBancoCSV(text);
  if (!parsed.length && (bankFmt === "montepio" || bankFmt === "bpi")) parsed = parseMontepioBPI(text);
  // Parsers universais em cascata
  if (!parsed.length) parsed = parseSantanderTabular(text || "");
  if (!parsed.length) parsed = parseSantanderPDF(text || "");
  if (!parsed.length) parsed = parseMillenniumCSV(text || "");
  if (!parsed.length) parsed = parseCGDCSV(text || "");
  if (!parsed.length) parsed = parseNovoBancoCSV(text || "");
  if (!parsed.length) parsed = parseMontepioBPI(text || "");
  if (!parsed.length) parsed = parseBankCsvLikeText(text || "");
  if (!parsed.length) parsed = parseBankCsvGeneric(text || "");

  if (!parsed.length && !text.trim()) {
    showBankResult("error", "Não foi possível extrair texto do ficheiro.");
    return { added: 0, dup: 0, read: 0 };
  }

  if (!parsed.length) {
    const firstLines = (text||"").split("\n").slice(0, 3).join(" | ").slice(0, 300);
    showBankResult("warn", `0 movimentos reconhecidos.<br><small>Banco detectado: <b>${typeof bankLabel !== "undefined" ? bankLabel : "Genérico"}</b><br>Primeiras linhas: ${escapeHtml(firstLines)}</small>`);
    return { added: 0, dup: 0, read: 0 };
  }

  // Deduplica
  // Deduplicação: chave = data|tipo|montante|descrição_original
  // A descrição original fica em notes; category pode ter mudado com auto-categorização
  // Dedup key: date + type + amount + first 30 normalised chars of description
  // Using truncated desc (not full) makes dedup robust across PDF/XLS/CSV variations
  // while still distinguishing legitimate same-day same-amount transactions (e.g. 2x PPR)
  function dedupKey(date, type, amount, desc) {
    const shortDesc = normStr(desc || "").slice(0, 30);
    return `${String(date||"").slice(0,10)}|${type}|${Math.round(Math.abs(amount)*100)}|${shortDesc}`;
  }

  const existing = new Set(state.transactions.map(tx => {
    const origDesc = tx.notes || tx.category || "";
    return dedupKey(tx.date, tx.type, parseNum(tx.amount), origDesc);
  }));

  let added = 0, dup = 0;
  let totalIn = 0, totalOut = 0;
  const newTx = [];

  for (const r of parsed) {
    const dir = r.amount >= 0 ? "in" : "out";
    const amount = Math.abs(r.amount);
    const key = dedupKey(r.date, dir, amount, r.desc);
    if (existing.has(key)) { dup++; continue; }
    existing.add(key);
    const category = autoCategorise(r.desc, dir);
    // Guardar descrição original em notes para deduplicação futura
    const tx = { id: uid(), type: dir, category, amount, date: r.date, recurring: "none", notes: r.desc || "" };
    state.transactions.push(tx);
    newTx.push(tx);
    if (dir === "in") totalIn += amount;
    else totalOut += amount;
    added++;
  }

  saveState();
  renderCashflow();

  // Resumo detalhado
  if (added > 0) {
    // Group by category
    const byCat = {};
    for (const tx of newTx) {
      if (!byCat[tx.category]) byCat[tx.category] = { in: 0, out: 0, n: 0 };
      byCat[tx.category][tx.type] += tx.amount;
      byCat[tx.category].n++;
    }
    const catRows = Object.entries(byCat)
      .sort((a,b) => (b[1].out + b[1].in) - (a[1].out + a[1].in))
      .slice(0, 8)
      .map(([cat, v]) => {
        const net = v.in - v.out;
        const color = net >= 0 ? "#059669" : "#dc2626";
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <span>${escapeHtml(cat)} <span style="color:#94a3b8;font-size:11px">(${v.n})</span></span>
          <span style="color:${color};font-weight:900">${net >= 0 ? "+" : ""}${fmtEUR2(net)}</span>
        </div>`;
      }).join("");

    showBankResult("ok", `
      <div style="margin-bottom:10px">
        ✅ <b>${added}</b> movimento${added!==1?"s":""} importado${added!==1?"s":""}
        ${dup > 0 ? ` · <span style="color:#92400e">${dup} duplicado${dup!==1?"s":""} ignorado${dup!==1?"s":""}</span>` : ""}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:#f0fdf4;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Entradas</div>
          <div style="font-weight:900;color:#059669">${fmtEUR2(totalIn)}</div>
        </div>
        <div style="background:#fef2f2;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Saídas</div>
          <div style="font-weight:900;color:#dc2626">${fmtEUR2(totalOut)}</div>
        </div>
        <div style="background:#f5f3ff;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:11px;color:#667085">Saldo</div>
          <div style="font-weight:900;color:${totalIn-totalOut>=0?"#059669":"#dc2626"}">${fmtEUR2(totalIn-totalOut)}</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:#667085;margin-bottom:4px">Por categoria:</div>
      ${catRows}
    `);
  } else {
    showBankResult("info", `ℹ️ 0 novos · ${dup} já existiam · ${parsed.length} lidos`);
  }

  toast(`${added} movimentos importados · Entradas ${fmtEUR2(totalIn)} · Saídas ${fmtEUR2(totalOut)}`);
  return { added, dup, read: parsed.length };
}

function showBankResult(type, html) {
  const el = document.getElementById("bankImportResult");
  if (!el) return;
  el.style.display = "";
  const colors = { ok: "#f0fdf4", warn: "#fffbeb", error: "#fef2f2", info: "#f5f3ff" };
  const borders = { ok: "#86efac", warn: "#fcd34d", error: "#fca5a5", info: "#c4b5fd" };
  el.style.background = colors[type] || "#f5f5f5";
  el.style.border = `1px solid ${borders[type] || "#e5e5e5"}`;
  el.style.borderRadius = "14px";
  el.style.padding = "12px 14px";
  el.style.fontWeight = "700";
  el.style.fontSize = "14px";
  el.innerHTML = html;
}

async function extractTextFromPDF(file) {
  // Tenta pdf.js primeiro (melhor qualidade, preserva estrutura de colunas)
  if (typeof pdfjsLib !== "undefined") {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Agrupar por Y (tolerância 2px), ordenar por X → preserva colunas
        const byY = new Map();
        for (const item of content.items) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] / 2) * 2;
          const x = item.transform[4];
          if (!byY.has(y)) byY.set(y, []);
          byY.get(y).push({ x, str: item.str });
        }
        const sortedYs = [...byY.keys()].sort((a, b) => b - a);
        for (const y of sortedYs) {
          const items = byY.get(y).sort((a, b) => a.x - b.x);
          fullText += items.map(i => i.str).join("\t") + "\n";
        }
      }
      if (fullText.trim()) return fullText;
    } catch(e) {
      console.warn("pdf.js falhou:", e.message);
    }
  }

  // Fallback: descompressão nativa do browser (iOS 16.4+ / Chrome / Firefox)
  console.log("pdf.js não disponível, a usar fallback nativo...");
  return extractPDFRaw(file);
}

async function extractPDFRaw(file) {
  // Fallback para quando pdf.js não está disponível.
  // Descomprime streams FlateDecode e reconstrói linhas usando operadores PDF (Td, TD, Tm, T*)
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const rawStr = new TextDecoder("latin1").decode(bytes);

    async function decompress(data) {
      try {
        // Tenta deflate-raw primeiro, depois deflate
        for (const fmt of ["deflate-raw", "deflate"]) {
          try {
            const ds = new DecompressionStream(fmt);
            const writer = ds.writable.getWriter();
            const reader = ds.readable.getReader();
            writer.write(data).catch(()=>{});
            writer.close().catch(()=>{});
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const total = chunks.reduce((a, c) => a + c.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) { out.set(c, offset); offset += c.length; }
            const text = new TextDecoder("latin1").decode(out);
            if (text.length > 10) return text;
          } catch(e) { continue; }
        }
        return null;
      } catch(e) { return null; }
    }

    // Encontrar todos os streams do PDF
    let allLines = [];
    const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = streamRe.exec(rawStr)) !== null) {
      const startIdx = m.index + m[0].indexOf('\n') + 1;
      const endIdx = m.index + m[0].lastIndexOf('endstream');
      if (endIdx <= startIdx) continue;
      const streamData = bytes.slice(startIdx, endIdx);
      const decompressed = await decompress(streamData);
      if (!decompressed) continue;

      // Processar blocos BT...ET (texto)
      const btBlocks = decompressed.match(/BT[\s\S]*?ET/g) || [];
      for (const block of btBlocks) {
        // Dividir em tokens para processar operadores em sequência
        const tokens = block.match(/\((?:[^)\\]|\\.)*\)|<[0-9A-Fa-f]*>|\[[\s\S]*?\]|[^\s\[\]]+/g) || [];
        const lineItems = []; // itens da linha corrente
        let currentLine = [];
        let lastY = null;

        let i = 0;
        while (i < tokens.length) {
          const tok = tokens[i];

          // String: (texto) ou <hex>
          if (tok.startsWith("(") && tok.endsWith(")")) {
            const str = tok.slice(1,-1)
              .replace(/\\n/g,"\n").replace(/\\r/g,"\r").replace(/\\t/g,"\t")
              .replace(/\\(.)/g,"$1");
            if (str.trim()) currentLine.push(str.trim());

          } else if (tok.startsWith("<") && tok.endsWith(">")) {
            // hex string
            const hex = tok.slice(1,-1);
            let str = "";
            for (let h=0; h<hex.length; h+=2) str += String.fromCharCode(parseInt(hex.slice(h,h+2),16));
            if (str.trim()) currentLine.push(str.trim());

          } else if (tok === "Tj" || tok === "'") {
            // Tj: usa currentLine como está
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            if (tok === "'") { allLines.push(lineItems.join("\t")); lineItems.length = 0; }

          } else if (tok === "TJ") {
            // TJ array — já processado nos tokens anteriores
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }

          } else if (tok === "Td" || tok === "TD") {
            // Mover posição — normalmente nova linha se dy != 0
            // Os dois tokens anteriores são dx dy
            const dy = parseFloat(tokens[i-1]) || 0;
            if (dy !== 0 && currentLine.length) {
              lineItems.push(currentLine.join(""));
              currentLine = [];
            }
            if (dy !== 0 || tok === "TD") {
              allLines.push(lineItems.join("\t"));
              lineItems.length = 0;
            }

          } else if (tok === "T*") {
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            allLines.push(lineItems.join("\t"));
            lineItems.length = 0;

          } else if (tok === "Tm") {
            // Matrix — nova posição absoluta, provavelmente nova linha
            if (currentLine.length) { lineItems.push(currentLine.join("")); currentLine = []; }
            const newY = parseFloat(tokens[i-2]) || 0;
            if (lastY !== null && Math.abs(newY - lastY) > 2) {
              allLines.push(lineItems.join("\t"));
              lineItems.length = 0;
            }
            lastY = newY;
          }
          i++;
        }
        // Flush remaining
        if (currentLine.length) lineItems.push(currentLine.join(""));
        if (lineItems.length) allLines.push(lineItems.join("\t"));
      }
    }

    return allLines.filter(l => l.trim()).join("\n");
  } catch(e) {
    console.error("extractPDFRaw error:", e);
    return "";
  }
}

// Parser Santander Portugal — estado de máquina sobre sequência de tokens
// Encoding do PDF: "!" = €, '"' (char34) = sinal negativo
// Sequência: data → "D. valor:..." → descrição → ['"'] → valor → "!" → saldo → "!"
function parseSantanderPDF(text) {
  const out = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const monthMap = {
    jan:1,fev:2,feb:2,mar:3,abr:4,apr:4,mai:5,may:5,
    jun:6,jul:7,ago:8,aug:8,set:9,sep:9,out:10,oct:10,nov:11,dez:12,dec:12
  };

  function parsePTDate(s) {
    const m = String(s||"").match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
    if (!m) return null;
    const mon = monthMap[m[2].toLowerCase().slice(0,3)];
    if (!mon) return null;
    return `${m[3]}-${String(mon).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }

  let i = 0;
  while (i < lines.length) {
    const iso = parsePTDate(lines[i]);
    if (!iso) { i++; continue; }

    // Avança sobre linhas "D. valor: ..."
    let j = i + 1;
    while (j < lines.length && /^D[\.\s]?\s*valor/i.test(lines[j])) j++;
    if (j >= lines.length) { i++; continue; }

    const txLine = lines[j];

    // Ignorar cabeçalhos
    if (parsePTDate(txLine) ||
        /titular|conta pt|saldo disponível|movimentos da|página|pesquisas|data da opera/i.test(txLine)) {
      i = j; continue;
    }

    // Encontrar valores monetários — o sinal pode estar separado do valor
    // Ex: "Descrição\t−\t20,00€\t3.009,88€" ou "Descrição\t−20,00€\t3.024,88€"
    // Normalizar: juntar sinal solto ao valor
    const normLine = txLine.replace(/[\u2212\-]\s*(\d)/g, "-$1");

    const moneyRe = /([\-]?\d{1,3}(?:\.\d{3})*,\d{2})€/g;
    const moneyMatches = [...normLine.matchAll(moneyRe)];

    if (moneyMatches.length >= 1) {
      const rawAmt = moneyMatches[0][1].replace(/\./g,"").replace(/,/g,".");
      const amount = Number(rawAmt);
      if (Number.isFinite(amount)) {
        // Descrição: tudo antes do primeiro valor, sem sinais soltos no fim
        const amtIdx = normLine.indexOf(moneyMatches[0][0]);
        const desc = normLine.slice(0, amtIdx)
          .replace(/\t/g," ").replace(/[\u2212\-]\s*$/,"").replace(/\s+/g," ").trim() || "Movimento";
        if (!/^D[\.\s]?\s*valor/i.test(desc)) {
          out.push({ date: iso, desc, amount });
        }
      }
    }
    i = j + 1;
  }
  return out;
}


// Santander variant: text comes out as consecutive items on same line with tabs
// e.g. "13 abr 2026\tD. valor: 13 abr 2026\tTrf.imed. De Filipe...\t15,00€\t3.024,88€"
function parseSantanderTabular(text) {
  const out = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  const monthMap = {
    jan:1, fev:2, feb:2, mar:3, abr:4, apr:4, mai:5, may:5,
    jun:6, jul:7, ago:8, aug:8, set:9, sep:9, out:10, oct:10, nov:11, dez:12, dec:12
  };

  function parsePTDate2(s) {
    const m = String(s||"").trim().match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/);
    if (!m) return null;
    const mon = monthMap[m[2].toLowerCase().slice(0,3)];
    if (!mon) return null;
    return `${m[3]}-${String(mon).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }

  for (const line of lines) {
    // Skip header/footer lines
    if (/titular|conta|saldo|movimentos|página|pesquisas|defeito|documento/i.test(line) &&
        !/\d{1,3}(?:\.\d{3})*,\d{2}€/.test(line)) continue;
    if (/^D[\.\s]?\s*valor/i.test(line)) continue;
    if (/data da opera|opera.+valor.+saldo/i.test(line)) continue;

    const cols = line.split(/\t/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;

    // Find date in first columns
    let iso = null, descStart = 0;
    for (let i = 0; i < Math.min(3, cols.length); i++) {
      iso = parsePTDate2(cols[i]);
      if (iso) { descStart = i + 1; break; }
    }
    if (!iso) continue;

    // Find money values — sign may be a separate tab-column before the number
    // e.g. ["Descrição", "−", "20,00€", "3.009,88€"]
    const moneyRe = /^[\u2212\-]?\d{1,3}(?:\.\d{3})*,\d{2}€?$/;
    const moneyIdxs = cols.map((c, i) => moneyRe.test(c.replace(/\s/g,"")) ? i : -1).filter(i => i >= 0);

    // Also detect a lone sign column immediately before a money column
    const signIdxs = cols.map((c, i) => /^[\u2212\-]$/.test(c.trim()) ? i : -1).filter(i => i >= 0);

    if (!moneyIdxs.length) continue;
    const amtIdx = moneyIdxs[0];

    // Check if there's a lone sign column just before the amount
    const signBefore = signIdxs.find(si => si === amtIdx - 1);
    const rawAmt = cols[amtIdx].replace(/\u2212/g,"-").replace(/€/g,"").replace(/\./g,"").replace(/,/g,".");
    let amount = Number(rawAmt);
    if (!Number.isFinite(amount)) continue;
    if (signBefore !== undefined) amount = -Math.abs(amount);

    // Description: cols between date end and sign/amount
    const descEnd = signBefore !== undefined ? signBefore : amtIdx;
    const desc = cols.slice(descStart, descEnd).join(" ").trim() || "Movimento";
    if (/^D[\.\s]?\s*valor/i.test(desc)) continue;

    out.push({ date: iso, desc, amount });
  }
  return out;
}

async function extractTextFromXLSX(file) {
  try {
    if (typeof XLSX === "undefined") {
      toast("Biblioteca Excel não carregada. Tenta recarregar a página.");
      return "";
    }
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array", dateNF: "yyyy-mm-dd" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });
  } catch (e) {
    console.error("XLSX extraction error:", e);
    return "";
  }
}

// ─── XLSX BANK PARSER: structured row parsing (handles Santander, BCP, CGD…) ───
// Reads XLSX directly as row objects — no lossy text conversion.
// Detects columns by keyword, handles PT number format, separate debit/credit cols.
async function parseXLSXBankRows(file) {
  // Robust XLSX bank parser — uses VALUE PATTERNS not header keywords.
  // Keyword-based detection is unreliable (e.g. "Data valor" matches "valor" = amount keyword).
  // Instead: read raw numeric cells, identify columns by their value characteristics.
  try {
    if (typeof XLSX === "undefined") return [];
    const arrayBuffer = await file.arrayBuffer();
    // raw:true preserves actual numeric values without string formatting
    const wb = XLSX.read(arrayBuffer, { type: "array", raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Get rows with raw values (numbers stay as numbers)
    const jsonRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!jsonRows.length) return [];

    const nCols = Math.max(...jsonRows.map(r => r.length));

    // ── STEP 1: Find the first data row (has a parseable date in col 0 or 1) ──
    let firstDataRow = -1;
    for (let i = 0; i < Math.min(30, jsonRows.length); i++) {
      const row = jsonRows[i];
      for (let j = 0; j < Math.min(3, (row||[]).length); j++) {
        if (parseDateFlexible(String(row[j] || ""))) { firstDataRow = i; break; }
      }
      if (firstDataRow >= 0) break;
    }
    if (firstDataRow < 0) return [];

    // ── STEP 2: Identify columns by value patterns across data rows ──
    // For each column, count: how many numeric values, how many are negative, median magnitude
    const colStats = [];
    const dataRows = jsonRows.slice(firstDataRow);
    for (let j = 0; j < nCols; j++) {
      const nums = [];
      const texts = [];
      const dates = [];
      for (const row of dataRows) {
        if (!row || row[j] == null || row[j] === "") continue;
        const v = row[j];
        if (typeof v === "number") { nums.push(v); continue; }
        const s = String(v).trim();
        if (parseDateFlexible(s)) { dates.push(s); continue; }
        const n = parseEuroNum(s);
        if (n !== null && s.replace(/[€\s,.]/g,"").length > 0) { nums.push(n); continue; }
        if (s) texts.push(s);
      }
      const hasNeg = nums.some(v => v < 0);
      const allPos = nums.length > 0 && nums.every(v => v >= 0);
      const avgMag = nums.length ? nums.reduce((a,b)=>a+Math.abs(b),0)/nums.length : 0;
      colStats.push({ j, nums, texts, dates, hasNeg, allPos, avgMag,
        numCount: nums.length, textCount: texts.length, dateCount: dates.length });
    }

    // Date col: mostly date-formatted text strings
    const dateCol = colStats.reduce((best, c) =>
      c.dateCount > (best ? best.dateCount : -1) ? c : best, null)?.j ?? 0;

    // Amount col: has NEGATIVE values (signed amount), moderate magnitude
    // Balance col: all positive, usually larger running total
    const numericCols = colStats.filter(c => c.numCount > 5);
    let amtCol = -1, balCol = -1;
    if (numericCols.length === 1) {
      amtCol = numericCols[0].j;
    } else if (numericCols.length >= 2) {
      // Amount col has negatives; balance col is all positive with higher avg
      const withNeg = numericCols.filter(c => c.hasNeg);
      const allPos  = numericCols.filter(c => c.allPos);
      if (withNeg.length >= 1) amtCol = withNeg[0].j;
      if (allPos.length >= 1)  balCol = allPos.reduce((a,b) => b.avgMag > a.avgMag ? b : a).j;
      // If no negatives found, pick col with smallest avg magnitude as amount
      if (amtCol < 0 && numericCols.length >= 2) {
        amtCol = numericCols.reduce((a,b) => a.avgMag <= b.avgMag ? a : b).j;
        balCol = numericCols.reduce((a,b) => a.avgMag >= b.avgMag ? a : b).j;
      }
    }

    // Also check for separate Debit/Credit columns (some banks use two cols)
    let debitCol = -1, creditCol = -1;
    if (amtCol < 0 && numericCols.length >= 2) {
      // Try header keywords only as tiebreaker here (already past the detection phase)
      const headerRow = jsonRows[firstDataRow > 0 ? firstDataRow - 1 : 0] || [];
      headerRow.forEach((h, j) => {
        const hl = String(h||"").toLowerCase();
        if (/d[ée]bit|sa[ií]d|out/.test(hl) && debitCol < 0) debitCol = j;
        if (/cr[ée]dit|entrad|in\b/.test(hl) && creditCol < 0) creditCol = j;
      });
    }

    // Desc col: mostly long text, not dates, not numbers
    const descCol = colStats.reduce((best, c) => {
      if (c.j === dateCol || c.j === amtCol || c.j === balCol) return best;
      if (c.textCount > (best ? best.textCount : -1)) return c;
      return best;
    }, null)?.j ?? -1;

    // ── STEP 3: Parse each data row ──
    const out = [];
    for (const row of dataRows) {
      if (!row || row.every(v => v == null || v === "")) continue;

      // Date
      const rawDate = String(row[dateCol] || "").trim();
      const isoDate = parseDateFlexible(rawDate);
      if (!isoDate) continue;

      // Description
      const desc = descCol >= 0 ? String(row[descCol] || "").trim() : "Movimento";
      if (!desc || /^(data|saldo|balance|descrição|description)/i.test(desc)) continue;

      // Amount — prefer signed single column
      let amount = null;
      if (amtCol >= 0) {
        const v = row[amtCol];
        amount = typeof v === "number" ? v : parseEuroNum(String(v || ""));
      } else if (debitCol >= 0 || creditCol >= 0) {
        const dv = debitCol >= 0 ? (typeof row[debitCol]==="number" ? row[debitCol] : parseEuroNum(String(row[debitCol]||"")) || 0) : 0;
        const cv = creditCol >= 0 ? (typeof row[creditCol]==="number" ? row[creditCol] : parseEuroNum(String(row[creditCol]||"")) || 0) : 0;
        amount = cv - dv;
      }

      // Last-resort: scan numeric cols, skip balance col
      if (amount === null || !Number.isFinite(amount)) {
        for (const c of numericCols) {
          if (c.j === balCol) continue;
          const v = row[c.j];
          const n = typeof v === "number" ? v : parseEuroNum(String(v||""));
          if (n !== null && Number.isFinite(n)) { amount = n; break; }
        }
      }

      if (!Number.isFinite(amount)) continue;
      out.push({ date: isoDate, desc: desc || "Movimento", amount });
    }
    return out;
  } catch (e) {
    console.error("parseXLSXBankRows error:", e);
    return [];
  }
}

// Generic CSV bank parser — handles most Portuguese bank exports
function parseBankCsvGeneric(text) {
  const out = [];
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);

  // Try to find delimiter
  const delims = [";", ",", "\t", "|"];
  let bestDelim = ";";
  let maxCols = 0;
  for (const d of delims) {
    const cols = (lines.find(l => l.trim()) || "").split(d).length;
    if (cols > maxCols) { maxCols = cols; bestDelim = d; }
  }

  // Find header row — look for date/description/amount keywords
  const dateKw = ["data","date","datum","fecha","dt"];
  const descKw = ["descri","movimento","operacao","conceito","narrat","detail","memo","ref"];
  const amtKw  = ["montante","amount","debito","credito","importe","movim"]; // "valor"/"saldo" removed: too ambiguous

  let headerIdx = -1, dateCol = -1, descCol = -1, amtCol = -1, debitCol = -1, creditCol = -1;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const row = splitCSVLine(lines[i], bestDelim).map(c => c.trim().toLowerCase());
    if (row.length < 2) continue;
    let score = 0;
    let di = -1, dsi = -1, ai = -1, dbi = -1, cri = -1;
    row.forEach((c, j) => {
      if (dateKw.some(k => c.includes(k))) { di = j; score++; }
      if (descKw.some(k => c.includes(k))) { dsi = j; score++; }
      if (amtKw.some(k => c.includes(k))) {
        if (c.includes("debito") || c.includes("saida") || c.includes("debit")) dbi = j;
        else if (c.includes("credito") || c.includes("entrada") || c.includes("credit")) cri = j;
        else ai = j;
        score++;
      }
    });
    if (score >= 2) {
      headerIdx = i; dateCol = di; descCol = dsi; amtCol = ai; debitCol = dbi; creditCol = cri;
      break;
    }
  }

  if (headerIdx < 0) return [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCSVLine(line, bestDelim).map(c => c.trim());
    if (cols.length < 2) continue;

    // Date
    const rawDate = dateCol >= 0 ? cols[dateCol] : cols[0];
    const isoDate = parseDateFlexible(rawDate);
    if (!isoDate) continue;

    // Description
    const desc = (descCol >= 0 ? cols[descCol] : cols.slice(1, 3).join(" ")).trim();

    // Amount — try separate debit/credit columns first
    let amount = 0;
    if (debitCol >= 0 || creditCol >= 0) {
      const debit = debitCol >= 0 ? parseEuroNum(cols[debitCol]) : 0;
      const credit = creditCol >= 0 ? parseEuroNum(cols[creditCol]) : 0;
      amount = (credit || 0) - (debit || 0);
    } else if (amtCol >= 0) {
      amount = parseEuroNum(cols[amtCol]);
    } else {
      // Last numeric column
      for (let j = cols.length - 1; j >= 0; j--) {
        const v = parseEuroNum(cols[j]);
        if (v !== null && v !== 0) { amount = v; break; }
      }
    }
    if (amount === null || amount === undefined) continue;

    out.push({ date: isoDate, desc: desc || "Movimento", amount });
  }
  return out;
}

function parseDateFlexible(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/['"]/g, "");
  // ISO: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2,"0"), mo = m1[2].padStart(2,"0");
    const y = m1[3].length === 2 ? "20" + m1[3] : m1[3];
    return `${y}-${mo}-${d}`;
  }
  // MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mo = m2[1].padStart(2,"0"), d = m2[2].padStart(2,"0"), y = m2[3];
    return `${y}-${mo}-${d}`;
  }
  // Portuguese: "15 Jan 2024" or "15 Janeiro 2024"
  const m3 = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
  if (m3) return parsePtDate(m3[1], m3[2], m3[3]);
  return null;
}

function parseEuroNum(s) {
  if (!s) return null;
  const clean = String(s).trim().replace(/[€$£\s]/g, "").replace(/\u2212/g, "-");
  if (!clean || clean === "-" || clean === "—") return null;
  // Handle PT format: 1.234,56 or 1,234.56
  let n;
  if (clean.includes(",") && clean.includes(".")) {
    n = clean.lastIndexOf(",") > clean.lastIndexOf(".")
      ? Number(clean.replace(/\./g,"").replace(",","."))
      : Number(clean.replace(/,/g,""));
  } else if (clean.includes(",")) {
    n = Number(clean.replace(",","."));
  } else {
    n = Number(clean);
  }
  return Number.isFinite(n) ? n : null;
}

// Keep old function for backwards compat
async function importBankMovementsCsv(file) {
  return importBankFile(file);
}

function downloadTemplate() {
  const rows = [
    ["tipo","classe","nome","valor","yield_tipo","yield_valor","valorizacao_esperada_pct","data","notas"],
    ["ativo","Ações/ETFs","VWCE",25000,"yield_pct",1.8,6,"",""],
    ["ativo","Imobiliário","Apartamento Lisboa",280000,"rent_month",900,2,"",""],
    ["ativo","Depósitos","DP CGD 4.5%",50000,"yield_pct",4.5,0,"2026-12-31","Capitalização mensal"],
    ["ativo","PPR","PPR Alves Ribeiro",15000,"yield_pct",5.2,1.5,"",""],
    ["ativo","Ouro","Ouro físico",8000,"","","","",""],
    ["passivo","Crédito habitação","CH Millennium",150000,"","","","",""],
    ["movimento","","Salário Pedro",3500,"","","",isoToday(),""],
    ["movimento","","Supermercado",200,"","","",isoToday(),""]
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
    settings: { currency: "EUR", goalMonthly: 0, returnDefaults: safeClone(DEFAULT_RETURN_SETTINGS), ...(p.settings || {}) },
    assets: Array.isArray(p.assets) ? p.assets : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    transactions: Array.isArray(p.transactions) ? p.transactions : [],
    dividends: Array.isArray(p.dividends) ? p.dividends : [],
    divSummaries: Array.isArray(p.divSummaries) ? p.divSummaries : [],
    history: Array.isArray(p.history) ? p.history : [],
    priceHistory: (p.priceHistory && typeof p.priceHistory === "object") ? p.priceHistory : {},
    fxHistory: (p.fxHistory && typeof p.fxHistory === "object") ? p.fxHistory : {},
    brokerData: {
      files: Array.isArray(p.brokerData && p.brokerData.files) ? p.brokerData.files : [],
      events: Array.isArray(p.brokerData && p.brokerData.events) ? p.brokerData.events : [],
      positions: Array.isArray(p.brokerData && p.brokerData.positions) ? p.brokerData.positions : []
    }
  };
  saveState();
  renderAll();
  toast("Backup importado com sucesso.");
}

let _resetPending = false;
function resetAll() {
  const btn = document.getElementById("btnReset");
  if (!_resetPending) {
    _resetPending = true;
    if (btn) { btn.textContent = "⚠️ Toca outra vez — apaga TUDO!"; btn.style.background="#7f1d1d"; }
    setTimeout(() => {
      _resetPending = false;
      if (btn) { btn.textContent = "🗑️ Reset total — apaga TUDO incluindo ativos"; btn.style.background=""; }
    }, 4000);
    return;
  }
  _resetPending = false;
  void storageClear();
  state = safeClone(DEFAULT_STATE);
  saveState();
  renderAll();
  toast("Dados apagados.");
}

/* ─── SETTINGS ────────────────────────────────────────────── */
function getReturnClassDefinitions() {
  return [
    { key: "acoes/etfs", label: "Ações / ETFs", hint: "dividendos + crescimento do mercado", passiveHint: "dividendo esperado", appreciationHint: "crescimento esperado" },
    { key: "fundos", label: "Fundos", hint: "fundos multi-activos / UCITS", passiveHint: "distribuição esperada", appreciationHint: "crescimento esperado" },
    { key: "ppr", label: "PPR", hint: "fundos PPR / seguros PPR", passiveHint: "distribuição / participação", appreciationHint: "crescimento esperado" },
    { key: "imobiliario", label: "Imobiliário", hint: "renda + valorização do activo", passiveHint: "yield renda", appreciationHint: "valorização do imóvel" },
    { key: "ouro", label: "Ouro", hint: "activo sem yield natural", passiveHint: "yield projectado", appreciationHint: "valorização esperada" },
    { key: "prata", label: "Prata", hint: "activo sem yield natural", passiveHint: "yield projectado", appreciationHint: "valorização esperada" },
    { key: "cripto", label: "Cripto", hint: "staking separado da apreciação", passiveHint: "staking / yield", appreciationHint: "apreciação esperada" },
    { key: "liquidez", label: "Liquidez", hint: "contas / saldo à ordem", passiveHint: "juro esperado", appreciationHint: "valorização" },
    { key: "depositos", label: "Depósitos", hint: "juro contratual", passiveHint: "juro esperado", appreciationHint: "valorização" },
    { key: "obrigacoes", label: "Obrigações", hint: "cupão separado do capital", passiveHint: "cupão / carry", appreciationHint: "pull-to-par / preço" },
    { key: "outros", label: "Outros", hint: "fallback residual", passiveHint: "rendimento base", appreciationHint: "valorização" }
  ];
}

function renderReturnSettingsCard() {
  const wrap = document.getElementById("returnAssumptionsCard");
  if (!wrap) return;
  const rs = getReturnSettings();
  const defs = getReturnClassDefinitions();
  const explicitApp = (state.assets || []).filter(a => hasExplicitAppreciationPct(a)).length;
  const explicitPassive = (state.assets || []).filter(a => hasExplicitPassiveYield(a)).length;
  const impliedApp = (state.assets || []).filter(a => !hasExplicitAppreciationPct(a) && Math.abs(getAssetAppreciationPct(a, { allowClassFallback: true })) > 1e-9).length;
  const impliedPassive = (state.assets || []).filter(a => !hasExplicitPassiveYield(a) && Math.abs(getAssetPassiveRatePct(a, { allowClassFallback: true })) > 1e-9).length;

  wrap.innerHTML = `
    <div class="return-settings-head">
      <div>
        <div class="card__title" style="margin-bottom:4px">Pressupostos de retorno projectado por classe</div>
        <div class="card__muted">Usados apenas nas projeções quando o activo não tem rendimento base ou valorização explícitos.</div>
      </div>
      <div class="return-settings-stat">${explicitPassive + explicitApp} overrides · ${impliedPassive + impliedApp} em fallback</div>
    </div>
    <div class="return-settings-summary">
      <div class="return-mini return-mini--green"><div class="return-mini__k">Rendimento base explícito</div><div class="return-mini__v">${explicitPassive}</div></div>
      <div class="return-mini return-mini--purple"><div class="return-mini__k">Valorização explícita</div><div class="return-mini__v">${explicitApp}</div></div>
      <div class="return-mini return-mini--slate"><div class="return-mini__k">Fallback rendimento</div><div class="return-mini__v">${impliedPassive}</div></div>
      <div class="return-mini return-mini--slate"><div class="return-mini__k">Fallback valorização</div><div class="return-mini__v">${impliedApp}</div></div>
    </div>
    <div class="return-settings-grid return-settings-grid--dual">
      ${defs.map(d => `
        <div class="return-setting-row return-setting-row--dual">
          <div>
            <div class="return-setting-row__title">${escapeHtml(d.label)}</div>
            <div class="return-setting-row__hint">${escapeHtml(d.hint)}</div>
          </div>
          <div class="return-setting-dual-wrap">
            <label class="return-setting-row__input return-setting-row__input--stack">
              <span class="return-setting-row__sub">${escapeHtml(d.passiveHint)}</span>
              <div class="return-setting-row__inputline">
                <input class="input input--sm js-ret-passive" data-key="${d.key}" inputmode="decimal" value="${String(parseNum(rs.classPassivePct[d.key] || 0))}">
                <span class="return-setting-row__suffix">%/ano</span>
              </div>
            </label>
            <label class="return-setting-row__input return-setting-row__input--stack">
              <span class="return-setting-row__sub">${escapeHtml(d.appreciationHint)}</span>
              <div class="return-setting-row__inputline">
                <input class="input input--sm js-ret-default" data-key="${d.key}" inputmode="decimal" value="${String(parseNum(rs.classAppreciationPct[d.key] || 0))}">
                <span class="return-setting-row__suffix">%/ano</span>
              </div>
            </label>
          </div>
        </div>`).join("")}
    </div>
    <div class="card" style="padding:12px;margin-top:12px;background:var(--card2)">
      <div class="return-settings-toggle">
        <label style="display:flex;align-items:center;gap:10px;font-weight:700">
          <input type="checkbox" id="prefPreferTWR" ${rs.preferTWR ? "checked" : ""}>
          Preferir TWR real quando houver histórico suficiente
        </label>
        <div class="return-setting-row__input" style="min-width:168px">
          <input class="input input--sm" id="prefTwrMinYears" inputmode="decimal" value="${String(parseNum(rs.twrMinYears || DEFAULT_RETURN_SETTINGS.twrMinYears))}">
          <span class="return-setting-row__suffix">anos mínimos</span>
        </div>
      </div>
      <div class="return-mini__foot" style="margin-top:8px">Sem TWR robusto, o motor usa rendimento base projectado ponderado + valorização esperada ponderada. O dashboard de rendimento passivo continua a usar o rendimento real/configurado.</div>
    </div>
    <div class="row row--wrap" style="margin-top:12px;gap:8px">
      <button class="btn btn--primary" id="btnSaveReturnDefaults" style="flex:1">Guardar pressupostos</button>
      <button class="btn btn--ghost" id="btnResetReturnDefaults">Repor valores sugeridos</button>
    </div>`;

  const btnSave = document.getElementById("btnSaveReturnDefaults");
  if (btnSave) btnSave.addEventListener("click", () => {
    const classPassivePct = {};
    const classAppreciationPct = {};
    document.querySelectorAll(".js-ret-passive").forEach(el => {
      const key = el.getAttribute("data-key");
      classPassivePct[key] = Math.max(-100, Math.min(100, parseNum(el.value)));
    });
    document.querySelectorAll(".js-ret-default").forEach(el => {
      const key = el.getAttribute("data-key");
      classAppreciationPct[key] = Math.max(-100, Math.min(100, parseNum(el.value)));
    });
    const preferTWR = !!((document.getElementById("prefPreferTWR") || {}).checked);
    const twrMinYears = Math.max(0.1, parseNum((document.getElementById("prefTwrMinYears") || {}).value || DEFAULT_RETURN_SETTINGS.twrMinYears));
    saveReturnSettings({ classPassivePct, classAppreciationPct, preferTWR, twrMinYears });
    saveState();
    renderReturnSettingsCard();
    if (currentView === "analysis") renderAnalysis();
    renderDashboard();
    toast("✅ Pressupostos de retorno guardados.");
  });

  const btnReset = document.getElementById("btnResetReturnDefaults");
  if (btnReset) btnReset.addEventListener("click", () => {
    saveReturnSettings({ classPassivePct: safeClone(PASSIVE_DEFAULTS), classAppreciationPct: safeClone(APPRECIATION_DEFAULTS), preferTWR: true, twrMinYears: DEFAULT_RETURN_SETTINGS.twrMinYears });
    saveState();
    renderReturnSettingsCard();
    if (currentView === "analysis") renderAnalysis();
    renderDashboard();
    toast("Pressupostos repostos para os valores sugeridos.");
  });
}

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
  else renderReturnSettingsCard();
}

/* ─── WIRING ──────────────────────────────────────────────── */
function wire() {
  if (window.__PF_MAIN_WIRED) return;
  window.__PF_MAIN_WIRED = true;
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

  // Quote refresh button
  const btnRefresh = $("btnRefreshQuotes");
  if (btnRefresh) btnRefresh.addEventListener("click", refreshLiveQuotes);
  const btnQuoteErrors = document.getElementById('btnQuoteErrors');
  if (btnQuoteErrors) btnQuoteErrors.addEventListener('click', () => {
    const report = (((state || {}).settings || {}).lastQuoteRefresh) || { updated:0, failed:0, errors:[] };
    showQuoteErrors(report.updated || 0, report.failed || 0, report.errors || [], report.updated || 0, report.failed || 0);
    quoteErrorsInlineOpen = true;
    renderQuoteErrorsInline(true);
    openModal('modalQuoteErrors');
  });
  const btnQuoteErrorsInlineClose = document.getElementById('btnQuoteErrorsInlineClose');
  if (btnQuoteErrorsInlineClose) btnQuoteErrorsInlineClose.addEventListener('click', () => {
    quoteErrorsInlineOpen = false;
    renderQuoteErrorsInline(false);
  });

  // Sync compound fields from asset
  const compAsset = document.getElementById("compAsset");
  if (compAsset) compAsset.addEventListener("change", syncCompoundFromAsset);
  const btnCalcComp = document.getElementById("btnCalcCompound");
  if (btnCalcComp) btnCalcComp.addEventListener("click", calcAndRenderCompound);

  // Analysis tabs
  // Wire das tabs de análise (botões com scroll horizontal)
  document.querySelectorAll(".analysis-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      // Actualizar hidden select (compatibilidade)
      const sel = document.getElementById("analysisTab");
      if (sel) sel.value = tab;
      // Actualizar estado visual dos botões
      document.querySelectorAll(".analysis-tab").forEach(b => b.classList.remove("analysis-tab--active"));
      btn.classList.add("analysis-tab--active");
      // Scroll para o botão activo
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      renderAnalysis();
    });
  });
  // Manter compatibilidade com select hidden
  const analysisTabs = document.getElementById("analysisTab");
  if (analysisTabs) analysisTabs.addEventListener("change", () => {
    const tab = analysisTabs.value;
    document.querySelectorAll(".analysis-tab").forEach(b => {
      b.classList.toggle("analysis-tab--active", b.dataset.tab === tab);
    });
    renderAnalysis();
  });

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
  ["fireWindow","fireHorizon","fireCustomReturn","fireCustomInflation","fireMonthlyInvest"].forEach(id => {
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
  if (cfGran) cfGran.addEventListener("change", () => {
    const gran = cfGran.value;
    const monthSel = document.getElementById("cfMonth");
    if (monthSel) monthSel.style.opacity = (gran === "year" || gran === "all") ? "0.3" : "1";
    renderCashflow();
  });

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

  // Importar corretoras (multi-ficheiro / multi-ano)
  const brokerFilesInput = document.getElementById("brokerFiles");
  const btnImportBrokerFiles = document.getElementById("btnImportBrokerFiles");
  if (brokerFilesInput && btnImportBrokerFiles) {
    brokerFilesInput.addEventListener("change", () => {
      btnImportBrokerFiles.disabled = !(brokerFilesInput.files && brokerFilesInput.files.length);
    });
    btnImportBrokerFiles.addEventListener("click", async () => {
      const files = brokerFilesInput.files;
      if (!files || !files.length) return;
      btnImportBrokerFiles.disabled = true;
      const orig = btnImportBrokerFiles.textContent;
      btnImportBrokerFiles.textContent = "A importar…";
      try {
        const result = await importBrokerFiles(files);
        // Show diagnostic if some files not recognized
        if (result && result.unknownFiles > 0) {
          const diagEl = document.getElementById("brokerImportDiag");
          if (diagEl) {
            diagEl.style.display = "";
            diagEl.style.cssText = "padding:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;font-size:13px;margin-top:8px;color:#9a3412";
            diagEl.innerHTML = `⚠️ ${result.unknownFiles} ficheiro${result.unknownFiles !== 1 ? "s" : ""} não reconhecido${result.unknownFiles !== 1 ? "s" : ""}.<br>
              <span style="font-size:12px">Formatos suportados: XTB (Excel/CSV histórico operações, posições abertas, operações de caixa), Trading 212 (CSV, PDF holdings).<br>
              Verifica se o ficheiro está em Excel (.xlsx) ou CSV e se corresponde a um destes formatos.</span>`;
          }
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        toast("Falha no import: " + msg, 5000);
        console.error("importBrokerFiles error:", e);
        const diagEl = document.getElementById("brokerImportDiag");
        if (diagEl) {
          diagEl.style.display = "";
          diagEl.style.cssText = "padding:10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;font-size:13px;margin-top:8px;color:#991b1b";
          diagEl.innerHTML = `❌ Erro no import: <b>${escapeHtml(msg)}</b>`;
        }
      } finally {
        btnImportBrokerFiles.disabled = false;
        btnImportBrokerFiles.textContent = orig;
      }
    });
  }
  const btnClearBrokerImports = document.getElementById("btnClearBrokerImports");
  if (btnClearBrokerImports) btnClearBrokerImports.addEventListener("click", clearBrokerImports);

  // Importar extracto do banco (universal: CSV, XLSX, PDF)
  const bankFileInput = document.getElementById("bankFile");
  const btnImportBank = document.getElementById("btnImportBank");
  if (bankFileInput && btnImportBank) {
    bankFileInput.addEventListener("change", () => {
      btnImportBank.disabled = !bankFileInput.files?.length;
      const res = document.getElementById("bankImportResult");
      if (res) res.style.display = "none";
    });
    btnImportBank.addEventListener("click", async e => {
      e.preventDefault();
      const f = bankFileInput.files?.[0];
      if (!f) return;
      btnImportBank.disabled = true;
      btnImportBank.textContent = "A importar…";
      try {
        await importBankFile(f);
      } catch (err) {
        showBankResult("error", `Erro: ${escapeHtml(err.message || String(err))}`);
        console.error(err);
      } finally {
        btnImportBank.disabled = false;
        btnImportBank.textContent = "Importar extracto";
      }
    });
  }

  // Bank CSV import (legacy - kept for Import tab)
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

  // Clear only transactions (keep assets/liabilities)
  function makeTwoTap(btnId, label, action) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let pending = false;
    btn.addEventListener("click", () => {
      if (!pending) {
        pending = true;
        const orig = btn.textContent;
        btn.textContent = "⚠️ Toca outra vez para confirmar";
        btn.style.background = "#fbbf24"; btn.style.color = "#000";
        setTimeout(() => { pending = false; btn.textContent = orig; btn.style.background=""; btn.style.color=""; }, 4000);
        return;
      }
      pending = false;
      btn.textContent = label; btn.style.background=""; btn.style.color="";
      action(btn);
    });
  }

  makeTwoTap("btnClearTransactions", "🗑️ Limpar movimentos (mantém ativos)", () => {
    const n = state.transactions.length;
    if (!n) { toast("Sem movimentos para limpar."); return; }
    state.transactions = [];
    saveState(); renderAll(); checkDuplicateWarning();
    toast(`🗑️ ${n} movimentos apagados. Reimporta os ficheiros do banco.`, 4000);
  });
  makeTwoTap("btnClearTransactions2", "🗑️ Limpar movimentos e reimportar", () => {
    const n = state.transactions.length;
    if (!n) { toast("Sem movimentos para limpar."); return; }
    state.transactions = [];
    saveState(); renderAll(); checkDuplicateWarning();
    toast(`🗑️ ${n} movimentos apagados. Reimporta os ficheiros do banco.`, 4000);
  });

  // Limpar só Ações/ETFs/Cripto (mantém depósitos, PPR, fundos, movimentos)
  const btnClearEq = document.getElementById("btnClearEquities");
  if (btnClearEq) {
    let _eqPending = false;
    btnClearEq.addEventListener("click", () => {
      const EQ = ["Ações/ETFs", "Cripto"];
      const toRemove = state.assets.filter(a => EQ.includes(a.class));
      if (!toRemove.length) { toast("Sem Ações/ETFs/Cripto para limpar."); return; }
      if (!_eqPending) {
        _eqPending = true;
        btnClearEq.textContent = `⚠️ Confirmar? Apaga ${toRemove.length} activos`;
        btnClearEq.style.background = "#fbbf24"; btnClearEq.style.color = "#000";
        setTimeout(() => { _eqPending = false; btnClearEq.textContent = "🗑️ Limpar Ações / ETFs / Cripto"; btnClearEq.style.background=""; btnClearEq.style.color=""; }, 4000);
        return;
      }
      _eqPending = false;
      state.assets = state.assets.filter(a => !EQ.includes(a.class));
      saveState(); renderAll();
      btnClearEq.textContent = "🗑️ Limpar Ações / ETFs / Cripto";
      btnClearEq.style.background=""; btnClearEq.style.color="";
      toast(`🗑️ ${toRemove.length} activos removidos. Reimporta o CSV do DivTracker.`, 4000);
    });
  }

  // Check on import view open
  checkDuplicateWarning();

  // Settings
  $("baseCurrency").value = state.settings.currency || "EUR";
  $("baseCurrency").addEventListener("change", () => {
    state.settings.currency = $("baseCurrency").value;
    saveState(); renderAll();
  });
  const btnGoImport = document.getElementById("btnGoImport");
  if (btnGoImport) btnGoImport.addEventListener("click", () => setView("import"));
  renderReturnSettingsCard();

  // Worker URL para cotações
  const workerInput = document.getElementById("settingsWorkerUrl");
  if (workerInput) workerInput.value = state.settings.workerUrl || "";
  const btnSaveWorkerUrl = document.getElementById("btnSaveWorkerUrl");
  if (btnSaveWorkerUrl) btnSaveWorkerUrl.addEventListener("click", () => {
    const val = (document.getElementById("settingsWorkerUrl").value || "").trim();
    if (!state.settings) state.settings = {};
    state.settings.workerUrl = val;
    saveState();
    toast(val ? "✅ Worker URL guardado" : "Worker URL removido");
  });

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

  // Dividendos — radio buttons de modo
  document.querySelectorAll('input[name="divInputMode"]').forEach(r => {
    r.addEventListener("change", () => { showDivFields(r.value); updateDivSummaryLive(); });
  });
  // Live calc em todos os campos de input de dividendos
  [
    "divSummaryGross","divSummaryTax",
    "divSummaryNet","divSummaryRetRate",
    "divSummaryPortfolio","divSummaryYield_py","divSummaryRetRate_py",
    "divSummaryYield_yo","divSummaryRetRate_yo",
    "divSummaryYield_gt","divSummaryYield_net"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateDivSummaryLive);
  });

  // Dividendos — modo selector
  const segDivS = document.getElementById("segDivSummary");
  const segDivD = document.getElementById("segDivDetail");
  const segDivC = document.getElementById("segDivCalendar");
  if (segDivS) segDivS.addEventListener("click", () => setDivMode("summary"));
  if (segDivD) segDivD.addEventListener("click", () => setDivMode("detail"));
  if (segDivC) segDivC.addEventListener("click", () => setDivMode("calendar"));
  const btnSaveDivSummary = document.getElementById("btnSaveDivSummary");
  if (btnSaveDivSummary) btnSaveDivSummary.addEventListener("click", saveDivSummary);
  const btnDeleteDivSummary = document.getElementById("btnDeleteDivSummary");
  if (btnDeleteDivSummary) btnDeleteDivSummary.addEventListener("click", deleteDivSummary);
  const btnDivProject = document.getElementById("btnDivProject");
  if (btnDivProject) btnDivProject.addEventListener("click", renderDivProjection);
  // Live calc
  ["divSummaryGross","divSummaryTax"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateDivSummaryLive);
  });

  // Dividendos individuais
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

/* ─── LIVE QUOTE REFRESH (via Cloudflare Worker proxy) ──────────────────────
   Arquitectura:
     PWA → Cloudflare Worker (worker.patrimonio.pages.dev) → Yahoo Finance API
   O Worker evita restrições CORS do browser.
   URL do worker configurável em Settings > Worker URL.
   Se não configurado, permite edição manual do valor do ativo.
──────────────────────────────────────────────────────────────────────────────*/

// Classes de ativos que têm cotação de mercado (ticker)
const QUOTE_CLASSES = ["Ações/ETFs", "Cripto", "Obrigações"];

function extractTicker(asset) {
  const explicit = String((asset && asset.ticker) || "").trim().toUpperCase();
  if (/^[A-Z0-9.-]{1,16}$/.test(explicit)) return explicit;

  const notes = String((asset && asset.notes) || "");
  const tagged = notes.match(/\b(?:Ticker|Yahoo)=([A-Z0-9.\-=^]{1,24})\b/i);
  if (tagged) return String(tagged[1] || "").trim().toUpperCase();

  const name = String((asset && asset.name) || "").trim();

  const bracketed = name.match(/[\[(]([A-Z0-9.-]{2,16}(?:\.[A-Z]{1,4}|-[A-Z]{3})?)[\])]/);
  if (bracketed) return String(bracketed[1] || "").trim().toUpperCase();

  const leadingWithVenue = name.match(/^([A-Z0-9.-]{1,16}\.(?:US|DE|FR|PT|LS|MC|PA|AS|L|SW|TO|IR|CO|ST|OL|HE|AX|F|UK))(?:\b|\s|—|-)/);
  if (leadingWithVenue) return String(leadingWithVenue[1] || "").trim().toUpperCase();

  const leadingPlain = name.match(/^([A-Z]{2,8}|[A-Z]-USD|[A-Z0-9]{2,10}-USD)(?:\b|\s*[—(\[])/);
  if (leadingPlain) return String(leadingPlain[1] || "").trim().toUpperCase();

  return null;
}


async function fetchQuote(ticker, workerUrl) {
  const url = `${workerUrl.replace(/\/$/, "")}/quote?ticker=${encodeURIComponent(ticker)}`;
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(`Worker inacessível: ${e.message || "timeout"}`);
  }

  let data = null;
  try { data = await resp.clone().json(); } catch (_) {}

  if (!resp.ok) {
    const detail = data && data.error ? `: ${data.error}` : "";
    throw new Error(`Worker HTTP ${resp.status}${detail}`);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}


async function refreshLiveQuotes() {
  const btn = $("btnRefreshQuotes");
  const workerUrl = (state.settings && state.settings.workerUrl) || "";

  if (!workerUrl) {
    // Sem Worker configurado — mostrar modal de configuração
    const url = prompt(
      "⚙️ Cloudflare Worker URL\n\nIntroduz o URL do teu Worker para actualizar cotações automaticamente.\nEx: https://patrimonio-quotes.SEU-NOME.workers.dev\n\n(Deixa em branco para configurar mais tarde)"
    );
    if (url && url.trim().startsWith("http")) {
      if (!state.settings) state.settings = {};
      state.settings.workerUrl = url.trim();
      saveState();
      toast("✅ Worker URL guardado. A tentar actualizar…");
      return refreshLiveQuotes();
    }
    toast("⚠️ Worker URL não configurado. Ver README para instruções.", 4000);
    return;
  }

  // Identificar apenas ativos com identidade de mercado suficiente.
  // Isto evita falsos erros em depósitos, certificados de aforro e ativos manuais sem ticker real.
  const candidates = state.assets.filter(assetLooksQuoteEligible);

  if (!candidates.length) {
    toast("Sem ativos com ticker detectado em Ações/ETFs/Cripto.", 3000);
    return;
  }

  // UI: spinning button
  if (btn) { btn.disabled = true; btn.textContent = "⟳ A actualizar…"; }

  let updated = 0, failed = 0;
  const errors = [];

  // Convert local / broker tickers into Yahoo candidates.
  // Several imports keep a stale ISIN→Yahoo guess; try that first, then sensible fallbacks.
  const SKIP_TICKERS = new Set(["WBA","14","DN3.DE","OD7F.DE","U9UA.DE"]);
  // v21: Reduzido para evitar cascata absurda. Ordem por prevalência para equities dual-listed.
  const ALT_EXCHANGE_SUFFIXES = [".DE", ".L", ".PA", ".TO"];
  const YAHOO_TICKER_OVERRIDES = {
    "WCP": "WCP.TO",
    "GRA": "GRA.TO",
    "FRU": "FRU.TO",
    "ISO": "ISO.TO",
    "DN3": "DN3.F",
    "U9UA": "U9UA.F",
    "CNYA.IR": "CNYA.DE",
    "CNYA": "CNYA.DE",
    "BAM1": "BAM",
    "BAM1.US": "BAM",
    // Volkswagen: VOW.DE está delisted; Xetra tem VOW3.DE (preferred)
    "VOW1": "VOW3.DE",
    "VOW1.DE": "VOW3.DE",
    "VOW.DE": "VOW3.DE",
    "GDXJ.DE": "G2XJ.DE",
    "GDXJ": "G2XJ.DE",
    "NOVOB": "NOVO-B.CO",
    "NOVOB.DK": "NOVO-B.CO",
    "STM.FR": "STMPA.PA",
    "MPW.US": "MPW",
    "MPW": "MPW",
    "NZYMB.DK": "NSIS-B.CO",
    "AMS": "AMS2.VI",
    "BTEC.DE": "BTEC.L"
  };

  function normalizeTickerLookupKey(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function isManualNonMarketAsset(asset) {
    const cls = normalizeTickerLookupKey(asset.class || "");
    const name = normalizeTickerLookupKey(asset.name || "");
    const raw = normalizeTickerLookupKey(asset.ticker || asset.name || "");
    if (name.includes("CERTIFICADOS AFORRO")) return true;
    if ((cls === "DEPOSITOS" || cls === "OBRIGACOES") && /^\d{1,6}$/.test(raw)) return true;
    return false;
  }

  function toYahooTicker(raw) {
    const t = (raw||"").trim().toUpperCase();
    if (!t || SKIP_TICKERS.has(t)) return null;
    if (YAHOO_TICKER_OVERRIDES[t]) return YAHOO_TICKER_OVERRIDES[t];
    // Cripto: BTC, ETH, BTC.CC, "Bitcoin" → BTC-USD (via tabela top 100)
    const cryptoTk = cryptoToYahoo(t);
    if (cryptoTk) return cryptoTk;
    if (t.endsWith(".CC")) return t.replace(/\.CC$/, "-USD");
    const xmap = {".PT":".LS",".GB":".L",".UK":".L",".PL":".WA",".CH":".SW",
      ".DK":".CO",".SE":".ST",".NO":".OL",".FI":".HE",
      ".BE":".BR",".IT":".MI",".FR":".PA",".NL":".AS",
      ".ES":".MC",".AU":".AX",".CA":".TO"};
    for (const [from, to] of Object.entries(xmap)) {
      if (t.endsWith(from)) return t.slice(0,-from.length) + to;
    }
    return t;
  }

  function getStoredYahooTicker(asset) {
    const direct = String(asset.yahooTicker || "").trim().toUpperCase();
    if (direct) return direct;
    const m = String(asset.notes || "").match(/(?:^|\s|·)Yahoo=([A-Z0-9.\-=^]+)/i);
    return m ? String(m[1] || "").trim().toUpperCase() : "";
  }

  function getRawTickerForAsset(asset) {
    const tk = String(asset.ticker || "").trim();
    if (tk && /^[A-Z0-9.\-]{1,16}$/i.test(tk)) return tk.toUpperCase();

    const cls = String(asset.class || "").trim();
    const isMarketClass = QUOTE_CLASSES.includes(cls);
    const nm = String(asset.name || "").trim();
    if ((asset && asset.generatedFromBroker) || isMarketClass) {
      if (nm && /^[A-Z0-9.\-]{1,16}$/i.test(nm)) return nm.toUpperCase();
    }

    const ext = extractTicker(asset);
    return ext ? String(ext).trim().toUpperCase() : "";
  }


  function hasExplicitTickerTag(asset) {
    return /\b(?:Ticker|Yahoo)=([A-Z0-9.\-=^]{1,24})\b/i.test(String((asset && asset.notes) || ""));
  }

  function isPlausibleMarketTicker(raw, asset) {
    const t = String(raw || "").trim().toUpperCase();
    if (!t) return false;
    if (/[.=\-]/.test(t)) return true;

    const cls = String((asset && asset.class) || "").trim();
    const isMarketClass = QUOTE_CLASSES.includes(cls);
    const isBroker = !!(asset && asset.generatedFromBroker);
    if (!isMarketClass && !isBroker) return false;

    if (t.length >= 2 && /^[A-Z0-9]{2,10}$/.test(t)) return true;
    if (t === "O") {
      const nm2 = normalizeSecurityNameKey((asset && asset.name) || "");
      return /\bREALTY\b/.test(nm2) || /\bINCOME\b/.test(nm2) || isBroker;
    }
    return false;
  }


  function assetLooksQuoteEligible(asset) {
    if (!asset || isManualNonMarketAsset(asset)) return false;
    const cls = String(asset.class || "").trim();
    const isin = String(asset.isin || "").trim().toUpperCase();
    const storedYahoo = getStoredYahooTicker(asset);
    const raw = getRawTickerForAsset(asset);
    if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(raw || "").trim().toUpperCase())) return false;
    const inferredYahoo = inferYahooTickerFromIdentity({
      isin,
      ticker: raw || asset.ticker || "",
      yahooTicker: storedYahoo || asset.yahooTicker || "",
      name: asset.name || "",
      currency: asset.priceCurrency || asset.currency || ""
    });

    const isMarketClass = QUOTE_CLASSES.includes(cls);

    if (asset.generatedFromBroker) return !!(raw || storedYahoo || inferredYahoo || isin);
    if (!isMarketClass) return !!(storedYahoo || hasExplicitTickerTag(asset));
    return !!(isin || storedYahoo || inferredYahoo || isPlausibleMarketTicker(raw, asset));
  }


  function getAltExchangeSuffixes(asset) {
    const ccy = String(asset.priceCurrency || asset.currency || "").trim().toUpperCase();
    const isin = String(asset.isin || "").trim().toUpperCase();
    const prefix = isin.slice(0, 2);
    if (ccy === "GBP" || ccy === "GBX") return [".L", ".DE", ".PA", ".AS", ".TO"];
    if (ccy === "USD") return [".L", ".DE", ".AS", ".PA", ".TO"];
    if (ccy === "CHF") return [".SW", ".DE", ".L"];
    if (ccy === "EUR") {
      if (prefix === "PT") return [".LS"];
      if (prefix === "ES") return [".MC"];
      if (prefix === "FR") return [".PA"];
      if (prefix === "IT") return [".MI"];
      if (prefix === "DE") return [".DE", ".F"];
      if (prefix === "AT") return [".VI"];
      if (prefix === "CH") return [".SW"];
      if (prefix === "DK") return [".CO"];
      if (prefix === "SE") return [".ST"];
      if (prefix === "NO") return [".OL"];
      if (prefix === "FI") return [".HE"];
      if (prefix === "BE") return [".BR"];
      return [".DE", ".PA", ".AS", ".MC", ".MI", ".L", ".TO"];
    }
    return [".DE", ".L", ".PA", ".AS", ".TO"];
  }

  function buildYahooTickerCandidates(asset) {
    if (isManualNonMarketAsset(asset)) return [];
    const out = [];
    const push = tk => {
      const val = toYahooTicker(tk);
      if (!val || out.includes(val)) return;
      out.push(val);
    };

    const clsNorm = String(asset.class || "").trim().toLowerCase();
    if (clsNorm === "cripto" || clsNorm === "crypto") {
      const tk  = String(asset.ticker || "").trim();
      const nm  = String(asset.name || "").trim();
      const nmHead = nm.split(/[—\-·]/)[0].trim();
      const cand1 = cryptoToYahoo(tk) || cryptoToYahoo(nm) || cryptoToYahoo(nmHead);
      if (cand1) { out.push(cand1); return out; }
    }

    const raw = getRawTickerForAsset(asset);
    const isin = String(asset.isin || "").trim().toUpperCase();
    const storedYahoo = getStoredYahooTicker(asset);
    const ccy = String(asset.priceCurrency || asset.currency || "").trim().toUpperCase();
    const knownOverride = getKnownBrokerYahooOverride({
      isin, ticker: raw || asset.ticker || "", name: asset.name || "", currency: ccy, priceCurrency: ccy
    });
    const inferredYahoo = inferYahooTickerFromIdentity({
      isin,
      ticker: raw || asset.ticker || "",
      yahooTicker: storedYahoo || asset.yahooTicker || "",
      name: asset.name || "",
      currency: ccy,
      priceCurrency: ccy
    });
    const directMapped = knownOverride || (isin && ISIN_YAHOO_MAP[isin]) || inferredYahoo || YAHOO_TICKER_OVERRIDES[raw] || "";

    if (knownOverride) push(knownOverride);
    if (asset.generatedFromBroker && raw && ccy === "USD" && /^[A-Z0-9.-]{1,10}$/.test(canonicalBrokerTickerBase(raw))) push(canonicalBrokerTickerBase(raw));
    if (inferredYahoo) push(inferredYahoo);
    if (isin && ISIN_YAHOO_MAP[isin]) push(ISIN_YAHOO_MAP[isin]);
    if (raw && YAHOO_TICKER_OVERRIDES[raw]) push(YAHOO_TICKER_OVERRIDES[raw]);
    if (storedYahoo) push(storedYahoo);

    const rawBase = canonicalBrokerTickerBase(raw);
    const highConfidence = normalizeResolvedYahoo(knownOverride || inferredYahoo || storedYahoo || "");
    if (["MPW", "CRSP", "UNA.AS"].includes(highConfidence) || ["MPW", "CRSP", "UNA"].includes(rawBase)) {
      return highConfidence ? [highConfidence] : (rawBase ? [rawBase] : out);
    }
    const normRaw = toYahooTicker(raw);
    if (rawBase && rawBase !== raw) push(rawBase);
    if (normRaw && normRaw !== raw) push(normRaw);
    if (!directMapped && raw) push(raw);

    if (rawBase && !/[.=\-]/.test(rawBase)) {
      const alts = getAltExchangeSuffixes(asset);
      alts.forEach(suf => push(rawBase + suf));
    }

    return out;
  }


function normalizeResolvedYahoo(raw) {
  return String(toYahooTicker(raw) || raw || "").trim().toUpperCase();
}

function tickerBaseOnly(raw) {
  return String(normalizeResolvedYahoo(raw)).split(/[.=]/)[0].trim().toUpperCase();
}

function strictVenueSuffixForAsset(asset) {
  const isin = String(asset && asset.isin || "").trim().toUpperCase();
  const prefix = isin.slice(0, 2);
  if (prefix === "PT") return ".LS";
  if (prefix === "ES") return ".MC";
  if (prefix === "FR") return ".PA";
  if (prefix === "IT") return ".MI";
  if (prefix === "DE") return ".DE";
  if (prefix === "AT") return ".VI";
  if (prefix === "CH") return ".SW";
  if (prefix === "DK") return ".CO";
  if (prefix === "SE") return ".ST";
  if (prefix === "NO") return ".OL";
  if (prefix === "FI") return ".HE";
  if (prefix === "BE") return ".BR";
  if (prefix === "GB") return ".L";
  return "";
}

function isQuoteCandidateAcceptable(asset, candidate) {
  if (!asset) return true;
  const cand = normalizeResolvedYahoo(candidate);
  const expected = normalizeResolvedYahoo(inferYahooTickerFromIdentity({
    isin: asset.isin || "",
    ticker: asset.ticker || "",
    yahooTicker: asset.yahooTicker || "",
    name: asset.name || "",
    currency: asset.priceCurrency || asset.currency || ""
  }));
  const rawBase = tickerBaseOnly(asset.ticker || asset.name || "");
  const candBase = tickerBaseOnly(cand);
  const expectedBase = tickerBaseOnly(expected);

  const strictSuffix = strictVenueSuffixForAsset(asset);
  if (strictSuffix && cand && !cand.endsWith(strictSuffix)) return false;

  const assetCcy = String(asset.priceCurrency || asset.currency || "").trim().toUpperCase();
  const nm = normalizeSecurityNameKey(asset.name || "");
  const isAccFund = /\bACC\b/.test(nm) || /\bETF\b/.test(nm) || /\bFUND\b/.test(nm) || /\bISHARES\b/.test(nm) || /\bXTRACKERS\b/.test(nm) || /\bWISDOMTREE\b/.test(nm) || /\bVANECK\b/.test(nm) || /\bGLOBAL X\b/.test(nm) || /\bKRANESHARES\b/.test(nm);
  if (expected && !/[.=]/.test(expected) && assetCcy === "USD" && cand.includes(".") && !isAccFund) return false;

  if (expected && cand === expected) return true;
  if (candBase && expectedBase && candBase === expectedBase) return true;
  if (candBase && rawBase && candBase === rawBase) return true;

  return !expected;
}


async function fetchQuoteWithFallback(ref) {
  let lastErr = null;
  for (const candidate of ref.candidates) {
    try {
      const q = await fetchQuote(candidate, workerUrl);
      if (!isQuoteCandidateAcceptable(ref.asset, candidate)) {
        lastErr = new Error(`Candidato incompatível com a identidade do activo: ${candidate}`);
        continue;
      }
      return { yahoo: candidate, quote: q };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Não foi possível obter uma cotação válida");
}

  const rawTickerRefs = candidates.map(asset => {
    const raw = getRawTickerForAsset(asset);
    return { asset, raw, candidates: buildYahooTickerCandidates(asset) };
  });
  const noCandidateRefs = rawTickerRefs.filter(x => !(x.candidates && x.candidates.length));
  const tickerList = rawTickerRefs.filter(x => x.candidates && x.candidates.length);
  noCandidateRefs.forEach(ref => {
    failed++;
    errors.push({
      raw: ref.raw,
      yahoo: "",
      assetName: ref.asset.name || ref.raw || "Ativo",
      reason: "Sem ticker Yahoo reconhecível para este activo"
    });
  });

  const quoteResults = await Promise.allSettled(
    tickerList.map(x => fetchQuoteWithFallback(x))
  );
  const quoteMap = {};
  const quoteErrMap = {};
  quoteResults.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value && r.value.quote) {
      quoteMap[i] = r.value;
    } else {
      quoteErrMap[i] = (r && r.reason && r.reason.message) ? r.reason.message : "Erro ao obter cotação";
    }
  });

  // Collect currencies needing FX (crypto always USD, others from quote)
  const ccysNeeded = new Set();
  for (const x of tickerList) {
    if ((x.candidates || []).some(tk => tk.endsWith("-USD"))) ccysNeeded.add("USD");
  }
  for (const res of Object.values(quoteMap)) {
    const q = res && res.quote;
    const c = (q && q.currency || "EUR").toUpperCase();
    if (c !== "EUR") ccysNeeded.add(c);
  }

  // Fetch FX rates via Worker (EURUSD=X, EURGBP=X, etc.)
  const fxRates = {};
  const FX_FALLBACK_LOCAL = {USD:0.92,GBP:1.17,DKK:0.134,CHF:1.05,PLN:0.23,
    SEK:0.087,NOK:0.085,CAD:0.68,AUD:0.59,JPY:0.006,HKD:0.118};
  await Promise.allSettled([...ccysNeeded].map(async ccy => {
    try {
      const fq = await fetchQuote(`EUR${ccy}=X`, workerUrl);
      if (fq && fq.price > 0) fxRates[ccy] = 1 / fq.price;
    } catch(_) {}
  }));
  for (const c of ccysNeeded) if (!fxRates[c]) fxRates[c] = FX_FALLBACK_LOCAL[c] || 1;

  // ── Store latest FX rates for offline/display use
  if (!state.settings) state.settings = {};
  state.settings.lastFxRates = fxRates;

  // ── FX History
  const isoToday2 = new Date().toISOString().slice(0, 10);
  if (!state.fxHistory) state.fxHistory = {};
  for (const [ccy, rate] of Object.entries(fxRates)) {
    if (!state.fxHistory[ccy]) state.fxHistory[ccy] = [];
    const fxh = state.fxHistory[ccy];
    const fi  = fxh.findIndex(h => h.date === isoToday2);
    const fe  = { date: isoToday2, rate: +rate.toFixed(8) };
    if (fi >= 0) fxh[fi] = fe; else fxh.push(fe);
    if (fxh.length > 1095) fxh.splice(0, fxh.length - 1095);
  }

  const today = new Date().toLocaleDateString("pt-PT");
  for (const [idx, ref] of tickerList.entries()) {
    const { asset, raw } = ref;
    const resolved = quoteMap[idx];
    const yahoo = resolved && resolved.yahoo;
    const q = resolved && resolved.quote;
    if (!q || !Number.isFinite(q.price) || q.price <= 0) {
      failed++;
      errors.push({
        raw,
        yahoo: (ref.candidates || []).join(" → "),
        assetName: asset.name || raw || (ref.candidates || [])[0] || "Ativo",
        reason: quoteErrMap[idx] || "Não foi possível obter uma cotação válida"
      });
      continue;
    }
    asset.yahooTicker = yahoo || asset.yahooTicker || "";
    const ccy = (q.currency||"EUR").toUpperCase();
    const fxToEur = ccy === "EUR" ? 1 : (fxRates[ccy] || FX_FALLBACK_LOCAL[ccy] || FX_FALLBACK_STATIC[ccy] || 1);
    const priceEur = q.price * fxToEur;

    const qtyField = parseNum(asset.qty || 0);
    const qtyMatch = (asset.notes||"").match(/Qty=([\d.,]+)/);
    const qtyFromNotes = qtyMatch ? parseFloat(qtyMatch[1].replace(",", ".")) : null;
    const qty = qtyField > 0 ? qtyField : qtyFromNotes;
    const newValue = qty ? qty * priceEur : priceEur;

    const priceLabel = ccy === "EUR"
      ? fmtEUR2(priceEur)
      : `${fmtEUR2(priceEur)} (${q.price.toFixed(4)} ${ccy})`;

    const noteBase = (asset.notes||"")
      .replace(/\s*·?\s*Preço:[^·]*/g,"")
      .replace(/\s*·?\s*⚠️ Custo histórico[^·]*/g,"").trim();
    asset.value = newValue;
    // Keep valueLocal in sync for multi-currency display and clear stale FX badges when asset returns to EUR.
    if (ccy !== "EUR") {
      asset.currency   = ccy;
      asset.valueLocal = qty ? +(qty * q.price).toFixed(6) : +q.price.toFixed(6);
    } else {
      asset.currency = "EUR";
      delete asset.valueLocal;
    }
    asset.notes = `${noteBase}${noteBase?" · ":""}Preço: ${priceLabel} (${today})`;
    // Guardar qty e pm como campos dedicados para P&L
    if (qty) asset.qty = qty;
    const pmFromNotes = (asset.notes||"").match(/PM=([\d.,]+)/);
    if (pmFromNotes) asset.pmOriginal = parseNum(pmFromNotes[1]);
    asset.lastPriceEur = priceEur;
    asset.lastUpdated  = today;
    // ── Price history (store one entry per day per ticker)
    if (!state.priceHistory) state.priceHistory = {};
    const isoNow = new Date().toISOString().slice(0, 10);
    const tkKey  = (raw || asset.name || "").trim().toUpperCase();
    if (tkKey) {
      if (!state.priceHistory[tkKey]) state.priceHistory[tkKey] = [];
      const hist = state.priceHistory[tkKey];
      const ccy  = (q.currency || "EUR").toUpperCase();
      const locPrice = q.price; // price in original currency
      // Replace entry for same day or append
      const dayIdx = hist.findIndex(h => h.date === isoNow);
      const entry  = { date: isoNow, priceEur: +priceEur.toFixed(6), priceLoc: +(locPrice||priceEur).toFixed(6), ccy };
      if (dayIdx >= 0) hist[dayIdx] = entry; else hist.push(entry);
      // Keep max 1095 days (3 years)
      if (hist.length > 1095) hist.splice(0, hist.length - 1095);
    }
    // Save sector/geography metadata for charts
    if (q.sector || q.country || q.exchange) {
      asset.meta = {
        sector:    q.sector    || "",
        industry:  q.industry  || "",
        country:   q.country   || "",
        exchange:  q.exchange  || "",
        quoteType: q.quote_type || "",
      };
    }
    updated++;
  }

  if (!state.settings) state.settings = {};
  state.settings.lastQuoteRefresh = { updated, failed, errors, ts: new Date().toISOString() };
  await saveStateAsync();
  renderAll();
  renderEquityPnL();
  // Disparar evento para outros listeners (P&L, price alerts)
  document.dispatchEvent(new CustomEvent("quotesUpdated"));

  if (btn) { btn.disabled = false; btn.textContent = "⟳ Cotações"; }

  if (updated > 0 && !failed) {
    toast(`✅ ${updated} ativo${updated !== 1 ? "s" : ""} actualizado${updated !== 1 ? "s" : ""}`, 3000);
  } else if (updated > 0) {
    // Show clickable toast — tapping opens full error list modal
    showQuoteErrors(updated, failed, errors, updated, failed);
    quoteErrorsInlineOpen = true;
    renderQuoteErrorsInline(true);
    openModal("modalQuoteErrors");
    toastClickable(
      `✅ ${updated} actualizado${updated !== 1 ? "s" : ""} · ⚠️ ${failed} erro${failed !== 1 ? "s" : ""} — toca para ver`,
      () => openModal("modalQuoteErrors"), 8000
    );
  } else {
    showQuoteErrors(0, failed, errors, 0, failed);
    quoteErrorsInlineOpen = true;
    renderQuoteErrorsInline(true);
    openModal("modalQuoteErrors");
    toastClickable(
      `⚠️ ${failed} erro${failed !== 1 ? "s" : ""} — toca para ver detalhes`,
      () => openModal("modalQuoteErrors"), 8000
    );
  }
}


function renderDividendBaseModal() {
  const summaryEl = document.getElementById('dividendBaseSummary');
  const listEl = document.getElementById('dividendBaseList');
  if (!summaryEl || !listEl) return;
  const pref = getPreferredDividendYieldData();
  const assets = Array.isArray(pref.linkedAssets) ? pref.linkedAssets.slice().sort((a,b) => parseNum(b.value) - parseNum(a.value)) : [];
  const divs = Array.isArray(pref.linkedDividends) ? pref.linkedDividends : [];
  summaryEl.innerHTML = `${escapeHtml(getDividendSourceLabel(pref.source))} · base actual ${fmtEUR(pref.divPortfolioVal || 0)} · ${assets.length} ativo${assets.length !== 1 ? 's' : ''}`;
  if (!assets.length) {
    listEl.innerHTML = `<div class="note">Sem ativos ligados ao cálculo do yield nesta sessão.</div>`;
    return;
  }
  listEl.innerHTML = assets.map(a => {
    const hits = divs.filter(d => assetMatchesDividend(a, d));
    const ttmGross = hits.reduce((s, d) => s + getDividendGross(d), 0);
    const ttmNet = hits.reduce((s, d) => s + getDividendNet(d), 0);
    const grossYield = parseNum(a.value) > 0 ? (ttmGross / parseNum(a.value) * 100) : 0;
    return `<div class="item" style="cursor:default;align-items:flex-start">
      <div class="item__l">
        <div class="item__t">${escapeHtml(a.name || a.ticker || 'Ativo')}</div>
        <div class="item__s" style="margin-top:4px;line-height:1.5">
          <div><b>Classe:</b> ${escapeHtml(a.class || '—')}</div>
          <div><b>Valor atual:</b> ${fmtEUR(parseNum(a.value))}</div>
          <div><b>Dividendos TTM:</b> ${fmtEUR(ttmGross)} bruto · ${fmtEUR(ttmNet)} líquido</div>
          <div><b>Yield bruto próprio:</b> ${fmtPct(grossYield)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openDividendBaseModal() {
  renderDividendBaseModal();
  openModal('modalDividendBase');
}

function formatQuoteErrorsHtml(errors) {
  if (!errors || !errors.length) return `<div class="note">Sem erros de cotação.</div>`;
  return errors.map(err => {
    const isObj = err && typeof err === "object";
    const raw = isObj ? String(err.raw || "") : String(err || "");
    const yahoo = isObj ? String(err.yahoo || "") : raw;
    const reason = isObj ? String(err.reason || "Não encontrado no Yahoo Finance") : "Não encontrado no Yahoo Finance";
    const assetName = isObj
      ? String(err.assetName || "")
      : String(((state.assets || []).find(a => String(a.ticker || a.name || "").toUpperCase() === raw.toUpperCase()) || {}).name || "");
    return `<div class="item" style="cursor:default;align-items:flex-start">
      <div class="item__l">
        <div class="item__t">${escapeHtml(assetName || raw || yahoo || "Ativo")}</div>
        <div class="item__s" style="margin-top:4px;line-height:1.5">
          <div><b>Local:</b> ${escapeHtml(raw || "—")}</div>
          <div><b>Yahoo tentado:</b> ${escapeHtml(yahoo || "—")}</div>
          <div><b>Motivo:</b> ${escapeHtml(reason || "Erro desconhecido")}</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

let quoteErrorsInlineOpen = false;

function renderQuoteErrorsInline(forceOpen = quoteErrorsInlineOpen) {
  const wrap = document.getElementById("quoteErrorsInline");
  const summary = document.getElementById("quoteErrorsInlineSummary");
  const list = document.getElementById("quoteErrorsInlineList");
  if (!wrap || !summary || !list) return;
  const report = (((state || {}).settings || {}).lastQuoteRefresh) || { updated:0, failed:0, errors:[] };
  const errors = Array.isArray(report.errors) ? report.errors : [];
  quoteErrorsInlineOpen = !!forceOpen && errors.length > 0;
  if (!errors.length || !quoteErrorsInlineOpen) {
    wrap.style.display = "none";
    wrap.classList.remove("is-open");
    list.innerHTML = "";
    summary.textContent = "";
    return;
  }
  wrap.style.display = "";
  wrap.classList.add("is-open");
  summary.textContent = `${report.updated || 0} actualizado${(report.updated || 0) !== 1 ? "s" : ""} · ${errors.length} erro${errors.length !== 1 ? "s" : ""}`;
  list.innerHTML = errors.map(err => {
    const isObj = err && typeof err === "object";
    const raw = isObj ? String(err.raw || "") : String(err || "");
    const yahoo = isObj ? String(err.yahoo || "") : raw;
    const reason = isObj ? String(err.reason || "Não encontrado no Yahoo Finance") : "Não encontrado no Yahoo Finance";
    const assetName = isObj ? String(err.assetName || raw || yahoo || "Ativo") : raw;
    return `<div class="quote-errors-inline__item">
      <div class="quote-errors-inline__item-title">${escapeHtml(assetName || raw || yahoo || "Ativo")}</div>
      <div class="quote-errors-inline__item-meta">
        <div><b>Local:</b> ${escapeHtml(raw || "—")}</div>
        <div><b>Yahoo tentado:</b> ${escapeHtml(yahoo || "—")}</div>
        <div><b>Motivo:</b> ${escapeHtml(reason || "Erro desconhecido")}</div>
      </div>
    </div>`;
  }).join("");
}

function updateQuoteErrorIndicator() {
  const btn = document.getElementById('btnQuoteErrors');
  if (!btn) return;
  const report = (((state || {}).settings || {}).lastQuoteRefresh) || null;
  if (!report || !Array.isArray(report.errors) || !report.errors.length) {
    btn.style.display = 'none';
    btn.textContent = '⚠️ Ver erros';
    renderQuoteErrorsInline(false);
    return;
  }
  btn.style.display = '';
  btn.textContent = `⚠️ ${report.errors.length} erro${report.errors.length !== 1 ? 's' : ''}`;
  btn.title = 'Ver detalhes dos erros de cotação';
  showQuoteErrors(report.updated || 0, report.failed || report.errors.length || 0, report.errors || [], report.updated || 0, report.failed || report.errors.length || 0);
  renderQuoteErrorsInline(quoteErrorsInlineOpen);
}

// Populate the quote errors modal
// Populate the quote errors modal
function showQuoteErrors(updated, failed, errors, updatedCount, failedCount) {
  const summary = document.getElementById("quoteErrorsSummary");
  const list = document.getElementById("quoteErrorsList");
  if (!summary || !list) return;
  summary.textContent = `${updatedCount} actualizado${updatedCount !== 1 ? "s" : ""} com sucesso · ${failedCount} falha${failedCount !== 1 ? "s" : ""}`;
  list.innerHTML = formatQuoteErrorsHtml(errors);
}


// Toast that can be tapped to trigger an action
function toastClickable(msg, onClick, duration = 5000) {
  let el = document.getElementById("toastEl");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastEl";
    el.style.cssText = "position:fixed;bottom:140px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 20px;border-radius:20px;font-weight:700;font-size:14px;z-index:999;max-width:90vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .3s;cursor:pointer;pointer-events:auto";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  el.style.cursor = "pointer";
  // Remove old listener and add new
  const newEl = el.cloneNode(true);
  el.parentNode.replaceChild(newEl, el);
  newEl.textContent = msg;
  newEl.style.opacity = "1";
  newEl.style.cursor = "pointer";
  newEl.style.pointerEvents = "auto";
  newEl.style.bottom = "140px";
  if (onClick) newEl.addEventListener("click", onClick);
  clearTimeout(newEl._t);
  newEl._t = setTimeout(() => { newEl.style.opacity = "0"; }, duration);
}


/* ─── DUPLICATE DETECTION ─────────────────────────────────────────────────── */
function checkDuplicateWarning() {
  const card = document.getElementById("dupWarningCard");
  if (!card) return;
  // v19: Ignorar transações geradas pela importação de corretoras.
  // Pagamentos recorrentes (dividendos mensais iguais, etc.) NÃO são duplicados reais.
  const manualTx = (state.transactions || []).filter(t => !t.generatedFromBroker);
  if (manualTx.length < 10) {
    card.style.display = "none";
    return;
  }
  // Detectar duplicados: mesmo dia + mesmo valor + mesma categoria + mesmas notas aparecendo 2+ vezes
  // (usa chave mais específica para evitar falsos positivos com transações legítimas repetidas)
  const counts = {};
  for (const tx of manualTx) {
    const k = [
      String(tx.date||"").slice(0,10),
      Math.round(Math.abs(parseNum(tx.amount))*100),
      String(tx.category||"").toLowerCase(),
      String(tx.notes||"").toLowerCase().slice(0,40)
    ].join("|");
    counts[k] = (counts[k] || 0) + 1;
  }
  // Só mostrar aviso se houver MESMA combinação exata 3+ vezes
  const hasDups = Object.values(counts).some(v => v >= 3);
  card.style.display = hasDups ? "" : "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  try { await requestPersistentStorage(); } catch (e) { console.error("Persistent storage init falhou", e); }
  try { state = await loadStateAsync(); } catch (e) {
    console.error("Falha ao carregar estado; a usar estado por defeito.", e);
    state = safeClone(DEFAULT_STATE);
  }
  try {
    let changed = false;
    if (migrateDividendRecords()) changed = true;
    const bd = ensureBrokerData();
    if ((bd.files||[]).length || (bd.events||[]).length || (bd.positions||[]).length) {
      const sig = getBrokerDataSignature();
      const prevSig = (((state || {}).settings || {}).brokerRebuildSig) || "";
      const prevSchema = parseInt((((state || {}).settings || {}).brokerRebuildSchemaVersion) || 0, 10) || 0;
      if (!hasBrokerGeneratedMirror() || sig !== prevSig || prevSchema !== BROKER_REBUILD_SCHEMA_VERSION) {
        rebuildBrokerGeneratedData();
        if (!state.settings) state.settings = {};
        state.settings.brokerRebuildSig = sig;
        state.settings.brokerRebuildSchemaVersion = BROKER_REBUILD_SCHEMA_VERSION;
        changed = true;
      }
    }
    autoSyncDivSummariesFromImportedData();
    if (pruneGeneratedDividendSummaries()) changed = true;
    if (changed) await saveStateAsync();
  } catch (e) { console.error("Falha na reconciliação inicial dos dividendos/corretoras", e); }
  // v18: Chart.js global defaults — animações reduzidas para performance
  try {
    if (typeof Chart !== "undefined") {
      Chart.defaults.animation = { duration: 400, easing: "easeOutQuart" };
      Chart.defaults.font.family = "inherit";
      Chart.defaults.responsive = true;
      Chart.defaults.maintainAspectRatio = false;
    }
  } catch (_) {}
  try { if (syncBrokerAssetDividendYieldsFromRecords()) await saveStateAsync(); } catch (e) { console.error("Falha ao sincronizar dividendos das posições", e); }
  try { ensureAllChartCanvasesReady(); } catch (e) { console.error("Falha ao preparar gráficos", e); }
  try { wire(); } catch (e) { console.error("Falha no binding dos botões", e); }
  try { renderAll(); } catch (e) { console.error("Falha no render inicial", e); }
  // v18: diferir tarefas não-críticas para depois do primeiro render
  setTimeout(() => {
    try { autoSnapshotIfNeeded(); } catch (e) { console.error("Falha no auto snapshot", e); }
    try { checkAndNotifyMaturities(); } catch (e) { console.error("Falha nas notificações de vencimento", e); }
  }, 500);
  window.openDividendBaseModal = openDividendBaseModal;
  window.setDividendYieldDisplayMode = setDividendYieldDisplayMode;
  window.applyPreferredDividendYieldToProjection = applyPreferredDividendYieldToProjection;
  window.renderDividends = renderDividends;
  window.renderAllocationPanel = renderAllocationPanel;
  window.setAllocationPreset = setAllocationPreset;
  window._allocPreset = _allocPreset;
});

// Guarantee state is saved when app goes to background or is closed
// Critical for iOS PWA where the process can be killed without warning
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveStateAsync();
});
window.addEventListener("pagehide", () => saveStateAsync());
window.addEventListener("beforeunload", () => saveStateAsync());

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 ADDITIONS
   Aplicadas sobre v14 real (5566 linhas)
   ═══════════════════════════════════════════════════════════════ */

/* ─── EXPORT CSV / XLSX ────────────────────────────────────── */
function downloadText(content, filename, mimeType) {
  const BOM = mimeType.includes("csv") ? "\uFEFF" : "";
  const blob = new Blob([BOM + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function exportCashflowCSV() {
  const gran = ($("cfGranularity") && $("cfGranularity").value) || "month";
  const y = ($("cfYear") && $("cfYear").value) || String(new Date().getFullYear());
  const m = $("cfMonth") ? String($("cfMonth").value).padStart(2,"0") : "01";
  let txs;
  if (gran === "all") txs = state.transactions.slice();
  else if (gran === "year") txs = expandRecurring(state.transactions).filter(t => String(t.date||"").slice(0,4) === y);
  else { const key = `${y}-${m}`; txs = expandRecurring(state.transactions).filter(t => monthKeyFromDateISO(t.date) === key); }
  txs = txs.sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const header = ["Data","Tipo","Categoria","Valor (EUR)","Recorrente","Notas"];
  const rows = txs.map(t => [t.date||"", t.type==="in"?"Entrada":"Saída", t.category||"", parseNum(t.amount).toFixed(2), t.recurring||"none", (t.notes||"").replace(/"/g,"'")]);
  const csv = [header,...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  const label = gran==="all" ? "completo" : gran==="year" ? y : `${y}_${m}`;
  downloadText(csv, `balanco_${label}.csv`, "text/csv;charset=utf-8;");
  toast("CSV exportado.");
}

function exportPortfolioCSV() {
  const header = ["Tipo","Classe","Nome","Valor (EUR)","Tipo Yield","Yield Valor","Valorização Esperada %","Capitalização","Vencimento","Custo Aquis.","Notas"];
  const rows = [
    ...state.assets.map(a => ["Ativo", a.class||"", a.name||"", parseNum(a.value).toFixed(2), a.yieldType||"none", parseNum(a.yieldValue).toFixed(4), hasExplicitAppreciationPct(a) ? parseNum(a.appreciationPct).toFixed(4) : "", a.compoundFreq||"", a.maturityDate||"", parseNum(a.costBasis||0).toFixed(2), (a.notes||"").replace(/"/g,"'")]),
    ...state.liabilities.map(l => ["Passivo", l.class||"", l.name||"", parseNum(l.value).toFixed(2), "","","","","","", (l.notes||"").replace(/"/g,"'")])
  ];
  const csv = [header,...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  downloadText(csv, `portfolio_${isoToday()}.csv`, "text/csv;charset=utf-8;");
  toast("Portfólio CSV exportado.");
}

function exportPortfolioXLSX() {
  if (typeof XLSX === "undefined") { toast("XLSX não disponível."); return; }
  const t = calcTotals();
  const assetRows = state.assets.map(a => ({ Tipo:"Ativo", Classe:a.class||"", Nome:a.name||"", "Valor EUR":parseNum(a.value), "Tipo Yield":a.yieldType||"none", "Yield Valor":parseNum(a.yieldValue), "Valorização Esperada %": hasExplicitAppreciationPct(a) ? parseNum(a.appreciationPct) : "", "Capitalização":a.compoundFreq||"", Vencimento:a.maturityDate||"", "Custo Aquis.":parseNum(a.costBasis||0), "Rend. Anual EUR":passiveFromItem(a), Notas:a.notes||"" }));
  const liabRows = state.liabilities.map(l => ({ Tipo:"Passivo", Classe:l.class||"", Nome:l.name||"", "Valor EUR":parseNum(l.value), "Tipo Yield":"","Yield Valor":"","Capitalização":"",Vencimento:"","Custo Aquis.":0,"Rend. Anual EUR":0, Notas:l.notes||"" }));
  const txRows = state.transactions.map(tx => ({ Data:tx.date||"", Tipo:tx.type==="in"?"Entrada":"Saída", Categoria:tx.category||"", "Valor EUR":parseNum(tx.amount), Recorrente:tx.recurring||"none", Notas:tx.notes||"" }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...assetRows,...liabRows]), "Portfólio");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), "Movimentos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Métrica:"Ativos Total", Valor:t.assetsTotal },
    { Métrica:"Passivos Total", Valor:t.liabsTotal },
    { Métrica:"Património Líquido", Valor:t.net },
    { Métrica:"Rendimento Passivo Anual", Valor:t.passiveAnnual },
    { Métrica:"Data Exportação", Valor:isoToday() }
  ]), "Resumo");
  XLSX.writeFile(wb, `patrimonio_${isoToday()}.xlsx`);
  toast("Excel exportado.");
}

/* ─── AUTO-SNAPSHOT MENSAL ─────────────────────────────────── */
function autoSnapshotIfNeeded() {
  const thisMonth = isoToday().slice(0,7);
  const last = state.history.slice().sort((a,b) => String(b.dateISO).localeCompare(String(a.dateISO)))[0];
  if (last && String(last.dateISO||"").slice(0,7) === thisMonth) return;
  if (!state.assets.length) return;
  const t = calcTotals();
  state.history.push({ dateISO:isoToday(), net:t.net, assets:t.assetsTotal, liabilities:t.liabsTotal, passiveAnnual:t.passiveAnnual, auto:true });
  saveState();
}

/* ─── NOTIFICAÇÕES PUSH ─────────────────────────────────────── */
async function requestNotifications() {
  if (!("Notification" in window)) { toast("Notificações não suportadas."); return; }
  const p = await Notification.requestPermission();
  if (p === "granted") { toast("✅ Notificações ativadas."); checkAndNotifyMaturities(); }
  else toast("❌ Notificações bloqueadas.");
}

function checkAndNotifyMaturities() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = isoToday();
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7ISO = in7.toISOString().slice(0,10);
  state.assets.filter(a => a.maturityDate && a.maturityDate >= today && a.maturityDate <= in7ISO).forEach(a => {
    const days = Math.round((new Date(a.maturityDate) - new Date()) / 86400000);
    new Notification("⏰ Vencimento — Património Familiar", { body:`${a.name}: vence em ${days} dia${days!==1?"s":""} (${a.maturityDate}) · ${fmtEUR(parseNum(a.value))}`, icon:"icon192.png", tag:`mat_${a.id}` });
  });
}

/* ─── PARSERS BANCÁRIOS ADICIONAIS ─────────────────────────── */
function detectBankFormat(text) {
  const h = String(text||"").slice(0,800).toLowerCase();
  if (h.includes("caixa geral") || h.includes("cgd") || h.includes("caixadirecta")) return "cgd";
  if (h.includes("millennium") || h.includes("millenniumbcp")) return "millennium";
  if (h.includes("novo banco") || h.includes("novobanco")) return "novobanco";
  if (h.includes("montepio")) return "montepio";
  if (/\bbpi\b/.test(h)) return "bpi";
  if (h.includes("santander")) return "santander";
  return "generic";
}

function parseMillenniumCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const parts = raw.trim().split(/[;\t]/);
    if (parts.length < 4) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const debit = parseNum(String(parts[2]||"").replace(/\s/g,""));
    const credit = parseNum(String(parts[3]||"").replace(/\s/g,""));
    if (debit > 0) out.push({date:iso, desc, amount:-debit});
    else if (credit > 0) out.push({date:iso, desc, amount:credit});
  }
  return out;
}

function parseCGDCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[;\t]/);
    if (parts.length < 3) continue;
    const dm = String(parts[0]).match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const desc = String(parts[1]||"").trim();
    const val = parseNum(String(parts[2]||"").replace(/\s/g,""));
    if (val !== 0) out.push({date:iso, desc, amount:val});
  }
  return out;
}

function parseNovoBancoCSV(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    const parts = raw.trim().split(";");
    if (parts.length < 3) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const val = parseNum(String(parts[2]||"").replace(/\s|\u00A0/g,""));
    if (val !== 0) out.push({date:iso, desc, amount:val});
  }
  return out;
}

function parseMontepioBPI(text) {
  const out = [];
  for (const raw of String(text||"").split(/\r?\n/)) {
    if (!/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/.test(raw)) continue;
    const parts = raw.trim().split(/[;\t]/);
    if (parts.length < 4) continue;
    const dm = String(parts[0]).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!dm) continue;
    const iso = `${dm[3]}-${String(dm[2]).padStart(2,"0")}-${String(dm[1]).padStart(2,"0")}`;
    const desc = String(parts[1]||"").trim();
    const debit = parseNum(String(parts[2]||"").replace(/\s/g,""));
    const credit = parseNum(String(parts[3]||"").replace(/\s/g,""));
    if (debit > 0) out.push({date:iso, desc, amount:-debit});
    else if (credit > 0) out.push({date:iso, desc, amount:credit});
  }
  return out;
}

/* ─── CUSTO DE AQUISIÇÃO & MAIS-VALIA ───────────────────────── */
function calcGainLoss(asset) {
  const cb = parseNum(asset.costBasis);
  const cur = parseNum(asset.value);
  if (!cb || cb <= 0) return null;
  const gain = cur - cb;
  return { costBasis:cb, currentVal:cur, gain, gainPct:(gain/cb)*100, irsEst:gain>0?gain*0.28:0 };
}

function renderGainLossBadge(asset) {
  const gl = calcGainLoss(asset);
  if (!gl) return "";
  const sign = gl.gain >= 0 ? "+" : "";
  const col = gl.gain >= 0 ? "#059669" : "#dc2626";
  return ` <span style="color:${col};font-size:11px;font-weight:700">${sign}${fmtPct(gl.gainPct)}</span>`;
}

/* ─── IRS ESTIMADO ───────────────────────────────────────────── */
function renderIRSCard() {
  const el = document.getElementById("irsEstCard");
  if (!el) return;
  const now = new Date();
  const yearStart = now.getFullYear() + "-01-01";
  const divYTD = (state.dividends||[]).filter(d=>d.date>=yearStart).reduce((s,d)=>s+getDividendGross(d),0);
  const rendasYTD = state.assets.filter(a=>a.yieldType==="rent_month").reduce((s,a)=>s+parseNum(a.yieldValue)*now.getMonth(),0);
  const latentGains = state.assets.map(a=>calcGainLoss(a)).filter(Boolean).filter(g=>g.gain>0).reduce((s,g)=>s+g.gain,0);
  const taxDiv = divYTD*0.28, taxRendas = rendasYTD*0.28, taxGains = latentGains*0.28;
  const total = taxDiv + taxRendas;
  if (total < 1 && taxGains < 1) { el.style.display="none"; return; }
  el.style.display="";
  const s = id => { const e=document.getElementById(id); return { set: v => { if(e) e.textContent=v; } }; };
  s("irsEstDiv").set(fmtEUR(taxDiv));
  s("irsEstRendas").set(fmtEUR(taxRendas));
  s("irsEstGains").set(fmtEUR(taxGains));
  s("irsEstTotal").set(fmtEUR(total));
}

/* ─── SNAPSHOT: APAGAR INDIVIDUALMENTE ─────────────────────── */
function deleteSnapshot(dateISO) {
  if (!confirm(`Apagar snapshot de ${dateISO}?`)) return;
  state.history = state.history.filter(h => h.dateISO !== dateISO);
  saveState();
  renderDashboard();
  toast("Snapshot apagado.");
}

function renderSnapshotTable() {
  const el = document.getElementById("snapshotTable");
  if (!el) return;
  const h = state.history.slice().sort((a,b) => String(b.dateISO).localeCompare(String(a.dateISO)));
  if (!h.length) { el.innerHTML=`<div class="item" style="cursor:default"><div class="item__l"><div class="item__t">Sem snapshots</div><div class="item__s">Usa "Registar mês" para criar.</div></div></div>`; return; }
  const SNAP_LIMIT = 10;
  if (!window._snapExpanded) window._snapExpanded = false;
  const shown = window._snapExpanded ? h : h.slice(0, SNAP_LIMIT);
  el.innerHTML = shown.map(s => {
    const auto = s.auto ? `<span class="badge badge--blue" style="font-size:10px">auto</span>` : "";
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(s.dateISO)} ${auto}</div>
        <div class="item__s">Ativos ${fmtEUR(parseNum(s.assets))} · Passivos ${fmtEUR(parseNum(s.liabilities||0))} · Rend. ${fmtEUR(parseNum(s.passiveAnnual||0))}/ano</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item__v">${fmtEUR(parseNum(s.net))}</div>
        <button onclick="deleteSnapshot('${escapeHtml(s.dateISO)}')" style="border:0;background:#fee2e2;color:#dc2626;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:13px;font-weight:700" title="Apagar snapshot">✕</button>
      </div>
    </div>`;
  }).join("");
  if (h.length > SNAP_LIMIT) {
    const btn = document.createElement("div");
    btn.style.cssText = "text-align:center;margin-top:10px";
    btn.innerHTML = `<button class="btn btn--ghost btn--sm" style="font-size:13px">
      ${window._snapExpanded ? "▲ Ver menos" : "▼ Ver mais (" + h.length + ")"}
    </button>`;
    btn.querySelector("button").addEventListener("click", () => {
      window._snapExpanded = !window._snapExpanded;
      renderSnapshotTable();
    });
    el.appendChild(btn);
  }
}

/* ─── TAXA DE JURO REAL (Fisher) ────────────────────────────── */
function realRate(nominalPct, inflationPct) {
  return ((1 + nominalPct/100) / (1 + inflationPct/100) - 1) * 100;
}

/* ─── PRINT / PDF ────────────────────────────────────────────── */
function printDashboard() { window.print(); }

/* ─── WIRE V15: botões extra ────────────────────────────────── */
(function wireV15() {
  // Aguardar DOM pronto
  const init = () => {
    if (window.__PF_WIRE_V15_DONE) return;
    window.__PF_WIRE_V15_DONE = true;
    const b = id => document.getElementById(id);
    if (b("btnExportCashflowCSV")) b("btnExportCashflowCSV").addEventListener("click", exportCashflowCSV);
    if (b("btnExportPortfolioCSV")) b("btnExportPortfolioCSV").addEventListener("click", exportPortfolioCSV);
    if (b("btnExportPortfolioXLSX")) b("btnExportPortfolioXLSX").addEventListener("click", exportPortfolioXLSX);
    if (b("btnEnableNotifications")) b("btnEnableNotifications").addEventListener("click", requestNotifications);
    if (b("btnPrintDashboard")) b("btnPrintDashboard").addEventListener("click", printDashboard);
    // Actualizar estado botão notificações
    if (b("btnEnableNotifications") && typeof Notification !== "undefined" && Notification.permission === "granted") {
      b("btnEnableNotifications").textContent = "🔔 Notificações ativas";
      b("btnEnableNotifications").disabled = true;
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 PARTE 2
   Novas funcionalidades: Saúde Financeira, Risco, E-se?, Fiscal
   ═══════════════════════════════════════════════════════════════ */

/* ─── SAÚDE FINANCEIRA (rácios) ─────────────────────────────── */
function renderHealthRatios(rc) {
  const el = document.getElementById("debtRatioContent");
  if (!el) return;

  const t = rc ? rc.totals : calcTotals();
  if (t.assetsTotal === 0) { el.innerHTML = "<div class='note'>Sem ativos registados.</div>"; return; }

  // v18: skip render if key values unchanged (evita reflow desnecessário)
  const _hrHash = `${t.assetsTotal}|${t.liabsTotal}|${t.passiveAnnual}|${t.passiveAnnualReal||0}|${t.passiveAnnualProjected||0}|${(state.transactions||[]).length}|${JSON.stringify(getReturnSettings())}`;
  if (renderHealthRatios._lastHash === _hrHash) return;
  renderHealthRatios._lastHash = _hrHash;

  const debtRatio = t.liabsTotal / t.assetsTotal * 100;
  const leverageRatio = t.assetsTotal / Math.max(1, t.net);
  const py = rc ? rc.py : calcPortfolioYield();
  const passiveAnnualReal = parseNum(t.passiveAnnualReal != null ? t.passiveAnnualReal : t.passiveAnnual);
  const passiveAnnualProjectedFromTotals = parseNum(t.passiveAnnualProjected != null ? t.passiveAnnualProjected : t.passiveAnnual);
  const passiveRatioActual = t.assetsTotal > 0 ? (passiveAnnualReal / t.assetsTotal * 100) : 0;
  const directProjectedAnnual = (state.assets || []).reduce((sum, a) => {
    const v = parseNum(a && a.value);
    if (v <= 0) return sum;
    return sum + v * (getAssetPassiveRatePct(a, { allowClassFallback: true }) / 100);
  }, 0);
  const helperProjectedAnnual = parseNum(py && py.projectedPassiveAnnual);
  const passiveAnnualProjected = Math.max(passiveAnnualProjectedFromTotals, directProjectedAnnual, helperProjectedAnnual, 0);
  const passiveRatioProjected = t.assetsTotal > 0 ? (passiveAnnualProjected / t.assetsTotal * 100) : 0;
  const passiveRatio = passiveRatioProjected > 0 ? passiveRatioProjected : passiveRatioActual;

  // Fluxo mensal médio (últimos 6 meses)
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7); if (!d) continue;
    const cur = byMonth.get(d) || { in: 0, out: 0 };
    if (tx.type === "in") cur.in += parseNum(tx.amount);
    else if (tx.type === "out") cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const last6 = [...byMonth.keys()].sort().slice(-6);
  const avgMonthlyExp = last6.length ? last6.reduce((s, k) => s + (byMonth.get(k).out || 0), 0) / last6.length : 0;
  const avgMonthlyIn = last6.length ? last6.reduce((s, k) => s + (byMonth.get(k).in || 0), 0) / last6.length : 0;
  const monthsOfRunway = avgMonthlyExp > 0 ? t.net / avgMonthlyExp : null;
  const savingsRate = avgMonthlyIn > 0 ? Math.max(0, ((avgMonthlyIn - avgMonthlyExp) / avgMonthlyIn) * 100) : null;
  const passiveCoverage = avgMonthlyExp > 0 ? (passiveAnnualProjected / (avgMonthlyExp * 12)) * 100 : null;

  // Liquidez imediata = Liquidez + Depósitos / despesas médias mensais
  const liquidAssets = state.assets
    .filter(a => {
      const k = assetClassKey(a);
      return k === "liquidez" || k === "depositos";
    })
    .reduce((s, a) => s + parseNum(a.value), 0);
  const liquidMonths = avgMonthlyExp > 0 ? liquidAssets / avgMonthlyExp : null;

  const semaforo = (val, good, ok) => val <= good ? "🟢" : val <= ok ? "🟡" : "🔴";
  const semaforoInv = (val, good, ok) => val >= good ? "🟢" : val >= ok ? "🟡" : "🔴";

  // ── Sugestões contextuais ──────────────────────────────────────────────
  const tips = [];

  // Dívida
  if (debtRatio > 60) tips.push({ icon:"⚠️", color:"#dc2626", bg:"#fef2f2",
    title:"Dívida elevada",
    text:`O teu rácio de dívida é ${fmt(debtRatio,1)}% dos activos. Acima de 60% é território de risco: uma queda no valor dos activos pode tornar o teu balanço negativo. Prioriza amortizar o passivo mais caro (normalmente crédito ao consumo).` });
  else if (debtRatio > 30) tips.push({ icon:"💡", color:"#d97706", bg:"#fffbeb",
    title:"Dívida moderada",
    text:`Rácio de dívida de ${fmt(debtRatio,1)}%. Nível aceitável, mas existe margem de melhoria. Se a taxa do crédito habitação > 3,5%, considera amortizações parciais antecipadas.` });
  else tips.push({ icon:"✅", color:"#059669", bg:"#f0fdf4",
    title:"Dívida controlada",
    text:`Rácio de dívida de ${fmt(debtRatio,1)}% — excelente. O teu balanço é robusto e tens capacidade para suportar uma queda nos activos sem entrar em território negativo.` });

  // Fundo de emergência (liquidez)
  if (liquidMonths !== null) {
    if (liquidMonths < 3) tips.push({ icon:"🚨", color:"#dc2626", bg:"#fef2f2",
      title:"Fundo de emergência insuficiente",
      text:`Tens apenas ${fmt(liquidMonths,1)} meses de despesas em liquidez. O mínimo recomendado são 3–6 meses. Em caso de perda de emprego ou despesa inesperada ficarias sem almofada. Prioridade: acumular ${fmtEUR(Math.max(0,(3-liquidMonths)*avgMonthlyExp))} em conta poupança ou DP com acesso imediato.` });
    else if (liquidMonths < 6) tips.push({ icon:"💡", color:"#d97706", bg:"#fffbeb",
      title:"Fundo de emergência razoável",
      text:`Tens ${fmt(liquidMonths,1)} meses de despesas acessíveis. Está na margem — o ideal são 6 meses para uma família. Aumenta progressivamente até ${fmtEUR(6*avgMonthlyExp)}.` });
    else if (liquidMonths > 24) tips.push({ icon:"💡", color:"#6366f1", bg:"#f5f3ff",
      title:"Excesso de liquidez",
      text:`Tens ${fmt(liquidMonths,1)} meses em liquidez — acima do necessário. O capital ocioso perde poder de compra com a inflação. Considera investir o excedente (acima de 6–12 meses) em activos com melhor rendimento.` });
    else tips.push({ icon:"✅", color:"#059669", bg:"#f0fdf4",
      title:"Fundo de emergência sólido",
      text:`${fmt(liquidMonths,1)} meses de despesas em liquidez. Boa almofada de segurança.` });
  }

  // Taxa de poupança
  if (savingsRate !== null) {
    if (savingsRate < 10) tips.push({ icon:"🚨", color:"#dc2626", bg:"#fef2f2",
      title:"Taxa de poupança baixa",
      text:`Apenas ${fmtPct(savingsRate)} das entradas ficam retidas. Abaixo de 10% é difícil construir riqueza ao longo do tempo. Identifica as 3 categorias de maior despesa e testa reduzir cada uma 15%.` });
    else if (savingsRate < 20) tips.push({ icon:"💡", color:"#d97706", bg:"#fffbeb",
      title:"Poupança abaixo do ideal",
      text:`Taxa de poupança de ${fmtPct(savingsRate)}. A regra dos 20% (regra 50/30/20) é um bom alvo. Aumentar ${fmtPct(20-savingsRate)} liberaria ${fmtEUR(avgMonthlyIn*(20-savingsRate)/100)}/mês para investir.` });
    else tips.push({ icon:"✅", color:"#059669", bg:"#f0fdf4",
      title:"Boa taxa de poupança",
      text:`${fmtPct(savingsRate)} das entradas são poupadas — acima da regra dos 20%. Mantém a disciplina e garante que esse dinheiro é efectivamente investido.` });
  }

  // Rendimento passivo
  if (passiveRatio < 2) tips.push({ icon:"💡", color:"#6366f1", bg:"#f5f3ff",
    title:"Rendimento passivo baixo",
    text:`O teu portfólio gera apenas ${fmtPct(passiveRatio)} de rendimento passivo anual sobre os activos. Considera re-alocar parte do capital para activos geradores de rendimento: depósitos a prazo, ETFs de dividendos, PPR ou obrigações.` });
  else if (passiveRatio >= 4) tips.push({ icon:"✅", color:"#059669", bg:"#f0fdf4",
    title:"Rendimento passivo forte",
    text:`${fmtPct(passiveRatio)} de rendimento passivo sobre activos totais. O portfólio trabalha para ti de forma eficaz.` });

  // Cobertura passiva das despesas
  if (passiveCoverage !== null && passiveCoverage >= 100) tips.push({ icon:"🏆", color:"#059669", bg:"#f0fdf4",
    title:"Independência financeira atingida!",
    text:`O teu rendimento passivo projectado (${fmtEUR(passiveAnnualProjected/12)}/mês) já cobre ${fmtPct(passiveCoverage)} das despesas mensais. Estás na zona de independência financeira (FIRE).` });

  // Construir o HTML das métricas
  const metricCard = (icon, label, value, sub, colorVal, tip) => `
    <div class="health-metric-card" style="background:var(--card2);border-radius:var(--r-sm);padding:12px 14px;border:1px solid var(--line);position:relative">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;line-height:1.3">${icon} ${label}</div>
      </div>
      <div style="font-size:22px;font-weight:900;color:${colorVal};line-height:1;margin-bottom:3px">${value}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.4">${sub}</div>
      ${tip ? `<div class="health-tip-inline" style="margin-top:8px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:7px;line-height:1.5">${tip}</div>` : ""}
    </div>`;

  const debtTip = debtRatio > 60
    ? "Prioriza amortizar o passivo mais caro"
    : debtRatio > 30 ? "Margem de melhoria: amortizações antecipadas" : "Balanço robusto ✓";
  const passiveTip = passiveRatio < 2
    ? `Projectado ${fmtPct(passiveRatio)} (${fmtEUR(passiveAnnualProjected || 0)}/ano) · real actual ${fmtPct(passiveRatioActual)} (${fmtEUR(passiveAnnualReal)}/ano) · considera reforçar activos geradores de rendimento`
    : passiveRatio >= 4 ? `Projectado ${fmtPct(passiveRatio)} (${fmtEUR(passiveAnnualProjected || 0)}/ano) · real actual ${fmtPct(passiveRatioActual)} (${fmtEUR(passiveAnnualReal)}/ano) · portfólio a gerar rendimento sólido ✓` : `Projectado ${fmtPct(passiveRatio)} (${fmtEUR(passiveAnnualProjected || 0)}/ano) · real actual ${fmtPct(passiveRatioActual)} (${fmtEUR(passiveAnnualReal)}/ano) · margem para optimização`;
  const savingsTip = savingsRate === null ? "" : savingsRate < 10
    ? "Revê as 3 maiores categorias de despesa"
    : savingsRate < 20 ? "Alvo: 20% — faltam "+fmtPct(20-savingsRate) : "Mantém a disciplina de poupança ✓";
  const leverageTip = leverageRatio > 3 ? "Risco de alavancagem elevado" : leverageRatio > 1.5 ? "Alavancagem moderada — monitoriza" : "Alavancagem baixa ✓";
  const runwayTip = monthsOfRunway === null ? "" : monthsOfRunway < 6
    ? "Urgente: aumentar liquidez ou reduzir passivos"
    : monthsOfRunway < 24 ? "Fundo de emergência a crescer ✓" : "Net worth cobre muitos anos de despesas ✓";
  const liquidTip = liquidMonths === null ? "" : liquidMonths < 3
    ? "🚨 Crítico: acumula 3–6 meses de despesas em DP/poupança"
    : liquidMonths < 6 ? "Aumenta até 6 meses de reserva" : liquidMonths > 24 ? "Excesso — investe o excedente" : "Reserva sólida ✓";

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      ${metricCard("🏦", "Rácio dívida/activos",
        fmt(debtRatio,1)+"%",
        "Passivos ÷ activos totais · &lt;30% excelente · &lt;60% aceitável",
        debtRatio<=30?"#059669":debtRatio<=60?"#d97706":"#dc2626", debtTip)}
      ${metricCard("💰", "Rendimento passivo",
        fmtPct(passiveRatio),
        `Valor principal = yield passivo projectado sobre activos · real actual ${fmtPct(passiveRatioActual)} · proj. ${fmtEUR(passiveAnnualProjected || 0)}/ano · real ${fmtEUR(passiveAnnualReal)}/ano · cálculo directo por activo/classe · &gt;4% excelente · &gt;2% adequado`,
        passiveRatio>=4?"#059669":passiveRatio>=2?"#d97706":"#94a3b8", passiveTip)}
      ${metricCard("💼", "Taxa de poupança",
        savingsRate!==null?fmtPct(savingsRate):"—",
        "Poupança ÷ entradas (últ. 6 meses) · alvo ≥20%",
        savingsRate===null?"#94a3b8":savingsRate>=20?"#059669":savingsRate>=10?"#d97706":"#dc2626", savingsTip)}
      ${metricCard("⚖️", "Alavancagem",
        fmt(leverageRatio,2)+"×",
        "Activos ÷ net worth · &lt;1,5× baixa · &lt;3× moderada",
        leverageRatio<=1.5?"#059669":leverageRatio<=3?"#d97706":"#dc2626", leverageTip)}
      ${metricCard("🛡️", "Autonomia financeira",
        monthsOfRunway?fmt(monthsOfRunway,0)+" meses":"—",
        "Net worth ÷ despesas/mês · alvo ≥24 meses",
        monthsOfRunway?(monthsOfRunway>=24?"#059669":monthsOfRunway>=6?"#d97706":"#dc2626"):"#94a3b8", runwayTip)}
      ${metricCard("🏧", "Reserva de liquidez",
        liquidMonths!==null?fmt(liquidMonths,0)+" meses":"—",
        "Liquidez+depósitos ÷ despesas/mês · alvo 3–12 meses",
        liquidMonths!==null?(liquidMonths>=6?"#059669":liquidMonths>=3?"#d97706":"#dc2626"):"#94a3b8", liquidTip)}
    </div>

    ${passiveCoverage !== null ? `
    <div style="margin-bottom:14px;background:var(--card2);border-radius:var(--r-sm);padding:12px 14px;border:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
        <span style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">🎯 Cobertura passiva das despesas</span>
        <span style="font-weight:900;font-size:15px;color:${passiveCoverage>=100?"#059669":passiveCoverage>=50?"#d97706":"#94a3b8"}">${fmt(Math.min(passiveCoverage,999),1)}%</span>
      </div>
      <div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:6px">
        <div style="height:8px;background:${passiveCoverage>=100?"#059669":passiveCoverage>=50?"#f59e0b":"#6366f1"};border-radius:4px;width:${Math.min(100,passiveCoverage)}%;transition:width .8s"></div>
      </div>
      <div style="font-size:11px;color:var(--muted)">
        ${passiveCoverage>=100
          ? `🏆 Independência financeira atingida! O rendimento passivo projectado (${fmtEUR(passiveAnnualProjected/12)}/mês) cobre as tuas despesas.`
          : `Rendimento passivo projectado cobre ${fmt(passiveCoverage,1)}% das despesas mensais. Faltam ${fmtEUR(Math.max(0,(avgMonthlyExp - passiveAnnualProjected/12)))} /mês para atingir independência.`}
      </div>
    </div>` : ""}

    ${tips.length ? `
    <div style="margin-bottom:4px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">💡 Sugestões de melhoria</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${tips.map(t => `
        <div style="background:${t.bg};border-left:3px solid ${t.color};border-radius:var(--r-sm);padding:10px 12px">
          <div style="font-weight:800;color:${t.color};font-size:13px;margin-bottom:3px">${t.icon} ${t.title}</div>
          <div style="font-size:12px;color:#475569;line-height:1.55">${t.text}</div>
        </div>`).join("")}
    </div>` : ""}`;
}

/* ─── ALERTAS DE CONCENTRAÇÃO DE RISCO ─────────────────────── */
function renderRiskAlerts(rc) {
  const card = document.getElementById("riskAlertCard");
  const content = document.getElementById("riskAlertContent");
  if (!card || !content) return;

  const t = rc ? rc.totals : calcTotals();
  if (t.assetsTotal === 0) { card.style.display = "none"; return; }

  const alerts = [];

  // Concentração por ativo individual
  for (const a of state.assets) {
    const pct = parseNum(a.value) / t.assetsTotal * 100;
    if (pct >= 40) alerts.push({ label: `${a.name}`, pct, tipo: "Ativo individual", severity: pct >= 60 ? "alta" : "média" });
  }

  // Concentração por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }
  for (const [cls, val] of Object.entries(byClass)) {
    const pct = val / t.assetsTotal * 100;
    if (pct >= 50) alerts.push({ label: `Classe: ${cls}`, pct, tipo: "Classe de activo", severity: pct >= 70 ? "alta" : "média" });
  }

  if (!alerts.length) { card.style.display = "none"; return; }
  card.style.display = "";

  content.innerHTML = alerts.map(a => {
    const col = a.severity === "alta" ? "#dc2626" : "#d97706";
    const bg = a.severity === "alta" ? "#fef2f2" : "#fffbeb";
    return `<div class="item" style="cursor:default;background:${bg}">
      <div class="item__l">
        <div class="item__t" style="color:${col}">${escapeHtml(a.label)}</div>
        <div class="item__s">${escapeHtml(a.tipo)} · Concentração ${a.severity}</div>
      </div>
      <div class="item__v" style="color:${col};font-weight:900">${fmt(a.pct, 1)}%</div>
    </div>`;
  }).join("");
}

/* ─── SIMULADOR "E SE?" ─────────────────────────────────────── */
function runWhatIf() {
  const pctInput = parseNum((document.getElementById("whatIfPct") || {}).value || "-20");
  const result = document.getElementById("whatIfResult");
  if (!result) return;

  const t = calcTotals();
  if (t.assetsTotal === 0) { toast("Sem activos para simular."); return; }

  // Calcular impacto por classe (só activos de mercado são afectados)
  const MARKET_CLASSES = ["Ações/ETFs", "Cripto", "Ouro", "Prata", "Fundos", "Obrigações"];
  const STABLE_CLASSES = ["Imobiliário", "Depósitos", "PPR", "Liquidez"];

  let marketVal = 0, stableVal = 0, otherVal = 0;
  for (const a of state.assets) {
    const v = parseNum(a.value);
    const cls = a.class || "Outros";
    if (MARKET_CLASSES.some(c => cls.includes(c.split("/")[0]))) marketVal += v;
    else if (STABLE_CLASSES.some(c => cls.includes(c.split("/")[0]))) stableVal += v;
    else otherVal += v;
  }

  const factor = pctInput / 100;
  const marketLoss = marketVal * factor; // negativo se queda
  const newAssetsTotal = t.assetsTotal + marketLoss;
  const newNet = t.net + marketLoss;
  const netChange = newNet - t.net;

  const col = netChange >= 0 ? "#059669" : "#dc2626";
  const sign = netChange >= 0 ? "+" : "";
  const arrow = netChange >= 0 ? "▲" : "▼";

  result.style.display = "";
  result.innerHTML = `
    <div style="padding:14px;background:${netChange >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:14px">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">
        Cenário: <b>${pctInput >= 0 ? "+" : ""}${pctInput}%</b> nos activos de mercado
        (${fmtEUR(marketVal)} afectados de ${fmtEUR(t.assetsTotal)} totais)
      </div>
      <div class="kpiRow">
        <div class="kpi"><div class="kpi__k">Activos totais</div><div class="kpi__v">${fmtEUR(newAssetsTotal)}</div><div class="kpi__s" style="color:${col}">${sign}${fmtEUR(marketLoss)}</div></div>
        <div class="kpi"><div class="kpi__k">Net worth</div><div class="kpi__v" style="color:${col}">${fmtEUR(newNet)}</div><div class="kpi__s" style="color:${col}">${sign}${fmtEUR(netChange)}</div></div>
        <div class="kpi"><div class="kpi__k">Impacto</div><div class="kpi__v" style="color:${col}">${sign}${fmtPct(netChange / Math.max(1, t.net) * 100)}</div><div class="kpi__s">do net worth</div></div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:8px">
        💡 Imóveis, depósitos, PPR e liquidez (${fmtEUR(stableVal)}) não são afectados neste cenário.
      </div>
    </div>`;
}

/* ─── RESUMO FISCAL COMPLETO ────────────────────────────────── */
function renderFiscalPanel() {
  const el = document.getElementById("fiscalContent");
  if (!el) return;

  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;

  // 1. Dividendos
  const divs = (state.dividends || []).filter(d => d.date >= yearStart);
  const divGross = divs.reduce((s, d) => s + getDividendGross(d), 0);
  const divTaxPaid = divs.reduce((s, d) => s + parseNum(d.taxWithheld || 0), 0);
  const divNet = divs.reduce((s, d) => s + getDividendNet(d), 0);
  const divTaxDueRaw = Math.max(0, divGross * 0.28 - divTaxPaid);

  // Usar resumo anual se existir
  const summary = (state.divSummaries || []).find(s => s.year === year);
  const divGrossFinal = summary ? parseNum(summary.gross) : divGross;
  const divTaxFinal = summary ? parseNum(summary.tax) : divTaxPaid;
  const divNetFinal = summary ? Math.max(0, divGrossFinal - divTaxFinal) : divNet;
  const divTaxDue = Math.max(0, divGrossFinal * 0.28 - divTaxFinal);

  // 2. Rendas
  const rendasAcum = state.assets
    .filter(a => a.yieldType === "rent_month")
    .reduce((s, a) => s + parseNum(a.yieldValue) * now.getMonth(), 0); // meses já passados

  // 3. Mais-valias latentes (não realizadas — informativo)
  const latentGains = state.assets
    .map(a => calcGainLoss(a)).filter(Boolean)
    .reduce((s, g) => ({ gains: s.gains + Math.max(0, g.gain), losses: s.losses + Math.max(0, -g.gain) }),
      { gains: 0, losses: 0 });

  // 4. Mais-valias realizadas (movimentos de cashflow com categoria "Venda activo" — se registadas)
  const realizedGains = state.transactions
    .filter(t => t.date >= yearStart && (t.category || "").toLowerCase().includes("venda"))
    .reduce((s, t) => s + (t.type === "in" ? parseNum(t.amount) : -parseNum(t.amount)), 0);

  const totalTax = divTaxFinal + rendasAcum * 0.28;

  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:12px">Ano ${year} — estimativa simplificada (taxa fixa 28%)</div>

    <!-- Dividendos -->
    <div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">💰 Dividendos</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Bruto recebido</span><span>${fmtEUR(divGrossFinal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Retenção na fonte (já paga)</span><span style="color:#dc2626">-${fmtEUR(divTaxFinal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Líquido recebido</span><span style="color:#059669">${fmtEUR(divNetFinal)}</span></div>
      ${divTaxDue > 0 ? `<div style="margin-top:6px;padding:6px 10px;background:#fef2f2;border-radius:8px;font-size:13px;color:#dc2626">⚠️ IRS adicional estimado a entregar: <b>${fmtEUR(divTaxDue)}</b></div>` : ""}
    </div>

    <!-- Rendas -->
    ${rendasAcum > 0 ? `<div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">🏠 Rendas recebidas (est. ${now.getMonth()} meses)</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Rendas acumuladas</span><span>${fmtEUR(rendasAcum)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>IRS estimado (28%)</span><span style="color:#dc2626">-${fmtEUR(rendasAcum * 0.28)}</span></div>
    </div>` : ""}

    <!-- Mais-valias -->
    <div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
      <div style="font-weight:700;margin-bottom:6px">📈 Mais-valias latentes (não realizadas)</div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Ganhos latentes</span><span style="color:#059669">${fmtEUR(latentGains.gains)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>Perdas latentes</span><span style="color:#dc2626">-${fmtEUR(latentGains.losses)}</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">Só são tributáveis quando realizadas (vendas).</div>
      ${latentGains.gains > 0 ? `<div style="font-size:12px;color:#92400e;margin-top:4px">Se realizadas: IRS estimado <b>${fmtEUR(latentGains.gains * 0.28)}</b></div>` : ""}
    </div>

    <!-- Total estimado -->
    <div style="padding:12px 0">
      <div style="font-weight:700;font-size:16px;display:flex;justify-content:space-between">
        <span>Total IRS estimado ${year}</span>
        <span style="color:#dc2626">${fmtEUR(totalTax)}</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">
        Estimativa muito simplificada. Não considera deduções, retenções especiais, IRS englobado, ou escalões progressivos.
        Consulta sempre um Técnico Oficial de Contas.
      </div>
    </div>`;
}

function exportFiscalCSV() {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;
  const divs = (state.dividends || []).filter(d => d.date >= yearStart);
  const header = ["Data","Activo","Dividendo Bruto (EUR)","Retenção (EUR)","Líquido (EUR)"];
  const rows = divs.map(d => [d.date||"", d.assetName||"", getDividendGross(d).toFixed(2), parseNum(d.taxWithheld||0).toFixed(2), getDividendNet(d).toFixed(2)]);
  const csv = [header,...rows].map(r => r.map(c=>`"${c}"`).join(";")).join("\n");
  downloadText(csv, `fiscal_${year}.csv`, "text/csv;charset=utf-8;");
  toast("Resumo fiscal exportado.");
}

/* v15: FIRE custom params lidos directamente em renderFire via window._fireCustomR/Inf */

/* ─── WIRE v15 PARTE 2 ───────────────────────────────────────── */
(function wireV15b() {
  const init = () => {
    if (window.__PF_WIRE_V15B_DONE) return;
    window.__PF_WIRE_V15B_DONE = true;
    // Simulador E-se?
    const btnWI = document.getElementById("btnWhatIf");
    if (btnWI) btnWI.addEventListener("click", runWhatIf);

    // Enter no campo E-se
    const wiInput = document.getElementById("whatIfPct");
    if (wiInput) wiInput.addEventListener("keydown", e => { if (e.key === "Enter") runWhatIf(); });

    // Export fiscal
    const btnFisc = document.getElementById("btnExportFiscal");
    if (btnFisc) btnFisc.addEventListener("click", exportFiscalCSV);

    // FIRE custom inputs — wired via wire() principal

    // Nota: renderFiscalPanel é chamada directamente em renderAnalysis quando tab === "fiscal"
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* v15: renderHealthRatios e renderRiskAlerts chamados directamente em renderDashboard */

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v15 PARTE 3
   Funcionalidades adicionais: DCA tracker, histórico poupança,
   alerta DP próximo do vencimento, net worth milestone
   ═══════════════════════════════════════════════════════════════ */

/* ─── HISTÓRICO DE TAXA DE POUPANÇA (últimos 12 meses) ──────── */
function calcSavingsHistory() {
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7);
    if (!d) continue;
    const cur = byMonth.get(d) || { in: 0, out: 0 };
    if (tx.type === "in") cur.in += parseNum(tx.amount);
    else cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const keys = [...byMonth.keys()].sort().slice(-12);
  return keys.map(k => {
    const { in: inc, out } = byMonth.get(k);
    const net = inc - out;
    const rate = inc > 0 ? Math.max(0, net / inc * 100) : 0;
    return { month: k, in: inc, out, net, rate };
  });
}

/* ─── DCA (Dollar-Cost Averaging) TRACKER ──────────────────── */
function calcDCA(assetId) {
  // Calcula preço médio ponderado das compras do asset via transacções marcadas como "Compra"
  const buys = state.transactions.filter(t =>
    t.type === "in" &&
    (t.category || "").toLowerCase().includes("compra") &&
    t.assetRef === assetId
  );
  if (!buys.length) return null;
  const totalSpent = buys.reduce((s, t) => s + parseNum(t.amount), 0);
  const totalUnits = buys.reduce((s, t) => s + parseNum(t.units || 0), 0);
  return { totalSpent, totalUnits, avgPrice: totalUnits > 0 ? totalSpent / totalUnits : 0, count: buys.length };
}

/* ─── METAS / MILESTONES DE NET WORTH ───────────────────────── */
function renderMilestones() {
  const el = document.getElementById("milestonesContent");
  const card = document.getElementById("milestonesCard");
  if (!el) return;

  const t = _rc ? _rc.totals : calcTotals();
  const net = t.net;
  if (net <= 0) { if (card) card.style.display = "none"; return; }
  if (card) card.style.display = "";

  const milestones = [
    { val: 10000,   label: "10K€",   emoji: "🌱" },
    { val: 25000,   label: "25K€",   emoji: "🌿" },
    { val: 50000,   label: "50K€",   emoji: "🌳" },
    { val: 100000,  label: "100K€",  emoji: "💎" },
    { val: 250000,  label: "250K€",  emoji: "🏆" },
    { val: 500000,  label: "500K€",  emoji: "🚀" },
    { val: 1000000, label: "1M€",    emoji: "👑" },
  ];

  const nextMilestone = milestones.find(m => m.val > net);
  const lastAchieved  = [...milestones].reverse().find(m => m.val <= net);

  el.innerHTML = milestones.map(m => {
    const done = net >= m.val;
    const active = nextMilestone && m.val === nextMilestone.val;
    const pct = active ? Math.min(100, net / m.val * 100) : done ? 100 : 0;
    const falta = active ? m.val - net : 0;

    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;opacity:${done || active ? 1 : 0.4}">
      <div style="font-size:24px;width:32px;text-align:center">${done ? m.emoji : active ? "⏳" : "○"}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;color:${done ? "#059669" : active ? "#6366f1" : "#94a3b8"}">${m.label}</div>
        ${active ? `<div style="height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:4px">
          <div style="height:5px;background:#6366f1;border-radius:3px;width:${pct}%;transition:width .6s"></div>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${fmtPct(pct)} · faltam ${fmtEUR(falta)}</div>` : ""}
      </div>
      <div style="font-size:18px">${done ? "✅" : ""}</div>
    </div>`;
  }).join("");
}

/* ─── ALERTAS DE DEPÓSITOS A PRAZO PRÓXIMO VENCIMENTO ───────── */
function renderMaturityAlerts() {
  const el = document.getElementById("maturityAlertsContent");
  if (!el) return;

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const in60 = new Date(today); in60.setDate(in60.getDate() + 60);
  const in60ISO = in60.toISOString().slice(0, 10);

  const expiring = state.assets
    .filter(a => a.maturityDate && a.maturityDate >= todayISO && a.maturityDate <= in60ISO)
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

  const alertCard = document.getElementById("maturityAlertsCard");
  if (!expiring.length) {
    if (alertCard) alertCard.style.display = "none";
    return;
  }
  if (alertCard) alertCard.style.display = "";

  el.innerHTML = expiring.map(a => {
    const days = Math.round((new Date(a.maturityDate) - today) / 86400000);
    const urgent = days <= 14;
    const col = urgent ? "#dc2626" : "#d97706";
    const bg  = urgent ? "#fef2f2" : "#fffbeb";
    const passive = passiveFromItem(a);
    return `<div style="padding:10px 12px;border-radius:12px;background:${bg};margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;color:${col}">${escapeHtml(a.name)}</div>
          <div style="font-size:12px;color:#64748b">${escapeHtml(a.class)} · ${a.maturityDate}</div>
          ${passive > 0 ? `<div style="font-size:12px;color:#059669;margin-top:2px">Rendimento: ${fmtEUR(passive)}/ano</div>` : ""}
        </div>
        <div style="text-align:right">
          <div style="font-weight:900;font-size:15px">${fmtEUR(parseNum(a.value))}</div>
          <div style="font-size:12px;font-weight:700;color:${col}">${days}d</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

/* ─── SCORE DE DIVERSIFICAÇÃO ────────────────────────────────── */
function calcDiversificationScore() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return { score: 0, label: "—", color: "#94a3b8", breakdown: [] };

  // Herfindahl-Hirschman Index (HHI) por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }
  const shares = Object.values(byClass).map(v => v / t.assetsTotal);
  const hhi = shares.reduce((s, p) => s + p * p, 0); // 0=perfeito, 1=concentrado

  // Score 0-100 (inverso do HHI)
  const nClasses = Object.keys(byClass).length;
  const score = Math.round((1 - hhi) * 100);

  const label = score >= 70 ? "Excelente" : score >= 50 ? "Boa" : score >= 30 ? "Moderada" : "Fraca";
  const color = score >= 70 ? "#059669" : score >= 50 ? "#6366f1" : score >= 30 ? "#d97706" : "#dc2626";

  const breakdown = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, val]) => ({ cls, val, pct: val / t.assetsTotal * 100 }));

  return { score, label, color, breakdown, nClasses };
}

/* ─── RENDER: PAINEL LATERAL DE QUALIDADE DO PORTFÓLIO ──────── */
function renderPortfolioQuality(rc) {
  const el = document.getElementById("portfolioQualityContent");
  const card = document.getElementById("portfolioQualityCard");
  if (!el) return;

  const div = rc ? rc.divScore : calcDiversificationScore();
  const t = rc ? rc.totals : calcTotals();

  // v18: skip se dados iguais
  const _pqHash = `${t.assetsTotal}|${t.passiveAnnual}|${div.score}`;
  if (renderPortfolioQuality._lastHash === _pqHash) return;
  renderPortfolioQuality._lastHash = _pqHash;

  // Yield coverage — rendimento passivo cobre despesas?
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date || "").slice(0, 7); if (!d) continue;
    const cur = byMonth.get(d) || { out: 0 };
    if (tx.type === "out") cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const last6 = [...byMonth.keys()].sort().slice(-6);
  const avgOut = last6.length ? last6.reduce((s, k) => s + byMonth.get(k).out, 0) / last6.length : 0;
  const coverage = avgOut > 0 ? t.passiveAnnual / (avgOut * 12) * 100 : 0;

  if (card) card.style.display = "";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #f1f5f9">
      <div style="width:56px;height:56px;border-radius:50%;background:${div.color}20;border:3px solid ${div.color};
        display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:${div.color}">
        ${div.score}
      </div>
      <div>
        <div style="font-weight:700">Diversificação: <span style="color:${div.color}">${div.label}</span></div>
        <div style="font-size:12px;color:#64748b">${div.nClasses} classe${div.nClasses !== 1 ? "s" : ""} de activos</div>
      </div>
    </div>
    <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      ${div.breakdown.slice(0, 5).map(b =>
        `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${escapeHtml(b.cls)}</span>
          <span style="font-weight:700">${fmt(b.pct, 1)}%</span>
        </div>
        <div style="height:4px;background:#f1f5f9;border-radius:2px;margin-bottom:6px;overflow:hidden">
          <div style="height:4px;background:#6366f1;width:${Math.min(100,b.pct)}%;border-radius:2px"></div>
        </div>`
      ).join("")}
    </div>
    <div style="padding:10px 0">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px">
        <span>Cobertura passiva das despesas</span>
        <span style="font-weight:700;color:${coverage >= 100 ? "#059669" : coverage >= 50 ? "#d97706" : "#dc2626"}">${fmt(Math.min(coverage, 999), 1)}%</span>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
        <div style="height:6px;background:${coverage >= 100 ? "#10b981" : "#6366f1"};width:${Math.min(100,coverage)}%;border-radius:3px;transition:width .6s"></div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — v16 PROFISSIONAL
   TWR · XIRR · Benchmark · Rebalancing · Price Alerts · Drawdown
   ═══════════════════════════════════════════════════════════════ */

/* ─── XIRR — Taxa Interna de Retorno com datas reais ────────── */
// Newton-Raphson sobre NPV para encontrar a taxa que zera os fluxos
function xirr(cashflows) {
  // cashflows: [{date: "YYYY-MM-DD", amount: number}]
  // amount positivo = investimento (saída de dinheiro = negativo para nós)
  // amount negativo = retorno (entrada)
  // convenção: cash invested = negativo, value today = positivo
  if (!cashflows || cashflows.length < 2) return null;

  const t0 = new Date(cashflows[0].date).getTime();
  const flows = cashflows.map(cf => ({
    t: (new Date(cf.date).getTime() - t0) / (365.25 * 24 * 3600 * 1000), // anos desde t0
    v: cf.amount
  }));

  // NPV(r) = sum(v_i / (1+r)^t_i)
  const npv = r => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, f.t), 0);
  const dnpv = r => flows.reduce((s, f) => s - f.t * f.v / Math.pow(1 + r, f.t + 1), 0);

  let r = 0.1; // initial guess 10%
  for (let i = 0; i < 100; i++) {
    const n = npv(r), d = dnpv(r);
    if (Math.abs(d) < 1e-12) break;
    const r2 = r - n / d;
    if (Math.abs(r2 - r) < 1e-8) { r = r2; break; }
    r = r2;
    if (!Number.isFinite(r) || Math.abs(r) > 100) return null;
  }
  return Number.isFinite(r) && Math.abs(r) < 100 ? r * 100 : null; // em %
}

function calcPortfolioXIRR() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return null;

  // Fluxos: entradas de cashflow marcadas como investimento, valor actual como retorno
  const investFlows = state.transactions
    .filter(tx => tx.type === "in" && (tx.category || "").toLowerCase().match(/poupança|investimento|depósito|compra/))
    .map(tx => ({ date: tx.date, amount: -parseNum(tx.amount) })); // saída de caixa = negativo

  if (investFlows.length === 0) return null;

  // Ordenar por data
  investFlows.sort((a, b) => a.date.localeCompare(b.date));

  // Adicionar valor actual como retorno hoje
  investFlows.push({ date: isoToday(), amount: t.net });

  return xirr(investFlows);
}

/* ─── TWR — Time-Weighted Return ────────────────────────────── */
// Elimina o efeito dos fluxos externos (depósitos/levantamentos)
// Usa os snapshots mensais como sub-períodos
function calcTWR() {
  const h = state.history
    .slice()
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));

  if (h.length < 2) return null;

  let twr = 1;
  for (let i = 1; i < h.length; i++) {
    const prev = parseNum(h[i - 1].net);
    const cur  = parseNum(h[i].net);
    if (prev <= 0) continue;

    // Estimar fluxos externos no período (poupança líquida)
    const prevISO = String(h[i - 1].dateISO).slice(0, 7);
    const curISO  = String(h[i].dateISO).slice(0, 7);
    const periodFlow = state.transactions
      .filter(tx => {
        const m = (tx.date || "").slice(0, 7);
        return m > prevISO && m <= curISO && !isInterAccountTransfer(tx);
      })
      .reduce((s, tx) => s + (tx.type === "in" ? parseNum(tx.amount) : -parseNum(tx.amount)), 0);

    // Sub-período return = (cur - flow) / prev
    const prevAdj = prev + Math.max(0, periodFlow); // adjust for external cash
    if (prevAdj <= 0) continue;
    const subReturn = (cur - periodFlow) / prevAdj;
    if (subReturn > 0) twr *= subReturn;
  }

  // Annualise
  const firstDate = new Date(h[0].dateISO);
  const lastDate  = new Date(h[h.length - 1].dateISO);
  const years = (lastDate - firstDate) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return null;

  const annualisedTWR = (Math.pow(twr, 1 / years) - 1) * 100;
  const totalTWR = (twr - 1) * 100;

  return { annualised: annualisedTWR, total: totalTWR, years: Math.round(years * 10) / 10 };
}

/* ─── BENCHMARK COMPARISON ──────────────────────────────────── */
// Retornos anuais históricos aproximados (S&P500, MSCI World, PSI20, Obrigações PT 10a)
const BENCHMARK_RETURNS = {
  "S&P 500":     { annual: 10.5, color: "#f59e0b", emoji: "🇺🇸" },
  "MSCI World":  { annual: 9.2,  color: "#6366f1", emoji: "🌍" },
  "VWCE (ETF)":  { annual: 8.8,  color: "#8b5cf6", emoji: "📊" },
  "PSI 20":      { annual: 3.2,  color: "#10b981", emoji: "🇵🇹" },
  "Ob. PT 10a":  { annual: 2.8,  color: "#64748b", emoji: "📄" },
  "Imobiliário PT": { annual: 5.5, color: "#f97316", emoji: "🏠" },
};


/* ─── PAINEL PERFORMANCE REAL ─────────────────────────────────
   Shows real broker metrics: realized P&L + dividends + true yield.
   Wired to Análise → ⚖️ Performance tab.
──────────────────────────────────────────────────────────────── */
function renderRealPerformancePanel() {
  const el = document.getElementById("benchmarkContent");
  if (!el) return;

  const m = calcPortfolioRealMetrics();
  if (!m.hasData) {
    el.innerHTML = `<div class="note">Importa os ficheiros da corretora (Importar → Corretoras) para ver a performance real do portfólio.</div>`;
    return;
  }

  // Sort sell details by date desc for the table
  const recentSells = (m.sellDetails||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,200);
  const gainSells   = recentSells.filter(s=>s.pnlEUR>0).sort((a,b)=>b.pnlEUR-a.pnlEUR);
  const lossSells   = recentSells.filter(s=>s.pnlEUR<0).sort((a,b)=>a.pnlEUR-b.pnlEUR);
  const topGains    = gainSells.slice(0,5);
  const topLosses   = lossSells.slice(0,5);

  const posCol = "#059669"; const negCol = "#dc2626";
  const gcol = m.grandTotalReturn >= 0 ? posCol : negCol;

  el.innerHTML = `
    <!-- Hero: retorno total real -->
    <div style="background:linear-gradient(135deg,${m.grandTotalReturn>=0?"#059669,#10b981":"#dc2626,#ef4444"});
      border-radius:var(--r-sm);padding:16px;margin-bottom:14px;color:#fff">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;opacity:.75;margin-bottom:8px">
        Retorno Total Real · Dados da corretora
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
        <div style="font-size:34px;font-weight:900;letter-spacing:-1px">${m.grandTotalReturn>=0?"+":""}${fmtPct(m.grandTotalReturnPct)}</div>
        <div>
          <div style="font-size:15px;font-weight:800">${m.grandTotalReturn>=0?"+":""}${fmtEUR(m.grandTotalReturn)}</div>
          <div style="font-size:10px;opacity:.7">latente + realizado + dividendos</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase">Latente</div>
          <div style="font-size:13px;font-weight:900">${m.unrealizedGain>=0?"+":""}${fmtEUR(m.unrealizedGain)}</div>
          <div style="font-size:10px;opacity:.75">${m.unrealizedGain>=0?"+":""}${fmtPct(m.unrealizedGainPct)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase">Realizado</div>
          <div style="font-size:13px;font-weight:900">${m.totalRealizedPnL>=0?"+":""}${fmtEUR(m.totalRealizedPnL)}</div>
          <div style="font-size:10px;opacity:.75">${m.sellCount} vendas</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase">Dividendos</div>
          <div style="font-size:13px;font-weight:900">+${fmtEUR(m.totalDivsNet)}</div>
          <div style="font-size:10px;opacity:.75">líquido recebido</div>
        </div>
      </div>
    </div>

    <!-- Métricas de dividendos -->
    <div style="background:var(--card2);border-radius:var(--r-sm);padding:14px;border:1px solid var(--line);margin-bottom:14px">
      <div style="font-weight:800;font-size:13px;margin-bottom:10px">💰 Dividendos — Métricas correctas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.3px">Yield TTM (base distribuidores)</div>
          <div style="font-size:22px;font-weight:900;color:#6366f1">${fmtPct(m.ttmYieldNet)}</div>
          <div style="font-size:11px;color:var(--muted)">líquido · base ${fmtEUR(m.distributingValue)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.3px">Yield TTM bruto</div>
          <div style="font-size:22px;font-weight:900;color:#8b5cf6">${fmtPct(m.ttmYieldGross)}</div>
          <div style="font-size:11px;color:var(--muted)">antes de retenção</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">TTM líquido</div>
          <div style="font-size:13px;font-weight:900;color:#059669">+${fmtEUR(m.ttmDivNet)}</div>
        </div>
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Total recebido</div>
          <div style="font-size:13px;font-weight:900;color:#6366f1">+${fmtEUR(m.totalDivsNet)}</div>
        </div>
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Retenção paga</div>
          <div style="font-size:13px;font-weight:900;color:#dc2626">-${fmtEUR(m.totalWithholding)}</div>
        </div>
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Mensal TTM</div>
          <div style="font-size:13px;font-weight:900">${fmtEUR(m.ttmDivNet/12)}</div>
        </div>
      </div>
    </div>

    <!-- Mais-valias realizadas -->
    <div style="background:var(--card2);border-radius:var(--r-sm);padding:14px;border:1px solid var(--line);margin-bottom:14px">
      <div style="font-weight:800;font-size:13px;margin-bottom:10px">📊 Mais-valias realizadas — ${m.sellCount} operações</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Ganhos</div>
          <div style="font-size:14px;font-weight:900;color:${posCol}">+${fmtEUR(m.realizedGains)}</div>
          <div style="font-size:10px;color:var(--muted)">${gainSells.length} vendas</div>
        </div>
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Perdas</div>
          <div style="font-size:14px;font-weight:900;color:${negCol}">${fmtEUR(m.realizedLosses)}</div>
          <div style="font-size:10px;color:var(--muted)">${lossSells.length} vendas</div>
        </div>
        <div style="background:var(--card);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:9px;color:var(--muted);font-weight:700">Líquido</div>
          <div style="font-size:14px;font-weight:900;color:${m.totalRealizedPnL>=0?posCol:negCol}">${m.totalRealizedPnL>=0?"+":""}${fmtEUR(m.totalRealizedPnL)}</div>
          <div style="font-size:10px;color:var(--muted)">${m.sellCount} total</div>
        </div>
      </div>
      <!-- Top gains and losses side by side -->
      ${topGains.length || topLosses.length ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;font-weight:800;color:${posCol};margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px">🏆 Melhores vendas</div>
          ${topGains.map(s=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid var(--line)">
            <span style="font-weight:700">${escapeHtml(s.ticker)}</span>
            <span style="color:${posCol};font-weight:800">+${fmtEUR(s.pnlEUR)}</span>
          </div>`).join("")}
        </div>
        <div>
          <div style="font-size:10px;font-weight:800;color:${negCol};margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px">📉 Piores vendas</div>
          ${topLosses.map(s=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid var(--line)">
            <span style="font-weight:700">${escapeHtml(s.ticker)}</span>
            <span style="color:${negCol};font-weight:800">${fmtEUR(s.pnlEUR)}</span>
          </div>`).join("")}
        </div>
      </div>` : ""}
    </div>

    <!-- Por ano: dividendos -->
    ${Object.keys(m.divByYear).length ? `
    <div style="background:var(--card2);border-radius:var(--r-sm);padding:14px;border:1px solid var(--line);margin-bottom:14px">
      <div style="font-weight:800;font-size:13px;margin-bottom:10px">📅 Dividendos por ano</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px">
          <th style="text-align:left;padding:4px 0">Ano</th>
          <th style="text-align:right;padding:4px 4px">Bruto</th>
          <th style="text-align:right;padding:4px 4px">Retenção</th>
          <th style="text-align:right;padding:4px 4px">Líquido</th>
          <th style="text-align:right;padding:4px 0">Pagamentos</th>
        </tr></thead>
        <tbody>
          ${Object.entries(m.divByYear).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,d])=>`
          <tr style="border-top:1px solid var(--line)">
            <td style="padding:6px 0;font-weight:800">${y}</td>
            <td style="padding:6px 4px;text-align:right;font-weight:700">${fmtEUR2(d.gross)}</td>
            <td style="padding:6px 4px;text-align:right;color:${negCol}">-${fmtEUR2(d.wh)}</td>
            <td style="padding:6px 4px;text-align:right;color:${posCol};font-weight:900">${fmtEUR2(d.net)}</td>
            <td style="padding:6px 0;text-align:right;color:var(--muted)">${d.count}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}`;
}
function renderBenchmarkComparison() {
  const el = document.getElementById("benchmarkContent");
  if (!el) return;

  const twr = calcTWR();
  const t = calcTotals();
  if (!twr || t.assetsTotal === 0) {
    el.innerHTML = `<div class="note">Precisas de pelo menos 2 snapshots para calcular a performance.<br>Usa "📸 Registar mês" no Dashboard.</div>`;
    return;
  }

  const portfolioReturn = twr.annualised;
  const rows = Object.entries(BENCHMARK_RETURNS).map(([name, b]) => {
    const diff = portfolioReturn - b.annual;
    const beating = diff > 0;
    return { name, annual: b.annual, color: b.color, emoji: b.emoji, diff, beating };
  }).sort((a, b) => b.annual - a.annual);

  // Chart data
  const allEntries = [
    { name: "O teu portfólio", annual: portfolioReturn, color: "#059669", emoji: "💼" },
    ...rows
  ].sort((a, b) => b.annual - a.annual);

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">
        TWR anualizado do teu portfólio:
        <span style="font-size:18px;font-weight:900;color:${portfolioReturn >= 0 ? "#059669" : "#dc2626"}">
          ${portfolioReturn >= 0 ? "+" : ""}${fmtPct(portfolioReturn)}
        </span>
        <span style="font-size:12px;color:#94a3b8">(${twr.years} anos · total ${twr.total >= 0 ? "+" : ""}${fmtPct(twr.total)})</span>
      </div>
    </div>
    ${allEntries.map(e => {
      const isPortfolio = e.name === "O teu portfólio";
      const barW = Math.max(0, Math.min(100, (e.annual + 5) / 20 * 100));
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span style="font-weight:${isPortfolio ? "900" : "600"}">${e.emoji} ${e.name}</span>
          <span style="font-weight:700;color:${e.annual >= 0 ? e.color : "#dc2626"}">${e.annual >= 0 ? "+" : ""}${fmtPct(e.annual)}/ano</span>
        </div>
        <div style="height:${isPortfolio ? 8 : 5}px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;background:${e.color};width:${barW}%;border-radius:4px;transition:width .6s"></div>
        </div>
        ${!isPortfolio ? `<div style="font-size:11px;color:${portfolioReturn > e.annual ? "#059669" : "#dc2626"};margin-top:2px">
          ${portfolioReturn > e.annual ? "▲ bates por " : "▼ ficas atrás por "} ${fmtPct(Math.abs(portfolioReturn - e.annual))}/ano
        </div>` : ""}
      </div>`;
    }).join("")}
    <div style="margin-top:12px;padding:10px;background:#f8fafc;border-radius:10px;font-size:11px;color:#94a3b8">
      ⚠️ Retornos históricos dos benchmarks são aproximações (médias longas). O TWR do portfólio pode variar consoante o período. Não é garantia de retornos futuros.
    </div>`;
}

/* ─── REBALANCING CALCULATOR ────────────────────────────────── */
// Calcula quanto comprar/vender para atingir a alocação alvo
function calcRebalancing() {
  const t = calcTotals();
  if (t.assetsTotal === 0) return [];

  // Ler targets do estado (guardado em settings)
  const targets = (state.settings && state.settings.allocationTargets) || {};

  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k] || 0) + parseNum(a.value);
  }

  return Object.entries(byClass).map(([cls, val]) => {
    const currentPct = val / t.assetsTotal * 100;
    const targetPct = parseNum(targets[cls] || 0);
    const targetVal = t.assetsTotal * targetPct / 100;
    const delta = targetVal - val;
    return { cls, val, currentPct, targetPct, targetVal, delta };
  }).filter(r => r.targetPct > 0 || r.currentPct > 0)
    .sort((a, b) => a.delta - b.delta); // mais urgentes primeiro
}

function renderRebalancing() {
  const el = document.getElementById("rebalancingContent");
  const totalEl = document.getElementById("rebalancingTotal");
  if (!el) return;

  const targets = (state.settings && state.settings.allocationTargets) || {};
  const t = calcTotals();

  if (t.assetsTotal === 0) { el.innerHTML = `<div class="note">Sem activos.</div>`; return; }

  // Se não há targets definidos, mostrar interface de configuração
  const hasSomeTarget = Object.values(targets).some(v => parseNum(v) > 0);
  if (!hasSomeTarget) {
    const byClass = {};
    for (const a of state.assets) { const k = a.class||"Outros"; byClass[k]=(byClass[k]||0)+parseNum(a.value); }
    el.innerHTML = `
      <div class="note" style="margin-bottom:12px">Define a tua <b>alocação alvo</b> por classe (total deve = 100%):</div>
      ${Object.entries(byClass).map(([cls, val]) => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <label style="flex:1;font-size:13px;font-weight:600">${escapeHtml(cls)}<br><span style="font-weight:400;color:#94a3b8">${fmtPct(val/t.assetsTotal*100)} actual</span></label>
          <input class="input" style="width:80px" inputmode="decimal" placeholder="%" id="target_${escapeHtml(cls).replace(/[^a-zA-Z0-9]/g,'_')}"
            value="${parseNum(targets[cls])||""}">
          <span style="font-size:13px;color:#94a3b8">%</span>
        </div>`).join("")}
      <button class="btn btn--primary" id="btnSaveTargets" style="width:100%;margin-top:8px">💾 Guardar alocação alvo</button>`;

    const btnSave = document.getElementById("btnSaveTargets");
    if (btnSave) btnSave.addEventListener("click", () => {
      const newTargets = {};
      for (const [cls] of Object.entries(byClass)) {
        const key = cls.replace(/[^a-zA-Z0-9]/g,'_');
        const el2 = document.getElementById("target_" + key);
        const v = parseNum(el2 ? el2.value : 0);
        if (v > 0) newTargets[cls] = v;
      }
      const total = Object.values(newTargets).reduce((s,v)=>s+v,0);
      if (Math.abs(total - 100) > 1) { toast(`Total = ${fmtPct(total)}, deve ser 100%.`); return; }
      if (!state.settings) state.settings = {};
      state.settings.allocationTargets = newTargets;
      saveState();
      renderRebalancing();
      toast("✅ Alocação alvo guardada.");
    });
    return;
  }

  const rows = calcRebalancing();
  const totalBuy  = rows.filter(r => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const totalSell = rows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);

  if (totalEl) totalEl.innerHTML = `Comprar ${fmtEUR(totalBuy)} · Vender ${fmtEUR(totalSell)}`;

  el.innerHTML = rows.map(r => {
    const offTarget = Math.abs(r.currentPct - r.targetPct);
    const urgent = offTarget > 5;
    const action = r.delta > 0 ? "COMPRAR" : r.delta < 0 ? "VENDER" : "OK";
    const actionCol = r.delta > 0 ? "#059669" : r.delta < 0 ? "#dc2626" : "#94a3b8";
    const barCur = Math.min(100, r.currentPct);
    const barTgt = Math.min(100, r.targetPct);
    return `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <span style="font-weight:700;font-size:14px">${escapeHtml(r.cls)}</span>
          ${urgent ? `<span style="font-size:10px;background:#fef2f2;color:#dc2626;border-radius:4px;padding:1px 5px;margin-left:6px">fora do alvo</span>` : ""}
        </div>
        <div style="text-align:right">
          <span style="font-size:12px;color:${actionCol};font-weight:900">${action}</span>
          ${Math.abs(r.delta) > 1 ? `<span style="font-size:13px;font-weight:700;color:${actionCol};margin-left:6px">${fmtEUR(Math.abs(r.delta))}</span>` : ""}
        </div>
      </div>
      <div style="position:relative;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;margin-bottom:3px">
        <div style="height:8px;background:#6366f1;width:${barCur}%;border-radius:4px;transition:width .6s"></div>
        <div style="position:absolute;top:0;left:${barTgt}%;width:2px;height:8px;background:#ef4444;transform:translateX(-1px)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8">
        <span>Actual: ${fmtPct(r.currentPct)} · ${fmtEUR(r.val)}</span>
        <span>Alvo: ${fmtPct(r.targetPct)} · ${fmtEUR(r.targetVal)}</span>
      </div>
    </div>`;
  }).join("") + `
    <button class="btn btn--ghost" id="btnResetTargets" style="margin-top:10px;font-size:12px;width:100%">✏️ Redefinir alocação alvo</button>`;

  const btnReset = document.getElementById("btnResetTargets");
  if (btnReset) btnReset.addEventListener("click", () => {
    if (!state.settings) state.settings = {};
    state.settings.allocationTargets = {};
    saveState();
    renderRebalancing();
  });
}

/* ─── ALERTAS DE PREÇO ───────────────────────────────────────── */
function checkPriceAlerts() {
  const alerts = (state.settings && state.settings.priceAlerts) || [];
  if (!alerts.length) return;

  for (const a of state.assets) {
    const price = parseNum(a.value);
    for (const alert of alerts) {
      if (alert.assetId !== a.id) continue;
      const triggered =
        (alert.type === "above" && price >= alert.price) ||
        (alert.type === "below" && price <= alert.price);
      if (triggered && !alert.fired) {
        alert.fired = true;
        const msg = `${a.name}: ${alert.type === "above" ? "acima de" : "abaixo de"} ${fmtEUR(alert.price)} (actual: ${fmtEUR(price)})`;
        toast(`🔔 Alerta: ${msg}`, 6000);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("🔔 Alerta de preço — Património", { body: msg, icon: "icon192.png" });
        }
      }
    }
  }
  saveState();
}

/* ─── SIMULAÇÃO DE DRAWDOWN (pós-FIRE) ──────────────────────── */
// Simula quanto tempo dura o capital se retirar X€/ano
function calcDrawdown(capital, annualWithdrawal, returnRate, inflationRate, years) {
  if (annualWithdrawal <= 0) return { survives: true, depletedAt: null, data: [] };

  const data = [];
  let cap = capital;
  let withdrawal = annualWithdrawal;
  let depletedAt = null;

  for (let y = 0; y <= years; y++) {
    data.push({ year: y, capital: Math.max(0, cap) });
    if (cap <= 0 && !depletedAt) { depletedAt = y; }
    if (cap <= 0) continue;
    cap = cap * (1 + returnRate / 100) - withdrawal;
    withdrawal *= (1 + inflationRate / 100);
  }

  return { survives: cap > 0, depletedAt, data, finalCap: Math.max(0, cap) };
}

function renderDrawdownPanel() {
  const el = document.getElementById("drawdownContent");
  if (!el) return;

  const t = calcTotals();
  const capital = t.net;

  const wdEl  = document.getElementById("drawdownWithdrawal");
  const retEl = document.getElementById("drawdownReturn");
  const infEl = document.getElementById("drawdownInflation");
  const yrEl  = document.getElementById("drawdownYears");

  const withdrawal  = parseNum((wdEl  || {}).value) || t.passiveAnnual || 24000;
  const returnRate  = parseNum((retEl || {}).value) || 5;
  const inflationRate = parseNum((infEl || {}).value) || 2.5;
  const years = parseInt((yrEl || {}).value || "40");

  // Auto-fill se vazio
  if (wdEl && !wdEl.value) wdEl.placeholder = fmtEUR(withdrawal) + " (auto)";

  const result = calcDrawdown(capital, withdrawal, returnRate, inflationRate, years);

  const ctx = prepareChartCanvas(document.getElementById("drawdownChart"), 220);
  if (ctx && typeof Chart !== "undefined") {
    clearChartUnavailable("drawdownChart");
    if (window._drawdownChart) window._drawdownChart.destroy();
    window._drawdownChart = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        labels: result.data.map(d => d.year === 0 ? "Hoje" : `+${d.year}a`),
        datasets: [{
          label: "Capital restante",
          data: result.data.map(d => d.capital),
          borderColor: result.survives ? "#10b981" : "#ef4444",
          backgroundColor: result.survives ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.06)",
          fill: true, tension: .3, pointRadius: 0, borderWidth: 2
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `Capital: ${fmtEUR(c.raw)}` } }
        },
        scales: { y: { ticks: { callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M€" : fmtEUR(v) } } }
      }
    });
  }

  el.innerHTML = `
    <div style="padding:12px;background:${result.survives ? "#f0fdf4" : "#fef2f2"};border-radius:12px;margin-bottom:12px">
      ${result.survives
        ? `<div style="font-weight:700;color:#059669;font-size:15px">✅ O capital aguenta os ${years} anos</div>
           <div style="font-size:13px;color:#064e3b;margin-top:4px">Capital final estimado: <b>${fmtEUR(result.finalCap)}</b></div>`
        : `<div style="font-weight:700;color:#dc2626;font-size:15px">⚠️ Capital esgota-se ao ano ${result.depletedAt}</div>
           <div style="font-size:13px;color:#7f1d1d;margin-top:4px">Reduz os levantamentos ou aumenta o capital antes de te reformares.</div>`
      }
    </div>
    <div style="font-size:12px;color:#64748b">
      Capital inicial: <b>${fmtEUR(capital)}</b> · 
      Levantamento: <b>${fmtEUR(withdrawal)}/ano</b> · 
      SWR: <b>${fmtPct(withdrawal/Math.max(1,capital)*100)}</b> ·
      Retorno ${fmtPct(returnRate)} · Inflação ${fmtPct(inflationRate)}
    </div>`;
}

/* ─── WIRE v16 ───────────────────────────────────────────────── */
(function wireV16() {
  const init = () => {
    if (window.__PF_WIRE_V16_DONE) return;
    window.__PF_WIRE_V16_DONE = true;
    // Drawdown recalc
    ["drawdownWithdrawal","drawdownReturn","drawdownInflation","drawdownYears"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", renderDrawdownPanel);
    });
    // Benchmark tab
    const tab = document.getElementById("analysisTab");
    if (tab) tab.addEventListener("change", () => {
      if (tab.value === "performance") {
        renderBenchmarkComparison();
        renderRebalancing();
      }
      if (tab.value === "drawdown") renderDrawdownPanel();
    });
    // Verificar alertas de preço após actualização de cotações
    document.addEventListener("quotesUpdated", checkPriceAlerts);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PATRIMÓNIO FAMILIAR — ANÁLISE POR IA (Claude API)
   Arquitectura: app → Anthropic API /v1/messages (browser fetch)
   O utilizador precisa de introduzir a sua API key uma vez.
   Dados ficam SEMPRE locais — só o resumo vai à API.
   ═══════════════════════════════════════════════════════════════ */

/* ─── PREPARAR CONTEXTO DO PORTFÓLIO PARA A IA ──────────────── */
function buildPortfolioContext() {
  const t = calcTotals();
  const div = calcDiversificationScore();
  const twr = calcTWR();
  const irs = (() => {
    try {
      const now = new Date();
      const yearStart = now.getFullYear() + "-01-01";
      const divYTD = (state.dividends||[]).filter(d=>d.date>=yearStart).reduce((s,d)=>s+getDividendGross(d),0);
      const rendasYTD = state.assets.filter(a=>a.yieldType==="rent_month").reduce((s,a)=>s+parseNum(a.yieldValue)*now.getMonth(),0);
      return { divYTD, rendasYTD, total: (divYTD+rendasYTD)*0.28 };
    } catch { return { divYTD:0, rendasYTD:0, total:0 }; }
  })();

  // Distribuição por classe
  const byClass = {};
  for (const a of state.assets) {
    const k = a.class || "Outros";
    byClass[k] = (byClass[k]||0) + parseNum(a.value);
  }
  const classBreakdown = Object.entries(byClass)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `${k}: ${fmtEUR(v)} (${fmt(v/t.assetsTotal*100,1)}%)`)
    .join(", ");

  // Top 5 activos
  const top5 = [...state.assets]
    .sort((a,b)=>parseNum(b.value)-parseNum(a.value))
    .slice(0,5)
    .map(a => {
      const gl = calcGainLoss(a);
      const glStr = gl ? ` | PL: ${gl.gain>=0?"+":""}${fmtEUR(gl.gain)} (${fmt(gl.gainPct,1)}%)` : "";
      return `${a.name} [${a.class}]: ${fmtEUR(parseNum(a.value))}${glStr}`;
    })
    .join("\n    ");

  // Passivos
  const liabsStr = state.liabilities.length > 0
    ? state.liabilities.map(l=>`${l.name}: ${fmtEUR(parseNum(l.value))}`).join(", ")
    : "Sem passivos";

  // Cashflow últimos 3 meses
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date||"").slice(0,7); if (!d) continue;
    const cur = byMonth.get(d)||{in:0,out:0};
    if (tx.type==="in") cur.in+=parseNum(tx.amount); else cur.out+=parseNum(tx.amount);
    byMonth.set(d,cur);
  }
  const last3 = [...byMonth.keys()].sort().slice(-3);
  const avgIn  = last3.length ? last3.reduce((s,k)=>s+byMonth.get(k).in,0)/last3.length : 0;
  const avgOut = last3.length ? last3.reduce((s,k)=>s+byMonth.get(k).out,0)/last3.length : 0;
  const savingsRate = avgIn > 0 ? (avgIn-avgOut)/avgIn*100 : 0;

  // FIRE status
  const baseFireNum = avgOut*12 > 0 ? avgOut*12/0.0375 : 0;
  const firePct = baseFireNum > 0 ? Math.min(100,t.net/baseFireNum*100) : 0;

  // Vencimentos próximos
  const today = isoToday();
  const in90 = new Date(); in90.setDate(in90.getDate()+90);
  const in90ISO = in90.toISOString().slice(0,10);
  const maturities = state.assets
    .filter(a=>a.maturityDate && a.maturityDate>=today && a.maturityDate<=in90ISO)
    .map(a=>`${a.name} (${a.maturityDate}): ${fmtEUR(parseNum(a.value))}`)
    .join(", ") || "Nenhum";

  // Alertas de concentração
  const riskAlerts = [];
  for (const [cls, val] of Object.entries(byClass)) {
    const pct = val/t.assetsTotal*100;
    if (pct>=50) riskAlerts.push(`${cls}: ${fmt(pct,1)}% do portfólio (concentração elevada)`);
  }

  return `PORTFÓLIO FAMILIAR — DADOS REAIS (${isoToday()})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BALANÇO GLOBAL
  Activos totais:    ${fmtEUR(t.assetsTotal)}
  Passivos totais:   ${fmtEUR(t.liabsTotal)}
  Património líquido: ${fmtEUR(t.net)}

RENDIMENTO PASSIVO
  Anual estimado:    ${fmtEUR(t.passiveAnnual)}
  Mensal estimado:   ${fmtEUR(t.passiveAnnual/12)}
  Rendimento base:   ${fmt(t.assetsTotal>0?t.passiveAnnual/t.assetsTotal*100:0,2)}%

DISTRIBUIÇÃO POR CLASSE
  ${classBreakdown}

SCORE DE DIVERSIFICAÇÃO: ${div.score}/100 (${div.label})

TOP 5 ACTIVOS
    ${top5}

PASSIVOS
  ${liabsStr}

CASHFLOW (média 3 meses)
  Entradas médias:   ${fmtEUR(avgIn)}/mês
  Saídas médias:     ${fmtEUR(avgOut)}/mês
  Taxa de poupança:  ${fmt(savingsRate,1)}%

MÉTRICAS CHAVE
  Rácio dívida/activos: ${fmt(t.assetsTotal>0?t.liabsTotal/t.assetsTotal*100:0,1)}%
  Progresso FIRE (base): ${fmt(firePct,1)}%
  ${twr ? `TWR anualizado: ${fmt(twr.annualised,2)}% (${twr.years} anos)` : "TWR: sem histórico suficiente"}

FISCAL (${new Date().getFullYear()} YTD)
  Dividendos brutos:  ${fmtEUR(irs.divYTD)}
  IRS estimado:       ${fmtEUR(irs.total)}

VENCIMENTOS (90 dias)
  ${maturities}

ALERTAS DE RISCO
  ${riskAlerts.length ? riskAlerts.join("\n  ") : "Sem alertas de concentração"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/* ─── PROMPTS POR MODO DE ANÁLISE ───────────────────────────── */
const AI_PROMPTS = {
  geral: `És um consultor de gestão de patrimônio pessoal experiente, especializado no mercado português.
Analisa o portfólio abaixo e fornece uma análise completa e honesta em português de Portugal.

Estrutura a tua resposta EXACTAMENTE assim (usa estes emojis e títulos):

## 💪 Pontos Fortes
(2-3 pontos concretos sobre o que está bem no portfólio)

## ⚠️ Riscos & Vulnerabilidades
(2-3 riscos reais identificados com base nos dados)

## 🎯 Sugestões Prioritárias
(3-4 acções concretas e realistas, ordenadas por impacto)

## 📊 Benchmarking
(Comparar métricas chave com referências — ex: yield vs média mercado PT, taxa de poupança, etc.)

## 🔭 Perspectiva a 5 Anos
(Projecção qualitativa com base na trajectória actual)

Sê directo, usa números concretos do portfólio, evita generalidades. Máximo 600 palavras.`,

  risco: `És um gestor de risco especializado em portfólios de particulares portugueses.
Analisa os riscos do portfólio abaixo com rigor.

Estrutura assim:

## 🔴 Riscos Críticos
(Riscos que precisam de acção imediata)

## 🟡 Riscos Moderados
(Riscos a monitorizar)

## 🟢 Pontos de Resiliência
(O que protege o portfólio)

## 🛡️ Plano de Mitigação
(Acções concretas para reduzir os riscos identificados, por ordem de prioridade)

Foca em: concentração, liquidez, risco de taxa de juro, risco cambial, risco de crédito, risco imobiliário.
Máximo 500 palavras.`,

  fiscal: `És um consultor fiscal especializado em Portugal (IRS, mais-valias, dividendos).
Analisa a situação fiscal do portfólio abaixo.

Estrutura assim:

## 🧾 Situação Fiscal Actual
(Resumo do que está sujeito a tributação)

## 💡 Oportunidades de Optimização Fiscal
(Estratégias legais para reduzir carga fiscal — PPR, mais-valias, timing, etc.)

## ⚠️ Alertas Fiscais
(O que pode causar problemas com o Fisco)

## 📋 Acções Recomendadas para ${new Date().getFullYear()}
(Específico para este ano fiscal)

IMPORTANTE: Inclui sempre a nota "Consulta sempre um TOC antes de tomar decisões fiscais."
Máximo 500 palavras.`,

  fire: `És um especialista em FIRE (Financial Independence, Retire Early) com foco em Portugal.
Analisa o progresso FIRE do portfólio abaixo.

Estrutura assim:

## 🔥 Estado FIRE Actual
(Onde está em relação ao objectivo)

## 📈 Trajectória & Prazo Estimado
(Com a taxa de poupança e rendimento actuais, quando atingirá FIRE?)

## 🚀 Aceleradores
(O que pode fazer para atingir FIRE mais cedo)

## ⚡ Riscos para o Plano FIRE
(O que pode atrasar ou comprometer)

## 🌤️ FIRE Parcial / Coast FIRE
(Análise de independência parcial já possível)

Usa os dados reais de cashflow e activos. Máximo 500 palavras.`,

  rebalancing: `És um gestor de carteiras especializado em alocação de activos para investidores portugueses.
Analisa o portfólio e sugere uma estratégia de rebalancing.

Estrutura assim:

## 📊 Alocação Actual vs Ideal
(Para o perfil deste investidor, qual seria a alocação ideal? Compara com a actual)

## ⚖️ Rebalancing Sugerido
(Exactamente o que comprar/vender/reforçar, com valores aproximados)

## 🌍 Diversificação Geográfica & Sectorial
(Como melhorar a exposição geográfica e sectorial)

## 📅 Plano de Execução
(Como e quando executar o rebalancing de forma eficiente)

Considera o contexto português: fiscalidade de ETFs, PPR, depósitos, imobiliário. Máximo 500 palavras.`
};

/* ─── ENGINE DE ANÁLISE IA ───────────────────────────────────── */
let aiHistory = [];

/* ─── CONFIGURAÇÕES DOS PROVIDERS DE IA ─────────────────────── */
const AI_PROVIDERS = {
  groq: {
    name: "Groq (Gratuito)",
    emoji: "⚡",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",   // melhor modelo gratuito Groq
    keyHint: "Obtém grátis em console.groq.com",
    keyPrefix: "gsk_",
    settingKey: "groqKey",
    format: "openai"   // protocolo OpenAI-compat
  },
  anthropic: {
    name: "Claude (Anthropic)",
    emoji: "🤖",
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    keyHint: "Obtém em console.anthropic.com (pago, mais preciso)",
    keyPrefix: "sk-",
    settingKey: "anthropicKey",
    format: "anthropic"
  }
};

async function callAIProvider(provider, apiKey, systemPrompt, userMsg) {
  if (provider.format === "openai") {
    // Groq / OpenAI-compatible
    const resp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1500,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userMsg }
        ]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error("API key Groq inválida. Verifica em console.groq.com");
      if (resp.status === 429) throw new Error("Limite Groq atingido. Tenta em alguns segundos.");
      throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";

  } else {
    // Anthropic nativo
    const resp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error("API key Claude inválida. Verifica em console.anthropic.com");
      if (resp.status === 429) throw new Error("Limite Claude atingido. Tenta em alguns segundos.");
      throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.content?.[0]?.text || "";
  }
}

async function runAIAnalysis() {
  const btn = document.getElementById("btnAiAnalyse");
  const loading = document.getElementById("aiLoadingCard");
  const resultCard = document.getElementById("aiResultCard");
  const loadingMsg = document.getElementById("aiLoadingMsg");

  // Obter modo, provider e pergunta
  const modeEl = document.querySelector('input[name="aiMode"]:checked');
  const mode = modeEl ? modeEl.value : "geral";
  const question = (document.getElementById("aiQuestion") || {}).value || "";
  const providerKey = (document.querySelector('input[name="aiProvider"]:checked') || {}).value || "groq";
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.groq;

  // Obter API key do provider seleccionado
  let apiKey = (state.settings && state.settings[provider.settingKey]) || "";
  if (!apiKey) {
    apiKey = prompt(
      `${provider.emoji} Análise IA — ${provider.name}

` +
      `Introduz a tua API key.
${provider.keyHint}

` +
      `A key fica guardada localmente. Os dados do portfólio só são enviados quando carregas "Analisar".`
    );
    if (!apiKey || !apiKey.trim()) { toast("API key não introduzida."); return; }
    apiKey = apiKey.trim();
    if (!state.settings) state.settings = {};
    state.settings[provider.settingKey] = apiKey;
    saveState();
  }

  // UI: loading
  if (btn) btn.disabled = true;
  if (resultCard) resultCard.style.display = "none";
  if (loading) loading.style.display = "";

  const modeLabels = { geral:"Análise Geral", risco:"Análise de Risco", fiscal:"Análise Fiscal", fire:"Plano FIRE", rebalancing:"Rebalancing" };

  const loadingMsgs = [
    `A usar ${provider.name}…`,
    "A ler o portfólio…",
    "A identificar riscos…",
    "A gerar sugestões…",
    "A finalizar análise…"
  ];
  let msgIdx = 0;
  const msgInterval = setInterval(() => {
    if (loadingMsg) loadingMsg.textContent = loadingMsgs[Math.min(msgIdx++, loadingMsgs.length-1)];
  }, 1800);

  try {
    const context = buildPortfolioContext();
    const systemPrompt = AI_PROMPTS[mode] || AI_PROMPTS.geral;
    const userMsg = question.trim()
      ? `Dados do portfólio:

${context}

Pergunta específica: ${question}`
      : `Dados do portfólio:

${context}`;

    const text = await callAIProvider(provider, apiKey, systemPrompt, userMsg);
    if (!text) throw new Error("Resposta vazia da IA.");

    clearInterval(msgInterval);
    if (loading) loading.style.display = "none";

    // Renderizar resultado
    renderAIResult(text, modeLabels[mode] || "Análise IA", mode, question);

    // Guardar no histórico (máx 5)
    const histEntry = {
      id: uid(),
      date: isoToday(),
      mode,
      modeLabel: modeLabels[mode],
      question: question.slice(0, 80),
      text,
      netWorth: calcTotals().net
    };
    aiHistory.unshift(histEntry);
    if (aiHistory.length > 5) aiHistory.length = 5;
    renderAIHistory();

  } catch (err) {
    clearInterval(msgInterval);
    if (loading) loading.style.display = "none";
    if (resultCard) resultCard.style.display = "";

    const errEl = document.getElementById("aiResultContent");
    const titleEl = document.getElementById("aiResultTitle");
    if (titleEl) titleEl.textContent = "❌ Erro";
    if (errEl) errEl.innerHTML = `
      <div style="padding:14px;background:#fef2f2;border-radius:12px;color:#dc2626">
        <b>${escapeHtml(err.message)}</b>
        <div style="margin-top:8px;font-size:13px;color:#64748b">
          Verifica: (1) API key correcta em Definições → IA, (2) tens créditos na conta Anthropic.
        </div>
      </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderAIResult(text, title, mode, question) {
  const resultCard = document.getElementById("aiResultCard");
  const titleEl = document.getElementById("aiResultTitle");
  const metaEl = document.getElementById("aiResultMeta");
  const contentEl = document.getElementById("aiResultContent");

  if (resultCard) resultCard.style.display = "";
  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = `${isoToday()} · Portfólio ${fmtEUR(calcTotals().net)}${question ? ` · "${question.slice(0,40)}…"` : ""}`;

  // Converter Markdown simples para HTML seguro
  if (contentEl) contentEl.innerHTML = markdownToHTML(text);

  // Scroll ao resultado
  if (resultCard) resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markdownToHTML(md) {
  if (!md) return "";
  return md
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    // Headers ## → styled div
    .replace(/^## (.+)$/gm, (_, t) => `<div class="ai-section-head">${t}</div>`)
    // **bold**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // *italic*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Listas - item
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    // Agrupar <li> em <ul>
    .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
    // Parágrafos
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<)(.+)$/gm, (m, t) => t.trim() ? `<p>${t}</p>` : "")
    // Limpar duplicados
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<div|<ul)/g, "$1")
    .replace(/(<\/div>|<\/ul>)<\/p>/g, "$1");
}

function updateAIKeyStatus() {
  const groqEl = document.getElementById("groqKeyStatus");
  const anthropicEl = document.getElementById("anthropicKeyStatus");
  const groqKey = state.settings && state.settings.groqKey;
  const anthropicKey = state.settings && state.settings.anthropicKey;
  if (groqEl) groqEl.textContent = groqKey ? "✅ Key configurada" : "Sem key — será pedida ao usar";
  if (anthropicEl) anthropicEl.textContent = anthropicKey ? "✅ Key configurada" : "Sem key — será pedida ao usar";
}

function renderAIHistory() {
  const section = document.getElementById("aiHistorySection");
  const container = document.getElementById("aiHistory");
  if (!section || !container || !aiHistory.length) {
    if (section) section.style.display = "none";
    return;
  }
  section.style.display = "";
  container.innerHTML = aiHistory.map(h => `
    <div class="item" onclick="showAIHistoryEntry('${h.id}')">
      <div class="item__l">
        <div class="item__t">${escapeHtml(h.modeLabel)}</div>
        <div class="item__s">${h.date} · Net worth: ${fmtEUR(h.netWorth)}${h.question ? ` · ${escapeHtml(h.question)}` : ""}</div>
      </div>
      <div class="item__v" style="font-size:14px">Ver →</div>
    </div>`).join("");
}

function showAIHistoryEntry(id) {
  const entry = aiHistory.find(h => h.id === id);
  if (!entry) return;
  renderAIResult(entry.text, entry.modeLabel, entry.mode, entry.question);
}

/* ─── LIMPAR API KEY NAS SETTINGS ───────────────────────────── */
function clearAIKey(provider) {
  const key = provider === "anthropic" ? "anthropicKey" : "groqKey";
  const name = provider === "anthropic" ? "Claude (Anthropic)" : "Groq";
  if (!confirm(`Apagar a API key de ${name}?`)) return;
  if (state.settings) delete state.settings[key];
  saveState();
  toast(`API key de ${name} removida.`);
}

/* ─── WIRE IA ────────────────────────────────────────────────── */
(function wireAI() {
  const init = () => {
    if (window.__PF_WIRE_AI_DONE) return;
    window.__PF_WIRE_AI_DONE = true;
    const btn = document.getElementById("btnAiAnalyse");
    if (btn) btn.addEventListener("click", runAIAnalysis);

    const btnCopy = document.getElementById("btnAiCopy");
    if (btnCopy) btnCopy.addEventListener("click", () => {
      const text = document.getElementById("aiResultContent");
      if (!text) return;
      navigator.clipboard.writeText(text.innerText || text.textContent || "")
        .then(() => toast("✅ Copiado para a área de transferência."))
        .catch(() => toast("Não foi possível copiar."));
    });

    // Renderizar análise quando entra na tab
    const tab = document.getElementById("analysisTab");
    if (tab) tab.addEventListener("change", () => {
      if (tab.value === "ai") { renderAIHistory(); updateAIKeyStatus(); }
    });
    // Actualizar status quando entra nas Definições
    document.querySelectorAll(".navbtn").forEach(b => {
      if (b.dataset.view === "settings") b.addEventListener("click", () => setTimeout(updateAIKeyStatus, 100));
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   PORTFOLIO DE ACÇÕES/ETFs — P&L por posição + resumo global
   Lê Qty e PM das notas do import, compara com valor actual
   ═══════════════════════════════════════════════════════════════ */

/* ─── EXTRAIR DADOS DE POSIÇÃO DAS NOTAS ────────────────────── */
function parsePositionFromAsset(asset) {
  const notes = asset.notes || "";

  // 1. Qty — campo dedicado (guardado no import) ou das notas
  let qty = parseNum(asset.qty || 0);
  if (!qty) {
    const m = notes.match(/Qty=([\d.,]+)/);
    qty = m ? parseNum(m[1]) : 0;
  }
  if (!qty || qty <= 0) return null;

  // 2. Custo total em EUR — campo dedicado (mais fiável)
  let costBasis = parseNum(asset.costBasis || 0);

  // Fallback: qty × PM das notas
  if (!costBasis) {
    const pmMatch  = notes.match(/PM=([\d.,]+)/);
    const ccyMatch = notes.match(/PM=[\d.,]+\s+([A-Z]{3})/);
    const pm  = pmMatch  ? parseNum(pmMatch[1])  : 0;
    const ccy = ccyMatch ? ccyMatch[1] : "EUR";
    if (pm > 0) {
      const FX = { EUR:1, USD:0.92, GBP:1.17, CHF:1.05, DKK:0.134,
                   SEK:0.087, NOK:0.085, CAD:0.68, AUD:0.59, JPY:0.006 };
      costBasis = qty * pm * (FX[ccy] || 0.92); // default USD se não reconhecer
    }
  }
  if (!costBasis || costBasis <= 0) return null;

  // 3. Valor actual — campo value actualizado pelas cotações
  // Se value for 0 ou muito baixo (cotação não actualizada), estimar pelo custo
  let currentValue = parseNum(asset.value);
  const hasLivePrice = asset.lastUpdated && currentValue > 0;

  // Se não há cotação ao vivo ainda, usar o custo como valor actual (P&L = 0)
  if (!currentValue || currentValue <= 0) currentValue = costBasis;

  // Sanity check: if currentValue is >20× costBasis AND no live price today,
  // it's almost certainly a stale wrong ticker quote — fall back to cost basis
  // (avoids showing +3000% gains for Portuguese stocks fetched as US tickers)
  const todayPt = new Date().toLocaleDateString("pt-PT");
  const isStaleQuote = !asset.lastUpdated || String(asset.lastUpdated || "") !== todayPt;
  if (isStaleQuote && currentValue > costBasis * 20 && costBasis > 0) {
    currentValue = costBasis; // show P&L=0 rather than wildly wrong value
  }

  const gain = currentValue - costBasis;
  const gainPct = (gain / costBasis) * 100;
  const currentPricePerUnit = currentValue / qty;
  const costPricePerUnit = costBasis / qty;

  // Extrair PM original para mostrar
  const pmMatch2  = notes.match(/PM=([\d.,]+)/);
  const ccyMatch2 = notes.match(/PM=[\d.,]+\s+([A-Z]{3})/);
  const pm  = pmMatch2  ? parseNum(pmMatch2[1])  : costPricePerUnit;
  const ccy = ccyMatch2 ? ccyMatch2[1] : "EUR";

  return {
    qty, pm, ccy, costBasis, currentValue,
    gain, gainPct, hasLivePrice,
    currentPricePerUnit, costPricePerUnit,
    priceChange: currentPricePerUnit - costPricePerUnit,
    priceChangePct: costPricePerUnit > 0 ? (currentPricePerUnit - costPricePerUnit) / costPricePerUnit * 100 : 0
  };
}

/* ─── CALCULAR P&L GLOBAL DO PORTFÓLIO DE ACÇÕES/ETFS ───────── */
function calcEquityPortfolioPnL() {
  const equityClasses = ["Ações/ETFs", "Cripto", "Fundos"];
  const equityAssets = state.assets.filter(a =>
    equityClasses.some(c => (a.class || "").includes(c.split("/")[0]))
  );

  // Pre-index dividends by ticker for fast lookup
  const now12m = new Date();
  now12m.setFullYear(now12m.getFullYear() - 1);
  const cutoff12m = now12m.toISOString().slice(0, 10);
  buildDividendStatsIndex();

  let totalCost      = 0;
  let totalCurrent   = 0;
  let totalRealized  = 0;
  let totalDivAll    = 0;
  const positions    = [];

  for (const asset of equityAssets) {
    const pos = parsePositionFromAsset(asset);
    if (!pos) continue;

    // Realized P&L from sells (stored on asset by rebuildBrokerGeneratedData)
    const realizedPnL  = parseNum(asset.realizedPnL || 0);
    // Dividend income for this asset
    const stats = getDividendStatsForAsset(asset);
    const divData = { total12m: stats.ttmNet || 0, totalAll: stats.allNet || 0, count: stats.allCount || 0 };
    // True yield = net dividends last 12m / cost basis
    const trueYieldPct = pos.costBasis > 0 && divData.total12m > 0
      ? (divData.total12m / pos.costBasis) * 100 : 0;
    // Total return = unrealized gain + realized gain + dividends received
    const totalReturn = pos.gain + realizedPnL + divData.totalAll;
    const totalReturnPct = pos.costBasis > 0 ? (totalReturn / pos.costBasis) * 100 : 0;

    // Augment pos
    pos.realizedPnL   = realizedPnL;
    pos.divAll        = divData.totalAll;
    pos.div12m        = divData.total12m;
    pos.divCount      = divData.count;
    pos.trueYieldPct  = trueYieldPct;
    pos.totalReturn   = totalReturn;
    pos.totalReturnPct = totalReturnPct;

    totalCost     += pos.costBasis;
    totalCurrent  += pos.currentValue;
    totalRealized += realizedPnL;
    totalDivAll   += divData.totalAll;
    positions.push({ asset, pos });
  }

  const totalGain    = totalCurrent - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  // Grand total return across all positions
  const grandTotalReturn = totalGain + totalRealized + totalDivAll;
  const grandTotalReturnPct = totalCost > 0 ? (grandTotalReturn / totalCost) * 100 : 0;

  return { positions, totalCost, totalCurrent, totalGain, totalGainPct,
    totalRealized, totalDivAll, grandTotalReturn, grandTotalReturnPct };
}

/* ─── RENDER: PAINEL P&L ─────────────────────────────────────── */
function renderEquityPnL() {
  const el = document.getElementById("equityPnLContent");
  if (!el) return;

  const { positions, totalCost, totalCurrent, totalGain, totalGainPct,
    totalRealized, totalDivAll, grandTotalReturn, grandTotalReturnPct } = calcEquityPortfolioPnL();

  if (!positions.length) {
    el.innerHTML = `<div class="note">
      Sem posições com dados de custo.<br><br>
      <b>Como activar:</b> importa o CSV do ledger da corretora (Trading 212, XTB). A app calcula
      automaticamente o preço médio, P&L realizado, dividendos recebidos e yield real por posição.
    </div>`;
    return;
  }

  const posNeg = positions.filter(p => p.pos.gain < 0).length;
  const posPos = positions.filter(p => p.pos.gain >= 0).length;
  const withLive = positions.filter(p => p.pos.hasLivePrice);
  const hasDivs  = totalDivAll > 0;
  const hasReal  = Math.abs(totalRealized) > 0;

  // Sort options
  if (!window._pnlSort) window._pnlSort = "total_return";
  const sorted = [...positions].sort((a, b) => {
    if (window._pnlSort === "gain_pct")     return b.pos.gainPct - a.pos.gainPct;
    if (window._pnlSort === "yield")        return b.pos.trueYieldPct - a.pos.trueYieldPct;
    if (window._pnlSort === "realized")     return b.pos.realizedPnL - a.pos.realizedPnL;
    if (window._pnlSort === "dividends")    return b.pos.divAll - a.pos.divAll;
    return b.pos.totalReturn - a.pos.totalReturn; // default: total return
  });

  const gcol = grandTotalReturn >= 0 ? "var(--green)" : "var(--red)";
  const gsign = grandTotalReturn >= 0 ? "+" : "";

  el.innerHTML = `
    <!-- HERO: retorno total (latente + realizado + dividendos) -->
    <div style="background:linear-gradient(135deg,${grandTotalReturn >= 0 ? "#059669,#10b981" : "#dc2626,#ef4444"});
      border-radius:var(--r-sm);padding:16px 16px 14px;margin-bottom:14px;color:#fff">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;opacity:.75;margin-bottom:8px">
        Retorno Total do Portfólio
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
        <div style="font-size:36px;font-weight:900;letter-spacing:-1px;line-height:1">
          ${gsign}${fmtPct(grandTotalReturnPct)}
        </div>
        <div>
          <div style="font-size:16px;font-weight:800">${gsign}${fmtEUR(grandTotalReturn)}</div>
          <div style="font-size:11px;opacity:.7">latente + realizado + dividendos</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Investido</div>
          <div style="font-size:13px;font-weight:900;margin-top:1px">${fmtEUR(totalCost)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Latente</div>
          <div style="font-size:13px;font-weight:900;margin-top:1px">${totalGain>=0?"+":""}${fmtEUR(totalGain)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Realizado</div>
          <div style="font-size:13px;font-weight:900;margin-top:1px">${totalRealized>=0?"+":""}${fmtEUR(totalRealized)}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:7px 8px">
          <div style="font-size:9px;opacity:.75;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Dividendos</div>
          <div style="font-size:13px;font-weight:900;margin-top:1px">${totalDivAll>0?"+":""}${fmtEUR(totalDivAll)}</div>
        </div>
      </div>
      <div style="font-size:11px;opacity:.65">
        ${posPos} positiva${posPos!==1?"s":""} · ${posNeg} negativa${posNeg!==1?"s":""} · ${positions.length} posições
        ${!withLive.length ? " · ⚡ Actualiza ⟳ Cotações para valores em tempo real" : ""}
      </div>
    </div>

    <!-- Ordenar por -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <span style="font-size:11px;color:var(--muted);font-weight:700">Ordenar:</span>
      ${[
        ["total_return","Retorno total"],["gain_pct","P&L %"],
        ["realized","Realizado"],["dividends","Dividendos"],["yield","Yield"]
      ].map(([v,l]) => `<button class="btn btn--sm ${window._pnlSort===v?"btn--primary":"btn--outline"}"
        style="font-size:11px;padding:4px 8px"
        onclick="window._pnlSort='${v}';renderEquityPnL()">${l}</button>`).join("")}
    </div>

    <!-- Cabeçalho da lista -->
    <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;
      letter-spacing:.4px;margin-bottom:6px;display:grid;
      grid-template-columns:1fr auto auto auto;gap:6px;padding:0 4px">
      <span>Activo</span>
      <span style="text-align:right;min-width:70px">PM/Actual</span>
      <span style="text-align:right;min-width:65px">Divid.</span>
      <span style="text-align:right;min-width:75px">Retorno</span>
    </div>

    ${(window._pnlExpanded ? sorted : sorted.slice(0, 10)).map(({ asset, pos }) => {
      const col  = pos.totalReturn >= 0 ? "var(--green)" : "var(--red)";
      const lCol = pos.gain >= 0 ? "var(--green)" : "var(--red)";
      const barW = Math.min(100, Math.max(0, (pos.currentValue / Math.max(pos.costBasis, 1)) * 100));
      const hasDiv = pos.divAll > 0;
      const hasRz  = Math.abs(pos.realizedPnL) > 0.01;

      return `<div style="border:1px solid var(--line);border-radius:var(--r-sm);
        padding:10px 12px;margin-bottom:7px;background:var(--item-bg);
        border-left:3px solid ${col}">
        <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:6px;align-items:start">
          <!-- Nome + ticker -->
          <div style="min-width:0">
            <div style="font-weight:900;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(asset.ticker || asset.name)}
            </div>
            <div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${asset.ticker && asset.name && asset.name !== asset.ticker ? escapeHtml(asset.name.split(" — ").slice(-1)[0] || asset.name) + " · " : ""}${escapeHtml(asset.class||"")} · ${fmt(pos.qty, pos.qty < 1 ? 4 : 2)} un.
            </div>
          </div>
          <!-- PM / Preço actual -->
          <div style="text-align:right;min-width:70px">
            <div style="font-size:10px;color:var(--muted)">PM ${fmtEUR2(pos.costPricePerUnit)}</div>
            <div style="font-size:12px;font-weight:800;color:${pos.hasLivePrice?"var(--text)":"var(--muted)"}">
              ${pos.hasLivePrice ? fmtEUR2(pos.currentPricePerUnit) : "—"}
            </div>
          </div>
          <!-- Dividendos -->
          <div style="text-align:right;min-width:65px">
            ${hasDiv ? `<div style="font-size:11px;font-weight:800;color:#6366f1">${fmtEUR(pos.divAll)}</div>
              <div style="font-size:10px;color:var(--muted)">${pos.trueYieldPct>0?fmtPct(pos.trueYieldPct)+" yield":pos.divCount+" pag."}</div>` :
              `<div style="font-size:10px;color:var(--muted)">—</div>`}
          </div>
          <!-- Retorno total -->
          <div style="text-align:right;min-width:75px">
            <div style="font-size:13px;font-weight:900;color:${col}">${pos.totalReturn>=0?"+":""}${fmtEUR(pos.totalReturn)}</div>
            <div style="font-size:10px;color:${col};font-weight:700">${pos.totalReturn>=0?"+":""}${fmtPct(pos.totalReturnPct)}</div>
          </div>
        </div>
        <!-- Linha 2: decomposição latente / realizado / dividendos -->
        ${(hasRz || hasDiv || pos.gain !== 0) ? `<div style="margin-top:7px;display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--muted)">
          <span style="color:${lCol}">Latente: ${pos.gain>=0?"+":""}${fmtEUR(pos.gain)} (${pos.gain>=0?"+":""}${fmtPct(pos.gainPct)})</span>
          ${hasRz ? `<span style="color:${pos.realizedPnL>=0?"var(--green)":"var(--red)"}">Realizado: ${pos.realizedPnL>=0?"+":""}${fmtEUR(pos.realizedPnL)}</span>` : ""}
          ${hasDiv ? `<span style="color:#6366f1">Div: +${fmtEUR(pos.divAll)} · Yield 12m: ${fmtPct(pos.trueYieldPct)}</span>` : ""}
        </div>` : ""}
        <!-- Barra visual custo → actual -->
        <div style="margin-top:6px;height:3px;background:var(--line);border-radius:2px;overflow:hidden">
          <div style="height:3px;background:${lCol};width:${barW}%;border-radius:2px;transition:width .5s"></div>
        </div>
      </div>`;
    }).join("")}

    ${sorted.length > 10 ? `
    <div style="text-align:center;margin-top:10px">
      <button class="btn btn--ghost btn--sm" onclick="window._pnlExpanded=!window._pnlExpanded;renderEquityPnL()" style="font-size:13px">
        ${window._pnlExpanded ? "▲ Ver menos" : "▼ Ver mais (" + sorted.length + ")"}
      </button>
    </div>` : ""}
    <div style="font-size:11px;color:var(--muted);margin-top:10px;text-align:center">
      ${!withLive.length ? "⚡ ⟳ Cotações para P&L real em tempo real · " : ""}${positions.length} posição${positions.length!==1?"s":""}
      ${hasDivs ? " · dividendos incluídos" : ""}${hasReal ? " · P&L realizado incluído" : ""}
    </div>`;
}




/* ─── ALOCAÇÃO ALVO FIRE ─────────────────────────────────────
   Sugestão baseada na literatura FIRE portuguesa (Frugalismo PT):
   - Fase acumulação (net worth < FIRE número): crescimento agressivo
   - Fase transição (50-90% FIRE): reduz risco gradualmente
   - Fase independência (≥100% FIRE): preservação + rendimento
──────────────────────────────────────────────────────────────── */
const FIRE_ALLOCATION_PRESETS = {
  acumulacao: {
    label: "🚀 Acumulação",
    desc: "Maximiza crescimento a longo prazo. Para quem está a construir o portfólio (< 50% do número FIRE). Horizonte ≥ 10 anos. Aceita volatilidade em troca de retorno superior.",
    firePhase: "< 50% FIRE",
    expectedReturn: "7–9%/ano histórico",
    classes: [
      { class:"Ações/ETFs",        pct:60,
        tip:"ETF global diversificado",
        rationale:"O motor principal da carteira. Historicamente 8–10%/ano a longo prazo. Recomendado: VWCE (FTSE All-World Acc) ou FWRG para exposição global com acumulação automática. Evita stockpicking — 80% dos gestores ativos falham bater o índice a 10 anos.",
        examples:"VWCE · FWRG · IWDA+EMIM · VT",
        riskReturn:"Alto risco / Alto retorno" },
      { class:"Imobiliário",       pct:15,
        tip:"Imóvel arrendado ou REIT",
        rationale:"Rendimento passivo estável + valorização. Em PT, rendas tributadas a 28% (taxa especial). REITs alternativa sem gestão directa. Limite a 15–20%: concentração geográfica e iliquidez são riscos reais.",
        examples:"Imóvel PT · REIT ETF (VNQ, IQQP) · Fundos imobiliários",
        riskReturn:"Médio risco / Médio-alto retorno" },
      { class:"PPR",               pct:10,
        tip:"Benefício fiscal PT",
        rationale:"Dedução IRS até 400€/ano (< 35 anos) a 20%. Em 30 anos equivale a +1–2% de retorno extra anualizado. Usa PPR com componente de acções (> 70% ações) enquanto tens horizonte longo. Resgata após 60 anos ou reforma sem penalização.",
        examples:"PPR Invest (GNB) · PPR Save (Optimize) · PPR carteira própria",
        riskReturn:"Baixo-médio risco / Médio retorno" },
      { class:"Depósitos a prazo", pct:5,
        tip:"Fundo de emergência",
        rationale:"3–6 meses de despesas em liquidez IMEDIATA. Não é investimento — é segurança. Garante que nunca tens de vender acções em bear market. Com taxas atuais 3–4% são atraentes mas mantém reduzido.",
        examples:"DP CGD · DP BCP · Conta poupança Santander/Novobanco",
        riskReturn:"Sem risco / Retorno baixo" },
      { class:"Metais Preciosos",  pct:5,
        tip:"Hedge inflação e colapso sistémico",
        rationale:"Ouro descorrelaciona com acções em crises. 5% é o consenso Bogleheads: suficiente para amortecer, insuficiente para arrastar o portfólio. Ouro físico (lingotes/moedas) ou ETC PHAU/IGLN sem custo de custódia excessivo.",
        examples:"Ouro físico · PHAU (ETC) · IGLN · SGLD",
        riskReturn:"Médio risco / Retorno moderado" },
      { class:"Obrigações/Fundos", pct:5,
        tip:"Amortecedor de volatilidade",
        rationale:"Em fase de acumulação, 5% é suficiente como amortecedor. Obrigações soberanas PT/EU de curta duração (< 5 anos) para não ter risco de taxa de juro elevado. Reavalia para 10–15% à medida que te aproximas da reforma.",
        examples:"VGEA (ETF obrig. EU) · BTP IT · Obrig. PT Tesouro Direto",
        riskReturn:"Baixo risco / Retorno baixo-médio" },
    ]
  },
  transicao: {
    label: "⚖️ Transição",
    desc: "Equilíbrio crescimento vs segurança. Entre 50–90% do número FIRE. Horizonte 5–10 anos. Começa a construir fontes de rendimento passivo.",
    firePhase: "50–90% FIRE",
    expectedReturn: "5–7%/ano",
    classes: [
      { class:"Ações/ETFs",        pct:45,
        tip:"Ainda o motor, mais defensivo",
        rationale:"Reduz exposição a acções de crescimento puro. Adiciona componente de dividendos (VHYL, TDIV) para gerar cashflow sem vender. Mantém base de ETF global mas complementa com 10–15% de ETFs de dividendos.",
        examples:"VWCE · VHYL · TDIV · Acções dividendo PT/EU",
        riskReturn:"Alto risco / Alto retorno" },
      { class:"Imobiliário",       pct:20,
        tip:"Rendimento passivo real",
        rationale:"Aumenta imobiliário para fonte de rendimento estável. Ideal se já tens imóvel arrendado — as rendas cobrem parte das despesas. REITs europeus para diversificação sem gestão.",
        examples:"Imóvel PT arrendado · REIT ETF · Fundos imobiliários fechados",
        riskReturn:"Médio risco / Médio retorno" },
      { class:"Obrigações/Fundos", pct:15,
        tip:"Sequência de retornos adversos",
        rationale:"O risco mais crítico perto da reforma é vender acções em crash para pagar despesas. Obrigações de qualidade funcionam como 'guardar 2 anos de despesas' e permite não tocar nas acções em bear markets.",
        examples:"VGEA · Obrig. soberanas EU · BTP IT 3–5 anos",
        riskReturn:"Baixo risco / Retorno baixo" },
      { class:"PPR",               pct:10,
        tip:"Fase pré-reforma",
        rationale:"Mantém PPR mas muda perfil para conservador (50% acções). Perto dos 60 anos o benefício fiscal de resgate começa a ser relevante. Planeia resgate faseado para otimização fiscal.",
        examples:"PPR conservador · PPR moderado",
        riskReturn:"Baixo-médio risco / Médio retorno" },
      { class:"Depósitos a prazo", pct:5,
        tip:"Liquidez táctica",
        rationale:"Mantém 1–2 anos de despesas em liquidez. Em transição, começa a construir 'runway' para os primeiros anos após reforma — tempo suficiente para recuperar de crash.",
        examples:"DP 6–12 meses · Conta poupança",
        riskReturn:"Sem risco / Retorno baixo" },
      { class:"Metais Preciosos",  pct:5,
        tip:"Descorrelação e hedge",
        rationale:"Mantém 5%. Nesta fase, ouro como seguro de carteira é ainda mais valioso — crises de mercado acontecem em média cada 7–10 anos.",
        examples:"Ouro físico · PHAU · IGLN",
        riskReturn:"Médio risco / Moderado" },
    ]
  },
  independencia: {
    label: "🏖️ Independência",
    desc: "Preservação + rendimento. Portfólio atingiu o número FIRE. Foco em cashflow previsível e protecção contra inflação a 30+ anos.",
    firePhase: "≥ 100% FIRE",
    expectedReturn: "4–6%/ano",
    classes: [
      { class:"Ações/ETFs",        pct:35,
        tip:"Crescimento para bater inflação",
        rationale:"35% em acções é o mínimo para que o portfólio cresça acima da inflação a 30 anos. Regra 4% pressupõe que activos crescem. Concentra em ETFs de dividendos (VHYL, TDIV) para cashflow sem necessidade de vender.",
        examples:"VHYL · TDIV · ETF dividendos globais · Acções PT/EU rendimento",
        riskReturn:"Alto risco / Alto retorno longo prazo" },
      { class:"Imobiliário",       pct:25,
        tip:"Cashflow previsível",
        rationale:"Rendas cobrem 30–40% das despesas mensais. O imobiliário é o activo que melhor protege contra inflação a longo prazo em PT. Garante que dividendos de acções não são o único rendimento passivo.",
        examples:"Imóvel PT arrendado · 2+ imóveis · REIT ETF",
        riskReturn:"Médio risco / Médio-alto retorno" },
      { class:"Obrigações/Fundos", pct:20,
        tip:"Laddering para cashflow",
        rationale:"Laddering de obrigações: compra obrigações que vencem em anos consecutivos (1, 2, 3... anos). Garante cashflow previsível sem vender activos. Obrigações PT Tesouro Direto até 5 anos são ideais (sem custo de gestão).",
        examples:"Tesouro Direto PT · Obrigações EU 1–5 anos · VGEA",
        riskReturn:"Baixo risco / Retorno baixo-médio" },
      { class:"PPR",               pct:10,
        tip:"Desacumulação com vantagem fiscal",
        rationale:"Resgate do PPR após 60 anos: apenas 8% de tributação (vs 28% normal). Planeia resgates anuais até esgotar — optimização fiscal significativa ao longo da reforma.",
        examples:"PPR conservador em fase de resgate",
        riskReturn:"Baixo risco / Retorno baixo" },
      { class:"Depósitos a prazo", pct:5,
        tip:"Runway de 2 anos",
        rationale:"1–2 anos de despesas em liquidez IMEDIATA. O mais importante dos FIRE: nunca venderes acções em crash. Repõe após cada ano de despesas. Com taxas 3–4%, o custo de oportunidade é aceitável.",
        examples:"DP renovável anual · Conta poupança instantânea",
        riskReturn:"Sem risco / Retorno baixo" },
      { class:"Metais Preciosos",  pct:5,
        tip:"Reserva de última instância",
        rationale:"Gold como seguro contra colapso sistémico, hiperinflação ou crise de dívida soberana PT/EU. Em 30 anos de reforma, a probabilidade de pelo menos 1 crise sistémica é alta. 5% é barato para este seguro.",
        examples:"Ouro físico (lingotes/moedas) · PHAU",
        riskReturn:"Médio risco / Moderado" },
    ]
  }
};

let _allocPreset = "acumulacao";
let _allocCustom = null; // user overrides

function setAllocationPreset(phase, opts = {}) {
  const { persist = false, rerender = true } = opts || {};
  if (!phase || !FIRE_ALLOCATION_PRESETS[phase]) return false;
  _allocPreset = phase;
  window._allocPreset = phase;
  if (!state.settings) state.settings = {};
  state.settings.allocationPreset = phase;
  if (persist) saveState();
  if (rerender) renderAllocationPanel();
  return true;
}

function detectFIREPhase() {
  // Try to estimate FIRE phase from current data
  const t = calcTotals();
  const byMonth = new Map();
  for (const tx of state.transactions) {
    if (isInterAccountTransfer(tx)) continue;
    const d = (tx.date||"").slice(0,7); if (!d) continue;
    const cur = byMonth.get(d)||{out:0}; if (tx.type==="out") cur.out += parseNum(tx.amount);
    byMonth.set(d, cur);
  }
  const last6 = [...byMonth.keys()].sort().slice(-6);
  const avgExp = last6.length ? last6.reduce((s,k)=>s+(byMonth.get(k).out||0),0)/last6.length : 0;
  const fireNum = avgExp > 0 ? avgExp * 12 / 0.04 : 0; // 4% SWR
  if (fireNum <= 0 || t.assetsTotal <= 0) return "acumulacao";
  const pct = t.assetsTotal / fireNum * 100;
  if (pct >= 90) return "independencia";
  if (pct >= 50) return "transicao";
  return "acumulacao";
}

function renderAllocationPanel() {
  const el = document.getElementById("allocationContent");
  const gapCard = document.getElementById("allocationGapCard");
  const gapEl   = document.getElementById("allocationGapContent");
  if (!el) return;

  try {
    // Phase detection
    const savedPreset = (state.settings && state.settings.allocationPreset) || null;
    if (!_allocPreset || !FIRE_ALLOCATION_PRESETS[_allocPreset]) {
      _allocPreset = savedPreset || detectFIREPhase();
    }

    const custom = (state.settings && state.settings.targetAllocation) || null;
    const preset = FIRE_ALLOCATION_PRESETS[_allocPreset];
    const alloc  = custom || preset.classes;
    const t      = calcTotals();

    const CLASS_KEY_MAP = {
      "Ações/ETFs":"acoes/etfs","Imobiliário":"imobiliario","Obrigações/Fundos":"obrigacoes",
      "PPR":"ppr","Depósitos a prazo":"depositos","Metais Preciosos":"ouro"
    };

    function getActualForClass(a) {
      const targetKey = CLASS_KEY_MAP[a.class] || normStr(a.class);
      return state.assets.filter(x => {
        const k = assetClassKey(x);
        if (a.class === "Obrigações/Fundos") return k === "obrigacoes" || k === "fundos";
        if (a.class === "Metais Preciosos")  return k === "ouro" || k === "prata";
        return k === targetKey;
      }).reduce((s,x) => s + parseNum(x.value), 0);
    }

    // Real metrics — safe call
    let m = { hasData:false, grandTotalReturn:0, grandTotalReturnPct:0, ttmYieldNet:0, totalRealizedPnL:0 };
    try { m = calcPortfolioRealMetrics(); } catch(e) { /* silent */ }

    // ── Build HTML using string concat (avoids nested template literal crashes on iOS)
    let html = "";

    // Phase selector
    html += "<div style='margin-bottom:14px'>";
    html += "<div style='font-size:11px;color:var(--muted);font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px'>Fase FIRE — selecciona a tua situação</div>";
    html += "<div class='alloc-phase-grid'>";
    Object.entries(FIRE_ALLOCATION_PRESETS).forEach(([key, p]) => {
      const active = _allocPreset === key;
      html += "<button class='btn " + (active ? "btn--primary" : "btn--outline") + " js-alloc-phase alloc-phase-btn'"
        + " type='button' data-phase='" + key + "' onclick='return window.setAllocationPreset && window.setAllocationPreset(this.dataset.phase, { persist: true, rerender: true });'>"
        + escapeHtml(p.label) + "<br><span style='font-size:9px;opacity:.75'>" + escapeHtml(p.firePhase) + "</span>"
        + "</button>";
    });
    html += "</div>";
    // Phase description card
    html += "<div style='background:var(--card2);border-radius:var(--r-sm);padding:10px 12px;border:1px solid var(--line)'>";
    html += "<div style='font-size:12px;line-height:1.6;color:var(--muted)'>" + escapeHtml(preset.desc) + "</div>";
    html += "<div style='margin-top:6px;font-size:11px;color:#6366f1;font-weight:700'>📈 Retorno esperado: " + escapeHtml(preset.expectedReturn) + "</div>";
    html += "</div></div>";

    // Allocation bars
    html += "<div style='display:flex;flex-direction:column;gap:10px;margin-bottom:14px'>";
    alloc.forEach(a => {
      const actual    = getActualForClass(a);
      const actualPct = t.assetsTotal > 0 ? actual / t.assetsTotal * 100 : 0;
      const gap       = a.pct - actualPct;
      const gapAbs    = Math.abs(gap);
      const gapCol    = gapAbs < 3 ? "#059669" : gapAbs < 10 ? "#d97706" : "#dc2626";
      const gapBg     = gapAbs < 3 ? "#d1fae5" : gapAbs < 10 ? "#fef3c7" : "#fef2f2";
      const gapText   = gapAbs < 3 ? "✅ Em linha"
        : gap > 0 ? "📈 +" + fmtEUR(t.assetsTotal * gap / 100)
        : "📉 -" + fmtEUR(t.assetsTotal * (-gap) / 100);
      const barPct    = Math.min(100, t.assetsTotal > 0 ? (actual / Math.max(1, t.assetsTotal * a.pct / 100)) * 100 : 0);
      const barCol    = gapAbs < 3 ? "#10b981" : gapAbs < 10 ? "#f59e0b" : "#6366f1";

      html += "<div style='background:var(--card2);border-radius:var(--r-sm);border:1px solid var(--line);overflow:hidden'>";
      // Header
      html += "<div style='padding:12px 14px 8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px'>";
      html += "<div style='flex:1;min-width:0'>";
      html += "<div style='display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap'>";
      html += "<span style='font-weight:900;font-size:14px'>" + escapeHtml(a.class) + "</span>";
      html += "<span style='font-size:10px;background:" + gapBg + ";color:" + gapCol + ";padding:2px 6px;border-radius:999px;font-weight:700'>" + gapText + "</span>";
      html += "</div>";
      html += "<div style='font-size:11px;color:var(--muted)'>" + escapeHtml(a.riskReturn || a.tip) + "</div>";
      html += "</div>";
      html += "<div style='text-align:right;flex-shrink:0'>";
      html += "<div style='font-size:20px;font-weight:900'>" + a.pct + "%</div>";
      html += "<div style='font-size:10px;color:var(--muted)'>actual " + fmtPct(actualPct) + "</div>";
      html += "</div></div>";
      // Progress bar
      html += "<div style='padding:0 14px 8px'>";
      html += "<div style='height:6px;background:var(--line);border-radius:3px;overflow:hidden'>";
      html += "<div style='height:6px;background:" + barCol + ";border-radius:3px;width:" + barPct + "%;transition:width .6s'></div>";
      html += "</div>";
      html += "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:3px'>";
      html += "<span>" + fmtEUR(actual) + "</span><span>alvo: " + fmtEUR(t.assetsTotal * a.pct / 100) + "</span>";
      html += "</div></div>";
      // Rationale (expandable details)
      if (a.rationale) {
        html += "<details style='border-top:1px solid var(--line)'>";
        html += "<summary style='padding:8px 14px;font-size:11px;font-weight:700;color:#6366f1;cursor:pointer;list-style:none'>";
        html += "💡 Porquê " + a.pct + "%? · " + escapeHtml(a.tip);
        html += "</summary>";
        html += "<div style='padding:8px 14px 12px;font-size:11px;color:var(--muted);line-height:1.6'>";
        html += escapeHtml(a.rationale);
        if (a.examples) {
          html += "<div style='margin-top:6px;font-weight:700;color:var(--text)'>📋 Exemplos: " + escapeHtml(a.examples) + "</div>";
        }
        html += "</div></details>";
      }
      html += "</div>"; // end card
    });
    html += "</div>"; // end allocation bars

    // Real performance block
    if (m.hasData) {
      html += "<div style='background:var(--card2);border-radius:var(--r-sm);padding:12px 14px;border:1px solid var(--line);margin-bottom:14px'>";
      html += "<div style='font-weight:800;font-size:13px;margin-bottom:8px'>📊 Performance real do teu portfólio</div>";
      html += "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:6px'>";
      const rc = m.grandTotalReturn >= 0 ? "#059669" : "#dc2626";
      const rp = (m.grandTotalReturn >= 0 ? "+" : "") + fmtPct(m.grandTotalReturnPct);
      html += "<div style='background:var(--card);border-radius:8px;padding:8px;text-align:center'><div style='font-size:9px;color:var(--muted);font-weight:700'>Retorno total</div><div style='font-size:14px;font-weight:900;color:" + rc + "'>" + rp + "</div></div>";
      html += "<div style='background:var(--card);border-radius:8px;padding:8px;text-align:center'><div style='font-size:9px;color:var(--muted);font-weight:700'>Yield (distrib.)</div><div style='font-size:14px;font-weight:900;color:#6366f1'>" + fmtPct(m.ttmYieldNet) + "</div></div>";
      const pc = m.totalRealizedPnL >= 0 ? "#059669" : "#dc2626";
      const pp = (m.totalRealizedPnL >= 0 ? "+" : "") + fmtEUR(m.totalRealizedPnL);
      html += "<div style='background:var(--card);border-radius:8px;padding:8px;text-align:center'><div style='font-size:9px;color:var(--muted);font-weight:700'>Mais-valias</div><div style='font-size:14px;font-weight:900;color:" + pc + "'>" + pp + "</div></div>";
      html += "</div></div>";
    }

    el.innerHTML = html;
    // iOS/Safari was previously only updating window._allocPreset via inline onclick.
    // The inline handler now calls setAllocationPreset(), which updates the real state.

    // Gap analysis
    if (t.assetsTotal > 0 && gapCard && gapEl) {
      gapCard.style.display = "";
      const gaps = alloc.map(a => {
        const tKey = CLASS_KEY_MAP[a.class] || normStr(a.class);
        const actual = state.assets.filter(x => {
          const k = assetClassKey(x);
          if (a.class === "Obrigações/Fundos") return k === "obrigacoes" || k === "fundos";
          if (a.class === "Metais Preciosos")  return k === "ouro" || k === "prata";
          return k === tKey;
        }).reduce((s,x) => s + parseNum(x.value), 0);
        return { class:a.class, actual, target: t.assetsTotal * a.pct / 100, gap: t.assetsTotal * a.pct / 100 - actual, pct: a.pct };
      }).sort((a,b) => b.gap - a.gap);

      gapEl.innerHTML = gaps.map(g => {
        const col    = g.gap > 0 ? "#059669" : g.gap < 0 ? "#dc2626" : "#94a3b8";
        const action = g.gap > 1000 ? "📈 Aumentar " + fmtEUR(g.gap)
          : g.gap < -1000 ? "📉 Reduzir " + fmtEUR(Math.abs(g.gap)) : "✅ Em linha";
        return "<div class='item' style='cursor:default'>"
          + "<div class='item__l'>"
          + "<div class='item__t'>" + escapeHtml(g.class) + "</div>"
          + "<div class='item__s'>" + fmtEUR(g.actual) + " actual → " + fmtEUR(g.target) + " alvo (" + g.pct + "%)</div>"
          + "</div>"
          + "<div style='text-align:right'><div style='font-weight:800;color:" + col + ";font-size:14px'>" + action + "</div></div>"
          + "</div>";
      }).join("");
    } else if (gapCard) { gapCard.style.display = "none"; }

    // Wire save button
    const btn = document.getElementById("btnSaveAllocation");
    if (btn) btn.onclick = () => {
      if (!state.settings) state.settings = {};
      state.settings.allocationPreset = _allocPreset;
      saveState();
      toast("Alocação " + FIRE_ALLOCATION_PRESETS[_allocPreset].label + " guardada ✅");
    };

  } catch(err) {
    console.error("renderAllocationPanel error:", err);
    const el2 = document.getElementById("allocationContent");
    if (el2) el2.innerHTML = "<div class='note'>Erro ao carregar alocação: " + escapeHtml(String(err)) + "</div>";
  }
}


/** XTB PDF Account Statement – text extraction fallback
 *  XTB PDFs are typically not machine-readable tables; we do a best-effort
 *  line-by-line parse looking for: Symbol Volume OpenPrice ClosePrice Profit patterns */
function parseXTBPdfText(text, meta) {
  const events = [], positions = [];
  const lines = String(text||"").split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Pattern: SYMBOL   BUY/SELL   DATE   DATE   OPEN   CLOSE   VOL   PROFIT
  // We look for lines that start with a known ticker-like pattern
  const tradeRe = /^([A-Z0-9._\-]{2,12})\s+(buy|sell|compra|venda)\s+/i;
  const numRe = /([\-+]?\d[\d\s.,]*)/g;

  for (const line of lines) {
    const m = line.match(tradeRe);
    if (!m) continue;
    const symbol = m[1].toUpperCase().trim();
    const typeRaw = m[2].toLowerCase();
    const type = typeRaw === "buy" || typeRaw === "compra" ? "BUY" : "SELL";
    const nums = [...line.matchAll(numRe)].map(x => parseNumberSmart(x[1].replace(/\s/g,"")));
    const validNums = nums.filter(n => Number.isFinite(n) && Math.abs(n) > 0);
    if (validNums.length < 2) continue;
    const vol = validNums[0];
    const profit = validNums[validNums.length - 1];
    const ticker = xtbTickerToYahoo(symbol);
    const evt = {
      id: uid(), sourceHash: meta.hash, sourceName: meta.name, broker: "XTB",
      type, actionRaw: typeRaw,
      date: isoToday(), dateTime: isoToday(),
      ticker, isin: "", name: symbol,
      qty: Math.abs(vol), pricePerShare: 0,
      totalEUR: 0, totalCurrency: "EUR",
      grossLocal: 0, localCurrency: "EUR",
      taxEUR: 0, feeEUR: 0, resultEUR: profit,
      notes: "XTB PDF (texto)", key: ""
    };
    evt.key = brokerEventKey(evt);
    events.push(evt);
  }
  return { events, positions };
}
/* ─── HISTÓRICO DE COTAÇÕES ─────────────────────────────────── */
function renderPriceHistoryPanel() {
  const el = document.getElementById("priceHistoryContent");
  if (!el) return;

  const hist = state.priceHistory || {};
  const tickers = Object.keys(hist).filter(k => (hist[k]||[]).length > 0)
    .sort((a,b) => a.localeCompare(b));

  if (!tickers.length) {
    el.innerHTML = `<div class="note">Sem histórico de cotações. Usa ⟳ Cotações para começar a registar.</div>`;
    return;
  }

  const selEl = document.getElementById("priceHistoryTicker");
  if (selEl) {
    const prev = selEl.value;
    selEl.innerHTML = tickers.map(t =>
      `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
    ).join("");
    if (tickers.includes(prev)) selEl.value = prev;
  }

  const ticker = (selEl && selEl.value) || tickers[0];
  const points = (hist[ticker] || []).slice().sort((a,b)=>a.date.localeCompare(b.date));

  if (!points.length) { el.innerHTML = `<div class="note">Sem dados para ${escapeHtml(ticker)}.</div>`; return; }

  const labels  = points.map(p => p.date.slice(5)); // MM-DD
  const prices  = points.map(p => p.priceEur);
  const ccy     = points[points.length-1].ccy || "EUR";
  const first   = prices[0], last = prices[prices.length-1];
  const change  = first > 0 ? ((last-first)/first*100) : 0;
  const changeCol = change >= 0 ? "#059669" : "#dc2626";
  const n = points.length;

  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div style="flex:1;min-width:100px;background:var(--card2);border-radius:var(--r-sm);padding:10px 14px;border:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted);font-weight:700">Preço actual</div>
        <div style="font-size:20px;font-weight:900">${fmtEUR2(last)}</div>
        <div style="font-size:11px;color:var(--muted)">${ccy !== "EUR" ? `${fmtCcy(points[points.length-1].priceLoc||last, ccy)} (${ccy})` : "EUR"}</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--card2);border-radius:var(--r-sm);padding:10px 14px;border:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted);font-weight:700">Variação (${n} dias)</div>
        <div style="font-size:20px;font-weight:900;color:${changeCol}">${change>=0?"+":""}${change.toFixed(2)}%</div>
        <div style="font-size:11px;color:var(--muted)">${fmtEUR2(first)} → ${fmtEUR2(last)}</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--card2);border-radius:var(--r-sm);padding:10px 14px;border:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted);font-weight:700">Registos</div>
        <div style="font-size:20px;font-weight:900">${n}</div>
        <div style="font-size:11px;color:var(--muted)">${points[0].date} → ${points[points.length-1].date}</div>
      </div>
    </div>
    <div class="chartWrap"><canvas id="priceHistoryChart" height="220"></canvas></div>
    <div style="margin-top:10px;font-size:11px;color:var(--muted)">
      Cotações em EUR · Actualiza com ⟳ Cotações (uma entrada por dia por ticker)
    </div>`;

  const ctx2 = prepareChartCanvas(document.getElementById("priceHistoryChart"), 220);
  if (!ctx2 || typeof Chart === "undefined") { renderChartUnavailable("priceHistoryChart"); return; }
  clearChartUnavailable("priceHistoryChart");
  const ctx = ctx2.getContext("2d");

  // Destroy previous chart if any
  if (window._priceHistChart) { try { window._priceHistChart.destroy(); } catch(_){} }
  window._priceHistChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: ticker + " (EUR)",
        data: prices,
        tension: 0.35,
        borderColor: change >= 0 ? "#10b981" : "#ef4444",
        backgroundColor: change >= 0 ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.08)",
        fill: true, pointRadius: points.length < 20 ? 3 : 0, borderWidth: 2
      }]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtEUR2(c.raw) } } },
      scales: { y: { ticks: { callback: v => fmtEUR2(v) } } }
    }
  });
}

function renderFXHistoryPanel() {
  const el = document.getElementById("fxHistoryContent");
  if (!el) return;
  const fxH = state.fxHistory || {};
  const ccys = Object.keys(fxH).filter(c => (fxH[c]||[]).length > 0).sort();
  if (!ccys.length) {
    el.innerHTML = `<div class="note">Sem histórico de câmbios. Actualiza ⟳ Cotações para registar taxas diárias.</div>`;
    return;
  }
  el.innerHTML = ccys.map(ccy => {
    const pts = (fxH[ccy]||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const last = pts[pts.length-1];
    const first = pts[0];
    const chg = first.rate > 0 ? ((last.rate - first.rate)/first.rate*100) : 0;
    const col = chg >= 0 ? "#059669" : "#dc2626";
    return `<div class="item" style="cursor:default">
      <div class="item__l">
        <div class="item__t">${escapeHtml(ccy)}/EUR</div>
        <div class="item__s">${pts.length} registos · ${first.date} → ${last.date}</div>
      </div>
      <div style="text-align:right">
        <div class="item__v">${last.rate.toFixed(5)}</div>
        <div style="font-size:11px;color:${col}">${chg>=0?"+":""}${chg.toFixed(2)}%</div>
      </div>
    </div>`;
  }).join("");
}
/* ─── MODAL: Currency auto-conversion wiring ───────────────── */
function wireCurrencyModal() {
  const curSel = document.getElementById("mCurrency");
  const vlEl   = document.getElementById("mValueLocal");
  const eurEl  = $("mValue");
  const fxNote = document.getElementById("mFxNote");
  if (!curSel || !vlEl || !eurEl || !fxNote) return;

  // Use a named handler stored on the element to allow clean removal
  const update = () => {
    const ccy = (curSel.value || "EUR").toUpperCase();
    const vl  = parseNum(vlEl.value);
    if (ccy === "EUR") {
      fxNote.style.display = "none";
      if (vl > 0) eurEl.value = vl.toFixed(2);
      return;
    }
    const rate    = brokerApproxFxToEUR(ccy);
    const isLive  = !!(state && state.settings && state.settings.lastFxRates && state.settings.lastFxRates[ccy]);
    const srcLabel = isLive ? "cotação actual" : "taxa aproximada";
    if (vl > 0) {
      const eur = vl * rate;
      eurEl.value = eur.toFixed(2);
      fxNote.style.display = "";
      fxNote.textContent = `1 ${ccy} = ${rate.toFixed(4)} EUR (${srcLabel}) → ${fmtEUR2(eur)}`;
    } else if (parseNum(eurEl.value) > 0) {
      fxNote.style.display = "";
      fxNote.textContent = `Taxa ${ccy}/EUR: ${rate.toFixed(4)} (${srcLabel}). Introduz o valor em ${ccy} para converter.`;
    } else {
      fxNote.style.display = "none";
    }
  };

  // Remove previous listeners if any (stored on element)
  if (curSel._ccyHandler) curSel.removeEventListener("change", curSel._ccyHandler);
  if (vlEl._ccyHandler)   vlEl.removeEventListener("input",    vlEl._ccyHandler);
  curSel._ccyHandler = update;
  vlEl._ccyHandler   = update;
  curSel.addEventListener("change", update);
  vlEl.addEventListener("input",    update);
}
/* ─── WIRE P&L ───────────────────────────────────────────────── */
(function wirePnL() {
  const init = () => {
    if (window.__PF_WIRE_PNL_DONE) return;
    window.__PF_WIRE_PNL_DONE = true;
    // Renderizar P&L quando entra na tab "assets" e quando cotações são actualizadas
    document.addEventListener("quotesUpdated", renderEquityPnL);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════
   MELHORIAS ADICIONAIS v16.1
   1. Compound com DCA explícito (reinvestimento dividendos separado)
   2. Projecção FIRE com 3 taxas de retorno baseadas em TWR real
   3. Alerta de rentabilidade negativa na carteira
   4. Contexto expandido para a IA (inclui P&L e TWR reais)
   ═══════════════════════════════════════════════════════════════ */

/* ─── PROJECÇÃO COMPOSTA COM DCA + DIVIDENDOS ───────────────── */
// Versão melhorada do compound que separa:
//   - Capital inicial
//   - Contribuições mensais (DCA)
//   - Reinvestimento de dividendos (taxa separada)
function compoundWithDCA(principal, rateAnnual, years, monthlyDCA, divYieldNet) {
  // rateAnnual = valorização do capital (ex: 8%)
  // divYieldNet = yield dividendos após IRS (ex: 2% × 0.72 = 1.44%)
  // monthlyDCA = contribuição mensal fixa
  const monthlyRate    = rateAnnual / 100 / 12;
  const monthlyDivRate = divYieldNet / 100 / 12;
  const results = [];
  let cap = principal;
  let totalContrib = 0;
  let totalDivReceived = 0;

  for (let m = 0; m <= years * 12; m++) {
    if (m % 12 === 0) {
      const yr = m / 12;
      results.push({
        year: yr,
        value: cap,
        contributed: principal + totalContrib,
        dividends: totalDivReceived,
        gain: cap - principal - totalContrib
      });
    }
    if (m < years * 12) {
      const divMonth = cap * monthlyDivRate;
      totalDivReceived += divMonth;
      cap = cap * (1 + monthlyRate) + divMonth + monthlyDCA;
      totalContrib += monthlyDCA;
    }
  }
  return results;
}

/* ─── RENDER: COMPOUND MELHORADO COM DCA + DIVIDENDOS ───────── */
function renderCompoundWithDCAPanel() {
  const el = document.getElementById("compoundDCAResult");
  if (!el) return;

  const principal = parseNum($("compPrincipal").value) || calcTotals().net;
  const rateStr   = parseNum($("compRate").value);
  const years     = parseInt($("compYears").value) || 20;
  const dca       = parseNum($("compContrib").value);
  const inflEl    = document.getElementById("compInflation");
  const inflation = inflEl ? parseNum(inflEl.value) || 2.5 : 2.5;

  // A taxa no simulador passa a ser sempre taxa total anual já integrada.
  const rateReal = (typeof realRate === "function") ? realRate(rateStr, inflation) : (rateStr - inflation);

  const results = compoundWithDCA(principal, rateStr, years, dca, 0);
  const finalRow = results[results.length - 1];
  const finalReal = compoundWithDCA(principal, Math.max(0, rateReal), years, dca, 0);
  const finalRealVal = finalReal[finalReal.length - 1].value;

  el.innerHTML = `
    <div style="background:var(--kpi-net);border-radius:var(--r-sm);padding:12px;margin-top:12px">
      <div style="font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
        Projecção a ${years} anos (retorno anual total ${fmtPct(rateStr)})
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Capital final</div>
          <div style="font-size:22px;font-weight:900;color:var(--vio)">${fmtEUR(finalRow.value)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Em valores reais (−${fmtPct(inflation)} inf.)</div>
          <div style="font-size:22px;font-weight:900;color:var(--muted)">${fmtEUR(finalRealVal)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Total investido</div>
          <div style="font-size:16px;font-weight:800">${fmtEUR(finalRow.contributed)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700">Ganho composto</div>
          <div style="font-size:16px;font-weight:800;color:var(--green)">${fmtEUR(finalRow.gain)}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted)">
        DCA: ${fmtEUR(dca)}/mês · Inflação: ${fmtPct(inflation)}
      </div>
      ${dca > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">
        💡 O DCA de ${fmtEUR(dca)}/mês contribui com <b>${fmtEUR(dca*12*years)}</b> ao longo de ${years} anos
        e gera <b>${fmtEUR(finalRow.value - principal - dca*12*years)}</b> de crescimento adicional.
      </div>` : ""}
    </div>`;
}

function renderReturnBreakdown() {
  const el = document.getElementById("returnBreakdownContent");
  if (!el) return;

  const py = calcPortfolioYield();
  const t  = calcTotals();
  if (t.assetsTotal === 0) { el.innerHTML = ""; return; }

  const byClass = {};
  for (const row of py.assetRows) {
    const cls = row.cls || "Outros";
    if (!byClass[cls]) byClass[cls] = { value: 0, passiveAmt: 0, appreciationAmt: 0, explicit: 0, count: 0 };
    byClass[cls].value += row.value;
    byClass[cls].passiveAmt += row.value * row.passiveRatePct / 100;
    byClass[cls].appreciationAmt += row.value * row.appreciationPct / 100;
    byClass[cls].count += 1;
    if (row.hasExplicitAppreciation) byClass[cls].explicit += 1;
  }

  const rows = Object.entries(byClass)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([cls, d]) => {
      const passiveYield = d.value > 0 ? d.passiveAmt / d.value * 100 : 0;
      const capitalReturn = d.value > 0 ? d.appreciationAmt / d.value * 100 : 0;
      const totalReturn = passiveYield + capitalReturn;
      const weight = t.assetsTotal > 0 ? d.value / t.assetsTotal * 100 : 0;
      const contrib = totalReturn * weight / 100;
      return { cls, value: d.value, passiveAmt: d.passiveAmt, passiveYield, capitalReturn, totalReturn, weight, contrib, explicit: d.explicit, count: d.count };
    });

  const totalContrib = rows.reduce((s, r) => s + r.contrib, 0);

  el.innerHTML = `
    <div style="margin-bottom:10px;padding:10px;background:var(--kpi-net);border-radius:var(--r-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700">Retorno total total</span>
        <span style="font-size:20px;font-weight:900;color:var(--vio)">${fmtPct(py.totalReturnAnnual)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">
        ${py.totalReturnSource === "twr"
          ? `TWR anualizado real da carteira ${fmtPct(py.totalReturnAnnual)} · base projectada ${fmtPct(py.weightedYield)} · passivo actual ${fmtPct(py.actualPassiveYieldPct || 0)}`
          : `Rendimento base projectado ${fmtPct(py.weightedYield)} + valorização esperada ${fmtPct(py.weightedAppreciationPct)}` }
      </div>
    </div>
    ${rows.map(r => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="font-weight:700">${escapeHtml(r.cls)}</span>
        <div style="text-align:right">
          <span style="font-weight:900;color:${r.totalReturn>3?"var(--green)":r.totalReturn>1?"var(--amber)":"var(--muted)"}">${fmtPct(r.totalReturn)}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:6px">${fmtEUR(r.value)} · ${fmtPct(r.weight)} da carteira</span>
        </div>
      </div>
      <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:2px">
        <div style="height:5px;border-radius:3px;background:var(--vio);width:${Math.min(100,Math.max(0,r.totalReturn)/20*100)}%;transition:width .5s"></div>
      </div>
      <div style="font-size:10px;color:var(--muted)">
        Base ${fmtPct(r.passiveYield)} + valorização ${fmtPct(r.capitalReturn)} · contribui <b>${fmtPct(r.contrib)}</b> para o retorno global
        ${r.passiveAmt>0?` · ${fmtEUR(r.passiveAmt)}/ano`:""}
        ${r.explicit < r.count && r.capitalReturn > 0 ? ` · parte da valorização é assumida por classe` : ""}
      </div>
    </div>`).join("")}
    <div style="font-size:11px;color:var(--muted);margin-top:8px;padding:8px;background:var(--note-bg);border-radius:var(--r-xs)">
      💡 <b>Retorno total</b> = soma ponderada do rendimento base configurado e da valorização esperada por activo. ${py.totalReturnSource === "twr" ? "Quando existe TWR robusto, o total da carteira usa o retorno real observado; o detalhe por classe mantém o motor esperado por activo." : "Sem TWR robusto, o total da carteira usa o mesmo motor ponderado por activo."}
    </div>`;
}

/* ─── ANOS ATÉ FIRE COM DCA ──────────────────────────────────── */
function calcYearsToFIRE(capital, annualSavings, returnRate, expenses) {
  const fireNumber = expenses / 0.04; // regra 4% SWR
  if (capital >= fireNumber) return 0;

  const monthlyRate = returnRate / 100 / 12;
  const monthlyDCA  = annualSavings / 12;
  let cap = capital;
  let months = 0;
  const MAX_MONTHS = 600; // 50 anos

  while (cap < fireNumber && months < MAX_MONTHS) {
    cap = cap * (1 + monthlyRate) + monthlyDCA;
    months++;
  }
  return months < MAX_MONTHS ? months / 12 : null;
}

/* ─── EXPORTAR RELATÓRIO ANUAL ───────────────────────────────── */
function exportAnnualReport() {
  const t    = calcTotals();
  const py   = calcPortfolioYield();
  const twr  = calcTWR();
  const div  = calcDiversificationScore();
  const pnl  = calcEquityPortfolioPnL();
  const year = new Date().getFullYear();

  const lines = [
    `RELATÓRIO PATRIMONIAL ${year}`,
    `Gerado em: ${new Date().toLocaleDateString("pt-PT")}`,
    "",
    "═══════════════════════════════════════",
    "BALANÇO GLOBAL",
    "═══════════════════════════════════════",
    `Activos totais:       ${fmtEUR(t.assetsTotal)}`,
    `Passivos totais:      ${fmtEUR(t.liabsTotal)}`,
    `Património líquido:   ${fmtEUR(t.net)}`,
    "",
    "═══════════════════════════════════════",
    "RENDIMENTO & RETORNO",
    "═══════════════════════════════════════",
    `Rendimento passivo anual: ${fmtEUR(t.passiveAnnual)}`,
    `Rendimento mensal:        ${fmtEUR(t.passiveAnnual/12)}`,
    `Rendimento base projectado: ${fmtPct(py.weightedYield)}`,
    `Retorno total:          ${fmtPct(py.totalReturnBlended)}`,
    twr ? `TWR anualizado:           ${fmtPct(twr.annualised)} (${twr.years} anos)` : "",
    "",
    "═══════════════════════════════════════",
    "PORTFÓLIO DE ACÇÕES/ETFs",
    "═══════════════════════════════════════",
    `Investido:    ${fmtEUR(pnl.totalCost)}`,
    `Valor actual: ${fmtEUR(pnl.totalCurrent)}`,
    `Ganho latente: ${pnl.totalGain>=0?"+":""}${fmtEUR(pnl.totalGain)} (${pnl.totalGain>=0?"+":""}${fmtPct(pnl.totalGainPct)})`,
    `P&L realizado: ${pnl.totalRealized>=0?"+":""}${fmtEUR(pnl.totalRealized||0)}`,
    `Dividendos recebidos: +${fmtEUR(pnl.totalDivAll||0)}`,
    `Retorno total: ${pnl.grandTotalReturn>=0?"+":""}${fmtEUR(pnl.grandTotalReturn||0)} (${pnl.grandTotalReturn>=0?"+":""}${fmtPct(pnl.grandTotalReturnPct||0)})`,
    "",
    "POSIÇÕES (Nome | P&L latente | Realizado | Dividendos | Retorno total | Yield):",
    ...pnl.positions.map(({asset,pos}) => {
      const rz = pos.realizedPnL || 0;
      const dv = pos.divAll || 0;
      const yl = pos.trueYieldPct || 0;
      return `  ${String(asset.name).padEnd(12)} ` +
        `Latente: ${pos.gain>=0?"+":""}${fmtEUR(pos.gain)} (${fmtPct(pos.gainPct)})` +
        (Math.abs(rz)>0 ? `  Realiz: ${rz>=0?"+":""}${fmtEUR(rz)}` : "") +
        (dv>0 ? `  Div: +${fmtEUR(dv)}` + (yl>0 ? ` (${fmtPct(yl)}yield)` : "") : "") +
        `  TOTAL: ${pos.totalReturn>=0?"+":""}${fmtEUR(pos.totalReturn)}`;
    }),
    "",
    "═══════════════════════════════════════",
    "ANÁLISE DE RISCO",
    "═══════════════════════════════════════",
    `Score diversificação: ${div.score}/100 (${div.label})`,
    `Rácio dívida/activos: ${fmtPct(t.assetsTotal>0?t.liabsTotal/t.assetsTotal*100:0)}`,
    "",
    "DISTRIBUIÇÃO POR CLASSE:",
    ...div.breakdown.map(b =>
      `  ${String(b.cls).padEnd(20)} ${fmtPct(b.pct).padStart(7)} (${fmtEUR(b.val)})`
    ),
    "",
    "═══════════════════════════════════════",
    "AVISO LEGAL",
    "═══════════════════════════════════════",
    "Este relatório é meramente informativo.",
    "Consulta sempre um TOC para matérias fiscais",
    "e um consultor financeiro para decisões de investimento.",
  ].filter(l => l !== null && l !== undefined);

  downloadText(lines.join("\n"), `relatorio_patrimonial_${year}.txt`, "text/plain;charset=utf-8;");
  toast("✅ Relatório exportado.");
}
