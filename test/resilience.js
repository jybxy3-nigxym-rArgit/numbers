'use strict';

// Checks for crowds and database hiccups: reads are repeated after a short D1 error, writes are not,
// a started server instance skips the table check when nothing changed, and ad views are written in groups.
// Run with:  node --disable-warning=ExperimentalWarning test/resilience.js

const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../store');
const config = require('../config');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (extra !== undefined ? '\n         ' + String(extra).slice(0, 300) : ''));
  }
};

function sqliteDriver(db, counter) {
  const isSelect = (sql) => /^\s*(select|pragma)/i.test(sql);
  return {
    async all(sql, p = []) { counter.n++; return db.prepare(sql).all(...p); },
    async first(sql, p = []) { counter.n++; return db.prepare(sql).get(...p) ?? null; },
    async run(sql, p = []) { counter.n++; const r = db.prepare(sql).run(...p); return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }; },
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => {
          counter.n++;
          if (isSelect(s.sql)) return { rows: db.prepare(s.sql).all(...(s.params || [])), changes: 0, lastId: 0 };
          const r = db.prepare(s.sql).run(...(s.params || []));
          return { rows: [], changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

(async () => {
  // 1) a new server instance skips the full table check
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const c1 = { n: 0 };
  await createStore(sqliteDriver(db, c1)).ready();
  const c2 = { n: 0 };
  await createStore(sqliteDriver(db, c2)).ready();
  check('first start builds the tables', c1.n > 15, c1.n);
  check('a later instance starts with only a few queries', c2.n <= 3, c2.n);

  // 2) an old database without the signature is still checked in full, then marked
  db.exec("DELETE FROM meta WHERE k = 'schema_sig'");
  const c3 = { n: 0 };
  await createStore(sqliteDriver(db, c3)).ready();
  check('a database without the signature is checked again', c3.n > 15, c3.n);

  // 3) ad views are written in groups
  config.viewFlushMs = 60000;
  const c4 = { n: 0 };
  const st = createStore(sqliteDriver(db, c4));
  await st.ready();
  db.exec("INSERT INTO users (id, phone, name, pass_hash) VALUES (1, '500000001', 'a', 'x')");
  db.exec("INSERT INTO listings (id, user_id, number, network, city, contact, price) VALUES (1, 1, '0555123987', 'stc', 'riyadh', '0500000001', 500)");
  const before = c4.n;
  await st.bumpViews(1); // first one is written at once
  const afterFirst = c4.n;
  await st.bumpViews(1);
  await st.bumpViews(1);
  check('the first view is written, the next ones wait', afterFirst > before && c4.n === afterFirst, [before, afterFirst, c4.n]);
  config.viewFlushMs = 0;
  await st.bumpViews(1);
  const row = db.prepare('SELECT views FROM listings WHERE id = 1').get();
  const day = db.prepare('SELECT COALESCE(SUM(views),0) AS v FROM views_daily').get();
  check('waiting views are added up correctly', row.views === 4 && day.v === 4, [row, day]);

  // 4) a view write that fails does not lose the count and does not break the caller's page (the caller ignores the error)
  let failNext = true;
  const base = sqliteDriver(db, { n: 0 });
  const flaky = { ...base, async batch(s) { if (failNext) { failNext = false; throw new Error('D1_ERROR: overloaded'); } return base.batch(s); } };
  const st2 = createStore(flaky);
  await st2.ready();
  let threw = false;
  try { await st2.bumpViews(1); } catch { threw = true; }
  await st2.bumpViews(1);
  const row2 = db.prepare('SELECT views FROM listings WHERE id = 1').get();
  check('a failed view write is kept and written next time', threw && row2.views === 6, row2);

  // 5) D1 reads are repeated after a short error; writes are not
  const d1 = require('../d1');
  let tries = 0;
  const fakeDb = {
    prepare: () => ({ bind: () => ({
      all: async () => { tries++; if (tries < 3) throw new Error('D1_ERROR: Network connection lost'); return { results: [{ v: 1 }] }; },
      first: async () => ({ ok: 1 }),
      run: async () => { tries++; throw new Error('D1_ERROR: Network connection lost'); },
    }) }),
    batch: async () => [],
  };
  const s2 = d1.storeFor(fakeDb);
  // reach the driver through a store method that only reads
  const rows = await s2.__driverForTest.all('SELECT 1');
  check('a read that failed twice works on the third try', rows.length === 1 && tries === 3, tries);
  tries = 0;
  let writeFailed = false;
  try { await s2.__driverForTest.run('UPDATE x SET y = 1'); } catch { writeFailed = true; }
  check('a failed write is not repeated', writeFailed && tries === 1, tries);

  // 6) the upkeep runs at most once per interval unless it is forced, and one failing step does not stop the others
  config.maintMinMs = 600000;
  const c6 = { n: 0 };
  const st3 = createStore(sqliteDriver(db, c6));
  await st3.ready();
  const m1 = await st3.maintenance();
  const afterM1 = c6.n;
  const m2 = await st3.maintenance();
  check('upkeep started twice in a row runs once', !m1.skipped && m2.skipped && c6.n === afterM1, [m1, m2]);
  const m3 = await st3.maintenance({ force: true });
  check('the hourly job always runs the upkeep', !m3.skipped && c6.n > afterM1, m3);
  let boom = true;
  const base7 = sqliteDriver(db, { n: 0 });
  const flaky7 = { ...base7, async run(sql, p) { if (boom && /DELETE FROM listing_likes/.test(sql)) throw new Error('D1_ERROR: overloaded'); return base7.run(sql, p); } };
  const st4 = createStore(flaky7);
  await st4.ready();
  const origErr = console.error; console.error = () => {};
  const m4 = await st4.maintenance({ force: true });
  console.error = origErr;
  check('a failing upkeep step is counted and the others still run', m4.errors === 1 && !m4.skipped, m4);

  // 7) identical searches within a few seconds are answered from memory; a write clears them
  config.searchCacheMs = 15000;
  const c8 = { n: 0 };
  const st5 = createStore(sqliteDriver(db, c8));
  await st5.ready();
  const q = { sort: 'new', limit: 24, offset: 0 };
  const r1 = await st5.searchListings(q);
  const n1 = c8.n;
  const r2 = await st5.searchListings(q);
  check('a repeated search does not touch the database', c8.n === n1 && r2.total === r1.total, [n1, c8.n]);
  r2.rows.length && (r2.rows[0].number = 'changed');
  const r3 = await st5.searchListings(q);
  check('the cached result cannot be changed by a caller', !r3.rows.length || r3.rows[0].number !== 'changed');
  await st5.setMemberFeatured(1, 0);
  const n2 = c8.n;
  await st5.searchListings(q);
  check('a write clears the cached searches', c8.n > n2, [n2, c8.n]);
  config.searchCacheMs = 0;

  // 8) number styles: the new ones match what the owner described, and old ads are tagged again after an update
  const util = require('../util');
  const has = (n, k) => util.patternTags(n).includes(` ${k} `);
  check('five of a kind', has('0555551234', 'quint') && !has('0555512345', 'quint'));
  check('double triple (333 ... 000, not next to each other)', has('0533367000', 'triple_triple') && has('0533312000', 'triple_triple') && !has('0533312300', 'triple_triple'));
  check('a plain four of a kind is not a double triple', !has('0555512345', 'triple_triple'));
  check('four pairs in a row', has('0599009966', 'four_pairs') && has('0511223344', 'four_pairs') && !has('0511223345', 'four_pairs'));
  check('tens: 0 digit 0, but not just the 050 start', has('0503050602', 'tens') && !has('0501234567', 'tens') && !has('0555123456', 'tens'));
  check('hundreds: 00 digit 00', has('0512300200', 'hundreds') && !has('0512300000', 'hundreds'));
  const db9 = new DatabaseSync(':memory:');
  db9.exec('PRAGMA foreign_keys = ON');
  const st9 = createStore(sqliteDriver(db9, { n: 0 }));
  await st9.ready();
  db9.exec("INSERT INTO users (name, phone, pass_hash) VALUES ('t', '500000099', 'x')");
  db9.exec("INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats) VALUES (1, '0533367000', 'stc', 'riyadh', 100, '966500000099', '', 'active', ' triple ')");
  db9.exec("DELETE FROM meta WHERE k = 'schema_sig'");
  await createStore(sqliteDriver(db9, { n: 0 })).ready();
  const tagged = db9.prepare('SELECT pats FROM listings WHERE id = 1').get().pats;
  check('stored ads get the new tags after the update', tagged.includes(' triple_triple ') && tagged === util.patternTags('0533367000'), tagged);

  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('\nAll checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
