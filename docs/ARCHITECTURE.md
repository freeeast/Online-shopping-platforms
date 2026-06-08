# ZStore Architecture

This document describes the architecture of ZStore from system, module, data, and security perspectives.

## 1. System overview

ZStore uses a monolithic backend + static frontend architecture:

- Frontend: static HTML/CSS/JS served by Express static middleware
- Backend: Node.js + Express API (`/api/*`)
- Database: SQLite (`backend/zstore.db`)
- External integration: Stripe Checkout + Stripe Webhook

## 2. High-level architecture

```text
Browser
  |
  | HTTPS / HTTP
  v
Nginx (production, optional in local)
  |
  | reverse proxy
  v
Node.js + Express (backend/server.js)
  |-- Auth/session + CSRF + validation middleware
  |-- Product/category/order/review/payment APIs
  |-- Static file serving (frontend/public)
  |
  +--> SQLite (backend/zstore.db)
  |
  +--> Stripe API (create checkout session)
       Stripe Webhook --> /api/payments/webhook
```

## 3. Backend module layout

### 3.1 Entry and routing

- `backend/server.js`
  - bootstraps Express app
  - wires middleware and routes
  - handles Stripe checkout and webhook
  - serves static frontend from `frontend/public`

### 3.2 Data layer

- `backend/database.js`
  - opens SQLite connection
  - creates/migrates schema
  - seeds default users/categories/products/vouchers

### 3.3 Security and auth

- `backend/middleware/security.js`
  - CSP headers
  - CSRF token generation/verification
  - input sanitization and validation helpers
- `backend/middleware/auth.js`
  - session cookie lifecycle
  - `requireSession` and `requireAdmin` guards

## 4. Frontend architecture

Frontend is multi-page and uses vanilla JavaScript modules:

- Core pages: `index.html`, `product.html`, `login.html`, `register.html`, `admin.html`, `my-orders.html`
- Shared scripts:
  - `assets/js/auth-banner.js` (auth UI state)
  - `assets/js/csrf-client.js` (CSRF token fetch/attach)
  - `assets/js/cart.js` (cart state in localStorage)
  - `assets/js/xss-safe.js` (escaping helper)
- Page scripts:
  - `assets/js/main.js` (catalog + category + pagination)
  - `assets/js/product.js` (product detail + review)
  - `assets/js/admin.js` (admin CRUD + order monitor)

## 5. Core data flows

## 5.1 Authentication flow

1. Client fetches CSRF token from `GET /api/csrf-token`
2. User posts credentials to `POST /api/login` with CSRF token
3. Backend validates credentials and issues HttpOnly session cookie
4. Frontend reads identity via `GET /api/me`
5. Protected APIs are guarded by session middleware

## 5.2 Checkout and payment flow

1. Client sends cart items to `POST /api/checkout/create-order`
2. Backend validates item list, computes order digest, stores pending order
3. Backend creates Stripe Checkout session and returns `checkoutUrl`
4. User completes payment on Stripe-hosted page
5. Stripe sends webhook to `POST /api/payments/webhook`
6. Backend verifies signature, checks digest/idempotency, marks order as paid

## 5.3 Review eligibility flow

1. User opens product page and calls `GET /api/product/:id/review-eligibility`
2. Backend checks paid order ownership + time window + duplicate constraints
3. Eligible users submit review via `POST /api/product/:id/reviews`

## 6. Data model highlights

Main tables:

- `users`: account info and role (`is_admin`)
- `categories`, `products`: product catalog
- `orders`, `order_items`: purchase records
- `transactions`, `transaction_items`: payment transaction records
- `processed_webhooks`: webhook idempotency tracking
- `vouchers`: discount and quota management
- `password_reset_tokens`: password reset lifecycle
- `product_reviews`: rating/comment with uniqueness constraint

Important integrity ideas:

- Order digest ties together currency, merchant email, salt, items, and total
- Webhook events are stored to prevent duplicate processing
- Reviews are constrained by `UNIQUE (order_id, user_id, pid)`

## 7. Security architecture

Defense-in-depth controls include:

- CSRF protection for all mutating endpoints
- Input sanitization and server-side validation
- Parameterized SQL queries (sqlite3 placeholders)
- Session fixation mitigation at login
- CSP response headers to reduce script injection risk
- Payment webhook signature and digest verification
- Role-based authorization for admin APIs

## 8. Deployment topology

Local development:

- Browser -> `http://localhost:3000`
- Express serves both API and static frontend
- SQLite as local file DB

Production (recommended):

- Nginx terminates TLS and proxies to Node process
- Node managed by systemd service
- Public HTTPS URL configured via `PUBLIC_BASE_URL`
- Stripe webhook endpoint exposed under `/api/payments/webhook`

For detailed deployment commands, see `docs/DEPLOYMENT.md`.

## 9. Architectural trade-offs

Current design advantages:

- Simple setup and fast local reproducibility
- Low infrastructure cost (single process + SQLite)
- Easy code navigation for teaching/demo projects

Current limitations:

- SQLite and single-node app are not horizontally scalable
- Backend file upload storage is local disk based
- Monolithic route file has high coupling as features grow

## 10. Suggested future evolution

- Split backend by domains (auth/catalog/order/payment)
- Introduce service/repository layers for maintainability
- Move uploads to object storage (S3/GCS)
- Replace SQLite with managed PostgreSQL for concurrency
- Add automated test suites (API integration + E2E)
- Add CI pipeline (lint/test/security scan) before deployment
