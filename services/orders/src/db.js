'use strict';
const mysql = require('mysql2/promise');
function createPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'storefront',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });
}
let _pool;
function pool() { if (!_pool) _pool = createPool(); return _pool; }
module.exports = { pool, createPool };
