require('dotenv').config();

const KEY = process.env.LLM_API_KEY;
const BASE = process.env.LLM_BASE_URL;
const MODEL = process.env.LLM_MODEL;

(async () => {
  console.log('[Smoke] OpenRouter GPT-4o-mini\n');
  console.log(`  Endpoint: ${BASE}/chat/completions`);
  console.log(`  Model: ${MODEL}`);

  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Classify X/Twitter accounts for trading relevance. Return valid JSON array only.' },
          { role: 'user', content: 'Classify these 2 accounts:\n[0]\nhandle: traderA\nbio: Day trading US equities\nsample: 1. hot breakout on NVDA 2. took profits 3. market looking weak\n\n[1]\nhandle: memeguy\nbio: Just vibing\nsample: 1. lol 2. gm 3. what a day\n\nReturn JSON: [{"handle":"...","primary_topic":"US Equities|Indian Equities|Options/Volatility|Crypto|Macro/Rates|Futures/Commodities|Quant/Systematic|AI/Coding for Traders|Finance News|General Business|Personal/Lifestyle","trading_signal_density":1-10,"post_style":"one sentence","is_aggregator":true/false,"is_dormant":true/false,"quality_score":1-10}]' },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const json = await res.json();
    console.log(`  Status: ${res.status} [${elapsed}s]`);
    console.log(`  Content: ${json.choices?.[0]?.message?.content?.slice(0, 600)}`);
    console.log(`\n  ✅ Smoke test PASSED.`);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ❌ Error [${elapsed}s]: ${e.message}`);
  }
})();
