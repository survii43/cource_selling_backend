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
    // Fail fast instead of hanging curl/browser when MySQL is down or wrong port.
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS) || 10_000,
  });
}
let _pool;
function pool() { if (!_pool) _pool = createPool(); return _pool; }
module.exports = { pool, createPool };
