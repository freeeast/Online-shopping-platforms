function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let categoryNameById = new Map();
let currentCatId = null;
let currentPage = 1;
let hasMoreProducts = true;
let productsLoading = false;

const PAGE_SIZE = 8;

async function loadCategoriesSidebar(activeCatId) {
  try {
    const res = await fetch("/api/categories", { credentials: "include" });
    const categories = await res.json();
    const list = document.getElementById("category-list");
    const breadcrumbCat = document.getElementById("breadcrumb-category");
    if (!list) return;

    // Keep the first "Categories" link
    const first = list.firstElementChild;
    list.innerHTML = "";
    if (first) list.appendChild(first);

    categoryNameById = new Map(categories.map((c) => [String(c.catid), c.name]));

    categories.forEach((cat) => {
      const a = document.createElement("a");
      a.href = `index.html?catid=${encodeURIComponent(cat.catid)}`;
      a.className = "list-group-item list-group-item-action";
      if (String(activeCatId) === String(cat.catid)) {
        a.classList.add("active");
      }
      a.innerHTML = `<i class="fas fa-tag me-2 text-muted"></i>${window.zstoreEscapeHtml(cat.name)}`;
      list.appendChild(a);
    });

    if (breadcrumbCat) {
      if (activeCatId) {
        breadcrumbCat.textContent =
          categoryNameById.get(String(activeCatId)) || `Category #${activeCatId}`;
      } else {
        breadcrumbCat.textContent = "All Categories";
      }
    }
  } catch (err) {
    console.error("Failed to load categories", err);
  }
}

function renderProductCard(container, p) {
  const col = document.createElement("div");
  col.className = "col";
  const imgSrc = window.zstoreSafeImageSrc(p.thumb_path || p.image_path);
  const price = !isNaN(Number(p.price))
    ? Number(p.price).toFixed(2)
    : window.zstoreEscapeHtml(p.price);
  const safeName = window.zstoreEscapeHtml(p.name);
  const avgRating = Number.isFinite(Number(p.avg_rating)) ? Number(p.avg_rating) : 10;
  const reviewCount = Number.isFinite(Number(p.rating_review_count))
    ? Number(p.rating_review_count)
    : 0;
  col.innerHTML = `
    <div class="card h-100 shadow-sm product-card-hover">
      <a href="product.html?pid=${encodeURIComponent(p.pid)}" class="d-block text-decoration-none">
        <div class="product-img-container">
          <img
            src="${window.zstoreEscapeHtml(imgSrc)}"
            alt="${safeName}"
            class="product-img-fit"
          />
        </div>
      </a>
      <div class="card-body text-center">
        <a href="product.html?pid=${encodeURIComponent(p.pid)}" class="text-decoration-none text-dark">
          <h5 class="card-title fs-6">${safeName}</h5>
        </a>
        <div class="small text-warning mb-1">
          <i class="fas fa-star"></i>
          ${window.zstoreEscapeHtml(avgRating.toFixed(2))}/10
          <span class="text-muted">(${window.zstoreEscapeHtml(String(reviewCount))} reviews)</span>
        </div>
        <p class="card-text text-danger fw-bold">$${price}</p>
        <div class="d-flex justify-content-center gap-2">
          <button
            class="btn btn-outline-dark btn-sm add-to-cart-btn"
            type="button"
            data-pid="${p.pid}"
          >
            <i class="fas fa-cart-plus"></i> Add
          </button>
          <a href="product.html?pid=${encodeURIComponent(p.pid)}" class="btn btn-dark btn-sm">
            View
          </a>
        </div>
      </div>
    </div>
  `;
  container.appendChild(col);
}

function updateProductsLoadingUi() {
  const loadMoreBtn = document.getElementById("load-more-products");
  const statusEl = document.getElementById("products-scroll-status");
  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle("d-none", !hasMoreProducts);
    loadMoreBtn.disabled = productsLoading;
  }
  if (statusEl) {
    statusEl.textContent = productsLoading
      ? "Loading products..."
      : hasMoreProducts
        ? "Scroll down to load more products"
        : "No more products";
  }
}

async function loadNextProductPage() {
  const container = document.getElementById("product-list");
  const breadcrumbCat = document.getElementById("breadcrumb-category");
  if (!container || productsLoading || !hasMoreProducts) return;
  productsLoading = true;
  updateProductsLoadingUi();
  try {
    const catid = currentCatId;
    const params = new URLSearchParams({
      page: String(currentPage),
      limit: String(PAGE_SIZE),
    });
    if (catid) params.set("catid", catid);
    const url = `/api/products?${params.toString()}`;
    const res = await fetch(url, { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    const products = Array.isArray(payload.items) ? payload.items : [];

    if (currentPage === 1 && products.length === 0) {
      container.innerHTML =
        '<div class="col-12"><div class="alert alert-info">No products found for this category.</div></div>';
      hasMoreProducts = false;
      updateProductsLoadingUi();
      if (breadcrumbCat) {
        breadcrumbCat.textContent = currentCatId
          ? categoryNameById.get(String(currentCatId)) || `Category #${currentCatId}`
          : "All Categories";
      }
      return;
    }

    if (breadcrumbCat) {
      if (catid) {
        breadcrumbCat.textContent =
          categoryNameById.get(String(catid)) || `Category #${catid}`;
      } else {
        breadcrumbCat.textContent = "All Categories";
      }
    }

    products.forEach((p) => renderProductCard(container, p));
    currentPage += 1;
    hasMoreProducts = Boolean(payload.hasMore);
  } catch (err) {
    console.error("Failed to load products", err);
    const container = document.getElementById("product-list");
    if (container && currentPage === 1) {
      container.innerHTML = `<div class="col-12"><div class="alert alert-danger">Could not load products. ${window.zstoreEscapeHtml(err.message || "Please refresh.")}</div></div>`;
    }
    hasMoreProducts = false;
  } finally {
    productsLoading = false;
    updateProductsLoadingUi();
  }
}

function resetAndLoadProducts(catid) {
  currentCatId = catid || null;
  currentPage = 1;
  hasMoreProducts = true;
  productsLoading = false;
  const container = document.getElementById("product-list");
  if (container) container.innerHTML = "";
  loadNextProductPage();
}

function renderRecentOrders(orders) {
  const emptyEl = document.getElementById("my-orders-empty");
  const tableWrap = document.getElementById("my-orders-table-wrap");
  const tbody = document.getElementById("my-orders-tbody");
  if (!emptyEl || !tableWrap || !tbody) return;

  if (!Array.isArray(orders) || orders.length === 0) {
    tbody.innerHTML = "";
    emptyEl.textContent = "No recent orders yet.";
    emptyEl.classList.remove("d-none");
    tableWrap.classList.add("d-none");
    return;
  }

  tbody.innerHTML = "";
  orders.forEach((o) => {
    const tr = document.createElement("tr");
    const itemSummary = (o.items || [])
      .slice(0, 3)
      .map((it) => `${it.product_name} x${it.quantity}`)
      .join(", ");
    const moreCount = Math.max((o.items || []).length - 3, 0);
    tr.innerHTML = `
      <td>#${window.zstoreEscapeHtml(String(o.order_id))}</td>
      <td>${window.zstoreEscapeHtml(String(o.payment_status || "pending"))}</td>
      <td>${window.zstoreEscapeHtml(String(Number(o.total_price || 0).toFixed(2)))} ${window.zstoreEscapeHtml(String(o.currency || "HKD"))}</td>
      <td>${window.zstoreEscapeHtml(String(o.created_at || "-"))}</td>
      <td>${window.zstoreEscapeHtml(itemSummary || "-")}${moreCount > 0 ? `, +${moreCount} more` : ""}</td>
    `;
    tbody.appendChild(tr);
  });

  emptyEl.classList.add("d-none");
  tableWrap.classList.remove("d-none");
}

async function loadRecentOrders() {
  const emptyEl = document.getElementById("my-orders-empty");
  const tableWrap = document.getElementById("my-orders-table-wrap");
  if (!emptyEl || !tableWrap) return;

  try {
    const meRes = await fetch("/api/me", { credentials: "include" });
    const meData = await meRes.json();
    if (!meData.user) {
      emptyEl.textContent = "Sign in to view your purchase history.";
      emptyEl.classList.remove("d-none");
      tableWrap.classList.add("d-none");
      return;
    }

    const res = await fetch("/api/my/orders?limit=5", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load orders");
    const orders = await res.json();
    renderRecentOrders(orders);
  } catch (err) {
    console.error(err);
    emptyEl.textContent = "Unable to load recent orders now.";
    emptyEl.classList.remove("d-none");
    tableWrap.classList.add("d-none");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const catid = getQueryParam("catid");
  await loadCategoriesSidebar(catid);
  resetAndLoadProducts(catid);
  const loadMoreBtn = document.getElementById("load-more-products");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", async () => {
      await loadNextProductPage();
    });
  }
  window.addEventListener("scroll", () => {
    if (!hasMoreProducts || productsLoading) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
      loadNextProductPage();
    }
  });
  await loadRecentOrders();
});
