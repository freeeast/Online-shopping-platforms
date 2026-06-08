function showOrdersMessage(text, type = "info") {
  const msg = document.getElementById("orders-msg");
  if (!msg) return;
  msg.className = `alert alert-${type}`;
  msg.textContent = text;
  msg.classList.remove("d-none");
}

function parseModifiedItems(text) {
  const entries = String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return null;
  const out = [];
  for (const entry of entries) {
    const [pidRaw, qtyRaw] = entry.split(":").map((s) => s.trim());
    const pid = parseInt(pidRaw, 10);
    const quantity = parseInt(qtyRaw, 10);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return null;
    }
    out.push({ pid, quantity });
  }
  return out;
}

function toEditableItemString(items) {
  return (items || []).map((it) => `${it.pid}:${it.quantity}`).join(", ");
}

function orderItemsSummary(items) {
  return (items || [])
    .map((it) => `${it.product_name} x${it.quantity}`)
    .join(", ");
}

async function loadOrders() {
  const tbody = document.getElementById("my-orders-full-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  try {
    const res = await fetch("/api/my/orders?all=1", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load orders");
    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="5" class="text-muted">No orders yet.</td>';
      tbody.appendChild(tr);
      return;
    }
    orders.forEach((order) => {
      const tr = document.createElement("tr");
      const status = String(order.payment_status || "pending").toLowerCase();
      const badgeClass =
        status === "paid"
          ? "success"
          : status === "pending"
            ? "warning text-dark"
            : "secondary";
      const safeVoucher = order.voucher_code
        ? `<div class="small text-success">Voucher: ${window.zstoreEscapeHtml(order.voucher_code)}</div>`
        : "";
      const canEdit = status === "pending";
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">#${window.zstoreEscapeHtml(String(order.order_id))}</div>
          <div class="small text-muted">${window.zstoreEscapeHtml(String(order.created_at || "-"))}</div>
        </td>
        <td><span class="badge bg-${badgeClass}">${window.zstoreEscapeHtml(status)}</span></td>
        <td>
          <div>Subtotal: $${Number(order.subtotal_price || order.total_price || 0).toFixed(2)}</div>
          <div class="text-success">Discount: -$${Number(order.discount_amount || 0).toFixed(2)}</div>
          <div class="fw-semibold">Total: $${Number(order.total_price || 0).toFixed(2)} ${window.zstoreEscapeHtml(String(order.currency || "HKD"))}</div>
          ${safeVoucher}
        </td>
        <td>
          <div class="small mb-2">${window.zstoreEscapeHtml(orderItemsSummary(order.items) || "-")}</div>
          ${
            canEdit
              ? `<textarea class="form-control form-control-sm modify-items-input" rows="2">${window.zstoreEscapeHtml(toEditableItemString(order.items))}</textarea>
                 <div class="small text-muted mt-1">Format: pid:qty, pid:qty</div>`
              : ""
          }
        </td>
        <td class="d-flex flex-column gap-2">
          ${
            canEdit
              ? `<button class="btn btn-sm btn-outline-primary order-modify-btn" data-order-id="${order.order_id}">Modify</button>
                 <button class="btn btn-sm btn-success order-pay-btn" data-order-id="${order.order_id}">Pay Again</button>
                 <button class="btn btn-sm btn-outline-danger order-cancel-btn" data-order-id="${order.order_id}">Cancel</button>`
              : `<span class="small text-muted">No actions</span>`
          }
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showOrdersMessage(err.message || "Failed to load orders", "danger");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const meRes = await fetch("/api/me", { credentials: "include" });
    const meData = await meRes.json();
    if (!meData.user) {
      window.location.replace("login.html?next=my-orders.html");
      return;
    }
    await window.ZStoreCsrf.initCsrf();
    await loadOrders();
  } catch (err) {
    showOrdersMessage(err.message || "Failed to initialize page", "danger");
  }

  document.body.addEventListener("click", async (e) => {
    const payBtn = e.target.closest(".order-pay-btn");
    const cancelBtn = e.target.closest(".order-cancel-btn");
    const modifyBtn = e.target.closest(".order-modify-btn");

    try {
      await window.ZStoreCsrf.initCsrf();
      if (!window.ZStoreCsrf.getCsrfToken()) {
        throw new Error("Missing CSRF token");
      }
      if (payBtn) {
        const orderId = payBtn.getAttribute("data-order-id");
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay-again`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...window.ZStoreCsrf.csrfHeaders(),
          },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to pay again");
        window.location.href = data.checkoutUrl;
        return;
      }
      if (cancelBtn) {
        const orderId = cancelBtn.getAttribute("data-order-id");
        if (!confirm(`Cancel order #${orderId}?`)) return;
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...window.ZStoreCsrf.csrfHeaders(),
          },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to cancel order");
        showOrdersMessage(`Order #${orderId} cancelled.`, "success");
        await loadOrders();
        return;
      }
      if (modifyBtn) {
        const orderId = modifyBtn.getAttribute("data-order-id");
        const row = modifyBtn.closest("tr");
        const input = row ? row.querySelector(".modify-items-input") : null;
        const items = parseModifiedItems(input ? input.value : "");
        if (!items) throw new Error("Invalid modify format. Use pid:qty, pid:qty");
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/modify`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...window.ZStoreCsrf.csrfHeaders(),
          },
          body: JSON.stringify({ items }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to modify order");
        showOrdersMessage(`Order #${orderId} updated. New total: $${Number(data.total || 0).toFixed(2)}`, "success");
        await loadOrders();
      }
    } catch (err) {
      showOrdersMessage(err.message || "Order action failed", "danger");
    }
  });
});
