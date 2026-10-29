'use strict';

// Hourly sync from the owner's Google Sheet into the admin's ads.
// The sheet publishes ONE tab as CSV with only three columns: number, network, price (no owner names, no cost prices).
// Whole-list rule (same as store.syncStoreList): numbers in the list are added or shown again, prices updated,
// and the admin's other live ads are hidden (never deleted). Bundle rows (two numbers in one cell) are skipped.
// Safety: with SHEET_FEED_APPLY off it only reports what it WOULD do; a broken or too-small list changes nothing.

const { normPhone, toLocal, toWestern } = require('./util');
const { networkOf } = require('./salla');

const META_KEY = 'sheet_feed_last';
const MIN_ROWS = 20; // a list shorter than this is treated as broken
const MAX_HIDE_SHARE = 0.3; // hiding more than this share of the live ads at once is blocked...
const MIN_HIDE_BLOCK = 8; // ...but only when it is more than this many ads
const SAMPLE = 40; // how many numbers of each kind to keep in the report

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// CSV text -> { items: [{ number, price, network, city }], skipped: [text...] }
function parseFeed(text) {
  const best = new Map();
  const skipped = [];
  for (const row of parseCsv(text)) {
    const raw = toWestern(String(row[0] ?? '')).trim();
    if (!raw) continue;
    const groups = raw.match(/\d{9,}/g) || [];
    if (groups.length !== 1) {
      if (groups.length > 1) skipped.push(raw); // a bundle row: the single numbers have their own rows
      continue; // otherwise it is the header line
    }
    const nat = normPhone(groups[0]);
    if (!nat || !/^5\d{8}$/.test(nat)) {
      skipped.push(raw);
      continue;
    }
    const price = Math.round(Number(toWestern(String(row[2] ?? '')).replace(/[^\d.]/g, '')));
    if (!(price > 0)) {
      skipped.push(raw);
      continue;
    }
    const number = toLocal(nat);
    const prev = best.get(number);
    if (!prev || price > prev.price) best.set(number, { number, price, network: networkOf(String(row[1] ?? '')), city: 'other' });
  }
  return { items: [...best.values()], skipped };
}

function cut(list) {
  return (list || []).slice(0, SAMPLE);
}

async function record(store, info) {
  const out = { at: new Date().toISOString(), ...info };
  try {
    await store.metaSet(META_KEY, JSON.stringify(out));
  } catch {
    /* the report is a convenience; never fail the job for it */
  }
  return out;
}

async function run(store, config, fetchFn) {
  if (!config.sheetFeedUrl) return { status: 'off' };
  const doFetch = fetchFn || fetch;
  await store.ready();
  let text;
  try {
    const res = await doFetch(config.sheetFeedUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('http ' + res.status);
    text = await res.text();
    if (/text\/html/i.test(res.headers.get('content-type') || '') || /^\s*</.test(text)) throw new Error('not a CSV (is the sheet tab published?)');
  } catch (e) {
    return record(store, { status: 'error', error: String((e && e.message) || e) });
  }
  const { items, skipped } = parseFeed(text);
  if (items.length < MIN_ROWS) return record(store, { status: 'error', error: `only ${items.length} numbers in the list; expected at least ${MIN_ROWS}` });
  const plan = await store.previewStoreList(items);
  if (!plan) return record(store, { status: 'error', error: 'no admin account' });
  const live = plan.same + plan.updated + plan.hidden;
  const base = {
    rows: items.length,
    skipped: skipped.length,
    added: plan.added,
    shown: plan.shown,
    updated: plan.updated,
    hidden: plan.hidden,
    taken: plan.taken,
    add_numbers: cut(plan.add_numbers),
    price_numbers: cut(plan.price_numbers),
    hide_numbers: cut(plan.hide_numbers),
  };
  if (plan.hidden > MIN_HIDE_BLOCK && plan.hidden > MAX_HIDE_SHARE * live) {
    return record(store, { status: 'blocked', error: `would hide ${plan.hidden} of ${live} live ads at once`, ...base });
  }
  if (!config.sheetFeedApply) return record(store, { status: 'preview', ...base });
  const res = await store.syncStoreList(items);
  return record(store, { status: 'applied', ...base, ...(res || {}) });
}

module.exports = { run, parseFeed, parseCsv, META_KEY };
