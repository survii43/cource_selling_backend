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
