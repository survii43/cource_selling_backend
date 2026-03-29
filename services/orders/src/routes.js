'use strict';
const { z } = require('zod');
const { pool } = require('./db');
const { requireCustomer, requireInternalKey } = require('./session');
const { getPublishedCourse } = require('./catalogClient');
const { grantEntitlement } = require('./coursesClient');

const checkoutSchema = z.object({
  shippingLine1: z.string().min(1).max(500),
  shippingLine2: z.string().max(500).optional(),
  shippingCity: z.string().min(1).max(255),
  shippingRegion: z.string().max(255).optional(),
  shippingPostal: z.string().min(1).max(64),
  shippingCountry: z.string().length(2),
  shippingLat: z.number().optional(),
  shippingLng: z.number().optional(),
});

async function getOrCreateCartId(userId) {
  await pool().query('INSERT IGNORE INTO carts (user_id) VALUES (?)', [userId]);
  const [rows] = await pool().query('SELECT id FROM carts WHERE user_id = ?', [userId]);
  return rows[0].id;
}

function createOrdersRouter(express) {
  const r = express.Router();

  r.get('/cart', requireCustomer, async (req, res) => {
    const cartId = await getOrCreateCartId(req.user.userId);
    const [lines] = await pool().query(
      'SELECT course_id AS courseId, quantity, price_snapshot_cents AS priceCents FROM cart_lines WHERE cart_id = ?',
      [cartId],
    );
    res.json({ cartId, lines });
  });

  r.post('/cart/items', requireCustomer, async (req, res) => {
    const body = z
      .object({
        courseId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(99).default(1),
      })
      .safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    }
    const { courseId, quantity } = body.data;
    const course = await getPublishedCourse(courseId);
    if (!course) {
      return res.status(400).json({ error: 'Course not available' });
    }
    const cartId = await getOrCreateCartId(req.user.userId);
    const price = course.priceCents;
    await pool().query(
      `INSERT INTO cart_lines (cart_id, course_id, quantity, price_snapshot_cents)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), price_snapshot_cents = VALUES(price_snapshot_cents)`,
      [cartId, courseId, quantity, price],
    );
    const [lines] = await pool().query(
      'SELECT course_id AS courseId, quantity, price_snapshot_cents AS priceCents FROM cart_lines WHERE cart_id = ?',
      [cartId],
    );
    res.status(201).json({ cartId, lines });
  });

  r.put('/cart/items/:courseId', requireCustomer, async (req, res) => {
    const courseId = Number(req.params.courseId);
    const body = z.object({ quantity: z.coerce.number().int().min(0).max(99) }).safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    }
    const cartId = await getOrCreateCartId(req.user.userId);
    if (body.data.quantity === 0) {
      await pool().query('DELETE FROM cart_lines WHERE cart_id = ? AND course_id = ?', [cartId, courseId]);
    } else {
      const course = await getPublishedCourse(courseId);
      if (!course) {
        return res.status(400).json({ error: 'Course not available' });
      }
      await pool().query(
        `INSERT INTO cart_lines (cart_id, course_id, quantity, price_snapshot_cents)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), price_snapshot_cents = VALUES(price_snapshot_cents)`,
        [cartId, courseId, body.data.quantity, course.priceCents],
      );
    }
    const [lines] = await pool().query(
      'SELECT course_id AS courseId, quantity, price_snapshot_cents AS priceCents FROM cart_lines WHERE cart_id = ?',
      [cartId],
    );
    res.json({ cartId, lines });
  });

  r.delete('/cart/items/:courseId', requireCustomer, async (req, res) => {
    const courseId = Number(req.params.courseId);
    const cartId = await getOrCreateCartId(req.user.userId);
    await pool().query('DELETE FROM cart_lines WHERE cart_id = ? AND course_id = ?', [cartId, courseId]);
    const [lines] = await pool().query(
      'SELECT course_id AS courseId, quantity, price_snapshot_cents AS priceCents FROM cart_lines WHERE cart_id = ?',
      [cartId],
    );
    res.json({ cartId, lines });
  });

  r.post('/checkout', requireCustomer, async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const cartId = await getOrCreateCartId(req.user.userId);
    const [lines] = await pool().query(
      'SELECT course_id, quantity, price_snapshot_cents FROM cart_lines WHERE cart_id = ?',
      [cartId],
    );
    if (!lines.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    let total = 0;
    for (const ln of lines) {
      total += ln.quantity * ln.price_snapshot_cents;
    }
    const d = parsed.data;
    const currency = 'USD';
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [ord] = await conn.query(
        `INSERT INTO orders (user_id, status, shipping_line1, shipping_line2, shipping_city, shipping_region, shipping_postal, shipping_country, shipping_lat, shipping_lng, total_cents, currency)
         VALUES (?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.userId,
          d.shippingLine1,
          d.shippingLine2 ?? null,
          d.shippingCity,
          d.shippingRegion ?? null,
          d.shippingPostal,
          d.shippingCountry.toUpperCase(),
          d.shippingLat ?? null,
          d.shippingLng ?? null,
          total,
          currency,
        ],
      );
      const orderId = ord.insertId;
      for (const ln of lines) {
        await conn.query(
          'INSERT INTO order_lines (order_id, course_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
          [orderId, ln.course_id, ln.quantity, ln.price_snapshot_cents],
        );
      }
      await conn.query('DELETE FROM cart_lines WHERE cart_id = ?', [cartId]);
      await conn.commit();
      res.status(201).json({
        order: {
          id: orderId,
          status: 'pending_payment',
          totalCents: total,
          currency,
        },
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });

  r.get('/orders', requireCustomer, async (req, res) => {
    const [rows] = await pool().query(
      `SELECT id, status, total_cents AS totalCents, currency, created_at AS createdAt
       FROM orders WHERE user_id = ? ORDER BY id DESC`,
      [req.user.userId],
    );
    res.json({ orders: rows });
  });

  r.get('/orders/:id', requireCustomer, async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await pool().query(
      `SELECT id, user_id, status, payment_ref AS paymentRef, shipping_line1 AS shippingLine1, shipping_line2 AS shippingLine2,
              shipping_city AS shippingCity, shipping_region AS shippingRegion, shipping_postal AS shippingPostal, shipping_country AS shippingCountry,
              shipping_lat AS shippingLat, shipping_lng AS shippingLng, total_cents AS totalCents, currency, created_at AS createdAt
       FROM orders WHERE id = ? AND user_id = ?`,
      [id, req.user.userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    const [lines] = await pool().query(
      'SELECT course_id AS courseId, quantity, unit_price_cents AS unitPriceCents FROM order_lines WHERE order_id = ?',
      [id],
    );
    res.json({ order: rows[0], lines });
  });

  r.post('/internal/orders/:id/confirm-payment', requireInternalKey, async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        paymentRef: z.string().min(1).max(255),
      })
      .safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    }
    const conn = await pool().getConnection();
    let order;
    let lines;
    try {
      await conn.beginTransaction();
      const [ords] = await conn.query(
        'SELECT id, user_id, status FROM orders WHERE id = ? FOR UPDATE',
        [id],
      );
      if (!ords.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Not found' });
      }
      order = ords[0];
      if (order.status !== 'pending_payment') {
        await conn.rollback();
        return res.status(409).json({ error: 'Order not pending payment' });
      }
      await conn.query(
        "UPDATE orders SET status = 'paid', payment_ref = ? WHERE id = ?",
        [body.data.paymentRef, id],
      );
      const [lineRows] = await conn.query(
        'SELECT course_id, quantity FROM order_lines WHERE order_id = ?',
        [id],
      );
      lines = lineRows;
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    const courseIds = [...new Set(lines.map((l) => l.course_id))];
    for (const courseId of courseIds) {
      await grantEntitlement({
        userId: order.user_id,
        courseId,
        orderId: id,
      });
    }
    res.json({ ok: true, orderId: id });
  });

  return r;
}

module.exports = { createOrdersRouter };
