'use strict';

// Node back end: the built-in SQLite, wrapped in the small async "driver" that store.js expects.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { createStore } = require('./store');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'site.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const isSelect = (sql) => /^\s*select/i.test(sql);

const driver = {
  async all(sql, params = []) {
    return db.prepare(sql).all(...params);
  },
  async first(sql, params = []) {
    return db.prepare(sql).get(...params) ?? null;
  },
  async run(sql, params = []) {
    const r = db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  },
  async batch(stmts) {
    const out = [];
    db.exec('BEGIN');
    try {
      for (const s of stmts) {
        const params = s.params || [];
        if (isSelect(s.sql)) out.push({ rows: db.prepare(s.sql).all(...params), changes: 0, lastId: 0 });
        else {
          const r = db.prepare(s.sql).run(...params);
          out.push({ rows: [], changes: Number(r.changes), lastId: Number(r.lastInsertRowid) });
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return out;
  },
};

module.exports = { db, store: createStore(driver) };
