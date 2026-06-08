function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function fetchOrderStatus(orderId) {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/checkout-context`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to load order status");
  }
  return String(data.order && data.order.paymentStatus ? data.order.paymentStatus : "");
}

async function waitForPaid(orderId, timeoutMs = 20000, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = (await fetchOrderStatus(orderId)).toLowerCase();
    if (status === "paid") return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = (getQueryParam("status") || "").toLowerCase();
  const orderId = getQueryParam("order_id");
  const titleEl = document.getElementById("result-title");
  const textEl = document.getElementById("result-text");
  if (!titleEl || !textEl) return;

  if (status === "success") {
    if (!orderId) {
      titleEl.textContent = "Payment Processing";
      textEl.textContent = "Missing order ID. Please verify in your account orders.";
      return;
    }

    titleEl.textContent = "Payment Processing";
    textEl.textContent = `Order #${orderId} is being confirmed. Please wait...`;
    try {
      const paid = await waitForPaid(orderId, 20000, 2000);
      if (paid) {
        titleEl.textContent = "Payment Completed";
        textEl.textContent = `Order #${orderId} has been confirmed as paid.`;
        setTimeout(() => {
          window.location.href = "index.html";
        }, 2500);
      } else {
        titleEl.textContent = "Payment Pending Confirmation";
        textEl.textContent =
          "Stripe payment succeeded, but webhook confirmation has not arrived yet. Please refresh later or check your recent orders.";
      }
    } catch (err) {
      titleEl.textContent = "Payment Status Unavailable";
      textEl.textContent =
        err && err.message
          ? err.message
          : "Unable to verify payment status now. Please check your recent orders.";
    }
    return;
  }

  if (status === "cancel") {
    titleEl.textContent = "Payment Cancelled";
    textEl.textContent = "You cancelled checkout. Your order is still pending.";
    return;
  }

  titleEl.textContent = "Unknown Payment Status";
  textEl.textContent = "Please verify your order in the admin panel or your recent orders list.";
});
