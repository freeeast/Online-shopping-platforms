// One-time CSRF bootstrap (visitor cookie + token); await before any mutating request.
const csrfBootstrap = window.ZStoreCsrf.initCsrf().catch((err) => {
  console.error(err);
  return null;
});

// Helper to show messages
function showMessage(elementId, message, type = "success") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove("d-none");
  setTimeout(() => {
    el.classList.add("d-none");
  }, 4000);
}

// Load categories into all relevant selects
async function loadCategories() {
  try {
    const res = await fetch("/api/categories", { credentials: "include" });
    const categories = await res.json();

    const selects = [
      "cat-select-update",
      "cat-select-delete",
      "prod-cat",
      "prod-cat-update",
    ].map((id) => document.getElementById(id));

    selects.forEach((sel) => {
      if (!sel) return;
      const keepFirst = sel.id === "prod-cat-update";
      const first = keepFirst ? sel.firstElementChild : null;
      sel.innerHTML = "";
      if (first) sel.appendChild(first);

      categories.forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat.catid;
        opt.textContent = cat.name;
        sel.appendChild(opt);
      });
    });
  } catch (err) {
    console.error(err);
    showMessage("category-message", "Failed to load categories", "danger");
  }
}

// Load all products into table
async function loadProducts() {
  try {
    const res = await fetch("/api/products", { credentials: "include" });
    const products = await res.json();
    const tbody = document.getElementById("products-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    products.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${window.zstoreEscapeHtml(String(p.pid))}</td>
        <td>${window.zstoreEscapeHtml(p.name)}</td>
        <td>${window.zstoreEscapeHtml(String(p.catid))}</td>
        <td>${window.zstoreEscapeHtml(Number(p.price).toFixed(2))}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    showMessage("product-message", "Failed to load products", "danger");
  }
}

async function loadAdminOrders() {
  try {
    const res = await fetch("/api/admin/orders", { credentials: "include" });
    const orders = await res.json();
    const tbody = document.getElementById("admin-orders-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!Array.isArray(orders) || orders.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="7" class="text-muted">No orders yet.</td>';
      tbody.appendChild(tr);
      return;
    }

    orders.forEach((o) => {
      const itemText = (o.items || [])
        .map((it) => `${it.product_name} x${it.quantity} @ ${Number(it.unit_price).toFixed(2)}`)
        .join("; ");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${window.zstoreEscapeHtml(String(o.order_id))}</td>
        <td>${window.zstoreEscapeHtml(String(o.user_email || "-"))}</td>
        <td>${window.zstoreEscapeHtml(String(o.payment_status || "pending"))}</td>
        <td>${window.zstoreEscapeHtml(String(Number(o.total_price || 0).toFixed(2)))} ${window.zstoreEscapeHtml(String(o.currency || "HKD"))}</td>
        <td>${window.zstoreEscapeHtml(String(o.created_at || "-"))}</td>
        <td>${window.zstoreEscapeHtml(String(o.paid_at || "-"))}</td>
        <td>${window.zstoreEscapeHtml(itemText || "-")}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  }
}

// Category: Add
document
  .getElementById("form-add-category")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "category-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const name = document.getElementById("cat-name").value.trim();
    if (!name) {
      showMessage("category-message", "Category name is required", "warning");
      return;
    }
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add category");
      showMessage("category-message", "Category added", "success");
      document.getElementById("cat-name").value = "";
      await loadCategories();
    } catch (err) {
      console.error(err);
      showMessage(
        "category-message",
        "Error adding category: " + err.message,
        "danger",
      );
    }
  });

// Category: Update
document
  .getElementById("form-update-category")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "category-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const id = document.getElementById("cat-select-update").value;
    const name = document.getElementById("cat-new-name").value.trim();
    if (!id || !name) {
      showMessage("category-message", "Please select category and new name", "warning");
      return;
    }
    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update category");
      showMessage("category-message", "Category updated", "success");
      document.getElementById("cat-new-name").value = "";
      await loadCategories();
    } catch (err) {
      console.error(err);
      showMessage(
        "category-message",
        "Error updating category: " + err.message,
        "danger",
      );
    }
  });

// Category: Delete
document
  .getElementById("form-delete-category")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "category-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const id = document.getElementById("cat-select-delete").value;
    if (!id) {
      showMessage("category-message", "Please select category to delete", "warning");
      return;
    }
    if (!confirm("Are you sure you want to delete this category?")) return;
    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { ...window.ZStoreCsrf.csrfHeaders() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete category");
      showMessage("category-message", "Category deleted", "success");
      await loadCategories();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showMessage(
        "category-message",
        "Error deleting category: " + err.message,
        "danger",
      );
    }
  });

// Product: Add
document
  .getElementById("form-add-product")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "product-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    const catid = document.getElementById("prod-cat").value;
    const name = document.getElementById("prod-name").value.trim();
    const price = document.getElementById("prod-price").value;
    const description = document.getElementById("prod-desc").value.trim();
    const file = document.getElementById("prod-image").files[0];

    if (!catid || !name || !price || !description || !file) {
      showMessage(
        "product-message",
        "All product fields including image are required",
        "warning",
      );
      return;
    }

    formData.append("catid", catid);
    formData.append("name", name);
    formData.append("price", price);
    formData.append("description", description);
    formData.append("image", file);
    window.ZStoreCsrf.appendCsrfToFormData(formData);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add product");
      showMessage("product-message", "Product added", "success");
      e.target.reset();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showMessage(
        "product-message",
        "Error adding product: " + err.message,
        "danger",
      );
    }
  });

// Product: Update
document
  .getElementById("form-update-product")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "product-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const pid = document.getElementById("prod-id-update").value;
    if (!pid) {
      showMessage("product-message", "Product ID is required for update", "warning");
      return;
    }

    const formData = new FormData();
    const name = document.getElementById("prod-name-update").value.trim();
    const price = document.getElementById("prod-price-update").value;
    const description = document.getElementById("prod-desc-update").value.trim();
    const catid = document.getElementById("prod-cat-update").value;
    const file = document.getElementById("prod-image-update").files[0];

    if (name) formData.append("name", name);
    if (price) formData.append("price", price);
    if (description) formData.append("description", description);
    if (catid) formData.append("catid", catid);
    if (file) formData.append("image", file);

    if ([...formData.keys()].length === 0) {
      showMessage(
        "product-message",
        "Nothing to update. Please change at least one field.",
        "warning",
      );
      return;
    }

    window.ZStoreCsrf.appendCsrfToFormData(formData);

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(pid)}`, {
        method: "PUT",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update product");
      showMessage("product-message", "Product updated", "success");
      e.target.reset();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showMessage(
        "product-message",
        "Error updating product: " + err.message,
        "danger",
      );
    }
  });

// Product: Delete
document
  .getElementById("form-delete-product")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) {
      showMessage(
        "product-message",
        "Security token missing — refresh the page",
        "danger",
      );
      return;
    }
    const pid = document.getElementById("prod-id-delete").value;
    if (!pid) {
      showMessage("product-message", "Product ID is required", "warning");
      return;
    }
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(pid)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { ...window.ZStoreCsrf.csrfHeaders() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete product");
      showMessage("product-message", "Product deleted", "success");
      e.target.reset();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showMessage(
        "product-message",
        "Error deleting product: " + err.message,
        "danger",
      );
    }
  });

// Gate admin UI: APIs are also protected server-side (requireAdmin).
document.addEventListener("DOMContentLoaded", async () => {
  const main = document.getElementById("admin-main");
  if (main) main.style.visibility = "hidden";

  let me;
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    me = await r.json();
  } catch {
    me = { user: null };
  }

  if (!me.user || !me.user.isAdmin) {
    window.location.replace("login.html?next=admin.html");
    return;
  }

  const label = document.getElementById("admin-user-label");
  if (label) label.textContent = me.user.displayName || me.user.email;
  if (main) main.style.visibility = "visible";

  await csrfBootstrap;
  await loadCategories();
  await loadProducts();
  await loadAdminOrders();

  document.getElementById("btn-refresh-orders")?.addEventListener("click", async () => {
    await loadAdminOrders();
  });

  document.getElementById("btn-admin-logout")?.addEventListener("click", async () => {
    await csrfBootstrap;
    if (!window.ZStoreCsrf.getCsrfToken()) return;
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      headers: { ...window.ZStoreCsrf.csrfHeaders() },
    });
    window.location.href = "index.html";
  });
});
