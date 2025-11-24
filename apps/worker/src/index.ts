import fetch from "node-fetch";

type PriceCheck = {
  productId: string;
  source: string;
  marketPrice: number;
};

const products = [
  { id: "p-1", name: "Shea Body Butter", price: 15.5 },
  { id: "p-2", name: "Vitamin C Serum", price: 25.0 },
  { id: "p-3", name: "Matte Lipstick", price: 12.0 }
];

// Simulated scheduled job entry point
async function run() {
  console.log("Running AI worker tasks...");
  await runPriceGapCheck();
  runSlowMoverHeuristic();
  runSeasonalForecast();
}

async function runPriceGapCheck() {
  // Placeholder competitor fetch; replace with real API/scraper
  const competitorPrices: PriceCheck[] = products.map((p) => ({
    productId: p.id,
    source: "example-competitor",
    marketPrice: Math.round(p.price * 0.9 * 100) / 100
  }));

  competitorPrices.forEach((entry) => {
    const ours = products.find((p) => p.id === entry.productId);
    if (!ours) return;

    const delta = (entry.marketPrice - ours.price) / ours.price;
    if (Math.abs(delta) > 0.1) {
      console.log(`[ALERT][PRICE_GAP] ${ours.name} market ${entry.marketPrice} vs ours ${ours.price}`);
      // In production, push to API /ai/price-gap
    }
  });
}

function runSlowMoverHeuristic() {
  const slowMovers = products
    .filter((_, idx) => idx % 2 === 0)
    .map((p) => ({ productId: p.id, daysWithoutSale: 45, suggestedDiscountPercent: 10 }));

  slowMovers.forEach((m) => {
    console.log(`[ALERT][SLOW_MOVER] ${m.productId} no sales in ${m.daysWithoutSale} days -> ${m.suggestedDiscountPercent}% off`);
  });
}

function runSeasonalForecast() {
  const forecast = products.map((p) => ({
    productId: p.id,
    month: new Date().getMonth() + 1,
    recommendedQty: 50
  }));

  forecast.forEach((f) => {
    console.log(`[ALERT][SEASONAL] ${f.productId} stock up ${f.recommendedQty} units for month ${f.month}`);
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
