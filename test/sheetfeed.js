'use strict';

// Checks the hourly Google-Sheet sync (sheetfeed.js) on a throw-away database.
// Run: node --disable-warning=ExperimentalWarning test/sheetfeed.js [path/to/rows.tsv]

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PHONE = '0599900079';

const config = require('../config');
const { store, db } = require('../db');
const feed = require('../sheetfeed');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok  ' + name);
  else {
    failed++;
    console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
  }
}

const csvOf = (rows) => 'الرقم,المقسم,السعر\n' + rows.map((r) => r.join(',')).join('\n') + '\n';
const fakeFetch = (text, type = 'text/csv; charset=utf-8', ok = true) => async () => ({ ok, status: ok ? 200 : 500, headers: { get: () => type }, text: async () => text });
const row = (number) => db.prepare('SELECT status, hidden_by, price, network, sold_at FROM listings WHERE number = ? ORDER BY id DESC').get(number);
const countLive = () => db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status IN ('active','pending')").get().c;

async function main() {
  const fixture = process.argv[2] || path.join(__dirname, 'sheet-rows.tsv');
  const lines = fs.readFileSync(fixture, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const rows = lines.map(([n, p]) => [n, n === '0500020152' || n === '0500024042' ? 'شحن موبايلي' : 'سوا', p]);

  console.log('parse');
  const parsed = feed.parseFeed(csvOf(rows));
  const singles = lines.filter(([n]) => !n.includes('-')).length;
  check('bundle rows are skipped, singles kept', parsed.items.length === singles && parsed.skipped.length === lines.length - singles, [parsed.items.length, parsed.skipped.length]);
  check('new numbers are listed in Riyadh', parsed.items.every((x) => x.city === 'riyadh'));
  check('network read from the sheet column', parsed.items.find((x) => x.number === '0500020152').network === 'mobily' && parsed.items.find((x) => x.number === '0501022088').network === 'stc');
  const q = feed.parseFeed('الرقم,المقسم,السعر\n"599940909","سوا","1,500"\n0555000111,سوا,٣٠٠\n0555000111,سوا,900\nabc,سوا,5\n0555000222,سوا,\n');
  check('9-digit, quoted, Arabic digits, duplicate keeps the higher price, bad rows skipped', q.items.length === 2 && q.items.find((x) => x.number === '0599940909').price === 1500 && q.items.find((x) => x.number === '0555000111').price === 900, q);

  console.log('database');
  await store.ready();
  const adminId = await store.createUser('599900079', 'admin', 'x');
  const otherId = await store.createUser('555000999', 'member', 'x');
  const mk = (userId, number, price, status = 'active') => store.insertListing({ userId, number, network: 'stc', city: 'riyadh', price, contact: '966599900079', description: '', status });
  await mk(adminId, '0501022088', 250); // price differs from the sheet
  await mk(adminId, '0501133664', 350); // same as the sheet
  await mk(adminId, '0555555555', 999); // not in the sheet -> must be hidden
  await mk(otherId, '0599940909', 1500); // a member already lists this number -> "taken"
  config.sheetFeedUrl = 'https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv';

  console.log('preview (default): reports only');
  config.sheetFeedApply = false;
  let r = await feed.run(store, config, fakeFetch(csvOf(rows)));
  check('status preview', r.status === 'preview', r);
  check('nothing changed in preview', row('0501022088').price === 250 && row('0555555555').status === 'active' && !row('0582088828'));
  check('report lists the price change and the number that would be marked sold', r.price_numbers.includes('0501022088 250→200') && r.sold_numbers.includes('0555555555') && r.sold === 1 && r.taken === 1, r);
  check('report saved for /admin/sync', JSON.parse(await store.metaGet(feed.META_KEY)).status === 'preview');

  console.log('apply');
  config.sheetFeedApply = true;
  r = await feed.run(store, config, fakeFetch(csvOf(rows)));
  check('status applied', r.status === 'applied', r);
  check('price updated to the sheet price', row('0501022088').price === 200);
  check('number missing from the sheet is marked sold (not deleted, not hidden)', row('0555555555').status === 'sold' && row('0555555555').hidden_by === -1 && !!row('0555555555').sold_at);
  check('new numbers added as live ads with the right network', row('0582088828').status === 'active' && row('0500020152').network === 'mobily');
  check('bundle rows were not listed', !row('0550099683-0550099684'));
  check('number held by a member is not duplicated', db.prepare("SELECT COUNT(*) AS c FROM listings WHERE number = '0599940909'").get().c === 1);
  check('live count = sheet singles + (the member ad counted once)', countLive() === singles, [countLive(), singles]);
  r = await feed.run(store, config, fakeFetch(csvOf(rows)));
  check('second run changes nothing', r.status === 'applied' && r.added === 0 && r.updated === 0 && r.sold === 0, r);

  console.log('a number comes back and a price changes');
  const rows2 = rows.map((x) => (x[0] === '0501133664' ? [x[0], x[1], '400'] : x)).concat([['0555555555', 'سوا', '700']]);
  r = await feed.run(store, config, fakeFetch(csvOf(rows2)));
  check('sold-by-sync number is live again with the new price, price edit applied', row('0555555555').status === 'active' && row('0555555555').sold_at === '' && row('0555555555').price === 700 && row('0501133664').price === 400, [row('0555555555'), row('0501133664')]);

  console.log('an ad the owner marked sold by hand stays sold');
  await mk(adminId, '0577999111', 800);
  const hand = db.prepare("SELECT id FROM listings WHERE number = '0577999111'").get().id;
  await store.setListingStatus(hand, 'sold', 0);
  await feed.run(store, config, fakeFetch(csvOf(rows2.concat([['0577999111', 'سوا', '800']]))));
  check('manual sold is not brought back by the sheet', row('0577999111').status === 'sold' && row('0577999111').hidden_by === 0, row('0577999111'));

  console.log('safety: broken inputs change nothing');
  const before = JSON.stringify(db.prepare('SELECT number, status, price FROM listings ORDER BY id').all());
  const same = async (label, fetchFn, expect) => {
    const res = await feed.run(store, config, fetchFn);
    const after = JSON.stringify(db.prepare('SELECT number, status, price FROM listings ORDER BY id').all());
    check(label, res.status === expect && after === before, res);
  };
  await same('HTML page (sheet not published) -> error', fakeFetch('<!doctype html><html></html>', 'text/html'), 'error');
  await same('HTTP error -> error', fakeFetch('', 'text/csv', false), 'error');
  await same('tiny list (broken sheet) -> error', fakeFetch(csvOf(rows.slice(0, 5))), 'error');
  await same('empty list -> error', fakeFetch(''), 'error');
  await same('network failure -> error', async () => {
    throw new Error('boom');
  }, 'error');
  config.sheetFeedUrl = '';
  check('no URL -> off', (await feed.run(store, config, fakeFetch(csvOf(rows)))).status === 'off');
  config.sheetFeedUrl = 'https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv';

  console.log('safety: mass hiding is blocked');
  for (let i = 0; i < 40; i++) await mk(adminId, '0577' + String(100000 + i), 500); // 40 live ads that the sheet does not know
  const before2 = JSON.stringify(db.prepare('SELECT number, status FROM listings ORDER BY id').all());
  r = await feed.run(store, config, fakeFetch(csvOf(rows2)));
  check('marking 40 of ~113 live ads as sold at once is blocked', r.status === 'blocked' && JSON.stringify(db.prepare('SELECT number, status FROM listings ORDER BY id').all()) === before2, r);

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall sheet-feed checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
