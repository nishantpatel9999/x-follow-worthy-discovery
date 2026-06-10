require('dotenv').config();
const fs = require('fs');
const { saveCSV, loadJSON, DATA_DIR, STATE_DIR } = require('./xfetch-client');

const CSV_IN = `${DATA_DIR}/follow-worthy.csv`;
const MY_FOLLOWS_CSV = `${DATA_DIR}/my-follows-enriched.csv`;
const CSV_OUT = `${DATA_DIR}/follow-worthy-scored.csv`;
const STATE_FILE = `${STATE_DIR}/phase6-llm.json`;

// Robust CSV parser that handles quoted fields with commas
function parseCSV(filename) {
  const raw = fs.readFileSync(filename, 'utf-8');
  const lines = raw.trim().split('\n');
  return lines.slice(1).map(line => {
    const vals = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { vals.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    vals.push(current.trim());
    return vals;
  });
}

(async () => {
  console.log('[Phase 6b] Scoring from state JSON...');

  const state = loadJSON(STATE_FILE);
  const classifications = state.classifications || {};
  console.log(`  ${Object.keys(classifications).length} classifications loaded.`);

  // Read follow-worthy using proper parser
  const worthy = fs.readFileSync(CSV_IN, 'utf-8').trim().split('\n');
  const worthyHeaders = worthy[0].split(',').map(h => h.trim());
  const worthyRows = worthy.slice(1).map(line => {
    const vals = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { vals.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    vals.push(current.trim());
    const obj = {};
    worthyHeaders.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });

  // Build my-follows set
  const myFollows = new Set();
  if (fs.existsSync(MY_FOLLOWS_CSV)) {
    const raw = fs.readFileSync(MY_FOLLOWS_CSV, 'utf-8');
    raw.trim().split('\n').slice(1).forEach(line => {
      const firstComma = line.indexOf(',');
      if (firstComma > 0) {
        // skip id, get handle
        const rest = line.slice(firstComma + 1);
        const secondComma = rest.indexOf(',');
        myFollows.add(secondComma > 0 ? rest.slice(0, secondComma) : rest);
      }
    });
  }

  console.log(`  ${worthyRows.length} accounts to score.`);

  const scoredRows = worthyRows
    .filter(w => classifications[w.handle])
    .map(w => {
      const c = classifications[w.handle] || {};
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
        why_follow: `${c.post_style || ''}. ${c.primary_topic || ''}. Endorsed by ${endorsed} of your follows.`,
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

  console.log(`\n  ✅ Scoring done. ${scoredRows.length} handles.`);

  console.log('\n  Top 30:');
  scoredRows.slice(0, 30).forEach((r, i) => {
    const v = r.verified === 'yes' ? '✓' : ' ';
    const already = r.already_followed === 'yes' ? '[FOLLOWING]' : '';
    console.log(`    ${String(i + 1).padStart(2)}. ${v} @${r.handle.padEnd(22)} score:${String(r.total_score).padStart(3)}  ${r.primary_topic.padEnd(25)} ${already}`);
  });

  console.log('');
  console.log('  Topic distribution:');
  const topicCounts = {};
  for (const r of scoredRows) {
    const t = r.primary_topic || 'unknown';
    topicCounts[t] = (topicCounts[t] || 0) + 1;
  }
  Object.entries(topicCounts).sort((a,b) => b[1] - a[1]).slice(0, 12).forEach(([t, c]) => {
    console.log(`    ${t}: ${c}`);
  });
})();
