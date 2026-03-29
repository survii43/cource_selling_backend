#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"
mkdir -p docker/mysql-init services/auth/src services/catalog/src services/orders/src services/courses/src services/gateway/src

printf '%s\n' 'node_modules/' '.env' '.env.*' '!.env.example' '**/dist/' '.DS_Store' > "$ROOT/.gitignore"

cat > "$ROOT/package.json" << 'JSON'
{
  "name": "cource-selling-backend",
  "private": true,
  "version": "0.1.0",
  "engines": { "node": ">=20" },
  "workspaces": ["services/*"],
  "scripts": {
    "dev": "concurrently -n gw,auth,cat,ord,crs -c blue,green,yellow,magenta,cyan \"npm run dev -w @cource-selling/gateway\" \"npm run dev -w @cource-selling/auth\" \"npm run dev -w @cource-selling/catalog\" \"npm run dev -w @cource-selling/orders\" \"npm run dev -w @cource-selling/courses\"",
    "start": "npm run start --workspaces --if-present"
  },
  "devDependencies": { "concurrently": "^9.1.2" }
}
JSON

cat > "$ROOT/docker-compose.yml" << 'YML'
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: storefront
    ports:
      - "3307:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./docker/mysql-init:/docker-entrypoint-initdb.d:ro
volumes:
  mysql_data:
YML

cat > "$ROOT/docker/mysql-init/01-databases.sql" << 'SQL'
CREATE DATABASE IF NOT EXISTS auth_db;
CREATE DATABASE IF NOT EXISTS catalog_db;
CREATE DATABASE IF NOT EXISTS orders_db;
CREATE DATABASE IF NOT EXISTS courses_db;
SQL

write_service() {
  local n="$1" port="$2" db="$3"
  local D="$ROOT/services/$n"
  mkdir -p "$D/src"
  cat > "$D/package.json" << EOF
{
  "name": "@cource-selling/$n",
  "version": "0.1.0",
  "private": true,
  "main": "src/server.js",
  "scripts": { "start": "node src/server.js", "dev": "nodemon src/server.js" },
  "dependencies": {
    "bcrypt": "^5.1.1",
    "compression": "^1.7.5",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "mysql2": "^3.12.0",
    "zod": "^3.24.1"
  },
  "devDependencies": { "nodemon": "^3.1.9" }
}
EOF
  cat > "$D/src/db.js" << 'JS'
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
JS
  cat > "$D/src/server.js" << EOF
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { pool } = require('./db');
const app = express();
const port = Number(process.env.PORT) || ${port};
const serviceName = process.env.SERVICE_NAME || '${n}';
app.use(helmet());
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: serviceName }); });
app.get('/health/db', async (_req, res) => {
  try {
    const [rows] = await pool().query('SELECT 1 AS ok');
    res.json({ status: 'ok', mysql: rows });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
app.listen(port, () => { console.log('[' + serviceName + '] http://localhost:' + port); });
EOF
  cat > "$D/env.example" << EOF
PORT=${port}
SERVICE_NAME=${n}
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=rootpass
MYSQL_DATABASE=${db}
JWT_SECRET=change-me-to-a-long-random-secret
EOF
}
write_service auth 3001 auth_db
write_service catalog 3002 catalog_db
write_service orders 3003 orders_db
write_service courses 3004 courses_db

G="$ROOT/services/gateway"
cat > "$G/package.json" << 'JSON'
{
  "name": "@cource-selling/gateway",
  "version": "0.1.0",
  "private": true,
  "main": "src/server.js",
  "scripts": { "start": "node src/server.js", "dev": "nodemon src/server.js" },
  "dependencies": {
    "compression": "^1.7.5",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "http-proxy-middleware": "^3.0.3"
  },
  "devDependencies": { "nodemon": "^3.1.9" }
}
JSON
cat > "$G/src/server.js" << 'JS'
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const port = Number(process.env.PORT) || 8080;
const targets = {
  auth: process.env.AUTH_URL || 'http://127.0.0.1:3001',
  catalog: process.env.CATALOG_URL || 'http://127.0.0.1:3002',
  orders: process.env.ORDERS_URL || 'http://127.0.0.1:3003',
  courses: process.env.COURSES_URL || 'http://127.0.0.1:3004',
};
app.use(helmet());
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'gateway', routes: targets }); });
app.use('/auth', createProxyMiddleware({ target: targets.auth, changeOrigin: true, pathRewrite: { '^/auth': '' } }));
app.use('/catalog', createProxyMiddleware({ target: targets.catalog, changeOrigin: true, pathRewrite: { '^/catalog': '' } }));
app.use('/orders', createProxyMiddleware({ target: targets.orders, changeOrigin: true, pathRewrite: { '^/orders': '' } }));
app.use('/courses', createProxyMiddleware({ target: targets.courses, changeOrigin: true, pathRewrite: { '^/courses': '' } }));
app.listen(port, () => { console.log('[gateway] http://localhost:' + port); });
JS
cat > "$G/env.example" << 'EOF'
PORT=8080
AUTH_URL=http://127.0.0.1:3001
CATALOG_URL=http://127.0.0.1:3002
ORDERS_URL=http://127.0.0.1:3003
COURSES_URL=http://127.0.0.1:3004
EOF

cat > "$ROOT/README.md" << 'MD'
# Course selling backend (microservices)
See frontend: `docs/BACKEND_REQUIREMENTS_FROM_FRONTEND.md`.
Run: `npm install`, copy each `env.example` to `.env`, `docker compose up -d mysql`, `npm run dev`.
Gateway health: http://localhost:8080/health
MD
echo "Scaffold complete. Next: npm install"
