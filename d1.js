'use strict';

// Cloudflare back end: D1, wrapped in the small async "driver" that store.js expects.

const { createStore } = require('./store');

// The D1 binding can be a different object on each request, so the driver looks it up every time.
let current = null;
const prep = (s) => current.prepare(s.sql).bind(...(s.params || []));

// D1 now and then answers a read with a short-lived error ("overloaded", "network connection lost") when many visitors arrive at once.
// Reading again a moment later is safe and is what Cloudflare advises, so reads try up to 3 times. Writes are never repeated.
const transient = (e) => /overload|network connection|connection lost|reset|timed? ?out|temporar|unavailable|try again|internal error|busy/i.test(String((e && e.message) || e));
async function retryRead(fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!transient(e) || i === 2) throw e;
      await new Promise((r) => setTimeout(r, 80 * (i + 1) + Math.random() * 80));
    }
  }
  throw last;
}

const driver = {
  async all(sql, params = []) {
    return retryRead(async () => (await current.prepare(sql).bind(...params).all()).results || []);
  },
  async first(sql, params = []) {
    return retryRead(async () => (await current.prepare(sql).bind(...params).first()) ?? null);
  },
  async run(sql, params = []) {
    const r = await current.prepare(sql).bind(...params).run();
    return { changes: r.meta.changes || 0, lastId: r.meta.last_row_id || 0 };
  },
  async batch(stmts) {
    const rs = await current.batch(stmts.map(prep));
    return rs.map((r) => ({
      rows: r.results || [],
      changes: (r.meta && r.meta.changes) || 0,
      lastId: (r.meta && r.meta.last_row_id) || 0,
    }));
  },
};

const store = createStore(driver);

function storeFor(db) {
  current = db;
  return store;
}

// Exposed only so the tests can reach the driver.
store.__driverForTest = driver;

module.exports = { storeFor };
