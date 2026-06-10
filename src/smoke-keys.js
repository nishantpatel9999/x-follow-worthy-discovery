require('dotenv').config();

const KEYS = (process.env.LLM_API_KEYS || '').split(',').filter(Boolean);
const BASE = process.env.LLM_BASE_URL;
const MODEL = process.env.LLM_MODEL;

(async () => {
  console.log('[Smoke 2] Testing keys 2-4 sequentially...\n');

  // Skip key 1 (already confirmed working)
  for (let idx = 1; idx < KEYS.length; idx++) {
    const key = KEYS[idx];
    const start = Date.now();
    const prefix = key.slice(7, 17);
    process.stdout.write(`  Key ${idx + 1} (${prefix}...) → `);

    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: 'say ok' }],
          max_tokens: 5,
          temperature: 0,
          extra_body: { chat_template_kwargs: { thinking: false } },
        }),
        signal: AbortSignal.timeout(420000),
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content || 'no content';
      console.log(`✓ ${text.trim()} [${elapsed}s]`);
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`✗ ${e.message.slice(0, 60)} [${elapsed}s]`);
    }
  }

  // Now test 2 parallel
  console.log('\n  Testing 2 keys parallel...');
  const batch = KEYS.slice(0, 2);
  const jobs = batch.map(async (key, idx) => {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: 'say p' }],
          max_tokens: 3,
          temperature: 0,
          extra_body: { chat_template_kwargs: { thinking: false } },
        }),
        signal: AbortSignal.timeout(420000),
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content || '?';
      console.log(`  Key ${idx + 1}: ${text.trim()} [${elapsed}s]`);
      return true;
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`  Key ${idx + 1}: ✗ ${e.message.slice(0, 40)} [${elapsed}s]`);
      return false;
    }
  });

  await Promise.all(jobs);
  console.log('\n  Done.');
})();
