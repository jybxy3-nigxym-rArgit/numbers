'use strict';

// Runs worker.mjs on plain Node so the same end-to-end test can check the Cloudflare version.
// A tiny stand-in for D1 (on top of built-in SQLite) plays the database; the real D1 is not used here.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');

class Stmt {
  constructor(sql) {
    this.sql = sql;
    this.params = [];
  }
  bind(...p) {
    if (p.some((x) => x === undefined)) throw new Error('D1 cannot bind undefined');
    this.params = p;
    return this;
  }
  _exec() {
    const st = sqlite.prepare(this.sql);
    if (/^\s*select/i.test(this.sql)) return { results: st.all(...this.params), meta: { changes: 0, last_row_id: 0 } };
    const r = st.run(...this.params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() {
    return this._exec();
  }
  async first() {
    return this._exec().results[0] ?? null;
  }
  async run() {
    return this._exec();
  }
}

const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(stmts) {
    sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._exec());
      sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
};

const env = { DB, ADMIN_PHONE: process.env.ADMIN_PHONE || '', REQUIRE_APPROVAL: process.env.REQUIRE_APPROVAL || '' };
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

(async () => {
  const worker = (await import('../worker.mjs')).default;
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://x').pathname;
      const file = path.join(PUBLIC_DIR, pathname);
      if (pathname !== '/' && file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'image/svg+xml' });
        return res.end(fs.readFileSync(file));
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) headers.set(k, String(v));
      headers.set('cf-connecting-ip', req.socket.remoteAddress);
      const init = { method: req.method, headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') init.body = Buffer.concat(chunks);
      const r = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, init), env);
      const out = {};
      r.headers.forEach((v, k) => k !== 'set-cookie' && (out[k] = v));
      const cookies = r.headers.getSetCookie();
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end('sim error');
    }
  });
  server.listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log('worker sim running'));
})();
