function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let categoryNameById = new Map();
let currentPid = null;

async function loadDetailCategories() {
  try {
    const res = await fetch("/api/categories", { credentials: "include" });
    const cats = await res.json();
    const list = document.getElementById("detail-category-list");
    if (!list) return;
    const first = list.firstElementChild;
    list.innerHTML = "";
    if (first) list.appendChild(first);

    categoryNameById = new Map(cats.map((c) => [String(c.catid), c.name]));

    cats.forEach((cat) => {
      const a = document.createElement("a");
      a.href = `index.html?catid=${encodeURIComponent(cat.catid)}`;
      a.className = "list-group-item list-group-item-action";
      a.innerHTML = `<i class="fas fa-tag me-2 text-muted"></i>${window.zstoreEscapeHtml(cat.name)}`;
      list.appendChild(a);
    });
  } catch (err) {
    console.error("Failed to load categories for detail page", err);
  }
}

async function loadProductDetail() {
  const pid = getQueryParam("pid");
  if (!pid) return;
  currentPid = pid;

  try {
    const res = await fetch(`/api/product/${encodeURIComponent(pid)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Product not found");
    }
    const p = await res.json();
    if (!p) {
      throw new Error("Product not found");
    }

    const imgEl = document.getElementById("product-image");
    const nameEl = document.getElementById("product-name");
    const skuEl = document.getElementById("product-sku");
    const priceEl = document.getElementById("product-price");
    const descEl = document.getElementById("product-description");
    const crumbCat = document.getElementById("detail-breadcrumb-category");
    const crumbName = document.getElementById("detail-breadcrumb-name");
    const addBtn = document.getElementById("add-to-cart-detail");

    const largeImg = window.zstoreSafeImageSrc(p.image_path);
    if (imgEl) {
      imgEl.src = largeImg;
      imgEl.alt = p.name;
    }
    if (nameEl) nameEl.textContent = p.name;
    if (skuEl) skuEl.textContent = `ID: ${p.pid}`;
    if (priceEl) {
      const price = !isNaN(Number(p.price))
        ? Number(p.price).toFixed(2)
        : p.price;
      priceEl.textContent = `$${price}`;
    }
    if (descEl) descEl.textContent = p.description || "";
    if (crumbName) crumbName.textContent = p.name;
    if (crumbCat) {
      if (p.catid) {
        crumbCat.href = `index.html?catid=${encodeURIComponent(p.catid)}`;
        crumbCat.textContent =
          categoryNameById.get(String(p.catid)) || `Category #${p.catid}`;
      } else {
        crumbCat.href = "index.html";
        crumbCat.textContent = "All Categories";
      }
    }

    if (addBtn) {
      addBtn.setAttribute("data-pid", p.pid);
    }
    const avgEl = document.getElementById("product-rating-avg");
    const metaEl = document.getElementById("product-rating-meta");
    if (avgEl) avgEl.textContent = Number(p.avg_rating || 10).toFixed(2);
    if (metaEl) {
      metaEl.textContent = `${Number(p.rating_review_count || 0)} comments, average includes default 10/10 for unrated completed orders`;
    }
  } catch (err) {
    console.error(err);
  }
}

function renderComments(comments) {
  const list = document.getElementById("product-comments-list");
  const empty = document.getElementById("product-comments-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  if (!Array.isArray(comments) || comments.length === 0) {
    empty.classList.remove("d-none");
    return;
  }
  empty.classList.add("d-none");
  comments.forEach((c) => {
    const card = document.createElement("div");
    card.className = "border rounded p-3 bg-white";
    card.innerHTML = `
      <div class="d-flex justify-content-between mb-1">
        <span class="fw-semibold">${window.zstoreEscapeHtml(String(c.author || "Anonymous"))}</span>
        <span class="text-warning"><i class="fas fa-star"></i> ${window.zstoreEscapeHtml(String(Number(c.rating || 10).toFixed(1)))}/10</span>
      </div>
      <div class="small text-muted mb-2">${window.zstoreEscapeHtml(String(c.createdAt || "-"))}</div>
      <div>${window.zstoreEscapeHtml(String(c.comment || ""))}</div>
    `;
    list.appendChild(card);
  });
}

async function loadReviewSummaryAndComments() {
  if (!currentPid) return;
  try {
    const res = await fetch(`/api/product/${encodeURIComponent(currentPid)}/reviews`, {
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load reviews");
    const avgEl = document.getElementById("product-rating-avg");
    const metaEl = document.getElementById("product-rating-meta");
    if (avgEl) avgEl.textContent = Number(data.averageRating || 10).toFixed(2);
    if (metaEl) {
      const commentsCount = Number(data.reviewCount || 0);
      const completedOrders = Number(data.completedOrders || 0);
      metaEl.textContent = `${commentsCount} comments, ${completedOrders} completed orders considered (unrated defaults to 10/10)`;
    }
    renderComments(data.comments || []);
  } catch (err) {
    console.error(err);
  }
}

async function refreshReviewEligibilityUi() {
  const form = document.getElementById("review-form");
  const hint = document.getElementById("review-eligibility-text");
  if (!form || !hint || !currentPid) return;
  form.classList.add("d-none");
  try {
    const meRes = await fetch("/api/me", { credentials: "include" });
    const meData = await meRes.json();
    if (!meData.user) {
      hint.textContent = "Sign in to submit a rating and comment.";
      return;
    }
    const res = await fetch(`/api/product/${encodeURIComponent(currentPid)}/review-eligibility`, {
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to check eligibility");
    if (data.canReview) {
      hint.textContent = `Eligible paid orders in the last 7 days: ${Number(data.remainingEligibleOrders || 1)}`;
      form.classList.remove("d-none");
    } else {
      hint.textContent = "No eligible paid order in the last 7 days for this product.";
    }
  } catch (err) {
    hint.textContent = "Unable to check eligibility now.";
  }
}

function bindReviewSubmit() {
  const form = document.getElementById("review-form");
  const msgEl = document.getElementById("review-submit-msg");
  if (!form || !msgEl) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentPid) return;
    const rating = parseInt(document.getElementById("review-rating").value, 10);
    const comment = document.getElementById("review-comment").value.trim();
    msgEl.className = "small mt-2 text-muted";
    msgEl.textContent = "";
    try {
      await window.ZStoreCsrf.initCsrf();
      const res = await fetch(`/api/product/${encodeURIComponent(currentPid)}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...window.ZStoreCsrf.csrfHeaders(),
        },
        body: JSON.stringify({
          rating,
          comment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to submit review");
      msgEl.className = "small mt-2 text-success";
      msgEl.textContent = "Review submitted successfully.";
      form.reset();
      document.getElementById("review-rating").value = "10";
      await loadReviewSummaryAndComments();
      await refreshReviewEligibilityUi();
    } catch (err) {
      msgEl.className = "small mt-2 text-danger";
      msgEl.textContent = err.message || "Failed to submit review";
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadDetailCategories();
  await window.ZStoreCsrf.initCsrf().catch(() => {});
  await loadProductDetail();
  await loadReviewSummaryAndComments();
  await refreshReviewEligibilityUi();
  bindReviewSubmit();
});
