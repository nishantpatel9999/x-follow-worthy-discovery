require('dotenv').config();
const { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const FOF_CSV = `${DATA_DIR}/all-follow-of-follows.csv`;
const MY_FOLLOWS_CSV = `${DATA_DIR}/my-follows-enriched.csv`;
const CSV_OUT = `${DATA_DIR}/follow-worthy.csv`;
const STATE_FILE = `${STATE_DIR}/phase4-enrich.json`;

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
  console.log('[Phase 4] Enriching all unique follows-of-follows + ranking...');

  if (!fs.existsSync(FOF_CSV)) {
    console.error(`  Missing ${FOF_CSV}. Run phase 3 first.`);
    process.exit(1);
  }

  const allRelations = parseCSV(FOF_CSV);
  console.log(`  Loaded ${allRelations.length} follow relationships.`);

  const uniqueIds = [...new Set(allRelations.map(r => r.follows_id).filter(Boolean))];
  console.log(`  ${uniqueIds.length} unique handles to enrich.`);

  const progress = loadJSON(STATE_FILE) || { enriched: {}, totalCreditsUsed: 0 };
  const profiles = { ...progress.enriched };
  const remaining = uniqueIds.filter(id => !profiles[id]);

  console.log(`  Already enriched: ${Object.keys(profiles).length}, remaining: ${remaining.length}.`);

  if (remaining.length === 0) {
    console.log('  All profiles already enriched. Skipping to ranking...');
  } else {
    // Batch lookup by ID (100 per request)
    const BATCH_SIZE = 100;

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE);
      const start = i + 1;
      const end = Math.min(i + BATCH_SIZE, remaining.length);
      process.stdout.write(`  [${start}-${end}/${remaining.length}] `);

      try {
        const res = await xfetch('/users', { ids: batch.join(',') });
        const users = res.data || [];

        for (const u of users) {
          profiles[u.id] = {
            handle: u.username || '',
            name: (u.name || '').replace(/[,\n\r]/g, ' '),
            bio: (u.description || '').replace(/[\n\r]/g, ' '),
            followers: u.follower_count || 0,
            following: u.following_count || 0,
            tweets: u.tweet_count || 0,
            verified: u.verified || false,
            joined: u.created_at || '',
          };
        }

        const charged = res.meta?.credits?.charged || 0;
        const remCredits = res.meta?.credits?.remaining || 0;
        progress.totalCreditsUsed += charged;
        console.log(`${users.length} profiles (credits: -${charged}, ${remCredits} left)`);

      } catch (e) {
        console.log(`error: ${e.message}`);
        if (e.message.includes('402') || e.message.includes('insufficient_credits')) {
          console.log('  Out of credits! Stopping.');
          break;
        }
      }

      progress.enriched = profiles;
      saveJSON(STATE_FILE, progress);
      await delay(300);
    }
  }

  // Count popularity: how many of your follows follow each handle
  const countMap = {};
  const sourceMap = {};
  for (const rel of allRelations) {
    countMap[rel.follows_id] = (countMap[rel.follows_id] || 0) + 1;
    if (!sourceMap[rel.follows_id]) sourceMap[rel.follows_id] = new Set();
    sourceMap[rel.follows_id].add(rel.source_handle);
  }

  // Build final ranked rows
  const rows = Object.entries(profiles).map(([id, p]) => ({
    id,
    handle: p.handle,
    name: p.name,
    bio: p.bio,
    followers: p.followers,
    following: p.following,
    tweets: p.tweets,
    verified: p.verified ? 'yes' : 'no',
    joined: p.joined,
    followed_by_count: countMap[id] || 0,
    followed_by: [...(sourceMap[id] || [])].slice(0, 10).join('|'),
  }));

  // Rank: verified first, then by followed_by_count, then by followers
  rows.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified === 'yes' ? -1 : 1;
    if (b.followed_by_count !== a.followed_by_count) return b.followed_by_count - a.followed_by_count;
    return b.followers - a.followers;
  });

  const headers = ['id', 'handle', 'name', 'bio', 'followers', 'following', 'tweets', 'verified', 'joined', 'followed_by_count', 'followed_by'];
  const csvRows = rows.map(r => [r.id, r.handle, r.name, r.bio, r.followers, r.following, r.tweets, r.verified, r.joined, r.followed_by_count, r.followed_by]);
  saveCSV(CSV_OUT, csvRows, headers);

  console.log(`\n  Done! ${rows.length} handles ranked.`);
  console.log(`  Total credits used: ${progress.totalCreditsUsed}`);
  console.log(`  Output: ${CSV_OUT}`);

  console.log('\n  Top 25:');
  rows.slice(0, 25).forEach((r, i) => {
    const vBadge = r.verified === 'yes' ? '✓' : ' ';
    console.log(`    ${String(i + 1).padStart(2)}. ${vBadge} @${r.handle.padEnd(20)} followed by ${String(r.followed_by_count).padStart(3)}  ${r.followers.toLocaleString()} followers  ${r.bio.slice(0, 60)}`);
  });
})();
