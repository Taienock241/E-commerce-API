// Change this constant to display another currency code. API prices are integer cents.
const CURRENCY = "USD";
const state = { token: localStorage.getItem("token"), user: null, page: 1, limit: 12, search: "", totalPages: 1, register: false };
const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY }).format(cents / 100);
}

function notice(message = "") { byId("notice").textContent = message; }

async function request(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body;
}

async function loadProducts() {
  try {
    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.search) params.set("search", state.search);
    const result = await request(`/products?${params}`);
    state.totalPages = Math.max(1, result.meta.totalPages);
    byId("page-label").textContent = `Page ${result.meta.page} of ${state.totalPages}`;
    byId("previous-page").disabled = state.page <= 1;
    byId("next-page").disabled = state.page >= state.totalPages;
    byId("products").innerHTML = result.data.map((product) => `
      <article class="card">
        <h3>${escapeHtml(product.name)}</h3><p class="muted">${escapeHtml(product.description)}</p>
        <p class="price">${money(product.priceCents)}</p><p>${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</p>
        <button data-add="${escapeHtml(product.id)}" ${product.stock < 1 ? "disabled" : ""}>Add to cart</button>
      </article>`).join("") || "<p>No products found.</p>";
  } catch (error) { notice(error.message); }
}

async function loadCart() {
  if (!state.token) { notice("Log in to view your cart."); return; }
  try {
    const cart = await request("/cart");
    byId("cart-count").textContent = cart.itemCount;
    byId("cart-items").innerHTML = cart.items.map((item) => `
      <div class="line"><div><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${item.quantity} × ${money(item.unitPriceCents)}${item.available ? "" : " · unavailable"}</span></div>
      <div class="row"><button class="secondary" data-quantity="${escapeHtml(item.productId)}" data-value="${item.quantity - 1}" aria-label="Decrease quantity">−</button>
      <button class="secondary" data-quantity="${escapeHtml(item.productId)}" data-value="${item.quantity + 1}" aria-label="Increase quantity">+</button>
      <button class="danger" data-remove="${escapeHtml(item.productId)}">Remove</button></div></div>`).join("") || "<p>Your cart is empty.</p>";
    byId("cart-total").textContent = `Total: ${money(cart.totalCents)}`;
    byId("cart-panel").classList.remove("hidden");
  } catch (error) { notice(error.message); }
}

async function loadOrders() {
  if (!state.token) return;
  try {
    const result = await request("/orders?limit=20");
    byId("orders").innerHTML = result.data.map((order) => `
      <div class="line"><div><strong>${escapeHtml(order.status)}</strong> · ${money(order.totalCents)}<br><span class="muted">${new Date(order.createdAt).toLocaleString()}</span></div>
      ${order.status === "PENDING" ? `<button class="danger" data-cancel="${escapeHtml(order.id)}">Cancel</button>` : ""}</div>`).join("") || "<p>No orders yet.</p>";
    byId("orders-panel").classList.remove("hidden");
  } catch (error) { notice(error.message); }
}

async function loadAdmin() {
  if (state.user?.role !== "ADMIN") return;
  byId("admin-panel").classList.remove("hidden");
  try {
    const products = await request("/products?limit=100");
    byId("admin-products").innerHTML = `<table><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${products.data.map((product) => `
      <tr><td>${escapeHtml(product.name)}</td><td>${money(product.priceCents)}</td><td>${product.stock}</td><td class="row">
      <button class="secondary" data-edit="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" data-price="${product.priceCents}">Edit</button>
      <button class="secondary" data-restock="${escapeHtml(product.id)}">Restock</button><button class="danger" data-hide="${escapeHtml(product.id)}">Hide</button></td></tr>`).join("")}</tbody></table>`;
    await loadAdminOrders();
  } catch (error) { notice(error.message); }
}

async function loadAdminOrders() {
  try {
    const status = byId("admin-status").value;
    const query = status ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
    const result = await request(`/admin/orders${query}`);
    byId("admin-orders").innerHTML = result.data.map((order) => {
      const next = { PENDING: ["PAID", "CANCELLED"], PAID: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED"], DELIVERED: [], CANCELLED: [] }[order.status];
      return `<div class="line"><span>${escapeHtml(order.status)} · ${money(order.totalCents)} · ${escapeHtml(order.id)}</span><span class="row">${next.map((status) => `<button data-status="${escapeHtml(order.id)}" data-next="${status}">${status}</button>`).join("")}</span></div>`;
    }).join("") || "<p>No orders found.</p>";
  } catch (error) { notice(error.message); }
}

async function refreshAccount() {
  if (!state.token) { state.user = null; updateAccountUi(); return; }
  try { state.user = await request("/auth/me"); await loadCart(); await loadOrders(); await loadAdmin(); }
  catch { state.token = null; state.user = null; localStorage.removeItem("token"); }
  updateAccountUi();
}

function updateAccountUi() {
  byId("account-label").textContent = state.user ? `Hello, ${state.user.name}` : "Browsing as guest";
  byId("account-button").textContent = state.user ? "Log out" : "Log in";
  if (state.user?.role !== "ADMIN") byId("admin-panel").classList.add("hidden");
  if (!state.user) { byId("orders-panel").classList.add("hidden"); byId("cart-panel").classList.add("hidden"); }
}

function openAuth(register) {
  state.register = register;
  byId("auth-title").textContent = register ? "Create your account" : "Log in";
  byId("name-field").classList.toggle("hidden", !register);
  byId("auth-submit").textContent = register ? "Register" : "Log in";
  byId("auth-switch").textContent = register ? "I already have an account" : "Create an account";
  byId("auth-error").textContent = "";
  byId("auth-dialog").showModal();
}

byId("products").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-add]"); if (!button) return;
  if (!state.token) { openAuth(false); return; }
  try { await request("/cart/items", { method: "POST", body: JSON.stringify({ productId: button.dataset.add, quantity: 1 }) }); notice("Added to your cart."); await loadCart(); }
  catch (error) { notice(error.message); }
});

byId("cart-items").addEventListener("click", async (event) => {
  const button = event.target.closest("button"); if (!button) return;
  try {
    if (button.dataset.remove) await request(`/cart/items/${button.dataset.remove}`, { method: "DELETE" });
    if (button.dataset.quantity) {
      const quantity = Number(button.dataset.value);
      if (quantity < 1) await request(`/cart/items/${button.dataset.quantity}`, { method: "DELETE" });
      else await request(`/cart/items/${button.dataset.quantity}`, { method: "PATCH", body: JSON.stringify({ quantity }) });
    }
    await loadCart();
  } catch (error) { notice(error.message); }
});

byId("orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancel]"); if (!button) return;
  try { await request(`/orders/${button.dataset.cancel}/cancel`, { method: "POST" }); await loadOrders(); await loadCart(); }
  catch (error) { notice(error.message); }
});

byId("create-product").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try { await request("/products", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), priceCents: Number(form.get("priceCents")), stock: Number(form.get("stock")) }) }); event.currentTarget.reset(); await loadProducts(); await loadAdmin(); }
  catch (error) { notice(error.message); }
});

byId("admin-products").addEventListener("click", async (event) => {
  const button = event.target.closest("button"); if (!button) return;
  try {
    if (button.dataset.edit) {
      const name = prompt("Product name", button.dataset.name); if (name === null) return;
      const price = prompt("Price in cents", button.dataset.price); if (price === null) return;
      await request(`/products/${button.dataset.edit}`, { method: "PATCH", body: JSON.stringify({ name, priceCents: Number(price) }) });
    }
    if (button.dataset.restock) { const delta = prompt("Stock change (positive to add)", "1"); if (delta === null) return; await request(`/products/${button.dataset.restock}/stock`, { method: "PATCH", body: JSON.stringify({ delta: Number(delta) }) }); }
    if (button.dataset.hide && confirm("Hide this product from the store?")) await request(`/products/${button.dataset.hide}`, { method: "DELETE" });
    await loadProducts(); await loadAdmin();
  } catch (error) { notice(error.message); }
});

byId("admin-orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-status]"); if (!button) return;
  try { await request(`/admin/orders/${button.dataset.status}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.next }) }); await loadAdminOrders(); }
  catch (error) { notice(error.message); }
});

byId("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const payload = { email: form.get("email"), password: form.get("password"), ...(state.register ? { name: form.get("name") } : {}) };
  try {
    const result = await request(state.register ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(payload) });
    state.token = result.token; localStorage.setItem("token", state.token); byId("auth-dialog").close(); event.currentTarget.reset(); await refreshAccount();
  } catch (error) { byId("auth-error").textContent = error.message; }
});

byId("account-button").addEventListener("click", () => {
  if (state.token) { state.token = null; state.user = null; localStorage.removeItem("token"); updateAccountUi(); }
  else openAuth(false);
});
byId("auth-switch").addEventListener("click", () => openAuth(!state.register));
byId("auth-cancel").addEventListener("click", () => byId("auth-dialog").close());
byId("cart-toggle").addEventListener("click", loadCart);
byId("close-cart").addEventListener("click", () => byId("cart-panel").classList.add("hidden"));
byId("checkout-button").addEventListener("click", async () => {
  try { await request("/orders", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({}) }); notice("Order placed."); await loadCart(); await loadOrders(); }
  catch (error) { notice(error.message); }
});
byId("search-button").addEventListener("click", () => { state.search = byId("search").value.trim(); state.page = 1; loadProducts(); });
byId("search").addEventListener("keydown", (event) => { if (event.key === "Enter") byId("search-button").click(); });
byId("previous-page").addEventListener("click", () => { if (state.page > 1) { state.page--; loadProducts(); } });
byId("next-page").addEventListener("click", () => { if (state.page < state.totalPages) { state.page++; loadProducts(); } });
byId("admin-status").addEventListener("change", loadAdminOrders);
byId("refresh-admin-orders").addEventListener("click", loadAdminOrders);

loadProducts();
refreshAccount();
