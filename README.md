# ZStore - Secure Web Store

ZStore is a full-stack e-commerce demo built for Web Programming and Internet Security.  
The project focuses on both product features (catalog, cart, orders, admin) and security hardening (XSS, CSRF, session security, input validation, payment webhook integrity checks).

## 1) Files contain

- `backend/` - Express server, API, SQLite schema/bootstrap logic, middleware
- `frontend/public/` - static pages, CSS, client-side JavaScript
- `docs/` - deployment and operation docs
- `README.md` - project overview and quick start
- `.gitignore` - excludes secrets and local runtime artifacts

## 2) Tech stack

- Backend: Node.js, Express 5
- Database: SQLite3
- Frontend: Vanilla JS + Bootstrap 5
- Security: custom middleware for CSP/CSRF/input validation + cookie/session controls
- Payment: Stripe Checkout + Webhook verification
- Image processing: Sharp

## 3) Main features

- User registration/login/logout, password change, password reset by token email flow
- Product browsing with category filter and pagination
- Shopping cart (localStorage) with voucher support
- Checkout flow with Stripe redirect
- Order lifecycle: pending/paid/cancelled, pay-again and modify for pending orders
- Product review system with purchase eligibility checks
- Admin panel for category/product CRUD and order monitoring

## 4) Security highlights

- CSP headers to reduce script injection risks
- CSRF token validation for all state-changing API endpoints
- Server-side input sanitization and strict validation
- Parameterized SQL queries against injection
- Session fixation mitigation on login
- Payment webhook idempotency and digest integrity checks

## 5) Architecture

ZStore is a monolithic Express app that serves both the REST API and static frontend, backed by SQLite and integrated with Stripe for payments.

- **Frontend**: multi-page vanilla JS (`frontend/public/`)
- **Backend**: Express routes + middleware (`backend/server.js`, `backend/middleware/`)
- **Data**: SQLite with schema bootstrap and seed data (`backend/database.js`)
- **Payments**: Stripe Checkout redirect + signed webhook confirmation

For module layout, data flows (auth / checkout / reviews), security design, and deployment topology, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

Related docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and core flows
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — local run and production redeploy

## 6) Quick start (local reproducible setup)

### Prerequisites

- Node.js 18+ (recommended Node 20 LTS)
- npm 9+

### Steps

1. Clone repository and enter project:

```bash
git clone <your-repo-url>.git
cd <your-repo-name>
```

2. Install dependencies:

```bash
cd backend
npm install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Edit `backend/.env` with your own values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ZSTORE_MERCHANT_EMAIL`
- optional: `PUBLIC_BASE_URL` (required if deployed behind reverse proxy/domain)

4. Start server:

```bash
npm start
```

5. Open browser:

- Home: `http://localhost:3000/index.html`
- Login: `http://localhost:3000/login.html`
- Admin: `http://localhost:3000/admin.html`

### Seeded demo accounts

- Admin: `admin@zstore.local` / `AdminPass2024!`
- User: `user@zstore.local` / `UserPass2024!`

These are seeded automatically on first run in `backend/database.js`.

## 7) Stripe webhook for local testing

Server webhook endpoint:

- `POST /api/payments/webhook`

Use Stripe CLI in another terminal:

```bash
stripe listen --forward-to http://localhost:3000/api/payments/webhook
```

Then copy the generated signing secret into:

- `STRIPE_WEBHOOK_SECRET=whsec_...`

## 8) Production redeployment

See full step-by-step guide in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Ubuntu VM + Nginx + systemd + HTTPS + Stripe webhook setup).

## 9) Demo page
if you want to check the real web page, here is the example:
136.112.51.118

