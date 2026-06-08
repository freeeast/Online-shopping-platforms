/**
 * HttpOnly session cookie for logged-in users (separate from CSRF visitor cookie).
 * In-memory store: opaque token -> user snapshot. Tokens are unguessable random bytes.
 */

const crypto = require("crypto");

// Cookie name for the authenticated session (not the pre-auth CSRF visitor id).
const AUTH_COOKIE = "zstore_session";

// Persist login across browser restarts: strictly between 0 and 3 days (use 48h).
const AUTH_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// token (hex) -> { userid, email, isAdmin, displayName, created }
const authSessions = new Map();

function randomSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isSecureCookie() {
  return (
    process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIES === "1"
  );
}

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE_MS,
  };
}

/**
 * Remove stale server-side sessions (optional housekeeping).
 */
function pruneExpiredAuthSessions() {
  const now = Date.now();
  for (const [tok, row] of authSessions.entries()) {
    if (now - row.created > AUTH_MAX_AGE_MS) authSessions.delete(tok);
  }
}

/**
 * If browser presents an old session id cookie, invalidate it server-side.
 * Called before issuing a new session after successful login (anti session fixation).
 */
function invalidateAuthTokenFromRequest(req) {
  const t = req.cookies && req.cookies[AUTH_COOKIE];
  if (t) authSessions.delete(t);
}

/**
 * Create a brand-new session id and Set-Cookie (login success).
 */
function createAuthSession(res, userRow) {
  const token = randomSessionToken();
  authSessions.set(token, {
    userid: userRow.userid,
    email: userRow.email,
    isAdmin: userRow.is_admin === 1,
    displayName: userRow.display_name || userRow.email,
    created: Date.now(),
  });
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  return token;
}

/**
 * Clear cookie and remove server session (logout / password change).
 */
function destroyAuthSession(req, res) {
  const t = req.cookies && req.cookies[AUTH_COOKIE];
  if (t) authSessions.delete(t);
  res.clearCookie(AUTH_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(),
  });
}

/**
 * Resolve current user from cookie, or null if missing/unknown/expired.
 */
function getAuthSession(req) {
  pruneExpiredAuthSessions();
  const t = req.cookies && req.cookies[AUTH_COOKIE];
  if (!t) return null;
  const row = authSessions.get(t);
  if (!row) return null;
  if (Date.now() - row.created > AUTH_MAX_AGE_MS) {
    authSessions.delete(t);
    return null;
  }
  return row;
}

/**
 * JSON APIs that require any logged-in user.
 */
function requireSession(req, res, next) {
  const s = getAuthSession(req);
  if (!s) {
    return res.status(401).json({ error: "Authentication required" });
  }
  req.auth = s;
  next();
}

/**
 * Admin CRUD APIs: must have valid session AND admin flag.
 */
function requireAdmin(req, res, next) {
  const s = getAuthSession(req);
  if (!s) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!s.isAdmin) {
    return res.status(403).json({ error: "Admin privileges required" });
  }
  req.auth = s;
  next();
}

module.exports = {
  AUTH_COOKIE,
  AUTH_MAX_AGE_MS,
  invalidateAuthTokenFromRequest,
  createAuthSession,
  destroyAuthSession,
  getAuthSession,
  requireSession,
  requireAdmin,
};
