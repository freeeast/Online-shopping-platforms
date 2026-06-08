/**
 * Change password: any logged-in user (session + CSRF). Guests → login with return URL.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("form-change-password");
  if (!form) return;

  let me;
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    me = await r.json();
  } catch {
    me = { user: null };
  }

  if (!me.user) {
    window.location.replace("login.html?next=change-password.html");
    return;
  }

  try {
    await window.ZStoreCsrf.initCsrf();
  } catch (e) {
    console.error(e);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById("cp-msg");
    if (msgEl) msgEl.textContent = "";
    await window.ZStoreCsrf.initCsrf().catch(() => {});
    if (!window.ZStoreCsrf.getCsrfToken()) {
      if (msgEl) msgEl.textContent = "Security token missing — refresh the page";
      return;
    }
    const currentPassword = document.getElementById("cp-old").value;
    const newPassword = document.getElementById("cp-new").value;
    const newPasswordConfirm = document.getElementById("cp-new2").value;
    if (newPassword !== newPasswordConfirm) {
      if (msgEl) msgEl.textContent = "New passwords do not match";
      return;
    }
    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          newPasswordConfirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      window.location.href = data.redirect || "login.html";
    } catch (err) {
      if (msgEl) msgEl.textContent = err.message;
    }
  });
});
