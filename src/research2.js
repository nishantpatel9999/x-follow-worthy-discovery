require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { xfetch, delay, saveCSV } = require('./xfetch-client');

const HANDLES_FILE = './data/research2-handles.json';
const OUT_DIR = './data/research2';
const DAYS_BACK = 15;

function analyzeSentiment(text) {
  const lower = (text || '').toLowerCase();
  const bullish = ['bullish', 'breakout', 'rally', 'green', 'long', 'buy', 'strength',
    'upside', 'rip', 'moon', 'pump', 'ath', 'new high', 'upgrad', 'beat', 'outperform',
    'accumulat', 'add', 'conviction', 'bounce', 'oversold', 'dip buying'];
  const bearish = ['bearish', 'breakdown', 'sell', 'red', 'short', 'weak', 'downside',
    'dump', 'crash', 'correction', 'downgrad', 'miss', 'underperform', 'distribution',
    'caution', 'risk-off', 'defensive', 'overbought', 'recession', 'tariff'];
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
    daily[key].tweets.push({ handle: t.handle, text: (t.text || '').slice(0, 150), sentiment: t.sentiment, time: dt.toISOString().slice(11, 16) });
  }
  return Object.keys(daily).sort().map(date => {
    const d = daily[date];
    const score = d.total === 0 ? 50 : ((d.bullish - d.bearish) / d.total) * 50 + 50;
    return {
      date, bullish: d.bullish, bearish: d.bearish, neutral: d.neutral, total: d.total,
      sentiment_score: Math.round(score * 10) / 10,
      sentiment_label: score > 60 ? 'bullish' : (score < 40 ? 'bearish' : 'neutral'),
      sample_tweets: d.tweets.slice(0, 3).map(t => `@${t.handle}: ${t.text}`),
    };
  });
}

(async () => {
  const targets = JSON.parse(fs.readFileSync(HANDLES_FILE, 'utf-8'));
  const handles = targets.map(t => t.handle);
  console.log(`[research2] xfetch pipeline — ${handles.length} US trading accounts`);
  console.log(`  Est: ~${handles.length * 21} credits`);

  // Phase 1: Resolve handles + fetch tweets
  let totalCredits = 0;
  const allTweets = [];

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    process.stdout.write(`  [${i + 1}/${handles.length}] @${handle} `);

    try {
      const userRes = await xfetch(`/users/by-username/${handle}`);
      const uid = userRes.data.id;
      totalCredits++;

      const tweetsRes = await xfetch(`/users/${uid}/tweets`);
      const tweets = tweetsRes.data || [];
      const charged = tweetsRes.meta?.credits?.charged || 0;
      totalCredits += charged;
      const remaining = tweetsRes.meta?.credits?.remaining || 0;

      for (const t of tweets) {
        allTweets.push({
          handle, tweet_id: t.id, created_at: t.created_at,
          text: t.text || '', likes: t.like_count || 0, retweets: t.retweet_count || 0,
          replies: t.reply_count || 0, is_retweet: t.is_retweet, sentiment: null,
        });
      }
      console.log(`${tweets.length} tweets (${remaining} credits left)`);
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
    await delay(300);
  }

  console.log(`\n  Total: ${allTweets.length} tweets | ${totalCredits} credits used`);

  // Phase 2: Sentiment
  for (const t of allTweets) t.sentiment = analyzeSentiment(t.text);
  const sc = {};
  for (const t of allTweets) sc[t.sentiment] = (sc[t.sentiment] || 0) + 1;
  console.log(`  Bullish: ${sc.bullish || 0} | Bearish: ${sc.bearish || 0} | Neutral: ${sc.neutral || 0}`);

  // Phase 3: Timeline
  const timeline = buildTimeline(allTweets);

  // Phase 4: Save
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  saveCSV(path.join(OUT_DIR, 'tweets.csv'),
    allTweets.map(t => [t.handle, t.created_at, (t.text || '').replace(/[\n\r]/g, ' '), t.sentiment, t.likes, t.retweets, t.replies, t.is_retweet ? 'yes' : 'no']),
    ['handle', 'created_at', 'text', 'sentiment', 'likes', 'retweets', 'replies', 'is_retweet']);

  saveCSV(path.join(OUT_DIR, 'timeline.csv'),
    timeline.map(t => [t.date, t.bullish, t.bearish, t.neutral, t.total, t.sentiment_score, t.sentiment_label]),
    ['date', 'bullish', 'bearish', 'neutral', 'total', 'sentiment_score', 'sentiment_label']);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SENTIMENT TIMELINE (${timeline.length} days)`);
  console.log(`${'='.repeat(60)}`);
  for (const t of timeline) {
    const bar = '█'.repeat(Math.round(t.sentiment_score / 5));
    const label = t.sentiment_label === 'bullish' ? '🟢' : t.sentiment_label === 'bearish' ? '🔴' : '⚪';
    console.log(`  ${t.date}  ${label} ${t.sentiment_label.toUpperCase().padEnd(8)}  ${String(t.sentiment_score).padStart(5)}  ${bar}`);
  }

  console.log(`\n  Outputs: ${OUT_DIR}/tweets.csv, ${OUT_DIR}/timeline.csv`);
})();
