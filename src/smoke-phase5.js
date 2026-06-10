require('dotenv').config();
const { xfetch, delay, XFETCH_KEY, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

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
  console.log('[Smoke Test] Phase 5 — post sampling, single account...\n');

  const rows = parseCSV(`${DATA_DIR}/follow-worthy.csv`)
    .filter(r => parseInt(r.followed_by_count) >= 5 && r.id)
    .sort((a, b) => parseInt(b.followed_by_count) - parseInt(a.followed_by_count));

  const top = rows[0];
  console.log(`  Testing: @${top.handle} (id: ${top.id})`);
  console.log(`  Endorsed by: ${top.followed_by_count} of your follows`);
  console.log(`  Bio: ${top.bio.slice(0, 80)}`);
  console.log(`\n  Fetching recent tweets...`);

  try {
    const res = await xfetch(`/users/${top.id}/tweets`);
    const tweets = res.data || [];
    const charged = res.meta?.credits?.charged || 0;
    const remaining = res.meta?.credits?.remaining || 0;

    console.log(`  Got ${tweets.length} tweets (credits: -${charged}, ${remaining} left)`);
    console.log('');

    tweets.slice(0, 10).forEach((t, i) => {
      const text = (t.text || '').replace(/\n/g, ' ').slice(0, 120);
      console.log(`    ${i + 1}. [${t.like_count}❤ ${t.retweet_count}🔁] ${text}`);
    });

    console.log(`\n  Smoke test PASSED.`);

  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
})();
