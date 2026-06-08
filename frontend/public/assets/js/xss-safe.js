/**
 * Client-side context-dependent encoding for strings inserted into HTML.
 * Prefer textContent when possible; use escapeHtml when building template strings.
 */

// Escape text nodes and attribute-like contexts when using innerHTML.
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow relative image paths we expect from our backend (mitigate `javascript:` etc.).
function safeImageSrc(path) {
  const p = String(path || "").trim();
  if (
    /^uploads\/[A-Za-z0-9._/-]+$/.test(p) ||
    /^thumbnails\/[A-Za-z0-9._/-]+$/.test(p) ||
    /^assets\/[A-Za-z0-9._/-]+$/.test(p)
  ) {
    return p;
  }
  return "assets/images/Sony_Alpha_Camera.jpeg";
}

window.ZStoreXss = { escapeHtml, safeImageSrc };
// Stable names for other classic scripts: duplicate `const { escapeHtml } = ...` in
// multiple files throws "already been declared" in the shared global scope.
window.zstoreEscapeHtml = escapeHtml;
window.zstoreSafeImageSrc = safeImageSrc;
