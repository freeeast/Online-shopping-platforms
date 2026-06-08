function queryToken() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("token") || "").trim();
}

document.addEventListener("DOMContentLoaded", async () => {
  const token = queryToken();
  const form = document.getElementById("form-reset-password");
  const msgEl = document.getElementById("rp-msg");
  if (!form || !msgEl) return;

  try {
    await window.ZStoreCsrf.initCsrf();
  } catch (err) {
    console.error(err);
  }

  if (!token) {
    msgEl.className = "small mb-3 text-danger";
    msgEl.textContent = "Missing reset token.";
    form.querySelector("button[type='submit']").disabled = true;
    return;
  }

  try {
    const verifyRes = await fetch(
      `/api/password-reset/verify?token=${encodeURIComponent(token)}`,
      { credentials: "include" },
    );
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyData.valid) {
      msgEl.className = "small mb-3 text-danger";
      msgEl.textContent = "This reset link is invalid or expired.";
      form.querySelector("button[type='submit']").disabled = true;
      return;
    }
  } catch (err) {
    msgEl.className = "small mb-3 text-danger";
    msgEl.textContent = "Unable to verify reset link.";
    form.querySelector("button[type='submit']").disabled = true;
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById("rp-new").value;
    const newPasswordConfirm = document.getElementById("rp-new2").value;
    if (newPassword !== newPasswordConfirm) {
      msgEl.className = "small mb-3 text-danger";
      msgEl.textContent = "Passwords do not match.";
      return;
    }
    try {
      await window.ZStoreCsrf.initCsrf();
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({
          token,
          newPassword,
          newPasswordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      msgEl.className = "small mb-3 text-success";
      msgEl.textContent = "Password reset successful. Redirecting to sign in...";
      setTimeout(() => {
        window.location.href = data.redirect || "/login.html";
      }, 1200);
    } catch (err) {
      msgEl.className = "small mb-3 text-danger";
      msgEl.textContent = err.message || "Failed to reset password";
    }
  });
});
