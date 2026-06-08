const express = require("express");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const db = require("./database.js");
const security = require("./middleware/security.js");
const auth = require("./middleware/auth.js");

const app = express();
const PORT = 3000;
const CHECKOUT_CURRENCY = "HKD";
const MERCHANT_EMAIL = process.env.ZSTORE_MERCHANT_EMAIL || "merchant@zstore.local";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@zstore.local";
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Static HTML/CSS/JS and user uploads live next to backend: ../frontend/public
const FRONTEND_PUBLIC = path.join(__dirname, "..", "frontend", "public");
for (const sub of ["uploads", "thumbnails"]) {
  const dir = path.join(FRONTEND_PUBLIC, sub);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Defense in depth: CSP on every response.
app.use(security.cspMiddleware);
app.use(cookieParser());

// Webhook route uses raw body so signature validation is based on exact bytes.
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    try {
      if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(503).json({ error: "Stripe webhook is not configured" });
      }
      if (process.env.NODE_ENV === "production") {
        const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
          .split(",")[0]
          .trim()
          .toLowerCase();
        const proto = forwardedProto || String(req.protocol || "").toLowerCase();
        if (proto !== "https") {
          return res.status(400).json({ error: "Webhook must be served over HTTPS" });
        }
      }

      const rawBody = req.body ? req.body.toString("utf8") : "";
      const signature = String(req.headers["stripe-signature"] || "");
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET,
      );
      let payload = null;

      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        const session = event.data.object;
        const lineItemList = await stripe.checkout.sessions.listLineItems(session.id, {
          limit: 100,
          expand: ["data.price.product"],
        });
        const lineItems = (lineItemList.data || []).map((item) => {
          const productObj =
            item.price && typeof item.price.product === "object"
              ? item.price.product
              : null;
          const pidRaw = productObj && productObj.metadata ? productObj.metadata.pid : null;
          const pid = security.validatePositiveInt(pidRaw);
          const quantity = security.validatePositiveInt(item.quantity);
          const unitAmount =
            item.price && Number.isFinite(Number(item.price.unit_amount))
              ? Number(item.price.unit_amount)
              : null;
          if (!pid || !quantity || unitAmount === null) {
            throw new Error("Invalid Stripe line item data for digest verification");
          }
          return {
            pid,
            quantity,
            unitPrice: unitAmount / 100,
            productName:
              (productObj && productObj.name) ||
              item.description ||
              `Product #${pid}`,
          };
        });
        payload = {
          eventId: event.id,
          orderId:
            (session.metadata && session.metadata.orderId) ||
            session.client_reference_id,
          gatewayOrderId: session.id,
          paymentStatus: "COMPLETED",
          currency: String(session.currency || "").toUpperCase(),
          totalPrice: Number(session.amount_total || 0) / 100,
          items: lineItems,
          rawPayload: rawBody,
        };
      } else {
        return res.json({ ok: true, ignored: true, eventType: event.type });
      }

      const result = await processPaymentEvent(payload);
      res.json({
        ok: true,
        duplicate: result.duplicate === true,
        orderId: result.orderId,
      });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || "Webhook processing failed" });
    }
  },
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function allDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}`;
}

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToAmount(cents) {
  return Number((Number(cents) / 100).toFixed(2));
}

function normalizeVoucherCode(raw) {
  const code = security.sanitizeText(raw, 64).toUpperCase();
  if (!code) return "";
  return code.replace(/[^A-Z0-9_-]/g, "");
}

function buildCheckoutLineItems(items, discountCents) {
  const baseItems = items.map((item) => ({
    pid: Number(item.pid),
    quantity: Number(item.quantity),
    unitCents: Math.max(0, toCents(item.unitPrice) || 0),
    name: item.name,
  }));
  const subtotalCents = baseItems.reduce((sum, it) => sum + it.unitCents * it.quantity, 0);
  const safeDiscount = Math.max(0, Math.min(discountCents || 0, subtotalCents));
  if (safeDiscount === 0 || subtotalCents === 0) {
    return {
      lineItems: baseItems.map((it) => ({
        pid: it.pid,
        quantity: it.quantity,
        unitCents: it.unitCents,
        lineTotalCents: it.unitCents * it.quantity,
        name: it.name,
      })),
      subtotalCents,
      discountCents: 0,
      totalCents: subtotalCents,
    };
  }
  let remainingDiscount = safeDiscount;
  const lineItems = baseItems.map((it, idx) => {
    const lineTotal = it.unitCents * it.quantity;
    let targetShare =
      idx === baseItems.length - 1
        ? remainingDiscount
        : Math.floor((safeDiscount * lineTotal) / subtotalCents);
    targetShare = Math.max(0, Math.min(targetShare, lineTotal));
    // Keep per-unit cents integer by forcing line discount to multiples of quantity.
    targetShare -= targetShare % it.quantity;
    targetShare = Math.max(0, Math.min(targetShare, remainingDiscount, lineTotal));
    remainingDiscount -= targetShare;
    const discountedLineTotal = Math.max(0, lineTotal - targetShare);
    const discountedUnitCents = Math.floor(discountedLineTotal / it.quantity);
    return {
      pid: it.pid,
      quantity: it.quantity,
      unitCents: discountedUnitCents,
      lineTotalCents: discountedUnitCents * it.quantity,
      name: it.name,
    };
  });

  const totalCents = lineItems.reduce((sum, it) => sum + it.unitCents * it.quantity, 0);
  return {
    lineItems,
    subtotalCents,
    discountCents: subtotalCents - totalCents,
    totalCents,
  };
}

async function getAverageRatingMapByProductIds(pidList) {
  const uniqueIds = [...new Set((pidList || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!uniqueIds.length) return new Map();
  const placeholders = uniqueIds.map(() => "?").join(",");
  const stats = await allDb(
    `WITH paid_lines AS (
       SELECT DISTINCT oi.pid, oi.order_id, o.user_id AS buyer_id
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       WHERE o.payment_status = 'paid'
         AND oi.pid IN (${placeholders})
     )
     SELECT pl.pid,
            AVG(COALESCE(pr.rating, 10.0)) AS avg_rating,
            COUNT(*) AS completed_orders,
            SUM(CASE WHEN pr.rating IS NOT NULL THEN 1 ELSE 0 END) AS review_count
     FROM paid_lines pl
     LEFT JOIN product_reviews pr
       ON pr.pid = pl.pid
      AND pr.order_id = pl.order_id
      AND pr.user_id = pl.buyer_id
     GROUP BY pl.pid`,
    uniqueIds,
  );
  const out = new Map();
  for (const row of stats) {
    out.set(Number(row.pid), {
      averageRating: Number(Number(row.avg_rating || 10).toFixed(2)),
      completedOrders: Number(row.completed_orders || 0),
      reviewCount: Number(row.review_count || 0),
    });
  }
  return out;
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return null;
  const map = new Map();
  for (const row of items) {
    const pid = security.validatePositiveInt(row && row.pid);
    const quantity = security.validatePositiveInt(
      row && (row.quantity || row.qty),
    );
    if (!pid || !quantity) return null;
    map.set(pid, (map.get(pid) || 0) + quantity);
  }
  return [...map.entries()]
    .map(([pid, quantity]) => ({ pid, quantity }))
    .sort((a, b) => a.pid - b.pid);
}

function normalizeGatewayItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return null;
  const map = new Map();
  for (const row of items) {
    const pid = security.validatePositiveInt(row && row.pid);
    const quantity = security.validatePositiveInt(row && row.quantity);
    const unitPrice = Number(row && row.unitPrice);
    if (!pid || !quantity || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
    const prev = map.get(pid);
    if (!prev) {
      map.set(pid, {
        pid,
        quantity,
        unitPrice,
        productName: (row && row.productName) || null,
      });
      continue;
    }
    // If gateway splits identical product into multiple lines, merge quantities.
    if (Math.abs(Number(prev.unitPrice) - unitPrice) > 0.000001) {
      return null;
    }
    prev.quantity += quantity;
  }
  return [...map.values()].sort((a, b) => a.pid - b.pid);
}

function buildDigestInput({ currency, merchantEmail, salt, items, totalPrice }) {
  const itemParts = items
    .sort((a, b) => a.pid - b.pid)
    .map((it) => `${it.pid}:${it.quantity}:${Number(it.unitPrice).toFixed(2)}`);
  return [
    String(currency || ""),
    String(merchantEmail || ""),
    String(salt || ""),
    ...itemParts,
    Number(totalPrice || 0).toFixed(2),
  ].join("|");
}

function computeOrderDigest(data) {
  const plain = buildDigestInput(data);
  return crypto.createHash("sha256").update(plain, "utf8").digest("hex");
}

function getMailTransporter() {
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

async function sendPasswordResetEmail({ toEmail, resetUrl }) {
  const transporter = getMailTransporter();
  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to: toEmail,
    subject: "ZStore password reset",
    text: `You requested to reset your password.\n\nReset link: ${resetUrl}\n\nThis link expires in 20 minutes.`,
    html: `<p>You requested to reset your password.</p><p><a href="${security.sanitizeText(resetUrl, 2000)}">Reset password</a></p><p>This link expires in 20 minutes.</p>`,
  });
  if (!SMTP_HOST) {
    console.log("[password-reset-preview]", info.message);
  }
}

async function processPaymentEvent(payload) {
  const eventId = security.sanitizeText(payload.eventId, 200);
  const gatewayOrderId = security.sanitizeText(payload.gatewayOrderId, 200);
  const orderId = security.validatePositiveInt(payload.orderId);
  const paymentStatus = String(payload.paymentStatus || "").toUpperCase();
  const paidCurrency = String(payload.currency || "").toUpperCase();
  const paidTotal = Number(payload.totalPrice);
  const normalizedGatewayItems = normalizeGatewayItems(payload.items);
  const rawPayload = typeof payload.rawPayload === "string" ? payload.rawPayload : null;
  if (!eventId || !orderId) {
    throw new Error("Invalid event payload");
  }
  if (paymentStatus !== "COMPLETED") {
    throw new Error("Payment is not completed");
  }
  if (!normalizedGatewayItems) {
    throw new Error("Missing or invalid payment line items");
  }

  const alreadyProcessed = await getDb(
    "SELECT event_id FROM processed_webhooks WHERE event_id = ?",
    [eventId],
  );
  if (alreadyProcessed) {
    return { duplicate: true, orderId };
  }

  const order = await getDb("SELECT * FROM orders WHERE order_id = ?", [orderId]);
  if (!order) {
    throw new Error("Order not found");
  }
  if (String(order.payment_status).toLowerCase() === "paid") {
    await runDb("INSERT INTO processed_webhooks (event_id) VALUES (?)", [eventId]);
    return { duplicate: true, orderId };
  }
  if (String(order.payment_status).toLowerCase() !== "pending") {
    throw new Error("Order is not payable");
  }

  const orderItems = await allDb(
    `SELECT pid, quantity, unit_price, product_name
     FROM order_items
     WHERE order_id = ?
     ORDER BY pid ASC`,
    [orderId],
  );
  if (!orderItems.length) {
    throw new Error("Order has no items");
  }
  if (paidCurrency && paidCurrency !== String(order.currency || "").toUpperCase()) {
    throw new Error("Currency mismatch");
  }
  if (Number.isFinite(paidTotal)) {
    const expectedTotal = Number(order.total_price);
    if (Math.abs(expectedTotal - paidTotal) > 0.000001) {
      throw new Error("Total price mismatch");
    }
  }

  const orderItemMap = new Map(
    orderItems.map((it) => [
      Number(it.pid),
      {
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
        productName: it.product_name || null,
      },
    ]),
  );
  const gatewayDigestItems = normalizedGatewayItems.map((it) => {
    const fromOrder = orderItemMap.get(Number(it.pid));
    if (!fromOrder) {
      throw new Error("Gateway line item references unknown product");
    }
    if (Number(it.quantity) !== Number(fromOrder.quantity)) {
      throw new Error("Gateway quantity mismatch");
    }
    return {
      pid: it.pid,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      productName: fromOrder.productName,
    };
  });
  if (gatewayDigestItems.length !== orderItems.length) {
    throw new Error("Gateway item count mismatch");
  }

  const digestPayload = {
    currency: order.currency,
    merchantEmail: order.merchant_email,
    salt: order.salt,
    items: gatewayDigestItems.map((it) => ({
      pid: it.pid,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
    })),
    totalPrice: Number(order.total_price),
  };
  const regenerated = computeOrderDigest(digestPayload);
  if (!safeEqualHex(regenerated, order.digest)) {
    throw new Error("Digest verification failed");
  }

  await runDb(
    `UPDATE orders
     SET payment_status = 'paid',
         paid_at = CURRENT_TIMESTAMP,
         gateway_order_id = COALESCE(?, gateway_order_id)
     WHERE order_id = ?`,
    [gatewayOrderId || null, orderId],
  );
  const tx = await runDb(
    `INSERT INTO transactions (
      event_id, order_id, gateway_order_id, payment_status, currency, total_price, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      orderId,
      gatewayOrderId || null,
      "paid",
      order.currency,
      Number(order.total_price),
      rawPayload,
    ],
  );
  for (const item of gatewayDigestItems) {
    await runDb(
      `INSERT INTO transaction_items (transaction_id, pid, quantity, unit_price, product_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        tx.lastID,
        item.pid,
        item.quantity,
        Number(item.unitPrice),
        item.productName || null,
      ],
    );
  }
  await runDb("INSERT INTO processed_webhooks (event_id) VALUES (?)", [eventId]);
  return { duplicate: false, orderId };
}

// Issue CSRF token + HttpOnly SameSite visitor cookie (for SPA-style admin fetches).
app.get("/api/csrf-token", (req, res) => {
  const token = security.ensureVisitorAndCsrf(req, res);
  res.json({ csrfToken: token });
});

// Friendly URL for hosting checklist path /admin (also serve admin.html).
app.get("/admin", (req, res) => {
  res.redirect("/admin.html");
});

// --- Auth (CSRF on mutating endpoints; session cookie is HttpOnly + separate from CSRF visitor id) ---

app.get("/api/me", (req, res) => {
  const s = auth.getAuthSession(req);
  if (!s) return res.json({ user: null });
  res.json({
    user: {
      email: s.email,
      isAdmin: s.isAdmin,
      displayName: s.displayName,
    },
  });
});

app.post("/api/register", security.verifyCsrf, (req, res) => {
  const email = security
    .sanitizeText(req.body.email, security.LIMITS.email)
    .toLowerCase();
  const pw = String(req.body.password || "");
  const pw2 = String(
    req.body.passwordConfirm || req.body.password_confirm || "",
  );
  const displayName = security.sanitizeText(
    req.body.displayName,
    security.LIMITS.displayName,
  );
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (
    pw.length < security.LIMITS.passwordMin ||
    pw.length > security.LIMITS.passwordMax
  ) {
    return res.status(400).json({ error: "Invalid password length" });
  }
  if (pw !== pw2) {
    return res.status(400).json({ error: "Passwords do not match" });
  }
  const hash = bcrypt.hashSync(pw, 10);
  db.run(
    "INSERT INTO users (email, password, is_admin, display_name) VALUES (?, ?, 0, ?)",
    [email, hash, displayName || null],
    function (err) {
      if (err) {
        if (String(err.message).includes("UNIQUE")) {
          return res.status(409).json({ error: "Email already registered" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: "Registered successfully", redirect: "/login.html" });
    },
  );
});

app.post("/api/login", security.verifyCsrf, (req, res) => {
  const email = security
    .sanitizeText(req.body.email, security.LIMITS.email)
    .toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // Session fixation defense: never trust an existing cookie value; drop old mapping first.
  auth.invalidateAuthTokenFromRequest(req);
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!bcrypt.compareSync(password, row.password)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    auth.createAuthSession(res, row);
    res.json({
      redirect: row.is_admin ? "/admin.html" : "/index.html",
      user: {
        email: row.email,
        isAdmin: row.is_admin === 1,
        displayName: row.display_name || row.email,
      },
    });
  });
});

app.post("/api/logout", security.verifyCsrf, (req, res) => {
  auth.destroyAuthSession(req, res);
  res.json({ ok: true, redirect: "/index.html" });
});

app.post("/api/change-password", security.verifyCsrf, auth.requireSession, (req, res) => {
  const current = String(req.body.currentPassword || "");
  const nextPw = String(req.body.newPassword || "");
  const next2 = String(req.body.newPasswordConfirm || "");
  if (
    nextPw.length < security.LIMITS.passwordMin ||
    nextPw.length > security.LIMITS.passwordMax
  ) {
    return res.status(400).json({ error: "Invalid new password" });
  }
  if (nextPw !== next2) {
    return res.status(400).json({ error: "New passwords do not match" });
  }
  db.get("SELECT * FROM users WHERE userid = ?", [req.auth.userid], (err, row) => {
    if (err || !row) return res.status(500).json({ error: "User lookup failed" });
    if (!bcrypt.compareSync(current, row.password)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const hash = bcrypt.hashSync(nextPw, 10);
    db.run(
      "UPDATE users SET password = ? WHERE userid = ?",
      [hash, row.userid],
      (e2) => {
        if (e2) return res.status(500).json({ error: e2.message });
        auth.destroyAuthSession(req, res);
        res.json({
          message: "Password updated; please sign in again",
          redirect: "/login.html",
        });
      },
    );
  });
});

app.post("/api/password-reset/request", security.verifyCsrf, async (req, res) => {
  try {
    const email = security
      .sanitizeText(req.body.email, security.LIMITS.email)
      .toLowerCase();
    // Return generic response regardless of account existence.
    const generic = {
      ok: true,
      message:
        "If this email is registered, a password reset link has been sent.",
    };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json(generic);
    }
    const user = await getDb("SELECT userid, email FROM users WHERE email = ?", [email]);
    if (!user) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    await runDb(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
      [user.userid, tokenHash, expiresAt],
    );
    const resetUrl = `${getPublicBaseUrl(req)}/reset-password.html?token=${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail({
      toEmail: user.email,
      resetUrl,
    });
    res.json(generic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process password reset request" });
  }
});

app.get("/api/password-reset/verify", async (req, res) => {
  try {
    const rawToken = security.sanitizeText(req.query.token, 512);
    if (!rawToken) return res.json({ valid: false });
    const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
    const row = await getDb(
      `SELECT id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?`,
      [tokenHash],
    );
    if (!row) return res.json({ valid: false });
    const expired = new Date(row.expires_at).getTime() < Date.now();
    const used = !!row.used_at;
    res.json({ valid: !expired && !used });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false });
  }
});

app.post("/api/password-reset/confirm", security.verifyCsrf, async (req, res) => {
  try {
    const rawToken = security.sanitizeText(req.body.token, 512);
    const newPw = String(req.body.newPassword || "");
    const newPw2 = String(req.body.newPasswordConfirm || "");
    if (!rawToken) return res.status(400).json({ error: "Invalid reset token" });
    if (
      newPw.length < security.LIMITS.passwordMin ||
      newPw.length > security.LIMITS.passwordMax
    ) {
      return res.status(400).json({ error: "Invalid password length" });
    }
    if (newPw !== newPw2) {
      return res.status(400).json({ error: "Passwords do not match" });
    }
    const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
    const row = await getDb(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?`,
      [tokenHash],
    );
    if (!row) return res.status(400).json({ error: "Invalid reset token" });
    if (row.used_at) return res.status(400).json({ error: "Reset token already used" });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Reset token has expired" });
    }
    const hash = bcrypt.hashSync(newPw, 10);
    await runDb("BEGIN IMMEDIATE");
    try {
      await runDb("UPDATE users SET password = ? WHERE userid = ?", [hash, row.user_id]);
      await runDb(
        "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?",
        [row.id],
      );
      await runDb("COMMIT");
    } catch (txErr) {
      await runDb("ROLLBACK");
      throw txErr;
    }
    res.json({ ok: true, redirect: "/login.html" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// --- Read-only API (no CSRF; still validate query/path params) ---

app.get("/api/categories", (req, res) => {
  db.all("SELECT * FROM categories", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/products", (req, res) => {
  const catid = req.query.catid;
  const pageRaw = security.validatePositiveInt(req.query.page);
  const limitRaw = security.validatePositiveInt(req.query.limit);
  const shouldPaginate = Boolean(pageRaw || limitRaw);
  const page = pageRaw || 1;
  const limit = Math.min(limitRaw || 8, 24);
  const offset = (page - 1) * limit;
  let sql = "SELECT * FROM products";
  let countSql = "SELECT COUNT(*) AS total FROM products";
  const params = [];

  if (catid !== undefined && catid !== "") {
    const cid = security.validatePositiveInt(catid);
    if (!cid) {
      return res.status(400).json({ error: "Invalid category id" });
    }
    sql += " WHERE catid = ?";
    countSql += " WHERE catid = ?";
    params.push(cid);
  }
  sql += " ORDER BY pid DESC";

  if (shouldPaginate) {
    sql += " LIMIT ? OFFSET ?";
  }

  const queryParams = shouldPaginate ? [...params, limit, offset] : params;
  db.all(sql, queryParams, async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    let enrichedRows = rows || [];
    try {
      const ratingMap = await getAverageRatingMapByProductIds(
        enrichedRows.map((row) => row.pid),
      );
      enrichedRows = enrichedRows.map((row) => {
        const stats = ratingMap.get(Number(row.pid));
        return {
          ...row,
          avg_rating: stats ? stats.averageRating : 10,
          rating_review_count: stats ? stats.reviewCount : 0,
          rating_completed_orders: stats ? stats.completedOrders : 0,
        };
      });
    } catch (ratingErr) {
      console.error("rating aggregation failed:", ratingErr);
    }
    if (!shouldPaginate) {
      return res.json(enrichedRows);
    }
    db.get(countSql, params, (countErr, countRow) => {
      if (countErr) return res.status(500).json({ error: countErr.message });
      const total = Number((countRow && countRow.total) || 0);
      res.json({
        items: enrichedRows,
        page,
        limit,
        total,
        hasMore: offset + enrichedRows.length < total,
      });
    });
  });
});

app.get("/api/products/byIds", (req, res) => {
  const raw = (req.query.ids || "").toString();
  const ids = raw
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isInteger(x) && x > 0);

  const uniqueIds = [...new Set(ids)].slice(0, 50);
  if (uniqueIds.length === 0) return res.json([]);

  const placeholders = uniqueIds.map(() => "?").join(",");
  db.all(
    `SELECT pid, catid, name, price, description, image_path, thumb_path
     FROM products
     WHERE pid IN (${placeholders})`,
    uniqueIds,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    },
  );
});

app.get("/api/cart/products", (req, res) => {
  const raw = (req.query.ids || "").toString();
  const ids = raw
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isInteger(x) && x > 0);

  const uniqueIds = [...new Set(ids)].slice(0, 50);
  if (uniqueIds.length === 0) return res.json([]);

  const placeholders = uniqueIds.map(() => "?").join(",");
  db.all(
    `SELECT pid, catid, name, price, description, image_path, thumb_path
     FROM products
     WHERE pid IN (${placeholders})`,
    uniqueIds,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    },
  );
});

app.get("/api/vouchers/validate", auth.requireSession, async (req, res) => {
  try {
    const code = normalizeVoucherCode(req.query.code);
    if (!code) {
      return res.json({ valid: false, reason: "Voucher code is required" });
    }
    const voucher = await getDb(
      `SELECT code, discount_amount, quota, used_count, is_active
       FROM vouchers
       WHERE code = ?`,
      [code],
    );
    if (!voucher || Number(voucher.is_active) !== 1) {
      return res.json({ valid: false, reason: "Voucher code is invalid" });
    }
    const quota = Number(voucher.quota || 0);
    const used = Number(voucher.used_count || 0);
    if (quota > 0 && used >= quota) {
      return res.json({ valid: false, reason: "Voucher quota has been exhausted" });
    }
    res.json({
      valid: true,
      voucher: {
        code: voucher.code,
        discountAmount: Number(voucher.discount_amount || 0),
        quota,
        usedCount: used,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to validate voucher" });
  }
});

app.post(
  "/api/checkout/create-order",
  security.verifyCsrf,
  auth.requireSession,
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Stripe is not configured" });
      }
      const normalizedItems = normalizeOrderItems(req.body && req.body.items);
      if (!normalizedItems) {
        return res.status(400).json({ error: "Invalid cart items" });
      }
      const voucherCode = normalizeVoucherCode(req.body && req.body.voucherCode);

      const pids = normalizedItems.map((x) => x.pid);
      const placeholders = pids.map(() => "?").join(",");
      const products = await allDb(
        `SELECT pid, name, price
         FROM products
         WHERE pid IN (${placeholders})`,
        pids,
      );
      if (products.length !== pids.length) {
        return res.status(400).json({ error: "One or more products not found" });
      }

      const productMap = new Map(products.map((p) => [p.pid, p]));
      const digestItems = normalizedItems.map((item) => {
        const product = productMap.get(item.pid);
        const price = Number(product.price);
        return {
          pid: item.pid,
          quantity: item.quantity,
          unitPrice: price,
          name: product.name,
        };
      });

      const subtotalCents = digestItems.reduce(
        (sum, it) => sum + (toCents(it.unitPrice) || 0) * it.quantity,
        0,
      );
      let voucher = null;
      if (voucherCode) {
        voucher = await getDb(
          `SELECT id, code, discount_amount, quota, used_count, is_active
           FROM vouchers
           WHERE code = ?`,
          [voucherCode],
        );
        if (!voucher || Number(voucher.is_active) !== 1) {
          return res.status(400).json({ error: "Invalid voucher code" });
        }
      }
      let discountCents = 0;
      if (voucher) {
        const quota = Number(voucher.quota || 0);
        const used = Number(voucher.used_count || 0);
        if (quota > 0 && used >= quota) {
          return res.status(400).json({ error: "Voucher quota exhausted" });
        }
        discountCents = Math.max(0, toCents(voucher.discount_amount) || 0);
      }
      const checkoutPricing = buildCheckoutLineItems(digestItems, discountCents);
      const totalPrice = centsToAmount(checkoutPricing.totalCents);
      const salt = crypto.randomBytes(16).toString("hex");
      const digest = computeOrderDigest({
        currency: CHECKOUT_CURRENCY,
        merchantEmail: MERCHANT_EMAIL,
        salt,
        items: checkoutPricing.lineItems.map((it) => ({
          pid: it.pid,
          quantity: it.quantity,
          unitPrice: centsToAmount(it.unitCents),
        })),
        totalPrice,
      });

      await runDb("BEGIN IMMEDIATE");
      let orderId = null;
      try {
        if (voucher) {
          const voucherUpdate = await runDb(
            `UPDATE vouchers
             SET used_count = used_count + 1
             WHERE id = ?
               AND is_active = 1
               AND (quota = 0 OR used_count < quota)`,
            [voucher.id],
          );
          if (voucherUpdate.changes !== 1) {
            await runDb("ROLLBACK");
            return res.status(409).json({ error: "Voucher was just exhausted" });
          }
        }

        const created = await runDb(
          `INSERT INTO orders (
            user_id, user_email, currency, merchant_email, salt, digest, total_price,
            subtotal_price, discount_amount, voucher_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.auth.userid,
            req.auth.email,
            CHECKOUT_CURRENCY,
            MERCHANT_EMAIL,
            salt,
            digest,
            totalPrice,
            centsToAmount(checkoutPricing.subtotalCents),
            centsToAmount(checkoutPricing.discountCents),
            voucher ? voucher.code : null,
          ],
        );
        orderId = created.lastID;

        for (const item of checkoutPricing.lineItems) {
          await runDb(
            `INSERT INTO order_items (order_id, pid, quantity, unit_price, product_name)
             VALUES (?, ?, ?, ?, ?)`,
            [
              orderId,
              item.pid,
              item.quantity,
              centsToAmount(item.unitCents),
              item.name,
            ],
          );
        }
        await runDb("COMMIT");
      } catch (txErr) {
        try {
          await runDb("ROLLBACK");
        } catch (_) {
          // ignore rollback errors
        }
        throw txErr;
      }

      let session = null;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: req.auth.email,
          client_reference_id: String(orderId),
          metadata: {
            orderId: String(orderId),
            digest,
          },
          line_items: checkoutPricing.lineItems.map((item) => ({
            quantity: item.quantity,
            price_data: {
              currency: CHECKOUT_CURRENCY.toLowerCase(),
              unit_amount: item.unitCents,
              product_data: {
                name: item.name,
                metadata: {
                  pid: String(item.pid),
                },
              },
            },
          })),
          success_url: `${getPublicBaseUrl(req)}/checkout-result.html?status=success&order_id=${orderId}`,
          cancel_url: `${getPublicBaseUrl(req)}/checkout-result.html?status=cancel&order_id=${orderId}`,
        });
      } catch (stripeErr) {
        if (voucher && orderId) {
          await runDb("BEGIN IMMEDIATE");
          try {
            await runDb(
              "UPDATE vouchers SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE id = ?",
              [voucher.id],
            );
            await runDb("DELETE FROM order_items WHERE order_id = ?", [orderId]);
            await runDb("DELETE FROM orders WHERE order_id = ?", [orderId]);
            await runDb("COMMIT");
          } catch (undoErr) {
            await runDb("ROLLBACK");
            console.error("Failed to rollback voucher usage:", undoErr);
          }
        }
        throw stripeErr;
      }
      await runDb(
        "UPDATE orders SET gateway_order_id = ? WHERE order_id = ?",
        [session.id, orderId],
      );

      res.json({
        orderId,
        digest,
        checkoutUrl: session.url,
        subtotal: centsToAmount(checkoutPricing.subtotalCents),
        discount: centsToAmount(checkoutPricing.discountCents),
        total: totalPrice,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create order" });
    }
  },
);

async function createStripeCheckoutForExistingOrder(req, orderId) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  const order = await getDb("SELECT * FROM orders WHERE order_id = ?", [orderId]);
  if (!order) throw new Error("Order not found");
  const status = String(order.payment_status || "").toLowerCase();
  if (status !== "pending") throw new Error("Only pending orders can be paid");
  if (!req.auth.isAdmin && Number(order.user_id) !== Number(req.auth.userid)) {
    throw new Error("Forbidden");
  }
  const items = await allDb(
    `SELECT pid, product_name, quantity, unit_price
     FROM order_items
     WHERE order_id = ?
     ORDER BY pid ASC`,
    [orderId],
  );
  if (!items.length) throw new Error("Order has no items");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.user_email,
    client_reference_id: String(orderId),
    metadata: {
      orderId: String(orderId),
      digest: String(order.digest || ""),
    },
    line_items: items.map((item) => ({
      quantity: Number(item.quantity),
      price_data: {
        currency: String(order.currency || CHECKOUT_CURRENCY).toLowerCase(),
        unit_amount: Math.max(0, toCents(item.unit_price) || 0),
        product_data: {
          name: String(item.product_name || `Product #${item.pid}`),
          metadata: {
            pid: String(item.pid),
          },
        },
      },
    })),
    success_url: `${getPublicBaseUrl(req)}/checkout-result.html?status=success&order_id=${orderId}`,
    cancel_url: `${getPublicBaseUrl(req)}/checkout-result.html?status=cancel&order_id=${orderId}`,
  });
  await runDb("UPDATE orders SET gateway_order_id = ? WHERE order_id = ?", [session.id, orderId]);
  return session;
}

app.post(
  "/api/orders/:id/pay-again",
  security.verifyCsrf,
  auth.requireSession,
  async (req, res) => {
    try {
      const orderId = security.validatePositiveInt(req.params.id);
      if (!orderId) return res.status(400).json({ error: "Invalid order id" });
      const session = await createStripeCheckoutForExistingOrder(req, orderId);
      res.json({ checkoutUrl: session.url, orderId });
    } catch (err) {
      const msg = err && err.message ? err.message : "Failed to create checkout session";
      if (msg === "Forbidden") return res.status(403).json({ error: msg });
      if (msg.includes("pending") || msg.includes("not found")) {
        return res.status(400).json({ error: msg });
      }
      console.error(err);
      res.status(500).json({ error: msg });
    }
  },
);

app.post(
  "/api/orders/:id/cancel",
  security.verifyCsrf,
  auth.requireSession,
  async (req, res) => {
    try {
      const orderId = security.validatePositiveInt(req.params.id);
      if (!orderId) return res.status(400).json({ error: "Invalid order id" });
      const order = await getDb("SELECT * FROM orders WHERE order_id = ?", [orderId]);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!req.auth.isAdmin && Number(order.user_id) !== Number(req.auth.userid)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (String(order.payment_status).toLowerCase() !== "pending") {
        return res.status(400).json({ error: "Only pending orders can be cancelled" });
      }
      await runDb("BEGIN IMMEDIATE");
      try {
        await runDb(
          "UPDATE orders SET payment_status = 'cancelled' WHERE order_id = ? AND payment_status = 'pending'",
          [orderId],
        );
        if (order.voucher_code) {
          await runDb(
            `UPDATE vouchers
             SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END
             WHERE code = ?`,
            [order.voucher_code],
          );
        }
        await runDb("COMMIT");
      } catch (txErr) {
        await runDb("ROLLBACK");
        throw txErr;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  },
);

app.post(
  "/api/orders/:id/modify",
  security.verifyCsrf,
  auth.requireSession,
  async (req, res) => {
    try {
      const orderId = security.validatePositiveInt(req.params.id);
      if (!orderId) return res.status(400).json({ error: "Invalid order id" });
      const order = await getDb("SELECT * FROM orders WHERE order_id = ?", [orderId]);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!req.auth.isAdmin && Number(order.user_id) !== Number(req.auth.userid)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (String(order.payment_status).toLowerCase() !== "pending") {
        return res.status(400).json({ error: "Only pending orders can be modified" });
      }

      const normalizedItems = normalizeOrderItems(req.body && req.body.items);
      if (!normalizedItems) {
        return res.status(400).json({ error: "Invalid order items" });
      }
      const pids = normalizedItems.map((x) => x.pid);
      const placeholders = pids.map(() => "?").join(",");
      const products = await allDb(
        `SELECT pid, name, price
         FROM products
         WHERE pid IN (${placeholders})`,
        pids,
      );
      if (products.length !== pids.length) {
        return res.status(400).json({ error: "One or more products not found" });
      }
      const productMap = new Map(products.map((p) => [p.pid, p]));
      const sourceItems = normalizedItems.map((item) => {
        const p = productMap.get(item.pid);
        return {
          pid: item.pid,
          quantity: item.quantity,
          unitPrice: Number(p.price),
          name: p.name,
        };
      });

      const oldDiscountCents = Math.max(0, toCents(order.discount_amount) || 0);
      const pricing = buildCheckoutLineItems(sourceItems, oldDiscountCents);
      const newTotal = centsToAmount(pricing.totalCents);
      const digest = computeOrderDigest({
        currency: order.currency,
        merchantEmail: order.merchant_email,
        salt: order.salt,
        items: pricing.lineItems.map((it) => ({
          pid: it.pid,
          quantity: it.quantity,
          unitPrice: centsToAmount(it.unitCents),
        })),
        totalPrice: newTotal,
      });

      await runDb("BEGIN IMMEDIATE");
      try {
        await runDb("DELETE FROM order_items WHERE order_id = ?", [orderId]);
        for (const item of pricing.lineItems) {
          await runDb(
            `INSERT INTO order_items (order_id, pid, quantity, unit_price, product_name)
             VALUES (?, ?, ?, ?, ?)`,
            [orderId, item.pid, item.quantity, centsToAmount(item.unitCents), item.name],
          );
        }
        await runDb(
          `UPDATE orders
           SET total_price = ?, subtotal_price = ?, discount_amount = ?, digest = ?, gateway_order_id = NULL
           WHERE order_id = ?`,
          [
            newTotal,
            centsToAmount(pricing.subtotalCents),
            centsToAmount(pricing.discountCents),
            digest,
            orderId,
          ],
        );
        await runDb("COMMIT");
      } catch (txErr) {
        await runDb("ROLLBACK");
        throw txErr;
      }
      res.json({
        ok: true,
        orderId,
        total: newTotal,
        subtotal: centsToAmount(pricing.subtotalCents),
        discount: centsToAmount(pricing.discountCents),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to modify order" });
    }
  },
);

app.get("/api/orders/:id/checkout-context", auth.requireSession, async (req, res) => {
  try {
    const orderId = security.validatePositiveInt(req.params.id);
    if (!orderId) return res.status(400).json({ error: "Invalid order id" });
    const order = await getDb("SELECT * FROM orders WHERE order_id = ?", [orderId]);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!req.auth.isAdmin && order.user_id !== req.auth.userid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const items = await allDb(
      `SELECT pid, product_name, quantity, unit_price
       FROM order_items
       WHERE order_id = ?
       ORDER BY pid ASC`,
      [orderId],
    );
    res.json({
      order: {
        orderId: order.order_id,
        paymentStatus: order.payment_status,
        totalPrice: Number(order.total_price),
        subtotalPrice: Number(order.subtotal_price || order.total_price),
        discountAmount: Number(order.discount_amount || 0),
        voucherCode: order.voucher_code || null,
        currency: order.currency,
        createdAt: order.created_at,
      },
      items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

app.get("/api/admin/orders", auth.requireAdmin, async (req, res) => {
  try {
    const orders = await allDb(
      `SELECT order_id, user_email, currency, total_price, payment_status, created_at, paid_at
       FROM orders
       ORDER BY order_id DESC
       LIMIT 200`,
    );
    const orderIds = orders.map((o) => o.order_id);
    if (!orderIds.length) return res.json([]);

    const placeholders = orderIds.map(() => "?").join(",");
    const items = await allDb(
      `SELECT order_id, pid, product_name, quantity, unit_price
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY order_id DESC, pid ASC`,
      orderIds,
    );
    const itemMap = new Map();
    for (const it of items) {
      if (!itemMap.has(it.order_id)) itemMap.set(it.order_id, []);
      itemMap.get(it.order_id).push(it);
    }

    res.json(
      orders.map((o) => ({
        ...o,
        total_price: Number(o.total_price),
        items: itemMap.get(o.order_id) || [],
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load admin orders" });
  }
});

app.get("/api/my/orders", auth.requireSession, async (req, res) => {
  try {
    const allMode = String(req.query.all || "") === "1";
    const limitRaw = security.validatePositiveInt(req.query.limit);
    const limit = Math.min(limitRaw || (allMode ? 200 : 5), 200);
    const orders = await allDb(
      `SELECT order_id, currency, total_price, subtotal_price, discount_amount, voucher_code,
              payment_status, created_at, paid_at
       FROM orders
       WHERE user_id = ?
       ORDER BY order_id DESC
       LIMIT ?`,
      [req.auth.userid, limit],
    );
    const orderIds = orders.map((o) => o.order_id);
    if (!orderIds.length) return res.json([]);

    const placeholders = orderIds.map(() => "?").join(",");
    const items = await allDb(
      `SELECT order_id, pid, product_name, quantity, unit_price
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY order_id DESC, pid ASC`,
      orderIds,
    );
    const itemMap = new Map();
    for (const it of items) {
      if (!itemMap.has(it.order_id)) itemMap.set(it.order_id, []);
      itemMap.get(it.order_id).push(it);
    }

    res.json(
      orders.map((o) => ({
        ...o,
        total_price: Number(o.total_price),
        subtotal_price: Number(o.subtotal_price || o.total_price),
        discount_amount: Number(o.discount_amount || 0),
        items: itemMap.get(o.order_id) || [],
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load recent orders" });
  }
});

app.get("/api/product/:id", async (req, res) => {
  try {
    const pid = security.validatePositiveInt(req.params.id);
    if (!pid) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    const row = await getDb("SELECT * FROM products WHERE pid = ?", [pid]);
    if (!row) return res.status(404).json({ error: "Product not found" });
    const ratingMap = await getAverageRatingMapByProductIds([pid]);
    const stats = ratingMap.get(pid);
    res.json({
      ...row,
      avg_rating: stats ? stats.averageRating : 10,
      rating_review_count: stats ? stats.reviewCount : 0,
      rating_completed_orders: stats ? stats.completedOrders : 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load product" });
  }
});

app.get("/api/product/:id/reviews", async (req, res) => {
  try {
    const pid = security.validatePositiveInt(req.params.id);
    if (!pid) return res.status(400).json({ error: "Invalid product id" });
    const ratingMap = await getAverageRatingMapByProductIds([pid]);
    const stats = ratingMap.get(pid) || {
      averageRating: 10,
      reviewCount: 0,
      completedOrders: 0,
    };
    const comments = await allDb(
      `SELECT pr.rating, pr.comment, pr.created_at, u.display_name, u.email
       FROM product_reviews pr
       JOIN users u ON u.userid = pr.user_id
       WHERE pr.pid = ?
         AND pr.comment IS NOT NULL
         AND LENGTH(TRIM(pr.comment)) > 0
       ORDER BY pr.created_at DESC
       LIMIT 5`,
      [pid],
    );
    res.json({
      averageRating: Number(stats.averageRating || 10),
      reviewCount: Number(stats.reviewCount || 0),
      completedOrders: Number(stats.completedOrders || 0),
      comments: comments.map((c) => ({
        rating: Number(c.rating || 10),
        comment: c.comment || "",
        createdAt: c.created_at,
        author: c.display_name || c.email || "Anonymous",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

app.get("/api/product/:id/review-eligibility", auth.requireSession, async (req, res) => {
  try {
    const pid = security.validatePositiveInt(req.params.id);
    if (!pid) return res.status(400).json({ error: "Invalid product id" });
    const rows = await allDb(
      `SELECT o.order_id
       FROM orders o
       WHERE o.user_id = ?
         AND o.payment_status = 'paid'
         AND o.paid_at IS NOT NULL
         AND datetime(o.paid_at) >= datetime('now', '-7 day')
         AND EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = o.order_id AND oi.pid = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM product_reviews pr
           WHERE pr.order_id = o.order_id
             AND pr.user_id = o.user_id
             AND pr.pid = ?
         )
       ORDER BY datetime(o.paid_at) DESC, o.order_id DESC`,
      [req.auth.userid, pid, pid],
    );
    res.json({
      canReview: rows.length > 0,
      remainingEligibleOrders: rows.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check review eligibility" });
  }
});

app.post(
  "/api/product/:id/reviews",
  security.verifyCsrf,
  auth.requireSession,
  async (req, res) => {
    try {
      const pid = security.validatePositiveInt(req.params.id);
      if (!pid) return res.status(400).json({ error: "Invalid product id" });
      const rating = security.validatePositiveInt(req.body.rating);
      const commentRaw = security.sanitizeText(req.body.comment, 500);
      const comment = commentRaw ? commentRaw : null;
      if (!rating || rating < 1 || rating > 10) {
        return res.status(400).json({ error: "Rating must be between 1 and 10" });
      }
      const eligibleOrder = await getDb(
        `SELECT o.order_id
         FROM orders o
         WHERE o.user_id = ?
           AND o.payment_status = 'paid'
           AND o.paid_at IS NOT NULL
           AND datetime(o.paid_at) >= datetime('now', '-7 day')
           AND EXISTS (
             SELECT 1 FROM order_items oi
             WHERE oi.order_id = o.order_id AND oi.pid = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM product_reviews pr
             WHERE pr.order_id = o.order_id
               AND pr.user_id = o.user_id
               AND pr.pid = ?
           )
         ORDER BY datetime(o.paid_at) DESC, o.order_id DESC
         LIMIT 1`,
        [req.auth.userid, pid, pid],
      );
      if (!eligibleOrder) {
        return res.status(403).json({
          error: "No eligible completed order for this product in the last 7 days",
        });
      }
      await runDb(
        `INSERT INTO product_reviews (order_id, user_id, pid, rating, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [eligibleOrder.order_id, req.auth.userid, pid, rating, comment],
      );
      res.json({ ok: true });
    } catch (err) {
      if (String(err && err.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "Review already submitted for this order" });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to submit review" });
    }
  },
);

// Multer: disk storage + strict image MIME filter (already mitigates some malicious uploads).
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(FRONTEND_PUBLIC, "uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// --- Mutating API: CSRF required; body validated server-side ---

app.post("/api/categories", security.verifyCsrf, auth.requireAdmin, (req, res) => {
  const name = security.sanitizeText(req.body.name, security.LIMITS.categoryName);
  if (!name) {
    return res.status(400).json({ error: "Category name is required" });
  }
  db.run("INSERT INTO categories (name) VALUES (?)", [name], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put("/api/categories/:id", security.verifyCsrf, auth.requireAdmin, (req, res) => {
  const id = security.validatePositiveInt(req.params.id);
  const name = security.sanitizeText(req.body.name, security.LIMITS.categoryName);
  if (!id || !name) {
    return res.status(400).json({ error: "Invalid category data" });
  }
  db.run(
    "UPDATE categories SET name = ? WHERE catid = ?",
    [name, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json({ message: "Category updated" });
    },
  );
});

app.delete("/api/categories/:id", security.verifyCsrf, auth.requireAdmin, (req, res) => {
  const id = security.validatePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid category id" });
  }
  db.run("DELETE FROM categories WHERE catid = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json({ message: "Category deleted" });
  });
});

app.post(
  "/api/products",
  upload.single("image"),
  security.verifyCsrf,
  auth.requireAdmin,
  async (req, res) => {
    try {
      const catid = security.validatePositiveInt(req.body.catid);
      const name = security.sanitizeText(req.body.name, security.LIMITS.productName);
      const price = security.validatePrice(req.body.price);
      const description = security.sanitizeText(
        req.body.description,
        security.LIMITS.description,
      );
      const file = req.file;

      if (!file) return res.status(400).json({ error: "No image uploaded" });
      if (!catid || !name || price === null || !description) {
        return res.status(400).json({ error: "Invalid product data" });
      }

      db.run(
        "INSERT INTO products (catid, name, price, description) VALUES (?, ?, ?, ?)",
        [catid, name, price, description],
        async function (err) {
          if (err) return res.status(500).json({ error: err.message });
          const pid = this.lastID;
          const ext =
            path.extname(file.originalname) || path.extname(file.filename);

          const imageFilename = `${pid}${ext}`;
          const thumbFilename = `${pid}_thumb${ext}`;

          const imageDiskPath = path.join(FRONTEND_PUBLIC, "uploads", imageFilename);
          const thumbDiskPath = path.join(FRONTEND_PUBLIC, "thumbnails", thumbFilename);

          try {
            fs.renameSync(file.path, imageDiskPath);
            await sharp(imageDiskPath).resize(300).toFile(thumbDiskPath);

            const webImagePath = "uploads/" + imageFilename;
            const webThumbPath = "thumbnails/" + thumbFilename;

            db.run(
              "UPDATE products SET image_path = ?, thumb_path = ? WHERE pid = ?",
              [webImagePath, webThumbPath, pid],
              function (updateErr) {
                if (updateErr) {
                  return res.status(500).json({ error: updateErr.message });
                }
                res.json({
                  message: "Product added successfully",
                  pid,
                  image_path: webImagePath,
                  thumb_path: webThumbPath,
                });
              },
            );
          } catch (fsErr) {
            console.error(fsErr);
            return res.status(500).json({ error: "Failed to process image" });
          }
        },
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to process image" });
    }
  },
);

app.put(
  "/api/products/:id",
  upload.single("image"),
  security.verifyCsrf,
  auth.requireAdmin,
  async (req, res) => {
    const pid = security.validatePositiveInt(req.params.id);
    if (!pid) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const fields = [];
    const params = [];

    if (req.body.name !== undefined && String(req.body.name).trim() !== "") {
      const n = security.sanitizeText(req.body.name, security.LIMITS.productName);
      if (n) {
        fields.push("name = ?");
        params.push(n);
      }
    }
    if (req.body.price !== undefined && String(req.body.price).trim() !== "") {
      const price = security.validatePrice(req.body.price);
      if (price !== null) {
        fields.push("price = ?");
        params.push(price);
      }
    }
    if (
      req.body.description !== undefined &&
      String(req.body.description).trim() !== ""
    ) {
      const d = security.sanitizeText(
        req.body.description,
        security.LIMITS.description,
      );
      if (d) {
        fields.push("description = ?");
        params.push(d);
      }
    }
    if (req.body.catid !== undefined && String(req.body.catid).trim() !== "") {
      const catid = security.validatePositiveInt(req.body.catid);
      if (catid) {
        fields.push("catid = ?");
        params.push(catid);
      }
    }

    const file = req.file;

    try {
      if (file) {
        const ext =
          path.extname(file.originalname) ||
          path.extname(file.filename) ||
          ".jpg";
        const imageFilename = `${pid}${ext}`;
        const thumbFilename = `${pid}_thumb${ext}`;
        const imageDiskPath = path.join(FRONTEND_PUBLIC, "uploads", imageFilename);
        const thumbDiskPath = path.join(FRONTEND_PUBLIC, "thumbnails", thumbFilename);

        db.get(
          "SELECT image_path, thumb_path FROM products WHERE pid = ?",
          [pid],
          (err, row) => {
            if (!err && row) {
              const oldImage = row.image_path
                ? path.join(FRONTEND_PUBLIC, row.image_path)
                : null;
              const oldThumb = row.thumb_path
                ? path.join(FRONTEND_PUBLIC, row.thumb_path)
                : null;
              [oldImage, oldThumb].forEach((p) => {
                if (p && fs.existsSync(p)) fs.unlink(p, () => {});
              });
            }
          },
        );

        fs.renameSync(file.path, imageDiskPath);
        await sharp(imageDiskPath).resize(300).toFile(thumbDiskPath);

        const webImagePath = "uploads/" + imageFilename;
        const webThumbPath = "thumbnails/" + thumbFilename;
        fields.push("image_path = ?");
        params.push(webImagePath);
        fields.push("thumb_path = ?");
        params.push(webThumbPath);
      }

      if (fields.length === 0) {
        return res
          .status(400)
          .json({ error: "No valid fields provided for update" });
      }

      params.push(pid);
      const sql = `UPDATE products SET ${fields.join(", ")} WHERE pid = ?`;
      db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
          return res.status(404).json({ error: "Product not found" });
        }
        res.json({ message: "Product updated" });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update product" });
    }
  },
);

app.delete("/api/products/:id", security.verifyCsrf, auth.requireAdmin, (req, res) => {
  const pid = security.validatePositiveInt(req.params.id);
  if (!pid) {
    return res.status(400).json({ error: "Invalid product id" });
  }

  db.get(
    "SELECT image_path, thumb_path FROM products WHERE pid = ?",
    [pid],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        const imagePath = row.image_path
          ? path.join(FRONTEND_PUBLIC, row.image_path)
          : null;
        const thumbPath = row.thumb_path
          ? path.join(FRONTEND_PUBLIC, row.thumb_path)
          : null;
        [imagePath, thumbPath].forEach((p) => {
          if (p && fs.existsSync(p)) fs.unlink(p, () => {});
        });
      }

      db.run("DELETE FROM products WHERE pid = ?", [pid], function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        if (this.changes === 0) {
          return res.status(404).json({ error: "Product not found" });
        }
        res.json({ message: "Product deleted" });
      });
    },
  );
});

// Static assets last so /api/* always hits handlers first.
app.use(express.static(FRONTEND_PUBLIC));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
