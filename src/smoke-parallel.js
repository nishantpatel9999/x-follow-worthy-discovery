require('dotenv').config();

const KEYS = (process.env.LLM_API_KEYS || '').split(',').filter(Boolean);
const BASE = process.env.LLM_BASE_URL;
const MODEL = process.env.LLM_MODEL;

(async () => {
  console.log(`[Smoke] 4-key parallel test — ${KEYS.length} keys\n`);

  const jobs = KEYS.map(async (key, idx) => {
    const start = Date.now();
    const prefix = key.slice(7, 17);
    process.stdout.write(`  Key ${idx + 1} (${prefix}...) starting...\n`);

    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: `Respond with exactly: "key ${idx + 1} working"` }],
          max_tokens: 20,
          temperature: 0,
          extra_body: { chat_template_kwargs: { thinking: false } },
        }),
        signal: AbortSignal.timeout(480000),
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content || 'no content';
      process.stdout.write(`  Key ${idx + 1} ✓ ${text.trim()} [${elapsed}s]\n`);
      return { key: idx + 1, ok: true, elapsed };
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      process.stdout.write(`  Key ${idx + 1} ✗ ${e.message.slice(0, 40)} [${elapsed}s]\n`);
      return { key: idx + 1, ok: false, elapsed, error: e.message };
    }
  });

  const results = await Promise.all(jobs);
  const success = results.filter(r => r.ok).length;
  console.log(`\n  ✅ ${success}/${KEYS.length} keys working.`);
  if (success === KEYS.length) console.log('  Ready for full Phase 6 parallel run.');
})();
