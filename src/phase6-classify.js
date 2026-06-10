require('dotenv').config();
const fs = require('fs');
const { saveCSV, saveJSON, loadJSON, STATE_DIR, DATA_DIR } = require('./xfetch-client');

const POSTS_CSV = `${DATA_DIR}/posts-sample.csv`;
const WORTHY_CSV = `${DATA_DIR}/follow-worthy.csv`;
const MY_FOLLOWS_CSV = `${DATA_DIR}/my-follows-enriched.csv`;
const CSV_OUT = `${DATA_DIR}/follow-worthy-scored.csv`;
const STATE_FILE = `${STATE_DIR}/phase6-llm.json`;

const LLM_KEY = process.env.LLM_API_KEY;
const LLM_BASE = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;
const BATCH_SIZE = 20;

if (!LLM_KEY) {
  console.error('Set LLM_API_KEY in .env');
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

async function callLLM(prompt) {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: 'Classify X/Twitter accounts for trading relevance. Return valid JSON array only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: BATCH_SIZE * 80,
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json.error || json)}`);
  return json.choices?.[0]?.message?.content || '';
}

(async () => {
  console.log('[Phase 6] LLM classification + scoring...');
  console.log(`  Provider: OpenRouter | Model: ${LLM_MODEL} | Batch: ${BATCH_SIZE}`);
  console.log(`  Est: ~${Math.ceil(1289 / BATCH_SIZE)} calls × ~2s = ~${(Math.ceil(1289 / BATCH_SIZE) * 2 / 60).toFixed(1)}m\n`);

  const posts = parseCSV(POSTS_CSV);
  const worthy = parseCSV(WORTHY_CSV);

  const myFollows = new Set();
  if (fs.existsSync(MY_FOLLOWS_CSV)) {
    for (const f of parseCSV(MY_FOLLOWS_CSV)) myFollows.add(f.handle);
  }

  const postsByHandle = {};
  for (const p of posts) {
    if (!postsByHandle[p.handle]) postsByHandle[p.handle] = [];
    postsByHandle[p.handle].push(p);
  }

  const worthyMap = {};
  for (const w of worthy) worthyMap[w.handle] = w;

  const handles = Object.keys(postsByHandle);
  console.log(`  ${handles.length} handles to classify.`);

  const progress = loadJSON(STATE_FILE) || { done: [], classifications: {}, batches: 0 };
  const pending = handles.filter(h => !progress.classifications[h]);

  console.log(`  Already: ${Object.keys(progress.classifications).length}, remaining: ${pending.length}.`);
  if (pending.length === 0) {
    console.log('  All classified. Skipping to scoring...');
  } else {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchNum = progress.batches + 1;
      const start = Date.now();

      process.stdout.write(`  Batch ${batchNum} [${i + 1}-${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length}] `);

      const batchData = batch.map((handle, idx) =>
        `[${idx}]\nhandle: ${handle}\nbio: ${(worthyMap[handle]?.bio || '').replace(/\n/g, ' ').slice(0, 150)}\nsample: ${(postsByHandle[handle] || []).slice(0, 8).map((t, ti) => {
          const prefix = t.is_retweet === 'yes' ? 'RT:' : '';
          return `${ti + 1}. ${prefix}${(t.text || '').replace(/\n/g, ' ').slice(0, 150)} [${t.like_count}❤]`;
        }).join(' | ')}`
      ).join('\n\n');

      const prompt = `Classify each [N] account for trading relevance. Return JSON array, one object per account, in order.

${batchData}

Return ONLY: [{"handle":"...","primary_topic":"US Equities|Indian Equities|Options/Volatility|Crypto|Macro/Rates|Futures/Commodities|Quant/Systematic|AI/Coding for Traders|Finance News|General Business|Personal/Lifestyle","trading_signal_density":1-10,"post_style":"one sentence summary","is_aggregator":true/false,"is_dormant":true/false,"quality_score":1-10}]`;

      try {
        const result = await callLLM(prompt);
        const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); } catch {
          const match = cleaned.match(/\[.*\]/s);
          parsed = match ? JSON.parse(match[0]) : [];
        }

        let matched = 0;
        for (const item of (Array.isArray(parsed) ? parsed : [])) {
          if (item.handle && progress.classifications[item.handle] === undefined) {
            progress.classifications[item.handle] = item;
            matched++;
          }
        }
        for (const h of batch) {
          if (!progress.classifications[h]) {
            progress.classifications[h] = { primary_topic: 'unknown', trading_signal_density: 1, post_style: 'parse error', is_aggregator: false, is_dormant: false, quality_score: 1 };
          }
          if (!progress.done.includes(h)) progress.done.push(h);
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`✓ ${matched}/${batch.length} [${elapsed}s]`);

      } catch (e) {
        console.log(`✗ ${e.message.slice(0, 60)}`);
        for (const h of batch) {
          if (!progress.classifications[h]) {
            progress.classifications[h] = { primary_topic: 'error', trading_signal_density: 1, post_style: 'api error', is_aggregator: false, is_dormant: false, quality_score: 1 };
          }
          if (!progress.done.includes(h)) progress.done.push(h);
        }
      }

      progress.batches = batchNum;
      saveJSON(STATE_FILE, progress);
      await delay(200);
    }
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

      const tradingTopics = [
        'US Equities', 'Indian Equities', 'Options/Volatility', 'Crypto',
        'Macro/Rates', 'Futures/Commodities', 'Quant/Systematic',
        'AI/Coding for Traders', 'Finance News',
      ];
      const isTrading = tradingTopics.includes(c.primary_topic || '');

      const E = Math.min(30, endorsed * 1.5);
      const T = isTrading ? Math.min(24, (c.trading_signal_density || 1) * 2.4) : 0;
      const S = Math.min(14, (c.trading_signal_density || 1) * 1.4);
      const Q = (c.primary_topic && c.primary_topic !== 'Personal/Lifestyle' && c.primary_topic !== 'General Business') ? 7 : 3;
      const C = verified ? 8 : (followers > 10000 ? 5 : 2);
      const A = (c.is_dormant ? 1 : 4) + (c.is_aggregator ? -2 : 2);
      const F = 4;
      const P = (c.is_aggregator ? 10 : 0) + (c.is_dormant ? 10 : 0);
      const score = Math.max(0, Math.min(100, E + T + S + Q + C + A + F - P));

      return {
        id: w.id, handle: w.handle, name: w.name, bio: w.bio,
        followers: w.followers, endorsed_by_count: w.followed_by_count, verified: w.verified,
        primary_topic: c.primary_topic || '', secondary_topic: c.secondary_topic || '',
        trading_signal_density: c.trading_signal_density || 1,
        post_style: c.post_style || '',
        is_aggregator: c.is_aggregator ? 'yes' : 'no',
        is_dormant: c.is_dormant ? 'yes' : 'no',
        endorsement_score: Math.round(E), trading_relevance: Math.round(T),
        signal_density: Math.round(S), specialization: Math.round(Q),
        credibility: Math.round(C), activity_quality: Math.round(A),
        fit_score: Math.round(F), penalty: Math.round(P),
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
  console.log(`     Batches: ${progress.batches}`);

  console.log('\n  Top 25:');
  scoredRows.slice(0, 25).forEach((r, i) => {
    const v = r.verified === 'yes' ? '✓' : ' ';
    const already = r.already_followed === 'yes' ? '[FOLLOWING]' : '';
    console.log(`    ${String(i + 1).padStart(2)}. ${v} @${r.handle.padEnd(22)} score:${String(r.total_score).padStart(3)}  ${r.primary_topic.padEnd(22)} ${r.post_style.slice(0, 60)} ${already}`);
  });
})();
