require('dotenv').config();
const { saveCSV, saveJSON, loadJSON, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const POSTS_CSV = `${DATA_DIR}/posts-sample.csv`;
const WORTHY_CSV = `${DATA_DIR}/follow-worthy.csv`;

const LLM_KEY = process.env.LLM_API_KEY;
const LLM_BASE = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;

function parseCSV(filename) {
  const raw = fs.readFileSync(filename, 'utf-8');
  const lines = raw.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
    return obj;
  });
}

async function callNimLLM(messages) {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 300,
      extra_body: { chat_template_kwargs: { thinking: false } },
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return json.choices?.[0]?.message?.content || '';
}

(async () => {
  console.log('[Smoke Test] Phase 6 — NIM + DeepSeek v4 Pro...\n');
  console.log(`  Endpoint: ${LLM_BASE}`);
  console.log(`  Model: ${LLM_MODEL}`);

  const posts = parseCSV(POSTS_CSV);
  const worthy = parseCSV(WORTHY_CSV);

  // Pick @Qullamaggie as smoke test (endorsed by 88 of your follows)
  const w = worthy.find(r => r.handle === 'Qullamaggie');
  const tweetsForHandle = posts.filter(p => p.handle === 'Qullamaggie').slice(0, 15);

  console.log(`\n  Testing: @${w.handle}`);
  console.log(`  Bio: ${w.bio.slice(0, 100)}`);
  console.log(`  Endorsed by: ${w.followed_by_count} | Followers: ${w.followers}`);
  console.log(`  Sample tweets: ${tweetsForHandle.length}`);

  const sample = tweetsForHandle.map((t, i) =>
    `  ${i + 1}. [${t.is_retweet === 'yes' ? 'RT' : 'TW'} ${t.like_count}❤ ${t.retweet_count}🔁] ${(t.text || '').slice(0, 200)}`
  ).join('\n');

  const prompt = `Analyze this X/Twitter account for trading relevance.

Bio: ${w.bio}
Recent posts:
${sample}

Respond in JSON only:
{
  "primary_topic": "US Equities|Indian Equities|Options/Volatility|Crypto|Macro/Rates|Futures/Commodities|Quant/Systematic|AI/Coding for Traders|Finance News|General Business|Personal/Lifestyle",
  "secondary_topic": "one of the above or none",
  "trading_signal_density": 1-10,
  "post_style": "one-sentence summary of posting style",
  "is_aggregator": true/false,
  "is_dormant": true/false,
  "quality_score": 1-10
}`;

  console.log('\n  Sending to NIM...');
  try {
    const result = await callNimLLM([
      { role: 'system', content: 'You analyze X/Twitter accounts for trading relevance. Respond with valid JSON only.' },
      { role: 'user', content: prompt },
    ]);

    console.log('\n  Raw response:');
    console.log(`  ${result.slice(0, 500)}`);

    const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log('\n  Parsed:');
    for (const [k, v] of Object.entries(parsed)) {
      console.log(`    ${k}: ${v}`);
    }
    console.log('\n  ✅ Smoke test PASSED.');
  } catch (e) {
    console.log(`\n  ❌ Error: ${e.message}`);
  }
})();
