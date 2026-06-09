require('dotenv').config();
const { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, YOUR_HANDLE, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');
const path = require('path');

const STATE_FILE = `${STATE_DIR}/phase1-xfetch.json`;
const CSV_OUT = `${DATA_DIR}/my-follows-phase1.csv`;

(async () => {
  console.log('[Phase 1] Fetching your follows via xfetch (no browser, no login)...');

  if (!XFETCH_KEY) {
    console.error('  Set XFETCH_API_KEY in .env. Get one free at https://xfetch.io');
    process.exit(1);
  }
  if (!YOUR_HANDLE) {
    console.error('  Set YOUR_HANDLE in .env');
    process.exit(1);
  }

  const resume = loadJSON(STATE_FILE);
  if (resume?.done) {
    console.log('  Already complete. Delete state/phase1-xfetch.json to re-run.');
    return;
  }

  // Step 1: Look up your handle to get numeric ID
  console.log(`  Looking up @${YOUR_HANDLE}...`);
  const profileRes = await xfetch(`/users/by-username/${YOUR_HANDLE}`);
  const userId = profileRes.data.id;
  const followingCount = profileRes.data.following_count;
  console.log(`  User ID: ${userId}, following: ${followingCount}`);

  // Step 2: Paginate through following list (mode=ids — cheapest)
  const allHandles = [];
  let nextToken = resume?.nextToken || null;
  let page = resume?.page || 0;

  console.log('  Fetching following list (IDs only)...');
  do {
    page++;
    const params = { mode: 'ids', limit: 5000 };
    if (nextToken) params.next_token = nextToken;

    const res = await xfetch(`/users/${userId}/following`, params);
    const batch = (res.data || []).map(d => d.id);
    allHandles.push(...batch);

    const charged = res.meta?.credits?.charged || 0;
    const remaining = res.meta?.credits?.remaining || 0;
    console.log(`  Page ${page}: ${batch.length} IDs (credits: -${charged}, ${remaining} left)`);

    nextToken = res.meta?.pagination?.next_token || null;

    // intermediate save — IDs only, no bios yet
    saveJSON(STATE_FILE, { nextToken, page, count: allHandles.length, idsOnly: true });

    if (nextToken) await delay(500);

  } while (nextToken);

  console.log(`  Got ${allHandles.length} user IDs.`);

  // Step 3: Batch resolve IDs to usernames (100 per call)
  console.log('  Resolving IDs to usernames...');
  const BATCH_SIZE = 100;
  const resolved = [];

  for (let i = 0; i < allHandles.length; i += BATCH_SIZE) {
    const batch = allHandles.slice(i, i + BATCH_SIZE);
    const start = i + 1;
    const end = Math.min(i + BATCH_SIZE, allHandles.length);
    process.stdout.write(`  [${start}-${end}/${allHandles.length}] `);

    try {
      const res = await xfetch('/users', { ids: batch.join(',') });
      const users = res.data || [];
      for (const u of users) {
        if (u.username) {
          resolved.push({ handle: u.username, profile_url: `https://x.com/${u.username}` });
        }
      }
      const charged = res.meta?.credits?.charged || 0;
      const remaining = res.meta?.credits?.remaining || 0;
      console.log(`${users.length} usernames (credits: -${charged}, ${remaining} left)`);
    } catch (e) {
      console.log(`error: ${e.message}`);
      if (e.message.includes('402')) {
        console.log('  Out of credits! Stopping. Top up and re-run.');
        break;
      }
    }

    saveJSON(STATE_FILE, { resolved: resolved.length, total: allHandles.length });
    await delay(300);
  }

  // Save final CSV
  const csvRows = resolved.map(r => [r.handle, r.profile_url]);
  saveCSV(CSV_OUT, csvRows, ['handle', 'profile_url']);
  saveJSON(STATE_FILE, { done: true, count: resolved.length, timestamp: new Date().toISOString() });

  console.log(`\n  ✅ Phase 1 complete.`);
  console.log(`     ${resolved.length} handles saved to ${CSV_OUT}`);
  console.log('');
  console.log('  Next: ./run.sh phase2  (enriches bios — no account needed)');
})();
