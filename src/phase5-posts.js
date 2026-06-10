require('dotenv').config();
const { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const CSV_IN = `${DATA_DIR}/follow-worthy.csv`;
const CSV_OUT = `${DATA_DIR}/posts-sample.csv`;
const STATE_FILE = `${STATE_DIR}/phase5-posts.json`;

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

(async () => {
  console.log('[Phase 5] Post sampling for top handles (endorsed by ≥5)...');

  if (!XFETCH_KEY) {
    console.error('  Set XFETCH_API_KEY in .env');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_IN)) {
    console.error(`  Missing ${CSV_IN}. Run phase 4 first.`);
    process.exit(1);
  }

  const allRows = parseCSV(CSV_IN);
  const targets = allRows
    .filter(r => parseInt(r.followed_by_count) >= 5 && r.id)
    .sort((a, b) => parseInt(b.followed_by_count) - parseInt(a.followed_by_count));

  console.log(`  Loaded ${allRows.length} handles, ${targets.length} with ≥5 endorsements.`);

  // Drop targets we already follow (cross-reference enriched csv)
  const myFollows = new Set();
  if (fs.existsSync(`${DATA_DIR}/my-follows-enriched.csv`)) {
    const enriched = parseCSV(`${DATA_DIR}/my-follows-enriched.csv`);
    for (const f of enriched) myFollows.add(f.handle);
  }
  const newTargets = targets.filter(t => !myFollows.has(t.handle));
  console.log(`  Already follow ${targets.length - newTargets.length}, ${newTargets.length} new to sample.`);

  const progress = loadJSON(STATE_FILE) || { done: [], totalCredits: 0 };
  const pending = newTargets.filter(t => !progress.done.includes(t.id));

  console.log(`  Already sampled: ${progress.done.length}, remaining: ${pending.length}.`);
  if (pending.length === 0) {
    console.log('  All done!');
    return;
  }

  // Load existing output
  let existing = [];
  if (fs.existsSync(CSV_OUT)) {
    existing = parseCSV(CSV_OUT);
  }
  const seenPosts = new Set(existing.map(r => `${r.handle}||${r.post_id}`));

  const headers = ['handle', 'handle_id', 'endorsed_by_count', 'post_id', 'created_at', 'text', 'is_reply', 'is_retweet', 'like_count', 'retweet_count', 'reply_count', 'quote_count'];
  let totalCredits = progress.totalCredits;
  let newPosts = 0;

  for (let i = 0; i < pending.length; i++) {
    const t = pending[i];
    process.stdout.write(`  [${progress.done.length + 1}/${newTargets.length}] @${t.handle} `);

    try {
      const res = await xfetch(`/users/${t.id}/tweets`);
      const tweets = res.data || [];
      const charged = res.meta?.credits?.charged || 0;
      const remaining = res.meta?.credits?.remaining || 0;
      totalCredits += charged;

      const newRows = [];
      for (const tw of tweets) {
        const key = `${t.handle}||${tw.id}`;
        if (seenPosts.has(key)) continue;
        seenPosts.add(key);
        newRows.push([
          t.handle,
          t.id,
          t.followed_by_count,
          tw.id,
          tw.created_at || '',
          (tw.text || '').replace(/[\n\r]/g, ' ').slice(0, 500),
          tw.is_reply ? 'yes' : 'no',
          tw.is_retweet ? 'yes' : 'no',
          tw.like_count || 0,
          tw.retweet_count || 0,
          tw.reply_count || 0,
          tw.quote_count || 0,
        ]);
      }

      newPosts += newRows.length;
      const allRows = [...existing.map(r => [
        r.handle, r.handle_id, r.endorsed_by_count, r.post_id, r.created_at, r.text,
        r.is_reply, r.is_retweet, r.like_count, r.retweet_count, r.reply_count, r.quote_count,
      ]), ...newRows];

      saveCSV(CSV_OUT, allRows, headers);
      existing = allRows.map(r => ({
        handle: r[0], handle_id: r[1], endorsed_by_count: r[2], post_id: r[3],
        created_at: r[4], text: r[5], is_reply: r[6], is_retweet: r[7],
        like_count: r[8], retweet_count: r[9], reply_count: r[10], quote_count: r[11],
      }));

      console.log(`${tweets.length} tweets, ${remaining} credits left`);

    } catch (e) {
      console.log(`error: ${e.message}`);
      if (e.message.includes('402')) {
        console.log('  Out of credits! Top up and re-run.');
        break;
      }
    }

    progress.done.push(t.id);
    progress.totalCredits = totalCredits;
    saveJSON(STATE_FILE, progress);
    await delay(500);
  }

  console.log(`\n  ✅ Phase 5 done. ${newPosts} new posts from ${progress.done.length} handles.`);
  console.log(`     Credits used: ${totalCredits}`);
  console.log(`     Output: ${CSV_OUT}`);
})();
