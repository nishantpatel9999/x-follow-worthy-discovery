require('dotenv').config();
const { xfetch, delay, XFETCH_KEY, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const CSV_IN = `${DATA_DIR}/my-follows-enriched.csv`;

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
  console.log('[Smoke Test] Phase 3 — single account trial...\n');

  const myFollows = parseCSV(CSV_IN).filter(f => f.id);
  const f = myFollows[0];

  console.log(`  Testing: @${f.handle} (id: ${f.id})`);
  console.log(`  Bio: ${f.bio.slice(0, 100)}`);
  console.log(`  Already follows: ${f.following} accounts\n`);

  console.log('  Fetching their following list...');

  let nextToken = null;
  let pageCount = 0;
  let allIds = [];

  do {
    pageCount++;
    const params = { mode: 'ids', limit: 5000 };
    if (nextToken) params.next_token = nextToken;

    const res = await xfetch(`/users/${f.id}/following`, params);
    const batch = (res.data || []).map(d => d.id);
    allIds.push(...batch);

    const charged = res.meta?.credits?.charged || 0;
    const remaining = res.meta?.credits?.remaining || 0;

    console.log(`    Page ${pageCount}: ${batch.length} IDs (credits: -${charged}, ${remaining} left)`);

    nextToken = res.meta?.pagination?.next_token || null;
    if (nextToken) await delay(300);

  } while (nextToken);

  console.log(`\n  Total IDs collected: ${allIds.length}`);
  console.log(`  First 10: ${allIds.slice(0, 10).join(', ')}`);

  // Resolve first 5 to usernames
  if (allIds.length > 0) {
    console.log(`\n  Resolving first 5 IDs to usernames...`);
    const sample = allIds.slice(0, 5);
    try {
      const res = await xfetch('/users', { ids: sample.join(',') });
      const users = res.data || [];
      const charged = res.meta?.credits?.charged || 0;
      const remaining = res.meta?.credits?.remaining || 0;
      console.log(`    Credits: -${charged}, ${remaining} left`);
      console.log('');
      for (const u of users) {
        console.log(`    @${u.username.padEnd(20)} ${u.name.padEnd(30)} ${u.follower_count.toLocaleString()} followers  ${(u.description || '').slice(0, 70)}`);
      }
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
  }

  console.log(`\n  Smoke test PASSED. Ready for full Phase 3.`);
  console.log(`  Estimated credits for all 168: ~${Math.round(allIds.length * 168 / 20)}`);
})();
