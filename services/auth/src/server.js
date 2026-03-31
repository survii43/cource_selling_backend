'use strict';
require('express-async-errors');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { pool } = require('./db');
const { migrate } = require('./migrate');
const { createAuthRouter, seedAdminIfNeeded } = require('./routes');

const app = express();
const port = Number(process.env.PORT) || 3001;
const serviceName = process.env.SERVICE_NAME || 'auth';

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  }),
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: serviceName });
});
app.get('/health/db', async (_req, res) => {
  try {
    const [rows] = await pool().query('SELECT 1 AS ok');
    res.json({ status: 'ok', mysql: rows });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

app.use(createAuthRouter());

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  // Client closed the connection before the JSON body finished (browser tab, cancelled fetch, etc.)
  if (err && (err.type === 'request.aborted' || err.code === 'ECONNABORTED')) {
    if (!res.headersSent) {
      res.status(400).end();
    }
    return;
  }
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal error' });
  }
});

async function main() {
  await migrate();
  await seedAdminIfNeeded();
  app.listen(port, () => {
    console.log(`[${serviceName}] http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
