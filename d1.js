'use strict';

// Cloudflare back end: D1, wrapped in the small async "driver" that store.js expects.

const { createStore } = require('./store');

// The D1 binding can be a different object on each request, so the driver looks it up every time.
let current = null;
const prep = (s) => current.prepare(s.sql).bind(...(s.params || []));

const driver = {
  async all(sql, params = []) {
    return (await current.prepare(sql).bind(...params).all()).results || [];
  },
  async first(sql, params = []) {
    return (await current.prepare(sql).bind(...params).first()) ?? null;
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

module.exports = { storeFor };
