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
// Allow Flutter web (different localhost port) to call this API; default Helmet
// sets Cross-Origin-Resource-Policy: same-origin and breaks browser fetch().
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
// CORS before compression so OPTIONS preflight finishes quickly (avoids "pending" in Chrome).
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
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'gateway', routes: targets }); });

const proxyCommon = {
  changeOrigin: true,
  timeout: 30_000,
  proxyTimeout: 30_000,
};

app.use(
  '/auth',
  createProxyMiddleware({
    target: targets.auth,
    pathRewrite: { '^/auth': '' },
    ...proxyCommon,
  }),
);
app.use(
  '/catalog',
  createProxyMiddleware({
    target: targets.catalog,
    pathRewrite: { '^/catalog': '' },
    ...proxyCommon,
  }),
);
app.use(
  '/orders',
  createProxyMiddleware({
    target: targets.orders,
    pathRewrite: { '^/orders': '' },
    ...proxyCommon,
  }),
);
app.use(
  '/courses',
  createProxyMiddleware({
    target: targets.courses,
    pathRewrite: { '^/courses': '' },
    ...proxyCommon,
  }),
);

app.listen(port, '0.0.0.0', () => {
  console.log('[gateway] http://127.0.0.1:' + port + ' (and http://localhost:' + port + ')');
});
