require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { xfetch, delay, saveCSV, loadJSON } = require('./xfetch-client');

const HANDLES_FILE = './data/research1-handles.json';
const ENRICHED_CSV = './data/my-follows-enriched.csv';
const OUT_DIR = './data/research1';
const DAYS_BACK = 15;

function parseEnrichedCSV() {
  const raw = fs.readFileSync(ENRICHED_CSV, 'utf-8');
  const lines = raw.trim().split('\n');
  const headers = lines[0].split(',');
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
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = vals[i] || ''; });
    return obj;
  });
}

function analyzeSentiment(text) {
  const lower = (text || '').toLowerCase();
  const bullish = ['bullish', 'breakout', 'rally', 'green', 'long', 'buy', 'strength',
    'upside', 'rip', 'moon', 'pump', 'ath', 'new high', 'upgrad', 'beat', 'outperform',
    'accumulat', 'add', 'conviction', 'bounce', 'oversold', 'dip buying'];
  const bearish = ['bearish', 'breakdown', 'sell', 'red', 'short', 'weak', 'downside',
    'dump', 'crash', 'correction', 'downgrad', 'miss', 'underperform', 'distribution',
    'caution', 'risk-off', 'defensive', 'overbought', 'top', 'recession', 'tariff'];

  let b = 0, be = 0;
  for (const w of bullish) if (lower.includes(w)) b++;
  for (const w of bearish) if (lower.includes(w)) be++;

  if (b > be) return 'bullish';
  if (be > b) return 'bearish';
  return 'neutral';
}

function buildTimeline(tweets) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_BACK);

  const daily = {};
  for (const t of tweets) {
    const dt = t.created_at ? new Date(t.created_at) : null;
    if (!dt || isNaN(dt.getTime()) || dt < cutoff) continue;
    const key = dt.toISOString().slice(0, 10);
    if (!daily[key]) daily[key] = { bullish: 0, bearish: 0, neutral: 0, total: 0, tweets: [] };
    daily[key][t.sentiment]++;
    daily[key].total++;
    daily[key].tweets.push({
      handle: t.handle,
      text: (t.text || '').slice(0, 150),
      sentiment: t.sentiment,
      time: dt.toISOString().slice(11, 16),
    });
  }

  return Object.keys(daily).sort().map(date => {
    const d = daily[date];
    const score = d.total === 0 ? 50 : ((d.bullish - d.bearish) / d.total) * 50 + 50;
    return {
      date,
      bullish: d.bullish,
      bearish: d.bearish,
      neutral: d.neutral,
      total: d.total,
      sentiment_score: Math.round(score * 10) / 10,
      sentiment_label: score > 60 ? 'bullish' : (score < 40 ? 'bearish' : 'neutral'),
      sample_tweets: d.tweets.slice(0, 3).map(t => `@${t.handle}: ${t.text}`),
    };
  });
}

(async () => {
  console.log('[research1] xfetch-powered sentiment analysis\n');

  const handles = JSON.parse(fs.readFileSync(HANDLES_FILE, 'utf-8'));
  console.log(`  Targets: ${handles.map(h => '@' + h).join(', ')}`);
  console.log(`  Last ${DAYS_BACK} days\n`);

  // Resolve handles to IDs via xfetch (these are discovered accounts, not in enriched CSV)
  const idMap = {};
  for (const h of handles) {
    console.log(`  Resolving @${h}...`);
    const res = await xfetch(`/users/by-username/${h}`);
    idMap[h] = res.data.id;
  }

  // Phase 1: Collect tweets
  const allTweets = [];
  for (const handle of handles) {
    const uid = idMap[handle];
    console.log(`  [${handle}] Fetching tweets (id: ${uid})...`);

    try {
      const res = await xfetch(`/users/${uid}/tweets`);
      const tweets = res.data || [];
      const charged = res.meta?.credits?.charged || 0;
      const remaining = res.meta?.credits?.remaining || 0;

      for (const t of tweets) {
        allTweets.push({
          handle,
          tweet_id: t.id,
          created_at: t.created_at,
          text: t.text || '',
          likes: t.like_count || 0,
          retweets: t.retweet_count || 0,
          replies: t.reply_count || 0,
          is_retweet: t.is_retweet,
          is_reply: t.is_reply,
          sentiment: null,
        });
      }
      console.log(`    ${tweets.length} tweets (credits: -${charged}, ${remaining} left)`);
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
    await delay(500);
  }

  console.log(`\n  Total: ${allTweets.length} tweets`);

  // Phase 2: Sentiment analysis
  console.log('  Classifying sentiment...');
  for (const t of allTweets) {
    t.sentiment = analyzeSentiment(t.text);
  }
  const sentiments = {};
  for (const t of allTweets) sentiments[t.sentiment] = (sentiments[t.sentiment] || 0) + 1;
  console.log(`    Bullish: ${sentiments.bullish || 0} | Bearish: ${sentiments.bearish || 0} | Neutral: ${sentiments.neutral || 0}`);

  // Phase 3: Timeline
  console.log('  Building timeline...');
  const timeline = buildTimeline(allTweets);

  // Phase 4: Save
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Tweets CSV
  saveCSV(
    path.join(OUT_DIR, 'tweets.csv'),
    allTweets.map(t => [t.handle, t.created_at, t.text.replace(/[\n\r]/g, ' '), t.sentiment, t.likes, t.retweets, t.replies, t.is_retweet ? 'yes' : 'no']),
    ['handle', 'created_at', 'text', 'sentiment', 'likes', 'retweets', 'replies', 'is_retweet'],
  );

  // Timeline CSV
  saveCSV(
    path.join(OUT_DIR, 'timeline.csv'),
    timeline.map(t => [t.date, t.bullish, t.bearish, t.neutral, t.total, t.sentiment_score, t.sentiment_label]),
    ['date', 'bullish', 'bearish', 'neutral', 'total', 'sentiment_score', 'sentiment_label'],
  );

  console.log('\n' + '='.repeat(60));
  console.log('  SENTIMENT TIMELINE');
  console.log('='.repeat(60));
  for (const t of timeline) {
    const bar = '█'.repeat(Math.round(t.sentiment_score / 5));
    const label = t.sentiment_label === 'bullish' ? '🟢' : t.sentiment_label === 'bearish' ? '🔴' : '⚪';
    console.log(`  ${t.date}  ${label} ${t.sentiment_label.toUpperCase().padEnd(8)}  score:${String(t.sentiment_score).padStart(5)}  ${bar}`);
    for (const s of t.sample_tweets.slice(0, 2)) {
      console.log(`            ${s.slice(0, 100)}`);
    }
  }

  console.log(`\n  Outputs: ${OUT_DIR}/tweets.csv, ${OUT_DIR}/timeline.csv`);
})();
