import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Link, Navigate, Outlet, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api/client";
import type { Cart, Order, OrderStatus, Page, Product } from "./api/types";
import { useAuth } from "./auth/AuthContext";
import { cartWithQuantity } from "./cart/optimistic";
import { photoForProduct } from "./catalog/photos";
import { currencyUnitsToCents, formatMoney } from "./lib/money";
import { allowedNextStatuses, progressStatuses } from "./orders/status";
import { useToast } from "./ui/ToastContext";

const CART_KEY = ["cart"] as const;
const LOGIN_PATH = "/login";

function Protected({ admin = false }: { admin?: boolean }) {
  const { token, role, loading } = useAuth();
  if (loading) return <div className="page-state" role="status">Checking your session…</div>;
  if (!token) return <Navigate to={LOGIN_PATH} replace />;
  if (admin && role !== "ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}

function Shell() {
  const { user, token, logout } = useAuth();
  const [cartOpen, setCartOpen] = useState(false);
  const closeCart = useCallback(() => setCartOpen(false), []);
  const cartQuery = useQuery({ queryKey: CART_KEY, queryFn: () => api.get<Cart>("/cart"), enabled: Boolean(token) });
  const count = cartQuery.data?.itemCount ?? 0;

  return <div className="app-shell">
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Common Goods home"><span className="brand-mark">C</span><span>common goods<span className="brand-period">.</span></span></Link>
      <nav className="site-nav" aria-label="Main navigation">
        <Link to="/">Shop</Link>
        {token && <Link to="/orders">Orders</Link>}
        {user?.role === "ADMIN" && <Link to="/admin">Admin</Link>}
      </nav>
      <div className="header-actions">
        {user ? <><span className="welcome">Hi, {user.name}</span><button className="button button--quiet" onClick={logout}>Log out</button></> : <Link className="button button--quiet" to={LOGIN_PATH}>Log in</Link>}
        <button className="cart-trigger" aria-label={`Open cart, ${count} items`} onClick={() => setCartOpen(true)}>
          <span className="bag-icon" aria-hidden="true">▱</span><span className="cart-trigger-label">Bag</span><span className="count-badge">{count}</span>
        </button>
      </div>
    </header>
    <main className="main-content"><Outlet /></main>
    <footer className="site-footer"><span>Thoughtful things for everyday life.</span><span>Secure checkout · Integer cents · No surprises</span></footer>
    <CartDrawer open={cartOpen} onClose={closeCart} />
  </div>;
}

function ProductPage() {
  const [params, setParams] = useSearchParams();
  const parsedPage = Number(params.get("page") || 1);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const urlSearch = params.get("search") || "";
  const [searchText, setSearchText] = useState(urlSearch);
  const [selected, setSelected] = useState<Product | null>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const detailDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => setSearchText(urlSearch), [urlSearch]);
  useEffect(() => {
    const normalizedSearch = searchText.trim();
    if (normalizedSearch === urlSearch) return;
    const timer = window.setTimeout(() => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (normalizedSearch) next.set("search", normalizedSearch); else next.delete("search");
        next.set("page", "1");
        return next;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, urlSearch, setParams]);
  useEffect(() => {
    if (selected) detailDialog.current?.showModal();
    else if (detailDialog.current?.open) detailDialog.current.close();
  }, [selected]);


  const query = useQuery({
    queryKey: ["products", urlSearch, page],
    queryFn: () => api.get<Page<Product>>(`/products?${new URLSearchParams({ search: urlSearch, page: String(page), limit: "12" })}`),
  });
  const addMutation = useMutation({
    mutationFn: (productId: string) => api.post<Cart>("/cart/items", { productId, quantity: 1 }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: CART_KEY }); showToast("Added to your bag."); },
    onError: (error) => showToast(messageFor(error), "error"),
  });

  function updatePage(nextPage: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(nextPage));
    setParams(next);
  }

  return <>
    <section className="hero">
      <div className="eyebrow">A little more considered</div>
      <h1>Good things<br /><em>for every day.</em></h1>
      <p>Useful, well-made essentials that make the everyday feel a little better.</p>
      <button className="text-link hero-cta" onClick={() => document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" })}>Explore the collection <span aria-hidden="true">↓</span></button>
      <div className="hero-stamp" aria-hidden="true"><span>OBJECTS<br />WITH<br />PURPOSE</span><b>✳</b></div>
    </section>
    <section className="catalogue" id="catalogue">
      <div className="section-heading"><div><div className="eyebrow">Made to be used</div><h2>The collection</h2></div><span className="result-count">{query.data?.meta.total ?? "—"} pieces</span></div>
      <div className="catalogue-tools"><label className="search-box"><span aria-hidden="true">⌕</span><span className="visually-hidden">Search products</span><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search the collection" /></label><span className="tool-note">Thoughtfully selected, always useful</span></div>
      {query.isLoading ? <div className="product-grid" aria-label="Loading products">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton-image" /><div className="skeleton-line" /><div className="skeleton-line skeleton-line--short" /></div>)}</div>
        : query.isError ? <div className="page-state error-state"><p>We couldn’t load the collection.</p><button className="button" onClick={() => void query.refetch()}>Try again</button></div>
          : query.data?.data.length ? <div className="product-grid">{query.data.data.map((product, index) => <ProductCard key={product.id} product={product} index={index} busy={addMutation.isPending && addMutation.variables === product.id} onOpen={() => setSelected(product)} onAdd={() => {
            if (!token) { showToast("Log in to add things to your bag.", "error"); return; }
            addMutation.mutate(product.id);
          }} />)}</div>
            : <div className="empty-state"><span className="empty-mark">⌕</span><h3>Nothing on this shelf</h3><p>Try another search and see what turns up.</p></div>}
      <div className="pagination"><button className="button button--outline" disabled={page <= 1} onClick={() => updatePage(page - 1)}>← Previous</button><span>Page {page} of {Math.max(1, query.data?.meta.totalPages ?? 1)}</span><button className="button button--outline" disabled={page >= (query.data?.meta.totalPages ?? 1)} onClick={() => updatePage(page + 1)}>Next →</button></div>
    </section>
    <ProductDialog product={selected} dialogRef={detailDialog} onClose={() => setSelected(null)} onAdd={() => selected && addMutation.mutate(selected.id)} busy={addMutation.isPending} />
  </>;
}

function ProductCard({ product, index, busy, onOpen, onAdd }: { product: Product; index: number; busy: boolean; onOpen(): void; onAdd(): void }) {
  const stockText = product.stock === 0 ? "Out of stock" : product.stock <= 3 ? `Only ${product.stock} left` : "In stock";
  return <article className={`product-card product-card--${index % 4}`}>
    <button className="product-art" onClick={onOpen} aria-label={`View ${product.name} details`}><ProductPhotoView product={product} decorative /><span className="art-open">View details ↗</span></button>
    <div className="product-info"><div><button className="product-name" onClick={onOpen}>{product.name}</button><p className="stock-label">{stockText}</p></div><span className="product-price">{formatMoney(product.priceCents)}</span></div>
    <button className="button button--add" disabled={product.stock === 0 || busy} onClick={onAdd}>{busy ? "Adding…" : "Add to bag"}<span aria-hidden="true">＋</span></button>
  </article>;
}

function ProductPhotoView({ product, detail = false, decorative = false }: { product: Product; detail?: boolean; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  const photo = photoForProduct(product.name);
  if (!photo || failed) {
    return detail
      ? <span className="detail-letter" aria-hidden="true">{product.name.slice(0, 1)}</span>
      : <span className="art-shape" aria-hidden="true">{product.name.slice(0, 1)}</span>;
  }
  return <img className={detail ? "detail-photo" : "product-photo"} src={photo.imageUrl} alt={decorative ? "" : photo.alt} loading={detail ? "eager" : "lazy"} onError={() => setFailed(true)} />;
}

function ProductDialog({ product, dialogRef, onClose, onAdd, busy }: { product: Product | null; dialogRef: RefObject<HTMLDialogElement>; onClose(): void; onAdd(): void; busy: boolean }) {
  if (!product) return null;
  return <dialog className="detail-dialog" ref={dialogRef} onClose={onClose} aria-labelledby="detail-title">
    <button className="dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close product details">×</button>
    <div className="detail-art"><ProductPhotoView product={product} detail /></div>
    <div className="eyebrow">A Common Goods find</div><h2 id="detail-title">{product.name}</h2><p>{product.description}</p><p className="detail-price">{formatMoney(product.priceCents)}</p>
    <p className="stock-label">{product.stock === 0 ? "Out of stock" : product.stock <= 3 ? `Only ${product.stock} left` : "In stock"}</p>
    {photoForProduct(product.name) && <p className="photo-credit">Photo by <a href={photoForProduct(product.name)?.photoPage} target="_blank" rel="noreferrer">{photoForProduct(product.name)?.photographer} on Unsplash ↗</a></p>}
    <button className="button" disabled={product.stock === 0 || busy} onClick={onAdd}>{busy ? "Adding…" : "Add to bag"}</button>
  </dialog>;
}

export function CartDrawer({ open, onClose }: { open: boolean; onClose(): void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const cartQuery = useQuery({ queryKey: CART_KEY, queryFn: () => api.get<Cart>("/cart"), enabled: Boolean(token && open) });
  const quantityMutation = useMutation<void, unknown, { productId: string; quantity: number }, { previous: Cart | undefined }>({
    mutationFn: async ({ productId, quantity }) => {
      if (quantity < 1) await api.delete<void>(`/cart/items/${productId}`);
      else await api.patch<Cart>(`/cart/items/${productId}`, { quantity });
    },
    onMutate: async ({ productId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: CART_KEY });
      const previous = queryClient.getQueryData<Cart>(CART_KEY);
      if (previous) queryClient.setQueryData(CART_KEY, cartWithQuantity(previous, productId, quantity));
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
      showToast(error instanceof ApiError && error.code === "INSUFFICIENT_STOCK" ? "That quantity is no longer available. Your bag was restored." : messageFor(error), "error");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CART_KEY }),
  });
  const checkoutKey = useRef<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [stockConflict, setStockConflict] = useState<string | null>(null);
  const navigate = useNavigate();
  const checkoutMutation = useMutation({
    mutationFn: (key: string) => api.post<Order>("/orders", {}, { "Idempotency-Key": key }),
    onSuccess: async (order) => {
      checkoutKey.current = null;
      setStockConflict(null);
      await queryClient.invalidateQueries({ queryKey: CART_KEY });
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
      navigate(`/confirmation/${order.id}`, { state: { order } });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        checkoutKey.current = null;
        if (error.status === 409 && ["INSUFFICIENT_STOCK", "PRODUCT_UNAVAILABLE"].includes(error.code)) {
          const productId = String(error.details?.productId ?? "");
          const productName = cartQuery.data?.items.find((item) => item.productId === productId)?.name;
          setStockConflict(`${productName ? `${productName}: ` : ""}${error.message}`);
          void queryClient.invalidateQueries({ queryKey: CART_KEY });
        }
        else showToast(messageFor(error), "error");
      } else {
        showToast("The connection dropped. Retry checkout to safely check the same order again.", "error");
      }
    },
  });

  useEffect(() => {
    if (open) queryClient.invalidateQueries({ queryKey: CART_KEY });
  }, [open, queryClient]);

  useEffect(() => {
    if (drawerRef.current) drawerRef.current.inert = !open;
    if (open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      drawerRef.current?.querySelector<HTMLElement>("button, a, input")?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") { onClose(); return; }
        if (event.key !== "Tab" || !drawerRef.current) return;
        const controls = [...drawerRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select, summary")];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    previousFocus.current?.focus();
    return undefined;
  }, [open, onClose]);

  function startCheckout() {
    if (!checkoutKey.current) checkoutKey.current = crypto.randomUUID();
    checkoutMutation.mutate(checkoutKey.current);
  }

  return <>
    <div className={`drawer-backdrop${open ? " is-open" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} />
    <aside ref={drawerRef} className={`cart-drawer${open ? " is-open" : ""}`} role="dialog" aria-modal={open || undefined} aria-labelledby="cart-title" aria-hidden={!open}>
      <div className="drawer-header"><div><div className="eyebrow">Your picks</div><h2 id="cart-title">The bag</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close bag">×</button></div>
      {!token ? <div className="empty-state"><p>Sign in to keep your bag close.</p><Link className="button" to={LOGIN_PATH} onClick={onClose}>Log in</Link></div>
        : cartQuery.isLoading ? <p className="drawer-message">Loading your bag…</p>
          : cartQuery.isError ? <div className="drawer-message"><p>Couldn’t load your bag.</p><button className="button button--outline" onClick={() => void cartQuery.refetch()}>Try again</button></div>
            : <>
              <div className="drawer-items">{cartQuery.data?.items?.length ? cartQuery.data.items.map((item) => <div className="cart-line" key={item.productId}>
                <div className="mini-art" aria-hidden="true">{item.name.slice(0, 1)}</div>
                <div className="cart-line-info"><strong>{item.name}</strong><span>{formatMoney(item.unitPriceCents)}</span>{!item.available && <span className="availability-warning">Stock changed. Adjust quantity to continue.</span>}
                  <div className="quantity-control"><button aria-label={`Decrease ${item.name} quantity`} disabled={quantityMutation.isPending} onClick={() => { setStockConflict(null); quantityMutation.mutate({ productId: item.productId, quantity: item.quantity - 1 }); }}>−</button><span>{item.quantity}</span><button aria-label={`Increase ${item.name} quantity`} disabled={quantityMutation.isPending} onClick={() => { setStockConflict(null); quantityMutation.mutate({ productId: item.productId, quantity: item.quantity + 1 }); }}>+</button></div>
                </div><div className="cart-line-end"><strong>{formatMoney(item.lineTotalCents)}</strong><button className="remove-link" disabled={quantityMutation.isPending} onClick={() => quantityMutation.mutate({ productId: item.productId, quantity: 0 })}>Remove</button></div>
              </div>) : <div className="empty-state"><span className="empty-mark">▱</span><h3>Your bag is taking a breather.</h3><p>Find something useful for the everyday.</p></div>}</div>
              {stockConflict && <div className="inline-error" role="alert"><strong>Stock changed</strong><p>{stockConflict}</p><p>Adjust or remove the unavailable item above, then try again.</p></div>}
              <div className="drawer-total"><span>Subtotal</span><strong>{formatMoney(cartQuery.data?.totalCents ?? 0)}</strong><small>Shipping and any applicable taxes are calculated later.</small>
                <CheckoutButton canCheckout={Boolean(cartQuery.data?.items.length) && !cartQuery.data?.items.some((item) => !item.available) && !quantityMutation.isPending} pending={checkoutMutation.isPending} retry={Boolean(checkoutKey.current)} onCheckout={startCheckout} />
              </div>
            </>}
    </aside>
  </>;
}

function AuthPage() {
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { login, register } = useAuth();
  const { showToast } = useToast();
  const mutation = useMutation({ mutationFn: () => registerMode ? register(email, password, name) : login(email, password), onError: (error) => showToast(messageFor(error), "error") });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 8 || password.length > 72) next.password = "Password must be 8 to 72 characters.";
    if (registerMode && !name.trim()) next.name = "Enter your name.";
    setErrors(next);
    if (!Object.keys(next).length) mutation.mutate();
  }

  return <section className="auth-page"><div className="auth-aside"><span className="auth-aside-mark">C</span><p>Good objects.<br /><em>Better everyday.</em></p><span>COMMON GOODS · EST. FOR THE EVERYDAY</span></div>
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="eyebrow">{registerMode ? "Join the good list" : "Welcome back"}</div><h1>{registerMode ? "Make yourself at home." : "Good to see you again."}</h1><p className="auth-intro">{registerMode ? "Create an account to keep your bag and orders together." : "Sign in to pick up where you left off."}</p>
      {registerMode && <Field label="Name" value={name} onChange={setName} error={errors.name} autoComplete="name" />}
      <Field label="Email address" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete={registerMode ? "new-password" : "current-password"} />
      <button className="button button--checkout" disabled={mutation.isPending}>{mutation.isPending ? "One moment…" : registerMode ? "Create account" : "Sign in"}</button>
      <p className="auth-switch">{registerMode ? "Already a member?" : "New around here?"} <button type="button" onClick={() => { setRegisterMode(!registerMode); setErrors({}); }}> {registerMode ? "Sign in" : "Create an account"}</button></p>
    </form>
  </section>;
}

function Field({ label, value, onChange, error, type = "text", autoComplete }: { label: string; value: string; onChange(value: string): void; error?: string; type?: string; autoComplete?: string }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return <div className="form-field"><label htmlFor={id}>{label}</label><input id={id} type={type} autoComplete={autoComplete} value={value} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />{error && <span className="field-error" id={`${id}-error`}>{error}</span>}</div>;
}

function OrdersPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["orders", "mine"], queryFn: () => api.get<Page<Order>>("/orders?limit=100"), refetchInterval: 15_000 });
  const cancelMutation = useMutation({ mutationFn: (id: string) => api.post<Order>(`/orders/${id}/cancel`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }), onError: (error) => showToast(messageFor(error), "error") });
  return <section className="content-page"><div className="eyebrow">Your purchases</div><h1>Order history</h1><p className="page-lead">A little record of good things on their way.</p>
    {query.isLoading ? <p className="page-state">Loading your orders…</p> : query.isError ? <div className="page-state error-state"><p>Couldn’t load your orders.</p><button className="button" onClick={() => void query.refetch()}>Try again</button></div> : query.data?.data.length ? <div className="order-list">{query.data.data.map((order) => <OrderCard key={order.id} order={order} onCancel={() => { if (window.confirm("Cancel this pending order? The items will return to stock.")) cancelMutation.mutate(order.id); }} busy={cancelMutation.isPending && cancelMutation.variables === order.id} />)}</div> : <div className="empty-state"><span className="empty-mark">✳</span><h3>No orders yet</h3><p>Your next everyday favourite is waiting.</p><Link className="text-link" to="/">Browse the collection →</Link></div>}
  </section>;
}

function OrderCard({ order, onCancel, busy }: { order: Order; onCancel(): void; busy: boolean }) {
  return <article className="order-card"><div className="order-top"><div><span className={`status-badge status-${order.status.toLowerCase()}`}>{order.status}</span><p className="order-date">Placed {new Date(order.createdAt).toLocaleDateString()}</p></div><strong>{formatMoney(order.totalCents)}</strong></div>
    {order.status === "CANCELLED" ? <p className="cancelled-note">This order was cancelled. Items were returned to stock.</p> : <OrderTimeline status={order.status} />}
    <details className="order-details"><summary>Items in this order ({order.items.reduce((sum, item) => sum + item.quantity, 0)})</summary><div>{order.items.map((item) => <div className="order-item" key={item.id}><span>{item.productName} <small>× {item.quantity}</small></span><strong>{formatMoney(item.unitPriceCents * item.quantity)}</strong></div>)}</div></details>
    {order.status === "PENDING" && <button className="button button--outline cancel-order" disabled={busy} onClick={onCancel}>{busy ? "Cancelling…" : "Cancel order"}</button>}
  </article>;
}

function OrderTimeline({ status }: { status: OrderStatus }) {
  const activeIndex = progressStatuses.indexOf(status);
  return <ol className="timeline" aria-label={`Order progress: ${status}`}>
    {progressStatuses.map((step, index) => <li className={index <= activeIndex ? "is-complete" : ""} key={step}><span className="timeline-dot">{index < activeIndex ? "✓" : index + 1}</span><span>{step[0] + step.slice(1).toLowerCase()}</span></li>)}
  </ol>;
}

function ConfirmationPage() {
  const { id = "" } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["order", id], queryFn: () => api.get<Order>(`/orders/${id}`), enabled: Boolean(id) });
  const order = query.data;
  return <section className="confirmation-page"><div className="confirmation-mark">✓</div><div className="eyebrow">All set</div><h1>Order placed.<br /><em>Good choice.</em></h1><p>Your order is in. We’ll keep its progress here for you.</p>
    {query.isLoading ? <p>Loading your confirmation…</p> : order && <div className="confirmation-card"><span>Order reference</span><strong>{order.id}</strong><span>Order total</span><strong>{formatMoney(order.totalCents)}</strong></div>}
    <Link className="button" to="/orders">View your orders</Link> <Link className="text-link" to="/">Back to the collection</Link>
  </section>;
}

function AdminPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const productsQuery = useQuery({ queryKey: ["admin", "products"], queryFn: () => api.get<Page<Product>>("/products?limit=100") });
  const hiddenProductsQuery = useQuery<Product[]>({ queryKey: ["admin", "hidden-products"], queryFn: async () => [], initialData: [] });
  const ordersQuery = useQuery({ queryKey: ["admin", "orders", status, page], queryFn: () => api.get<Page<Order>>(`/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page), limit: "10" })}`) });
  const productSave = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), description: description.trim(), priceCents: currencyUnitsToCents(price) };
      return editing ? api.patch<Product>(`/products/${editing.id}`, payload) : api.post<Product>("/products", { ...payload, stock: Number(stock) });
    },
    onSuccess: async () => { showToast(editing ? "Product updated." : "Product created."); setEditing(null); setName(""); setDescription(""); setPrice(""); setStock("0"); await queryClient.invalidateQueries({ queryKey: ["admin", "products"] }); await queryClient.invalidateQueries({ queryKey: ["products"] }); },
    onError: (error) => showToast(messageFor(error), "error"),
  });
  const stockMutation = useMutation({ mutationFn: ({ id, delta }: { id: string; delta: number }) => api.patch<Product>(`/products/${id}/stock`, { delta }), onSuccess: async () => { showToast("Stock updated."); await queryClient.invalidateQueries({ queryKey: ["admin", "products"] }); }, onError: (error) => showToast(messageFor(error), "error") });
  const activeMutation = useMutation({ mutationFn: ({ product, active }: { product: Product; active: boolean }) => api.patch<Product>(`/products/${product.id}`, { isActive: active }), onSuccess: async (product) => { queryClient.setQueryData<Product[]>(["admin", "hidden-products"], (items = []) => product.isActive ? items.filter((item) => item.id !== product.id) : [product, ...items.filter((item) => item.id !== product.id)]); await queryClient.invalidateQueries({ queryKey: ["admin", "products"] }); await queryClient.invalidateQueries({ queryKey: ["products"] }); }, onError: (error) => showToast(messageFor(error), "error") });
  const statusMutation = useMutation({ mutationFn: ({ id, status: next }: { id: string; status: OrderStatus }) => api.patch<Order>(`/admin/orders/${id}/status`, { status: next }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "orders"] }), onError: (error) => showToast(error instanceof ApiError && error.status === 409 ? `Order changed: ${error.message}` : messageFor(error), "error") });
  const products = useMemo(() => [...(productsQuery.data?.data ?? []), ...hiddenProductsQuery.data], [productsQuery.data?.data, hiddenProductsQuery.data]);

  function edit(product: Product) { setEditing(product); setName(product.name); setDescription(product.description); setPrice((product.priceCents / 100).toFixed(2)); }
  function submitProduct(event: FormEvent) { event.preventDefault(); productSave.mutate(); }

  return <section className="content-page admin-page"><div className="eyebrow">Store operations</div><h1>Admin desk</h1><p className="page-lead">Good service starts behind the scenes.</p>
    <section className="admin-section"><div className="admin-section-heading"><div><div className="eyebrow">The catalogue</div><h2>Products</h2></div></div>
      <form className="admin-product-form" onSubmit={submitProduct}>
        <h3>{editing ? "Edit product" : "Add a product"}</h3>
        <div className="admin-form-grid"><Field label="Name" value={name} onChange={setName} /><Field label="Description" value={description} onChange={setDescription} /><Field label="Price (USD)" type="number" value={price} onChange={setPrice} /><Field label="Initial stock" type="number" value={stock} onChange={setStock} /></div>
        <div className="row-actions"><button className="button" disabled={productSave.isPending}>{productSave.isPending ? "Saving…" : editing ? "Save changes" : "Create product"}</button>{editing && <button className="button button--outline" type="button" onClick={() => setEditing(null)}>Stop editing</button>}</div>
        <p className="field-hint">Prices are entered in dollars and sent to the API as integer cents. Stock changes use the separate relative adjustment control below.</p>
      </form>
      {productsQuery.isLoading ? <p>Loading products…</p> : productsQuery.isError ? <div className="page-state error-state"><p>Couldn’t load products.</p><button className="button" onClick={() => void productsQuery.refetch()}>Try again</button></div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <AdminProductRow key={product.id} product={product} onEdit={() => edit(product)} onStock={(delta) => stockMutation.mutate({ id: product.id, delta })} onToggle={() => activeMutation.mutate({ product, active: !product.isActive })} stockBusy={stockMutation.isPending} activeBusy={activeMutation.isPending} />)}</tbody></table>{!products.length && <p className="empty-table">No active products yet.</p>}</div>}
    </section>
    <section className="admin-section"><div className="admin-section-heading"><div><div className="eyebrow">Every customer</div><h2>Orders</h2></div><label className="filter-label">Filter by status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      {ordersQuery.isLoading ? <p>Loading orders…</p> : ordersQuery.isError ? <div className="page-state error-state"><p>Couldn’t load orders.</p><button className="button" onClick={() => void ordersQuery.refetch()}>Try again</button></div> : <><div className="table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Next step</th></tr></thead><tbody>{ordersQuery.data?.data.map((order) => <tr key={order.id}><td><code>{order.id.slice(0, 8)}</code><small>{new Date(order.createdAt).toLocaleDateString()}</small></td><td>{order.userId.slice(0, 8)}</td><td>{formatMoney(order.totalCents)}</td><td><span className={`status-badge status-${order.status.toLowerCase()}`}>{order.status}</span></td><td><StatusActionButtons status={order.status} disabled={statusMutation.isPending} onChoose={(next) => statusMutation.mutate({ id: order.id, status: next })} /></td></tr>)}</tbody></table>{!ordersQuery.data?.data.length && <p className="empty-table">No orders match that filter.</p>}</div><div className="pagination"><button className="button button--outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>Page {page} of {Math.max(1, ordersQuery.data?.meta.totalPages ?? 1)}</span><button className="button button--outline" disabled={page >= (ordersQuery.data?.meta.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)}>Next →</button></div></>}
    </section>
  </section>;
}

function AdminProductRow({ product, onEdit, onStock, onToggle, stockBusy, activeBusy }: { product: Product; onEdit(): void; onStock(delta: number): void; onToggle(): void; stockBusy: boolean; activeBusy: boolean }) {
  const [delta, setDelta] = useState("1");
  return <tr className={!product.isActive ? "inactive-row" : ""}><td><strong>{product.name}</strong><small>{product.description}</small></td><td>{formatMoney(product.priceCents)}</td><td>{product.stock}</td><td>{product.isActive ? "Shown" : "Hidden"}</td><td><div className="admin-row-actions"><button className="button button--small button--outline" onClick={onEdit}>Edit</button><form className="stock-adjust" onSubmit={(event) => { event.preventDefault(); const amount = Number(delta); if (Number.isInteger(amount) && amount !== 0) onStock(amount); }}><label className="visually-hidden" htmlFor={`stock-${product.id}`}>Stock change for {product.name}</label><input id={`stock-${product.id}`} type="number" value={delta} onChange={(event) => setDelta(event.target.value)} /><button className="button button--small" disabled={stockBusy || !Number(delta)}>Apply +/-</button></form><button className="button button--small button--quiet" disabled={activeBusy} onClick={onToggle}>{product.isActive ? "Hide" : "Show"}</button></div></td></tr>;
}

function statusActionLabel(status: OrderStatus) {
  return { PAID: "Mark paid", CANCELLED: "Cancel", SHIPPED: "Ship", DELIVERED: "Mark delivered", PENDING: "Mark pending" }[status];
}

export function CheckoutButton({ canCheckout, pending, retry, onCheckout }: { canCheckout: boolean; pending: boolean; retry: boolean; onCheckout(): void }) {
  return <button className="button button--checkout" disabled={!canCheckout || pending} onClick={onCheckout}>{pending ? "Placing your order…" : retry ? "Retry secure checkout" : "Continue to checkout"}<span aria-hidden="true">→</span></button>;
}

export function StatusActionButtons({ status, disabled, onChoose }: { status: OrderStatus; disabled: boolean; onChoose(status: OrderStatus): void }) {
  return <div className="row-actions">{allowedNextStatuses[status].map((next) => <button className="button button--small" key={next} disabled={disabled} onClick={() => onChoose(next)}>{statusActionLabel(next)}</button>)}</div>;
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function App() {
  return <Routes><Route element={<Shell />}>
    <Route index element={<ProductPage />} />
    <Route path="login" element={<AuthPage />} />
    <Route element={<Protected />}>
      <Route path="orders" element={<OrdersPage />} />
      <Route path="confirmation/:id" element={<ConfirmationPage />} />
    </Route>
    <Route element={<Protected admin />}><Route path="admin" element={<AdminPage />} /></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}
