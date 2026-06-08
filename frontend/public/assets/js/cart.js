/**
 * ZStore Cart (AJAX + localStorage)
 * Stores: { [pid]: qty } in localStorage key "zstore_cart"
 * Fetches product name/price from backend to render.
 */

const CART_STORAGE_KEY = "zstore_cart";

function safeParseJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function toPositiveInt(x, fallback = 1) {
  const n = parseInt(x, 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

class Cart {
  constructor() {
    this.map = {}; // { pid: qty }
    this.load();
  }

  load() {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = safeParseJson(raw, {});
    this.map = {};
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([pid, qty]) => {
        const p = toPositiveInt(pid, null);
        const q = toPositiveInt(qty, null);
        if (p && q) this.map[String(p)] = q;
      });
    }
  }

  save() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(this.map));
    window.dispatchEvent(new CustomEvent("zstore:cart-updated"));
  }

  getCount() {
    return Object.values(this.map).reduce((sum, q) => sum + q, 0);
  }

  getEntries() {
    // [{pid, qty}]
    return Object.entries(this.map).map(([pid, qty]) => ({
      pid: toPositiveInt(pid, 0),
      qty: toPositiveInt(qty, 1),
    }));
  }

  add(pid, qty = 1) {
    const p = toPositiveInt(pid, null);
    if (!p) return;
    const q = toPositiveInt(qty, 1);
    const key = String(p);
    this.map[key] = (this.map[key] || 0) + q;
    this.save();
  }

  setQty(pid, qty) {
    const p = toPositiveInt(pid, null);
    if (!p) return;
    const q = parseInt(qty, 10);
    const key = String(p);
    if (!Number.isInteger(q) || q <= 0) {
      delete this.map[key];
    } else {
      this.map[key] = q;
    }
    this.save();
  }

  remove(pid) {
    const p = toPositiveInt(pid, null);
    if (!p) return;
    delete this.map[String(p)];
    this.save();
  }

  clear() {
    this.map = {};
    this.save();
  }
}

async function fetchProductsByIds(pids) {
  const ids = [...new Set(pids.map((x) => toPositiveInt(x, null)).filter(Boolean))];
  if (ids.length === 0) return [];
  try {
    // Use a stable cart endpoint (some environments may not route /api/products/byIds reliably)
    const res = await fetch(
      `/api/cart/products?ids=${encodeURIComponent(ids.join(","))}`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error("Failed to fetch products");
    return await res.json();
  } catch (err) {
    console.error(err);
    // Fallback: fetch individually
    const out = [];
    for (const id of ids) {
      try {
        const r = await fetch(`/api/product/${encodeURIComponent(id)}`, {
          credentials: "include",
        });
        if (r.ok) out.push(await r.json());
      } catch {
        // ignore
      }
    }
    return out;
  }
}

class CartUI {
  constructor(cart) {
    this.cart = cart;
    this.voucher = {
      code: "",
      valid: false,
      discountAmount: 0,
      reason: "",
    };
    this.badge = document.getElementById("cart-count-badge");
    this.list = document.getElementById("cart-items");
    this.totalEl = document.getElementById("cart-total");
    this.discountEl = document.getElementById("cart-discount");
    this.totalAfterDiscountEl = document.getElementById("cart-total-after-discount");
    this.voucherInput = document.getElementById("cart-voucher-code");
    this.voucherFeedback = document.getElementById("cart-voucher-feedback");
    this.clearBtn = document.getElementById("cart-clear");
    this.checkoutBtn = document.getElementById("cart-checkout");

    window.addEventListener("zstore:cart-updated", () => this.render());

    if (this.list) {
      this.list.addEventListener("change", (e) => {
        const target = e.target;
        if (target && target.classList && target.classList.contains("cart-qty")) {
          const pid = target.getAttribute("data-pid");
          this.cart.setQty(pid, target.value);
        }
      });

      this.list.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (btn.classList.contains("cart-remove")) {
          const pid = btn.getAttribute("data-pid");
          this.cart.remove(pid);
        }
        if (btn.classList.contains("cart-inc")) {
          const pid = btn.getAttribute("data-pid");
          const current = this.cart.map[String(toPositiveInt(pid, 0))] || 0;
          this.cart.setQty(pid, current + 1);
        }
        if (btn.classList.contains("cart-dec")) {
          const pid = btn.getAttribute("data-pid");
          const current = this.cart.map[String(toPositiveInt(pid, 0))] || 0;
          this.cart.setQty(pid, current - 1);
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener("click", () => {
        if (!confirm("Clear the cart?")) return;
        this.cart.clear();
      });
    }

    if (this.checkoutBtn) {
      this.checkoutBtn.addEventListener("click", async () => {
        await this.startCheckout();
      });
    }
    if (this.voucherInput) {
      this.voucherInput.addEventListener("keydown", () => {
        clearTimeout(this._voucherTimer);
        this._voucherTimer = setTimeout(() => this.validateVoucher(), 300);
      });
      this.voucherInput.addEventListener("blur", () => this.validateVoucher());
    }
    const qs = new URLSearchParams(window.location.search);
    const initialVCode = (qs.get("vcode") || "").trim();
    if (initialVCode && this.voucherInput) {
      this.voucherInput.value = initialVCode;
      this.validateVoucher();
    }
  }

  async validateVoucher() {
    if (!this.voucherInput) return;
    const code = (this.voucherInput.value || "").trim().toUpperCase();
    this.voucher = {
      code,
      valid: false,
      discountAmount: 0,
      reason: "",
    };
    if (!code) {
      if (this.voucherFeedback) this.voucherFeedback.textContent = "";
      this.render();
      return;
    }
    try {
      const meRes = await fetch("/api/me", { credentials: "include" });
      const meData = await meRes.json();
      if (!meData.user) {
        this.voucher.reason = "Sign in to validate vouchers";
        if (this.voucherFeedback) this.voucherFeedback.textContent = this.voucher.reason;
        this.render();
        return;
      }
      const res = await fetch(`/api/vouchers/validate?code=${encodeURIComponent(code)}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.valid && data.voucher) {
        this.voucher.valid = true;
        this.voucher.discountAmount = Number(data.voucher.discountAmount || 0);
        this.voucher.reason = `Voucher applied: -$${this.voucher.discountAmount.toFixed(2)}`;
      } else {
        this.voucher.reason = data.reason || "Invalid voucher";
      }
    } catch {
      this.voucher.reason = "Unable to validate voucher";
    }
    if (this.voucherFeedback) {
      this.voucherFeedback.textContent = this.voucher.reason;
      this.voucherFeedback.className = `small mt-1 ${this.voucher.valid ? "text-success" : "text-danger"}`;
    }
    this.render();
  }

  async startCheckout() {
    const entries = this.cart.getEntries();
    if (!entries.length) {
      alert("Your cart is empty.");
      return;
    }

    let me = null;
    try {
      const meRes = await fetch("/api/me", { credentials: "include" });
      const meData = await meRes.json();
      me = meData && meData.user ? meData.user : null;
    } catch {
      me = null;
    }
    if (!me) {
      window.location.href = "/login.html";
      return;
    }

    await window.ZStoreCsrf.initCsrf();
    if (!window.ZStoreCsrf.getCsrfToken()) {
      alert("Security token missing. Please refresh and try again.");
      return;
    }

    try {
      const payload = {
        items: entries.map((it) => ({
          pid: it.pid,
          quantity: it.qty,
        })),
      };
      if (this.voucher.valid && this.voucher.code) {
        payload.voucherCode = this.voucher.code;
      }
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      this.cart.clear();
      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error(err);
      alert(`Checkout failed: ${err.message}`);
    }
  }

  async render() {
    // Update badge
    if (this.badge) {
      const count = this.cart.getCount();
      this.badge.textContent = String(count);
      this.badge.style.display = count > 0 ? "inline-block" : "none";
    }

    if (!this.list || !this.totalEl) return;

    const entries = this.cart.getEntries();
    if (entries.length === 0) {
      this.list.innerHTML =
        '<li class="text-muted small py-2">Your cart is empty.</li>';
      this.totalEl.textContent = "$0.00";
      if (this.discountEl) this.discountEl.textContent = "-$0.00";
      if (this.totalAfterDiscountEl) this.totalAfterDiscountEl.textContent = "$0.00";
      return;
    }

    const products = await fetchProductsByIds(entries.map((e) => e.pid));
    const productMap = new Map(products.map((p) => [String(p.pid), p]));

    let total = 0;
    this.list.innerHTML = "";

    entries.forEach(({ pid, qty }) => {
      const p = productMap.get(String(pid));
      const name = p ? p.name : `Product #${pid}`;
      const priceNum = p && !isNaN(Number(p.price)) ? Number(p.price) : 0;
      total += priceNum * qty;

      const li = document.createElement("li");
      li.className =
        "d-flex justify-content-between align-items-center border-bottom py-2 gap-2";
      li.innerHTML = `
        <div class="flex-grow-1">
          <div class="fw-semibold">${window.zstoreEscapeHtml(name)}</div>
          <div class="text-muted small">$${priceNum.toFixed(2)} each</div>
        </div>
        <div class="d-flex align-items-center gap-1">
          <button class="btn btn-outline-secondary btn-sm cart-dec" data-pid="${pid}" type="button">-</button>
          <input
            type="number"
            min="1"
            value="${qty}"
            class="form-control form-control-sm cart-qty"
            data-pid="${pid}"
            style="width: 70px"
          />
          <button class="btn btn-outline-secondary btn-sm cart-inc" data-pid="${pid}" type="button">+</button>
        </div>
        <button class="btn btn-outline-danger btn-sm cart-remove" data-pid="${pid}" type="button">
          Remove
        </button>
      `;
      this.list.appendChild(li);
    });

    this.totalEl.textContent = `$${total.toFixed(2)}`;
    const discount = this.voucher.valid ? Math.min(this.voucher.discountAmount, total) : 0;
    const payable = Math.max(total - discount, 0);
    if (this.discountEl) this.discountEl.textContent = `-$${discount.toFixed(2)}`;
    if (this.totalAfterDiscountEl) this.totalAfterDiscountEl.textContent = `$${payable.toFixed(2)}`;
    if (this.checkoutBtn) this.checkoutBtn.disabled = entries.length === 0;
  }
}

// Global singleton
window.ZStoreCart = new Cart();
window.ZStoreCartUI = null;

document.addEventListener("DOMContentLoaded", () => {
  window.ZStoreCart.load();
  window.ZStoreCartUI = new CartUI(window.ZStoreCart);
  window.ZStoreCartUI.render();

  // Global delegation for any "Add to cart" buttons
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".add-to-cart-btn");
    if (!btn) return;
    const pid = btn.getAttribute("data-pid");
    if (!pid) return;

    // Default quantity = 1
    let qty = 1;

    // If button specifies a qty input selector (e.g. detail page)
    const qtySelector = btn.getAttribute("data-qty-input");
    if (qtySelector) {
      const input = document.querySelector(qtySelector);
      if (input && input.value !== undefined) {
        qty = toPositiveInt(input.value, 1);
      }
    }

    window.ZStoreCart.add(pid, qty);
  });
});

