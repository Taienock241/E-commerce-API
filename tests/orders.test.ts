import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { addToCart, api, bearer, checkout, createProduct, createUser, resetDb, stockOf } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** Adds `quantity` of a product to the customer's cart and checks out. Returns the created order. */
async function buy(token: string, productId: string, quantity = 1) {
  await addToCart(token, productId, quantity);
  const res = await checkout(token);
  if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const setStatus = (adminToken: string, orderId: string, status: string) =>
  api().patch(`/admin/orders/${orderId}/status`).set(bearer(adminToken)).send({ status });

describe("placing an order", () => {
  it("creates the order, snapshots items, reduces stock and empties the cart", async () => {
    const { token } = await createUser();
    const mug = await createProduct({ name: "Mug", priceCents: 1250, stock: 10 });
    const lamp = await createProduct({ name: "Lamp", priceCents: 3000, stock: 5 });
    await addToCart(token, mug.id, 2);
    await addToCart(token, lamp.id, 1);

    const res = await checkout(token);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", totalCents: 2 * 1250 + 3000 });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: "Mug", unitPriceCents: 1250, quantity: 2 }),
        expect.objectContaining({ productName: "Lamp", unitPriceCents: 3000, quantity: 1 }),
      ]),
    );
    expect(await stockOf(mug.id)).toBe(8);
    expect(await stockOf(lamp.id)).toBe(4);
    expect((await api().get("/cart").set(bearer(token))).body.items).toHaveLength(0);
  });

  it("ignores any price or total sent by the client", async () => {
    const { token } = await createUser();
    const product = await createProduct({ priceCents: 5000, stock: 10 });
    await addToCart(token, product.id, 2);

    const res = await api()
      .post("/orders")
      .set(bearer(token))
      .set("Idempotency-Key", randomUUID())
      .send({ totalCents: 1, items: [{ productId: product.id, unitPriceCents: 1, quantity: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(10_000);
    expect(res.body.items[0]).toMatchObject({ unitPriceCents: 5000, quantity: 2 });
  });

  it("keeps the price paid even if the product price changes later", async () => {
    const admin = await createUser("ADMIN");
    const { token } = await createUser();
    const product = await createProduct({ priceCents: 1000, stock: 10 });
    const order = await buy(token, product.id, 2);

    await api().patch(`/products/${product.id}`).set(bearer(admin.token)).send({ priceCents: 9999, name: "Renamed" });

    const res = await api().get(`/orders/${order.id}`).set(bearer(token));
    expect(res.body.totalCents).toBe(2000);
    expect(res.body.items[0]).toMatchObject({ unitPriceCents: 1000, productName: "Test Product" });
  });

  it("rejects an empty cart", async () => {
    const { token } = await createUser();
    const res = await checkout(token);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_CART");
  });

  it("requires a valid Idempotency-Key header", async () => {
    const { token } = await createUser();
    const product = await createProduct();
    await addToCart(token, product.id);

    const missing = await api().post("/orders").set(bearer(token)).send({});
    const bad = await api().post("/orders").set(bearer(token)).set("Idempotency-Key", "x").send({});

    expect(missing.status).toBe(400);
    expect(bad.status).toBe(400);
    expect(await prisma.order.count()).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await api().post("/orders").set("Idempotency-Key", randomUUID()).send({});
    expect(res.status).toBe(401);
  });

  it("fails a product that was deleted after it was added to the cart", async () => {
    const { token } = await createUser();
    const product = await createProduct();
    await addToCart(token, product.id);
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

    const res = await checkout(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_UNAVAILABLE");
  });
});

describe("data integrity: failed orders", () => {
  it("is all-or-nothing: one unavailable item rolls back everything", async () => {
    const { token } = await createUser();
    const first = await createProduct({ name: "First", stock: 5 });
    const second = await createProduct({ name: "Second", stock: 5 });
    await addToCart(token, first.id, 2);
    await addToCart(token, second.id, 3);

    // Someone else buys most of the second product after it was added to the cart
    await prisma.product.update({ where: { id: second.id }, data: { stock: 1 } });

    const res = await checkout(token);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(first.id)).toBe(5); // untouched, even though it was processable
    expect(await stockOf(second.id)).toBe(1);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect((await api().get("/cart").set(bearer(token))).body.items).toHaveLength(2); // cart survives for a retry
  });
});

describe("data integrity: duplicate requests", () => {
  it("returns the original order when the same Idempotency-Key is sent again", async () => {
    const { token } = await createUser();
    const product = await createProduct({ stock: 10 });
    await addToCart(token, product.id, 3);
    const key = randomUUID();

    const first = await checkout(token, key);
    const second = await checkout(token, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(product.id)).toBe(7); // reduced once, not twice
  });

  it("handles two identical requests arriving at the same time", async () => {
    const { token } = await createUser();
    const product = await createProduct({ stock: 10 });
    await addToCart(token, product.id, 3);
    const key = randomUUID();

    const results = await Promise.all([checkout(token, key), checkout(token, key)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(product.id)).toBe(7);
  });

  it("does not let different customers' keys collide", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const product = await createProduct({ stock: 10 });
    await addToCart(alice.token, product.id, 1);
    await addToCart(bob.token, product.id, 1);
    const sharedKey = randomUUID();

    const a = await checkout(alice.token, sharedKey);
    const b = await checkout(bob.token, sharedKey);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
  });
});

describe("data integrity: concurrency (no overselling)", () => {
  it("two customers race for the last item: exactly one wins", async () => {
    const product = await createProduct({ stock: 1, priceCents: 5000 });
    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    await addToCart(alice.token, product.id, 1);
    await addToCart(bob.token, product.id, 1);

    const results = await Promise.all([checkout(alice.token), checkout(bob.token)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(product.id)).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it("10 customers compete for 5 units: exactly 5 succeed and stock ends at 0", async () => {
    const product = await createProduct({ stock: 5 });
    const customers = await Promise.all(Array.from({ length: 10 }, () => createUser()));
    for (const c of customers) await addToCart(c.token, product.id, 1);

    const results = await Promise.all(customers.map((c) => checkout(c.token)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(product.id)).toBe(0);
    expect(await prisma.order.count()).toBe(5);
    const sold = await prisma.orderItem.aggregate({ _sum: { quantity: true } });
    expect(sold._sum.quantity).toBe(5);
  });

  it("overlapping carts in different orders do not deadlock", async () => {
    const a = await createProduct({ name: "A", stock: 10 });
    const b = await createProduct({ name: "B", stock: 10 });
    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    await addToCart(alice.token, a.id, 1);
    await addToCart(alice.token, b.id, 1);
    await addToCart(bob.token, b.id, 1);
    await addToCart(bob.token, a.id, 1);

    const results = await Promise.all([checkout(alice.token), checkout(bob.token)]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await stockOf(a.id)).toBe(8);
    expect(await stockOf(b.id)).toBe(8);
  });
});

describe("order history and access control", () => {
  it("lists only the caller's own orders, newest first, with pagination", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const product = await createProduct({ stock: 50 });
    const first = await buy(alice.token, product.id);
    const second = await buy(alice.token, product.id);
    await buy(bob.token, product.id);

    const res = await api().get("/orders?limit=10").set(bearer(alice.token));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);

    const paged = await api().get("/orders?page=2&limit=1").set(bearer(alice.token));
    expect(paged.body.data.map((o: { id: string }) => o.id)).toEqual([first.id]);
  });

  it("hides other customers' orders (404), but admins can see any order", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const admin = await createUser("ADMIN");
    const product = await createProduct();
    const order = await buy(alice.token, product.id);

    expect((await api().get(`/orders/${order.id}`).set(bearer(bob.token))).status).toBe(404);
    expect((await api().get(`/orders/${order.id}`).set(bearer(alice.token))).status).toBe(200);
    expect((await api().get(`/orders/${order.id}`).set(bearer(admin.token))).status).toBe(200);
  });

  it("lets only admins list all orders", async () => {
    const alice = await createUser();
    const admin = await createUser("ADMIN");
    const product = await createProduct({ stock: 10 });
    await buy(alice.token, product.id);

    expect((await api().get("/admin/orders").set(bearer(alice.token))).status).toBe(403);
    expect((await api().get("/admin/orders")).status).toBe(401);

    const res = await api().get("/admin/orders?status=PENDING").set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe("order status tracking", () => {
  it("only admins can change an order's status", async () => {
    const alice = await createUser();
    const product = await createProduct();
    const order = await buy(alice.token, product.id);

    const res = await setStatus(alice.token, order.id, "PAID");
    expect(res.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("follows PENDING → PAID → SHIPPED → DELIVERED and rejects invalid jumps", async () => {
    const admin = await createUser("ADMIN");
    const alice = await createUser();
    const product = await createProduct();
    const order = await buy(alice.token, product.id);

    const skip = await setStatus(admin.token, order.id, "DELIVERED");
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe("INVALID_STATUS_TRANSITION");

    for (const status of ["PAID", "SHIPPED", "DELIVERED"]) {
      const res = await setStatus(admin.token, order.id, status);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }

    expect((await setStatus(admin.token, order.id, "CANCELLED")).status).toBe(409); // delivered is final
    expect((await setStatus(admin.token, order.id, "NOT_A_STATUS")).status).toBe(400);
  });

  it("restores stock exactly once when an order is cancelled", async () => {
    const admin = await createUser("ADMIN");
    const alice = await createUser();
    const product = await createProduct({ stock: 10 });
    const order = await buy(alice.token, product.id, 3);
    expect(await stockOf(product.id)).toBe(7);

    const cancelled = await setStatus(admin.token, order.id, "CANCELLED");
    expect(cancelled.status).toBe(200);
    expect(await stockOf(product.id)).toBe(10);

    const again = await setStatus(admin.token, order.id, "CANCELLED");
    expect(again.status).toBe(409);
    expect(await stockOf(product.id)).toBe(10); // not 13
  });

  it("two simultaneous cancellations restore stock only once", async () => {
    const admin = await createUser("ADMIN");
    const alice = await createUser();
    const product = await createProduct({ stock: 10 });
    const order = await buy(alice.token, product.id, 3);

    const results = await Promise.all([
      setStatus(admin.token, order.id, "CANCELLED"),
      api().post(`/orders/${order.id}/cancel`).set(bearer(alice.token)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(product.id)).toBe(10);
  });

  it("lets a customer cancel their own pending order only", async () => {
    const admin = await createUser("ADMIN");
    const alice = await createUser();
    const bob = await createUser();
    const product = await createProduct({ stock: 10 });
    const pending = await buy(alice.token, product.id);
    const paid = await buy(alice.token, product.id);
    await setStatus(admin.token, paid.id, "PAID");

    expect((await api().post(`/orders/${pending.id}/cancel`).set(bearer(bob.token))).status).toBe(404);

    const ok = await api().post(`/orders/${pending.id}/cancel`).set(bearer(alice.token));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("CANCELLED");

    const tooLate = await api().post(`/orders/${paid.id}/cancel`).set(bearer(alice.token));
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error.code).toBe("ORDER_NOT_CANCELLABLE");
  });
});
