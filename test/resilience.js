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

  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('\nAll checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
