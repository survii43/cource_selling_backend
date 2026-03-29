'use strict';
const AUTH_URL = process.env.AUTH_URL || 'http://127.0.0.1:3001';

async function verifyBearer(req) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) {
    return null;
  }
  const r = await fetch(`${AUTH_URL}/internal/verify`, {
    headers: { Authorization: h },
  });
  if (!r.ok) {
    return null;
  }
  return r.json();
}

function requireCustomer(req, res, next) {
  verifyBearer(req)
    .then((u) => {
      if (!u || u.role !== 'customer') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = u;
      next();
    })
    .catch(next);
}

function requireInternalKey(req, res, next) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || req.headers['x-internal-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { verifyBearer, requireCustomer, requireInternalKey };
