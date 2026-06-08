/**
 * Public storefront: show current identity (display name, email, or "guest") and basic auth links.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const identity = document.getElementById("auth-identity");
  const loginLink = document.getElementById("auth-login-link");
  const registerLink = document.getElementById("auth-register-link");
  const changePwLink = document.getElementById("auth-change-password-link");
  const myOrdersLink = document.getElementById("auth-my-orders-link");
  const adminLink = document.getElementById("auth-admin-link");
  const logoutBtn = document.getElementById("auth-logout-btn");

  if (!identity) return;

  try {
    const r = await fetch("/api/me", { credentials: "include" });
    const d = await r.json();

    if (d.user) {
      identity.textContent = d.user.displayName || d.user.email;
      loginLink?.classList.add("d-none");
      registerLink?.classList.add("d-none");
      changePwLink?.classList.remove("d-none");
      myOrdersLink?.classList.remove("d-none");
      if (d.user.isAdmin) adminLink?.classList.remove("d-none");
      logoutBtn?.classList.remove("d-none");

      logoutBtn?.addEventListener("click", async () => {
        await window.ZStoreCsrf.initCsrf().catch(() => {});
        await fetch("/api/logout", {
          method: "POST",
          credentials: "include",
          headers: { ...window.ZStoreCsrf.csrfHeaders() },
        });
        window.location.reload();
      });
    } else {
      identity.textContent = "guest";
    }
  } catch {
    identity.textContent = "guest";
  }
});
