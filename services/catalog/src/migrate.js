'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const file = path.join(__dirname, '..', 'migrations', '001_init.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
  const p = pool();
  for (const stmt of statements) {
    await p.query(stmt);
  }
}

module.exports = { migrate };
