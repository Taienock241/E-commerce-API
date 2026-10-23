import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { addToCart, api, bearer, createProduct, createUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("cart", () => {
  it("requires authentication", async () => {
    expect((await api().get("/cart")).status).toBe(401);
    expect((await api().post("/cart/items").send({})).status).toBe(401);
  });

  it("starts empty", async () => {
    const { token } = await createUser();
    const res = await api().get("/cart").set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], itemCount: 0, totalCents: 0 });
  });

  it("adds items, merges repeats, and computes totals on the server", async () => {
    const { token } = await createUser();
    const mug = await createProduct({ name: "Mug", priceCents: 1250, stock: 10 });
    const lamp = await createProduct({ name: "Lamp", priceCents: 3000, stock: 10 });

    await addToCart(token, mug.id, 2);
    await addToCart(token, mug.id, 1); // same product again: quantity increases, no duplicate line
    const res = await addToCart(token, lamp.id, 1);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.itemCount).toBe(4);
    expect(res.body.totalCents).toBe(3 * 1250 + 3000);
    expect(res.body.items.find((i: { name: string }) => i.name === "Mug").quantity).toBe(3);
  });

  it("refuses quantities above available stock", async () => {
    const { token } = await createUser();
    const product = await createProduct({ stock: 3 });

    const tooMany = await api().post("/cart/items").set(bearer(token)).send({ productId: product.id, quantity: 4 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { available: 3, requested: 4 } });

    // The limit also applies to the running total, not just a single request
    await addToCart(token, product.id, 2);
    const overTotal = await api().post("/cart/items").set(bearer(token)).send({ productId: product.id, quantity: 2 });
    expect(overTotal.status).toBe(409);
  });

  it("validates input", async () => {
    const { token } = await createUser();
    const product = await createProduct();
    const add = (body: object) => api().post("/cart/items").set(bearer(token)).send(body);

    expect((await add({ productId: product.id, quantity: 0 })).status).toBe(400);
    expect((await add({ productId: product.id, quantity: -2 })).status).toBe(400);
    expect((await add({ productId: product.id, quantity: 1.5 })).status).toBe(400);
    expect((await add({ productId: "nope", quantity: 1 })).status).toBe(400);
    expect((await add({ productId: "6f1c1f0e-2a39-4c4f-9b3a-2f1d7d7e9a11", quantity: 1 })).status).toBe(404);
  });

  it("does not allow hidden (deleted) products", async () => {
    const { token } = await createUser();
    const hidden = await createProduct({ isActive: false });

    const res = await api().post("/cart/items").set(bearer(token)).send({ productId: hidden.id, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it("updates a quantity, validating against stock", async () => {
    const { token } = await createUser();
    const product = await createProduct({ stock: 5 });
    await addToCart(token, product.id, 1);

    const ok = await api().patch(`/cart/items/${product.id}`).set(bearer(token)).send({ quantity: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.items[0].quantity).toBe(5);

    const tooMany = await api().patch(`/cart/items/${product.id}`).set(bearer(token)).send({ quantity: 6 });
    expect(tooMany.status).toBe(409);
  });

  it("removes items, and 404s when the item is not in the cart", async () => {
    const { token } = await createUser();
    const product = await createProduct();
    await addToCart(token, product.id, 1);

    expect((await api().delete(`/cart/items/${product.id}`).set(bearer(token))).status).toBe(204);
    expect((await api().get("/cart").set(bearer(token))).body.items).toHaveLength(0);
    expect((await api().delete(`/cart/items/${product.id}`).set(bearer(token))).status).toBe(404);
    expect((await api().patch(`/cart/items/${product.id}`).set(bearer(token)).send({ quantity: 1 })).status).toBe(404);
  });

  it("keeps carts private: one customer cannot see or touch another's cart", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const product = await createProduct();
    await addToCart(alice.token, product.id, 2);

    expect((await api().get("/cart").set(bearer(bob.token))).body.items).toHaveLength(0);
    expect((await api().delete(`/cart/items/${product.id}`).set(bearer(bob.token))).status).toBe(404);
    expect((await api().get("/cart").set(bearer(alice.token))).body.items).toHaveLength(1);
  });

  it("flags items that are no longer available", async () => {
    const { token } = await createUser();
    const product = await createProduct({ stock: 5 });
    await addToCart(token, product.id, 4);
    await prisma.product.update({ where: { id: product.id }, data: { stock: 2 } });

    const res = await api().get("/cart").set(bearer(token));
    expect(res.body.items[0].available).toBe(false);
  });
});
