/**
 * Fetch CSRF token after visitor cookie is set; attach to mutating admin requests.
 * credentials: 'include' is required so Set-Cookie from /api/csrf-token is stored.
 */

let csrfToken = null;

async function initCsrf() {
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (!res.ok) throw new Error("CSRF bootstrap failed");
  const data = await res.json();
  csrfToken = data.csrfToken || null;
  return csrfToken;
}

function getCsrfToken() {
  return csrfToken;
}

// Header name must match server middleware/security.js (lowercased by Express).
function csrfHeaders() {
  return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
}

function appendCsrfToFormData(formData) {
  if (csrfToken) formData.append("_csrf", csrfToken);
}

window.ZStoreCsrf = {
  initCsrf,
  getCsrfToken,
  csrfHeaders,
  appendCsrfToFormData,
};
