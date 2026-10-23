/**
 * End-to-end demonstration against a RUNNING server (npm run dev) with a seeded database (npm run db:seed).
 *
 *   npm run demo
 *
 * Story: an admin lists a product with only ONE unit in stock; two customers try to buy it at the same
 * moment. Exactly one succeeds. Then we replay the winner's request (idempotency) and track the order.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

type Opts = { token?: string; body?: unknown; headers?: Record<string, string> };

async function call(method: string, path: string, opts: Opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function step(title: string) {
  console.log(`\n=== ${title}`);
}

function show(label: string, value: unknown) {
  console.log(`${label}:`, typeof value === "string" ? value : JSON.stringify(value));
}

async function register(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@demo.test`;
  const res = await call("POST", "/auth/register", { body: { email, password: "Password123!", name } });
  if (res.status !== 201) throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, email };
}

async function main() {
  step("1. Admin logs in and lists a product with ONE unit in stock");
  const admin = await call("POST", "/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200) throw new Error("Admin login failed. Did you run `npm run db:seed`?");
  const product = await call("POST", "/products", {
    token: admin.body.token,
    body: { name: "Limited Edition Mug", description: "Only one exists", priceCents: 1250, stock: 1 },
  });
  show("created", { id: product.body.id, priceCents: product.body.priceCents, stock: product.body.stock });

  step("2. A customer cannot create products (authorization)");
  const alice = await register("Alice");
  const bob = await register("Bob");
  const forbidden = await call("POST", "/products", { token: alice.token, body: { name: "Hack", priceCents: 1, stock: 1 } });
  show("status", forbidden.status);

  step("3. Both customers put the last mug in their carts");
  for (const c of [alice, bob]) {
    const cart = await call("POST", "/cart/items", { token: c.token, body: { productId: product.body.id, quantity: 1 } });
    show("cart total (computed by the server)", cart.body.totalCents);
  }

  step("4. Both check out at the same moment");
  const keys = { alice: randomUUID(), bob: randomUUID() };
  const [a, b] = await Promise.all([
    call("POST", "/orders", { token: alice.token, headers: { "Idempotency-Key": keys.alice }, body: {} }),
    call("POST", "/orders", { token: bob.token, headers: { "Idempotency-Key": keys.bob }, body: {} }),
  ]);
  show("Alice", { status: a.status, error: a.body.error?.code, total: a.body.totalCents });
  show("Bob  ", { status: b.status, error: b.body.error?.code, total: b.body.totalCents });

  const aliceWon = a.status === 201;
  const winner = aliceWon ? alice : bob;
  const loser = aliceWon ? bob : alice;
  const winnerKey = aliceWon ? keys.alice : keys.bob;
  const winnerOrder = aliceWon ? a.body : b.body;

  step("5. Winner's network retries the same request (same Idempotency-Key)");
  const replay = await call("POST", "/orders", { token: winner.token, headers: { "Idempotency-Key": winnerKey }, body: {} });
  show("status", replay.status);
  show("same order returned", replay.body.id === winnerOrder.id);

  step("6. Admin tracks the order through its lifecycle");
  for (const status of ["PAID", "SHIPPED", "DELIVERED"]) {
    const res = await call("PATCH", `/admin/orders/${winnerOrder.id}/status`, { token: admin.body.token, body: { status } });
    show(status, res.status);
  }

  step("7. Order history");
  const history = await call("GET", "/orders", { token: winner.token });
  show("winner's orders", history.body.data.map((o: { id: string; status: string; totalCents: number }) => ({ id: o.id, status: o.status, totalCents: o.totalCents })));
  const loserHistory = await call("GET", "/orders", { token: loser.token });
  show("loser's orders", loserHistory.body.meta.total);

  const finalStock = await call("GET", `/products/${product.body.id}`);
  show("\nfinal stock (never negative)", finalStock.body.stock);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
