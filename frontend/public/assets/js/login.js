/**
 * Login form: CSRF + JSON to /api/login; server sets HttpOnly session cookie.
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  const nextPage = params.get("next");

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await window.ZStoreCsrf.initCsrf();
    } catch (e) {
      console.error(e);
    }

    const form = document.getElementById("form-login");
    const msg = document.getElementById("login-msg");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (msg) msg.textContent = "";
      await window.ZStoreCsrf.initCsrf().catch(() => {});
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...window.ZStoreCsrf.csrfHeaders(),
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (msg) msg.textContent = data.error || "Invalid email or password";
          return;
        }
        let dest = data.redirect || "index.html";
        const next = (nextPage || "").trim();
        if (next === "admin.html" && data.user && data.user.isAdmin) {
          dest = "admin.html";
        } else if (next === "change-password.html") {
          dest = "change-password.html";
        }
        window.location.href = dest;
      } catch (err) {
        console.error(err);
        if (msg) msg.textContent = "Network error";
      }
    });
  });
})();
