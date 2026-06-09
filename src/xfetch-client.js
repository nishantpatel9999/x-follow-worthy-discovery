require('dotenv').config();
const fs = require('fs');
const path = require('path');

const XFETCH_KEY = process.env.XFETCH_API_KEY;
const YOUR_HANDLE = process.env.YOUR_HANDLE;

const XFETCH_BASE = 'https://api.xfetch.io/v1';
const STATE_DIR = './state';
const DATA_DIR = './data';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function xfetch(path, params = {}) {
  const url = new URL(`${XFETCH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${XFETCH_KEY}` },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5');
    console.log(`  Rate limited. Waiting ${retryAfter}s...`);
    await delay(retryAfter * 1000);
    return xfetch(path, params);
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.error || body?.message || res.statusText;
    throw new Error(`${res.status} ${err}`);
  }

  return body;
}

function saveCSV(filename, rows, headers) {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  let content = headers.map(escape).join(',') + '\n';
  for (const row of rows) {
    content += row.map(escape).join(',') + '\n';
  }
  fs.writeFileSync(filename, content, 'utf-8');
}

function saveJSON(filename, data) {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf-8');
}

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf-8'));
  } catch {
    return null;
  }
}

module.exports = { xfetch, delay, saveCSV, saveJSON, loadJSON, XFETCH_KEY, YOUR_HANDLE, STATE_DIR, DATA_DIR };
