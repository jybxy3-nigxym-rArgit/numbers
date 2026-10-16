'use strict';

// Numbers Market on Node. No external packages. Needs Node 22.13 or newer (built-in SQLite).
// This file only connects Node's http server to app.js, which holds the whole site.
// (On Cloudflare the entry point is worker.mjs instead.)

const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { db, store } = require('./db');
const { handle } = require('./app');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 20000;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

const STATIC_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'public, max-age=86400',
};

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  if (!rel || rel.includes('\0')) return false;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return false;
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return false;
  }
  res.writeHead(200, { ...STATIC_HEADERS, 'Content-Type': type });
  res.end(data);
  return true;
}

function clientIp(req) {
  if (config.trustedHops > 0) {
    const xff = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const i = xff.length - config.trustedHops;
    if (i >= 0) return xff[i];
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function onRequest(req, res) {
  const method = req.method;
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if ((method === 'GET' || method === 'HEAD') && serveStatic(res, pathname)) return;

  const proto =
    config.trustedHops > 0 ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : 'http';
  const host = /^[a-z0-9.\-:]+$/i.test(req.headers.host || '') ? req.headers.host : 'localhost';
  const url = `${proto === 'http' ? 'http' : 'https'}://${host}${req.url}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = await readBody(req);

  const response = await handle(new Request(url, init), { store, ip: clientIp(req) });

  const out = {};
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') out[k] = v;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer((req, res) => {
  onRequest(req, res).catch((err) => {
    if (res.headersSent) return res.end();
    if (err && err.status === 413) {
      res.writeHead(413);
      return res.end();
    }
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  });
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log(`Numbers Market running on http://localhost:${config.port}`);
    if (!config.adminLocal) console.log('Tip: set ADMIN_PHONE to choose the admin account.');
  });
  // Upkeep (automatic refresh for verified advertisers, removal of year-old ads): once an hour.
  const upkeep = () => store.maintenance().catch((e) => console.error('upkeep failed', e.message));
  setTimeout(upkeep, 5000).unref();
  setInterval(upkeep, 3600 * 1000).unref();
  const stop = () => {
    server.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { server };
