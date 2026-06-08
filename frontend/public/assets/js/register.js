/**
 * Registration: client-side password match; server repeats the same check.
 */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await window.ZStoreCsrf.initCsrf();
  } catch (e) {
    console.error(e);
  }

  const form = document.getElementById("form-register");
  const msg = document.getElementById("reg-msg");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = "";
    await window.ZStoreCsrf.initCsrf().catch(() => {});

    const email = document.getElementById("reg-email").value.trim();
    const displayName = document.getElementById("reg-name").value.trim();
    const password = document.getElementById("reg-password").value;
    const passwordConfirm = document.getElementById("reg-password2").value;

    if (password !== passwordConfirm) {
      if (msg) msg.textContent = "Passwords do not match";
      return;
    }

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({
          email,
          displayName,
          password,
          passwordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (msg) msg.textContent = data.error || "Registration failed";
        return;
      }
      window.location.href = data.redirect || "/login.html";
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Network error";
    }
  });
});
