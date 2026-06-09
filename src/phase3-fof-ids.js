require('dotenv').config();
const { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, STATE_DIR, DATA_DIR } = require('./xfetch-client');
const fs = require('fs');

const CSV_IN = `${DATA_DIR}/my-follows-enriched.csv`;
const CSV_OUT = `${DATA_DIR}/all-follow-of-follows.csv`;
const STATE_FILE = `${STATE_DIR}/phase3-fof-ids.json`;

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
  console.log('[Phase 3] Fetching follows-of-follows IDs via xfetch...');

  if (!XFETCH_KEY) {
    console.error('  Set XFETCH_API_KEY in .env');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_IN)) {
    console.error(`  Missing ${CSV_IN}. Run phase 2 first.`);
    process.exit(1);
  }

  const myFollows = parseCSV(CSV_IN).filter(f => f.id);
  console.log(`  Loaded ${myFollows.length} accounts with resolved IDs.`);

  const progress = loadJSON(STATE_FILE) || { completed: [], totalCreditsUsed: 0 };

  // Parse existing output
  let existing = [];
  if (fs.existsSync(CSV_OUT)) {
    existing = parseCSV(CSV_OUT);
  }
  const seen = new Set(existing.map(r => `${r.source_id}||${r.follows_id}`));

  const pending = myFollows.filter(f => !progress.completed.includes(f.id) && f.id);
  console.log(`  Already done: ${progress.completed.length}, remaining: ${pending.length}.`);
  if (pending.length === 0) {
    console.log('  All done!');
    return;
  }

  const header = ['source_id', 'source_handle', 'follows_id'];
  let totalNew = 0;

  for (let i = 0; i < pending.length; i++) {
    const f = pending[i];
    console.log(`\n  [${progress.completed.length + 1}/${myFollows.length}] @${f.handle} (id: ${f.id})`);

    try {
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
        progress.totalCreditsUsed += charged;

        process.stdout.write(`\r    Page ${pageCount}: ${allIds.length} ids (credits: -${charged}, ${remaining} left)`);

        nextToken = res.meta?.pagination?.next_token || null;
        if (nextToken) await delay(300);

      } while (nextToken);

      console.log('');

      const newRows = allIds
        .filter(fid => !seen.has(`${f.id}||${fid}`))
        .map(fid => [f.id, f.handle, fid]);

      for (const row of newRows) seen.add(`${row[0]}||${row[1]}`);

      const allRows = [...existing.map(r => [r.source_id, r.source_handle, r.follows_id]), ...newRows];
      saveCSV(CSV_OUT, allRows, header);
      existing = allRows.map(r => ({ source_id: r[0], source_handle: r[1], follows_id: r[2] }));

      totalNew += newRows.length;
      console.log(`    ${newRows.length} new. Total: ${allRows.length}. Credits used: ${progress.totalCreditsUsed}`);

    } catch (e) {
      console.log(`    Error: ${e.message}`);
      if (e.message.includes('402') || e.message.includes('insufficient_credits')) {
        console.log('  Out of credits! Stopping. Top up and re-run.');
        break;
      }
    }

    progress.completed.push(f.id);
    saveJSON(STATE_FILE, progress);
    await delay(500);
  }

  console.log(`\n  Done. ${totalNew} new relationships.`);
  console.log(`  Credits used: ${progress.totalCreditsUsed}`);
  console.log(`  Output: ${CSV_OUT}`);
  console.log('');
  console.log('  Next: ./run.sh phase4');
})();
