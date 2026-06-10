require('dotenv').config();
const fs = require('fs');
const { saveCSV, saveJSON, loadJSON, STATE_DIR, DATA_DIR } = require('./xfetch-client');

const POSTS_CSV = `${DATA_DIR}/posts-sample.csv`;
const WORTHY_CSV = `${DATA_DIR}/follow-worthy.csv`;
const MY_FOLLOWS_CSV = `${DATA_DIR}/my-follows-enriched.csv`;
const CSV_OUT = `${DATA_DIR}/follow-worthy-scored.csv`;
const STATE_FILE = `${STATE_DIR}/phase6-llm.json`;

const LLM_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const LLM_BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

if (!LLM_KEY) {
  console.error('  Set LLM_API_KEY or DEEPSEEK_API_KEY in .env');
  process.exit(1);
}

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

async function callLLM(messages) {
  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
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
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return json.choices?.[0]?.message?.content || '';
}

async function classifyHandle(handle, bio, tweets) {
  const sample = tweets.slice(0, 15).map((t, i) => `  ${i + 1}. [${t.is_retweet === 'yes' ? 'RT' : 'TW'} ${t.like_count}❤] ${t.text.slice(0, 200)}`).join('\n');

  const prompt = `Analyze this X/Twitter account for trading relevance.

Bio: ${bio}
Recent posts:
${sample}

Respond in JSON only:
{
  "primary_topic": "US Equities|Indian Equities|Options/Volatility|Crypto|Macro/Rates|Futures/Commodities|Quant/Systematic|AI/Coding for Traders|Finance News|General Business|Personal/Lifestyle",
  "secondary_topic": "one of the above or none",
  "trading_signal_density": 1-10 (how many tweets are directly trading-relevant vs noise),
  "post_style": "one-sentence summary of posting style",
  "is_aggregator": true/false,
  "is_dormant": true/false,
  "quality_score": 1-10
}`;

  const result = await callLLM([
    { role: 'system', content: 'You analyze X/Twitter accounts for trading relevance. Respond with valid JSON only.' },
    { role: 'user', content: prompt },
  ]);

  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { primary_topic: 'unknown', trading_signal_density: 1, post_style: 'no data', quality_score: 1 };
  }
}

(async () => {
  console.log('[Phase 6] LLM classification + scoring...');
  console.log(`  Provider: ${LLM_BASE} | Model: ${LLM_MODEL}`);

  if (!fs.existsSync(POSTS_CSV)) {
    console.error(`  Missing ${POSTS_CSV}. Run phase 5 first.`);
    process.exit(1);
  }

  // Load data
  const posts = parseCSV(POSTS_CSV);
  const worthy = parseCSV(WORTHY_CSV);

  // Build my-follows set
  const myFollows = new Set();
  if (fs.existsSync(MY_FOLLOWS_CSV)) {
    for (const f of parseCSV(MY_FOLLOWS_CSV)) myFollows.add(f.handle);
  }

  // Group posts by handle
  const postsByHandle = {};
  for (const p of posts) {
    if (!postsByHandle[p.handle]) postsByHandle[p.handle] = [];
    postsByHandle[p.handle].push(p);
  }

  // Build worthy lookup
  const worthyMap = {};
  for (const w of worthy) worthyMap[w.handle] = w;

  const handles = Object.keys(postsByHandle);
  console.log(`  ${handles.length} handles to classify.`);

  const progress = loadJSON(STATE_FILE) || { done: [], classifications: {} };
  const pending = handles.filter(h => !progress.classifications[h]);

  console.log(`  Already classified: ${Object.keys(progress.classifications).length}, remaining: ${pending.length}.`);

  // Classify in batches with delay
  for (let i = 0; i < pending.length; i++) {
    const handle = pending[i];
    const w = worthyMap[handle] || {};
    const tweets = postsByHandle[handle] || [];

    process.stdout.write(`  [${progress.done.length + 1}/${handles.length}] @${handle} (${tweets.length} posts) `);

    try {
      const result = await classifyHandle(handle, w.bio || '', tweets);
      progress.classifications[handle] = result;
      console.log(`→ ${result.primary_topic} density:${result.trading_signal_density}`);
    } catch (e) {
      console.log(`error: ${e.message}`);
      progress.classifications[handle] = {
        primary_topic: 'error',
        trading_signal_density: 1,
        post_style: 'error',
        quality_score: 1,
      };
    }

    progress.done.push(handle);
    saveJSON(STATE_FILE, progress);

    if (i % 25 === 0) await delay(1000);
    else await delay(300);
  }

  // === Scoring ===
  console.log('\n  Computing final scores...');

  const scoredRows = worthy
    .filter(w => progress.classifications[w.handle])
    .map(w => {
      const c = progress.classifications[w.handle] || {};
      const endorsed = parseInt(w.followed_by_count) || 0;
      const followers = parseInt(w.followers) || 0;
      const verified = w.verified === 'yes';

      // Endorsement score (0-30): how many of your follows follow them
      const E = Math.min(30, endorsed * 1.5);

      // Trading relevance (0-24): from classification
      const tradingTopics = [
        'US Equities', 'Indian Equities', 'Options/Volatility', 'Crypto',
        'Macro/Rates', 'Futures/Commodities', 'Quant/Systematic',
        'AI/Coding for Traders', 'Finance News',
      ];
      const isTrading = tradingTopics.includes(c.primary_topic || '');
      const T = isTrading ? Math.min(24, (c.trading_signal_density || 1) * 2.4) : 0;

      // Signal density (0-14): how many tweets are trading-relevant
      const S = Math.min(14, (c.trading_signal_density || 1) * 1.4);

      // Specialization (0-10): narrower topic focus = higher
      const Q = (c.primary_topic && c.primary_topic !== 'Personal/Lifestyle' && c.primary_topic !== 'General Business') ? 7 : 3;

      // Credibility (0-8)
      const C = verified ? 8 : (followers > 10000 ? 5 : 2);

      // Activity quality (0-6)
      const A = (c.is_dormant ? 1 : 4) + (c.is_aggregator ? -2 : 2);

      // Fit score (0-8): how well they match a retail trader
      const F = 4;

      // Penalty (0-20)
      const P = (c.is_aggregator ? 10 : 0) + (c.is_dormant ? 10 : 0);

      const score = Math.max(0, Math.min(100, E + T + S + Q + C + A + F - P));

      return {
        id: w.id,
        handle: w.handle,
        name: w.name,
        bio: w.bio,
        followers: w.followers,
        endorsed_by_count: w.followed_by_count,
        verified: w.verified,
        primary_topic: c.primary_topic || '',
        secondary_topic: c.secondary_topic || '',
        trading_signal_density: c.trading_signal_density || 1,
        post_style: c.post_style || '',
        is_aggregator: c.is_aggregator ? 'yes' : 'no',
        is_dormant: c.is_dormant ? 'yes' : 'no',
        endorsement_score: Math.round(E),
        trading_relevance: Math.round(T),
        signal_density: Math.round(S),
        specialization: Math.round(Q),
        credibility: Math.round(C),
        activity_quality: Math.round(A),
        fit_score: Math.round(F),
        penalty: Math.round(P),
        total_score: Math.round(score),
        already_followed: myFollows.has(w.handle) ? 'yes' : 'no',
        why_follow: `${c.post_style || ''}. ${c.primary_topic || ''} focus. Endorsed by ${endorsed} of your follows.`,
      };
    })
    .sort((a, b) => b.total_score - a.total_score);

  const headers = [
    'id', 'handle', 'name', 'bio', 'followers', 'endorsed_by_count', 'verified',
    'primary_topic', 'secondary_topic', 'trading_signal_density', 'post_style',
    'is_aggregator', 'is_dormant',
    'endorsement_score', 'trading_relevance', 'signal_density', 'specialization',
    'credibility', 'activity_quality', 'fit_score', 'penalty', 'total_score',
    'already_followed', 'why_follow',
  ];

  const csvRows = scoredRows.map(r => [
    r.id, r.handle, r.name, r.bio, r.followers, r.endorsed_by_count, r.verified,
    r.primary_topic, r.secondary_topic, r.trading_signal_density, r.post_style,
    r.is_aggregator, r.is_dormant,
    r.endorsement_score, r.trading_relevance, r.signal_density, r.specialization,
    r.credibility, r.activity_quality, r.fit_score, r.penalty, r.total_score,
    r.already_followed, r.why_follow,
  ]);

  saveCSV(CSV_OUT, csvRows, headers);

  console.log(`\n  ✅ Phase 6 done. ${scoredRows.length} handles scored.`);
  console.log(`     Output: ${CSV_OUT}`);

  console.log('\n  Top 25:');
  scoredRows.slice(0, 25).forEach((r, i) => {
    const v = r.verified === 'yes' ? '✓' : ' ';
    const already = r.already_followed === 'yes' ? '[FOLLOWING]' : '';
    console.log(`    ${String(i + 1).padStart(2)}. ${v} @${r.handle.padEnd(22)} score:${String(r.total_score).padStart(3)}  ${r.primary_topic.padEnd(22)} ${r.post_style.slice(0, 60)} ${already}`);
  });
})();
