/**
 * Phase 4 Section A: request hardening (CSP, CSRF session + SameSite cookie,
 * server-side validation helpers). Comments in English per project convention.
 */

const crypto = require("crypto");

// HttpOnly visitor id; SameSite=Lax is the extra CSRF layer alongside the nonce.
const VISITOR_COOKIE = "zstore_sid";
const CSRF_HEADER = "x-csrf-token";
const CSRF_FIELD = "_csrf";

// Max field lengths (must match or exceed client maxlength attributes).
const LIMITS = {
  categoryName: 100,
  productName: 150,
  description: 1000,
  priceMax: 1e9,
  email: 254,
  displayName: 100,
  passwordMax: 128,
  passwordMin: 8,
};

// sid -> { csrfToken: string, created: number }
const visitorSessions = new Map();
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function randomHex(byteLength) {
  return crypto.randomBytes(byteLength).toString("hex");
}

function pruneOldSessions() {
  const now = Date.now();
  for (const [sid, data] of visitorSessions.entries()) {
    if (now - data.created > SESSION_MAX_AGE_MS) visitorSessions.delete(sid);
  }
}

/**
 * Strict string cleanup: strip NUL, trim, enforce max length (parameter tampering / overflow).
 */
function sanitizeText(value, maxLen) {
  if (value === undefined || value === null) return "";
  let s = String(value).replace(/\0/g, "").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function validatePositiveInt(value) {
  const n = parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function validatePrice(value) {
  const n = parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.priceMax) return null;
  return n;
}

/**
 * Constant-time comparison to avoid leaking token length via timingSafeEqual throw.
 */
function safeEqualString(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function setVisitorCookie(res, sid) {
  const maxAgeSec = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const secure =
    process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIES === "1";
  res.cookie(VISITOR_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

/**
 * Ensure visitor has a session and return the CSRF token for this browser.
 */
function ensureVisitorAndCsrf(req, res) {
  pruneOldSessions();
  let sid = req.cookies && req.cookies[VISITOR_COOKIE];
  if (!sid || !visitorSessions.has(sid)) {
    sid = randomHex(16);
    visitorSessions.set(sid, {
      csrfToken: randomHex(32),
      created: Date.now(),
    });
    setVisitorCookie(res, sid);
  }
  return visitorSessions.get(sid).csrfToken;
}

function getExpectedCsrf(req) {
  const sid = req.cookies && req.cookies[VISITOR_COOKIE];
  if (!sid) return null;
  const row = visitorSessions.get(sid);
  return row ? row.csrfToken : null;
}

function extractSubmittedCsrf(req) {
  if (req.body && typeof req.body[CSRF_FIELD] === "string") {
    return req.body[CSRF_FIELD];
  }
  const h = req.headers[CSRF_HEADER];
  if (typeof h === "string") return h;
  return null;
}

/**
 * Reject state-changing API calls without a valid CSRF nonce (synchronizer token pattern).
 */
function verifyCsrf(req, res, next) {
  const expected = getExpectedCsrf(req);
  const submitted = extractSubmittedCsrf(req);
  if (!expected || !submitted || !safeEqualString(expected, submitted)) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }
  next();
}

/**
 * CSP to reduce XSS impact; CDNs used by HTML are allowlisted explicitly.
 */
function cspMiddleware(req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "img-src 'self' data: blob:",
      "font-src 'self' https://cdnjs.cloudflare.com",
      // DevTools may fetch CSS source maps from CDNs referenced by Bootstrap etc.
      "connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
}

module.exports = {
  VISITOR_COOKIE,
  CSRF_HEADER,
  CSRF_FIELD,
  LIMITS,
  sanitizeText,
  validatePositiveInt,
  validatePrice,
  ensureVisitorAndCsrf,
  verifyCsrf,
  cspMiddleware,
};
