document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("form-forgot-password");
  const msgEl = document.getElementById("fp-msg");
  if (!form || !msgEl) return;

  try {
    await window.ZStoreCsrf.initCsrf();
  } catch (err) {
    console.error(err);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.textContent = "";
    const email = document.getElementById("fp-email").value.trim();
    try {
      await window.ZStoreCsrf.initCsrf();
      const res = await fetch("/api/password-reset/request", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send reset email");
      msgEl.className = "small mb-3 text-success";
      msgEl.textContent =
        data.message ||
        "If this email is registered, a password reset link has been sent.";
    } catch (err) {
      msgEl.className = "small mb-3 text-danger";
      msgEl.textContent = err.message || "Request failed";
    }
  });
});
