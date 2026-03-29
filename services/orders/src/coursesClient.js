'use strict';
const COURSES_URL = process.env.COURSES_URL || 'http://127.0.0.1:3004';
const KEY = process.env.INTERNAL_API_KEY;

async function grantEntitlement({ userId, courseId, orderId }) {
  if (!KEY) {
    throw new Error('INTERNAL_API_KEY is not set');
  }
  const r = await fetch(`${COURSES_URL}/internal/entitlements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': KEY },
    body: JSON.stringify({ userId, courseId, orderId }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Courses entitlement error: ${r.status} ${t}`);
  }
}

module.exports = { grantEntitlement };
