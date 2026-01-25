// === LIVE PRICES ENGINE (CRYPTO FIRST) ===

const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

// botão refresh
document.getElementById("btnRefreshPrices").addEventListener("click", updateCryptoPrices);

// mapa simples símbolo → coingecko id
const CRYPTO_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOT: "polkadot",
  BNB: "binancecoin"
};

// função principal
async function updateCryptoPrices() {

  const cryptos = state.investments.filter(i => i.class === "Cripto");

  if (cryptos.length === 0) {
    alert("Sem criptomoedas registadas.");
    return;
  }

  const ids = cryptos
    .map(c => CRYPTO_MAP[c.symbol])
    .filter(Boolean)
    .join(",");

  if (!ids) {
    alert("Símbolos não reconhecidos.");
    return;
  }

  try {

    const res = await fetch(`${COINGECKO}?ids=${ids}&vs_currencies=eur`);
    const data = await res.json();

    cryptos.forEach(inv => {

      const apiId = CRYPTO_MAP[inv.symbol];
      const price = data[apiId]?.eur;

      if (price) {
        inv.marketPrice = price;
        inv.marketValue = price * inv.qty;
        inv.pnl = inv.marketValue - (inv.qty * inv.avgPrice);
        inv.pnlPct = (inv.pnl / (inv.qty * inv.avgPrice)) * 100;
      }

    });

    saveState();
    renderAll();

    alert("Preços actualizados.");

  } catch (err) {
    alert("Erro ao obter preços.");
    console.error(err);
  }
}
