'use strict';
const CATALOG_URL = process.env.CATALOG_URL || 'http://127.0.0.1:3002';
const KEY = process.env.INTERNAL_API_KEY;

async function getPublishedCourse(courseId) {
  if (!KEY) {
    throw new Error('INTERNAL_API_KEY is not set');
  }
  const r = await fetch(`${CATALOG_URL}/internal/courses/${courseId}`, {
    headers: { 'X-Internal-Key': KEY },
  });
  if (r.status === 404) {
    return null;
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Catalog error: ${r.status} ${t}`);
  }
  const data = await r.json();
  const c = data.course;
  if (!c.published) {
    return null;
  }
  return c;
}

module.exports = { getPublishedCourse };
