require('dotenv').config();

const LLM_KEY = process.env.LLM_API_KEY;
const LLM_BASE = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;

(async () => {
  console.log('[NIM Smoke] Starting...');
  console.log(`  Endpoint: ${LLM_BASE}/chat/completions`);
  console.log(`  Model: ${LLM_MODEL}`);
  console.log('  Waiting up to 8 minutes for NIM to respond...\n');

  const start = Date.now();
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        max_tokens: 10,
        temperature: 0,
        extra_body: { chat_template_kwargs: { thinking: false } },
      }),
      signal: AbortSignal.timeout(480000),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Response received in ${elapsed}s`);
    console.log(`  Status: ${res.status}`);

    const text = await res.text();
    console.log(`  Body: ${text.slice(0, 500)}`);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Failed after ${elapsed}s: ${e.message}`);
  }
})();
