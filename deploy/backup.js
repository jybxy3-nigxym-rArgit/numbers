'use strict';

// Copies the database to a dated file and keeps the 14 newest copies.
// Used by the daily cron job that deploy/install.sh sets up. Safe to run while the site is live.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const outDir = process.env.BACKUP_DIR || '/var/backups/numbers';
const keep = Number(process.env.BACKUP_KEEP) || 14;

fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const out = path.join(outDir, `site-${stamp}.db`);
if (fs.existsSync(out)) fs.rmSync(out);

const db = new DatabaseSync(path.join(dataDir, 'site.db'));
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();

const old = fs
  .readdirSync(outDir)
  .filter((f) => /^site-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) fs.rmSync(path.join(outDir, f));

console.log(`Backup saved: ${out}`);
