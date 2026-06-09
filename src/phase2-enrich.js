require('dotenv').config();
const { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const CSV_IN = `${DATA_DIR}/my-follows-phase1.csv`;
const CSV_OUT = `${DATA_DIR}/my-follows-enriched.csv`;
const STATE_FILE = `${STATE_DIR}/phase2-enrich.json`;

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
  console.log('[Phase 2] Enriching seed profiles via xfetch...');

  if (!XFETCH_KEY) {
    console.error('  Set XFETCH_API_KEY in .env');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_IN)) {
    console.error(`  Missing ${CSV_IN}. Run phase 1 first.`);
    process.exit(1);
  }

  const handles = parseCSV(CSV_IN);
  console.log(`  Loaded ${handles.length} handles to enrich.`);

  const progress = loadJSON(STATE_FILE) || { done: [], profiles: {}, totalCreditsUsed: 0 };
  const profiles = { ...progress.profiles };
  const remaining = handles.filter(h => !profiles[h.handle]);

  console.log(`  Already enriched: ${Object.keys(profiles).length}, remaining: ${remaining.length}.`);
  if (remaining.length === 0) {
    console.log('  All done!');
    return;
  }

  const headers = ['id', 'handle', 'name', 'bio', 'followers', 'following', 'tweets', 'verified', 'joined', 'location', 'profile_url', 'scraped_follows'];
  let totalCredits = progress.totalCreditsUsed;

  for (let i = 0; i < remaining.length; i++) {
    const h = remaining[i];
    process.stdout.write(`  [${i + 1}/${remaining.length}] @${h.handle} `);

    try {
      const res = await xfetch(`/users/by-username/${h.handle}`);
      const u = res.data;
      const charged = res.meta?.credits?.charged || 1;
      const rem = res.meta?.credits?.remaining || 0;
      totalCredits += charged;

      profiles[h.handle] = {
        id: u.id,
        handle: u.username,
        name: (u.name || '').replace(/[,\n\r]/g, ' '),
        bio: (u.description || '').replace(/[\n\r]/g, ' '),
        followers: u.follower_count || 0,
        following: u.following_count || 0,
        tweets: u.tweet_count || 0,
        verified: u.verified ? 'yes' : 'no',
        joined: u.created_at || '',
        location: (u.location || '').replace(/,/g, ' '),
        profile_url: `https://x.com/${u.username}`,
        scraped_follows: false,
      };

      process.stdout.write(`→ ${profiles[h.handle].followers} followers, ${rem} credits left\n`);
    } catch (e) {
      if (e.message.includes('402')) {
        console.log(`\n  Out of credits! ${totalCredits} used. Top up and re-run.`);
        break;
      }
      profiles[h.handle] = { id: '', handle: h.handle, name: h.handle, bio: '', followers: 0, following: 0, tweets: 0, verified: 'no', joined: '', location: '', profile_url: h.profile_url, scraped_follows: false };
      process.stdout.write(`→ failed (${e.message})\n`);
    }

    await delay(200);
    progress.profiles = profiles;
    progress.totalCreditsUsed = totalCredits;
    progress.done = Object.keys(profiles);
    saveJSON(STATE_FILE, progress);

    // Save CSV every 25
    if (i % 25 === 0 || i === remaining.length - 1) {
      const allRows = handles.map(hh => {
        const p = profiles[hh.handle] || {};
        return [p.id || '', hh.handle, p.name || '', p.bio || '', p.followers || 0, p.following || 0, p.tweets || 0, p.verified || 'no', p.joined || '', p.location || '', p.profile_url || hh.profile_url, p.scraped_follows ? 'true' : 'false'];
      });
      saveCSV(CSV_OUT, allRows, headers);
    }
  }

  console.log(`\n  ✅ Phase 2 done. ${Object.keys(profiles).length} enriched.`);
  console.log(`     Credits used: ${totalCredits}`);
  console.log(`     Output: ${CSV_OUT}`);
})();
