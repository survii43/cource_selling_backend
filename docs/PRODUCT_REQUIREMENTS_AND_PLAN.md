# Course shop — requirements analysis and backend plan

This file is the **single source of truth** for product scope and how the backend will satisfy it. The README links here only; do not copy long sections elsewhere.

---

## 1. Requirement analysis (safe interpretation)

### 1.1 Actors

| Actor | Role |
|--------|------|
| **Admin (single)** | One operational account for the whole shop: categories, courses, content (video / PDF / book), pricing, offers. Not multi-tenant; not multiple competing admins unless you later add RBAC. |
| **Customer (user)** | Register, log in, browse courses, cart, checkout. Receives delivery for physical items; receives digital access after payment. |

### 1.2 Functional scope

- **Catalog structure:** Admin creates **categories** and **courses** under them. Each course is one sellable product line (SKUs can be modeled as variants later if needed).
- **Content types:** **Video**, **PDF**, **book** (treat book as shippable product + optional digital add-on if ever needed; default: physical book implies fulfillment + address).
- **Commerce:** List courses, **add to cart**, **place orders** (standard e-commerce flow adapted to courses).
- **Delivery / location:** **Accurate address** for **delivery** (books). Frontend uses **Google Maps**; backend should store **structured address** plus **coordinates** if the frontend sends them (or geocode server-side later). Validate country/postal rules as a follow-up.
- **Digital access:** **Before payment:** only **preview** (e.g. trailer, first chapter snippet, watermarked sample, time-limited preview URL). **After successful payment:** **full PDF / video** available **inside their application** (not “open public link forever” by default—use **short-lived signed URLs** or **session-bound streaming**).
- **Sessions:** **No multi-device login for users** — at most **one active session** per user (new login **invalidates** previous tokens or previous refresh/session record).

### 1.3 Non-functional and security notes

- **Payment:** Requirement implies a **payment provider** (Stripe, Razorpay, etc.); backend must treat “paid” as **webhook-confirmed** or server-side capture, not client-only flags.
- **Asset storage:** Video/PDF files live in **object storage** (S3-compatible, etc.); DB holds metadata, preview vs full flags, and entitlements.
- **PII:** Addresses and emails need **encryption at rest** consideration and **retention** policy per jurisdiction (document only at this stage).

### 1.4 Ambiguities to resolve with the client (not blockers for architecture)

- Whether **one course** can bundle **multiple** content types (e.g. video + PDF) or **exactly one** primary type per course.
- Whether **books** are always physical or also sold as PDF; refund/return policy.
- **Preview** rules: duration, % of PDF pages, fixed teaser video length.
- **Tax** and **invoices** (if required).

---

## 2. Alignment with existing backend architecture

Current repo: **API gateway** + **auth**, **catalog**, **orders**, **courses** services, each with its own MySQL database. No duplication of the same business tables across DBs: use **clear ownership** and **IDs referenced across services** (eventual consistency or sync jobs if needed).

| Concern | Owning service | Rationale |
|--------|----------------|-----------|
| Users, credentials, roles (admin vs customer), **single-session policy** | **auth** | Authentication and session invalidation belong here. |
| Categories, course **listing** metadata, search-facing fields, pricing display | **catalog** | Merchandising and browse; keeps storefront queries cohesive. |
| Cart, checkout intent, **addresses**, order lines, **payment status**, fulfillment state | **orders** | Transactional commerce and delivery. |
| Course **content graph**: lessons/assets, **preview vs full**, **entitlement checks**, signed URLs / stream tokens | **courses** | Digital rights and heavy read paths for content. |
| Routing, CORS, auth forwarding | **gateway** | Unchanged role; may attach user context headers after validating JWT. |

**Rule:** Avoid defining the same tables in two databases. If catalog needs a “summary” of course data, **catalog** can store denormalized read models updated when admin changes data (sync from admin write path or async).

---

## 3. Implementation plan (phased, non-duplicative)

### Phase A — Foundation

- **Migrations** per service DB: minimal schemas only where that service owns the data.
- **auth:** User table (role: `admin` \| `customer`), password hash, **session or refresh token version** (increment on login to enforce **single active session**), JWT claims including `sid` or `tokenVersion`.
- **catalog:** Categories, courses (title, slug, type enum: `video` \| `pdf` \| `book`, price, category FK, published flag), optional preview summary fields.
- **orders:** Cart (user-scoped or session-scoped → merge on login), cart lines, orders, order lines, **shipping address** (structured fields + `lat`, `lng` nullable), payment reference, status enum.
- **courses:** Course content records linked by **course_id** (UUID or bigint shared with catalog), asset storage keys, `is_preview` / `preview_config`, no duplicate catalog pricing.

### Phase B — Admin (single admin)

- Bootstrap **one admin** (env seed or one-time script); optional middleware `requireAdmin`.
- Admin APIs: CRUD categories and courses in **catalog**; upload metadata + initiate upload to storage; wire **courses** service for files and preview/full flags.

### Phase C — Customer flows

- Register/login (**auth**); login bumps **token version** so other devices log out.
- Browse (**catalog** via gateway); cart + address + checkout (**orders**).
- Integrate **payment webhook** → on success, mark order paid and call **courses** to grant **entitlement** (user_id + course_id).

### Phase D — Access control

- **Preview:** public or authenticated lightweight endpoints in **courses** (or catalog-backed) serving only preview assets.
- **Post-payment:** **courses** checks entitlement + issues **short-lived signed URL** or stream session; **no** permanent public URLs in DB.

### Phase E — Hardening

- Rate limits, audit log for admin actions, rotate JWT secrets, backups, and monitoring.

---

## 4. Traceability matrix (requirement → plan)

| Requirement | Where it is addressed |
|-------------|------------------------|
| Single admin, shop content | Phase B; auth role + optional seed |
| Categories + courses + video/PDF/book | Phase A catalog schema + Phase B admin |
| User register/login | Phase C auth |
| List courses, cart, orders | Phase A/C catalog + orders |
| Address + map accuracy | Phase A orders address fields; contract with frontend for lat/lng |
| Preview vs full after payment | Phase D courses + entitlements after webhook |
| No multi-device login | Phase A/C auth token version or single server session |

---

## 5. Frontend contract (high level)

- Send **structured address** + **latitude/longitude** on checkout if Maps provides them.
- Send **Authorization: Bearer** on customer and admin routes as agreed.
- Do not embed long-lived asset URLs for paid content; request **session or signed URL** from API after payment.

This document should be updated in place when scope changes; avoid parallel requirement docs.

---

## 6. Implemented HTTP surface (backend)

All paths below assume the **gateway** prefix (`/auth`, `/catalog`, `/orders`, `/courses`); upstream services expose the path **after** the prefix (e.g. gateway `POST /auth/login` → auth service `POST /login`).

| Area | Method & path | Notes |
|------|----------------|--------|
| Auth | `POST /register` | Customer only; returns `accessToken`. |
| Auth | `POST /login` | Bumps `token_version` (invalidates prior JWTs). |
| Auth | `GET /me` | Bearer JWT. |
| Auth | `GET /internal/verify` | Other services use this to validate Bearer (session + version). |
| Catalog | `GET /categories`, `GET /courses`, `GET /courses/:idOrSlug` | Public listing; unpublished detail only with admin JWT. |
| Catalog | `GET /internal/courses/:id` | Header `X-Internal-Key`; used by orders to price cart lines. |
| Catalog | `POST/PATCH/DELETE /admin/categories…`, `POST/PATCH/DELETE /admin/courses…` | Admin JWT only. |
| Orders | `GET/POST /cart…`, `PUT/DELETE /cart/items/:courseId` | Customer JWT; cart is server-validated against catalog. |
| Orders | `POST /checkout` | Customer JWT; body includes structured address + optional `shippingLat` / `shippingLng`. |
| Orders | `GET /orders`, `GET /orders/:id` | Customer JWT. |
| Orders | `POST /internal/orders/:id/confirm-payment` | `X-Internal-Key` + JSON `{ paymentRef }`; marks paid and grants entitlements in courses. |
| Courses | `GET /preview/:courseId` | Preview assets metadata (no entitlement). |
| Courses | `GET /access/:courseId` | Customer JWT + entitlement; returns time-limited signed `downloadUrl` entries. |
| Courses | `GET /download?token=` | Validates signed token; JSON with `storageKey` / `mime` (wire to CDN in production). |
| Courses | `POST /admin/courses/:courseId/assets`, `DELETE /admin/assets/:id` | Admin JWT. |
| Courses | `POST /internal/entitlements` | `X-Internal-Key`; called by orders after payment. |

**Payment provider:** `confirm-payment` is the integration point for a future webhook; replace manual calls in non-production with verified provider events.
