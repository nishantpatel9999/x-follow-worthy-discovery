require('dotenv').config();
const fs = require('fs');

const POSTS_CSV = './data/posts-sample.csv';
const WORTHY_CSV = './data/follow-worthy.csv';
const MY_FOLLOWS_CSV = './data/my-follows-enriched.csv';

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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callNimLLM(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
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
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const json = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
    return json.choices?.[0]?.message?.content || '';
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

(async () => {
  console.log('[Smoke Test 2] Phase 6 — real handle with posts...\n');

  const posts = parseCSV(POSTS_CSV);
  const worthy = parseCSV(WORTHY_CSV);

  // Find a handle with actual posts that we don't already follow
  const myFollows = new Set();
  if (fs.existsSync(MY_FOLLOWS_CSV)) {
    for (const f of parseCSV(MY_FOLLOWS_CSV)) myFollows.add(f.handle);
  }

  const postsByHandle = {};
  for (const p of posts) {
    if (!postsByHandle[p.handle]) postsByHandle[p.handle] = [];
    postsByHandle[p.handle].push(p);
  }

  const candidateHandles = ['markminervini', 'RichardMoglen', 'OliverKell_', 'LeifSoreide', 'TraderLion', 'PeterLBrandt', 'Rayner_Teo'];
  let found = null;
  for (const h of candidateHandles) {
    if (postsByHandle[h] && postsByHandle[h].length >= 5 && !myFollows.has(h)) {
      found = h;
      break;
    }
  }

  if (!found) {
    console.log('  No eligible handle found.');
    return;
  }

  const w = worthy.find(r => r.handle === found);
  const tweets = postsByHandle[found].slice(0, 15);

  console.log(`  Testing: @${found}`);
  console.log(`  Bio: ${(w?.bio || '').slice(0, 100)}`);
  console.log(`  Endorsed by: ${w?.followed_by_count || '?'} | Followers: ${w?.followers}`);
  console.log(`  Posts sampled: ${tweets.length}\n`);

  const sample = tweets.map((t, i) =>
    `  ${i + 1}. [${t.is_retweet === 'yes' ? 'RT' : 'TW'} ${t.like_count}❤ ${t.retweet_count}🔁] ${(t.text || '').slice(0, 200)}`
  ).join('\n');

  // Show first 3 posts
  console.log('  Sample posts:');
  tweets.slice(0, 3).forEach((t, i) => {
    console.log(`    ${i + 1}. [${t.is_retweet === 'yes' ? 'RT' : 'TW'} ${t.like_count}❤] ${(t.text || '').slice(0, 120)}`);
  });
  console.log('');

  const prompt = `Analyze this X/Twitter account for trading relevance.

Bio: ${w?.bio || ''}
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

  console.log('  Sending to NIM...');
  try {
    const result = await callNimLLM([
      { role: 'system', content: 'You analyze X/Twitter accounts for trading relevance. Respond with valid JSON only.' },
      { role: 'user', content: prompt },
    ]);

    const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    console.log('\n  Results:');
    for (const [k, v] of Object.entries(parsed)) {
      console.log(`    ${k}: ${v}`);
    }
    console.log('\n  ✅ Smoke test PASSED. Ready for full Phase 6.');
  } catch (e) {
    console.log(`\n  ❌ Error: ${e.message}`);
  }
})();
