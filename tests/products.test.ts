import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { api, bearer, createProduct, createUser, resetDb, stockOf } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const validProduct = { name: "Desk Lamp", description: "LED lamp", priceCents: 3499, stock: 15 };

describe("GET /products", () => {
  it("is public and paginated", async () => {
    for (let i = 1; i <= 15; i++) await createProduct({ name: `Item ${i}` });

    const page1 = await api().get("/products?page=1&limit=10");
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.meta).toEqual({ page: 1, limit: 10, total: 15, totalPages: 2 });

    const page2 = await api().get("/products?page=2&limit=10");
    expect(page2.body.data).toHaveLength(5);
  });

  it("searches name and description, ignoring case", async () => {
    await createProduct({ name: "Blue Mug" });
    await createProduct({ name: "Red Plate", description: "Pairs nicely with a mug" });
    await createProduct({ name: "Spoon" });

    const res = await api().get("/products?search=MUG");
    const names = res.body.data.map((p: { name: string }) => p.name).sort();

    expect(names).toEqual(["Blue Mug", "Red Plate"]);
    expect(res.body.meta.total).toBe(2);
  });

  it("rejects invalid pagination with 400", async () => {
    expect((await api().get("/products?limit=1000")).status).toBe(400);
    expect((await api().get("/products?page=abc")).status).toBe(400);
  });
});

describe("GET /products/:id", () => {
  it("returns a product, 404 for unknown ids, 400 for malformed ids", async () => {
    const product = await createProduct();

    expect((await api().get(`/products/${product.id}`)).body.name).toBe("Test Product");
    expect((await api().get("/products/6f1c1f0e-2a39-4c4f-9b3a-2f1d7d7e9a11")).status).toBe(404);
    expect((await api().get("/products/not-a-uuid")).status).toBe(400);
  });
});

describe("admin-only product management", () => {
  it("rejects anonymous callers (401) and customers (403)", async () => {
    const customer = await createUser("CUSTOMER");

    expect((await api().post("/products").send(validProduct)).status).toBe(401);
    expect((await api().post("/products").set(bearer(customer.token)).send(validProduct)).status).toBe(403);
    expect(await prisma.product.count()).toBe(0);
  });

  it("lets customers neither update, restock nor delete", async () => {
    const customer = await createUser("CUSTOMER");
    const product = await createProduct();

    const patch = await api().patch(`/products/${product.id}`).set(bearer(customer.token)).send({ priceCents: 1 });
    const restock = await api().patch(`/products/${product.id}/stock`).set(bearer(customer.token)).send({ delta: 5 });
    const del = await api().delete(`/products/${product.id}`).set(bearer(customer.token));

    expect([patch.status, restock.status, del.status]).toEqual([403, 403, 403]);
  });

  it("lets an admin create and update a product", async () => {
    const admin = await createUser("ADMIN");

    const created = await api().post("/products").set(bearer(admin.token)).send(validProduct);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(validProduct);

    const updated = await api()
      .patch(`/products/${created.body.id}`)
      .set(bearer(admin.token))
      .send({ priceCents: 2999, name: "Desk Lamp v2" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ priceCents: 2999, name: "Desk Lamp v2", stock: 15 });
  });

  it("validates input", async () => {
    const admin = await createUser("ADMIN");
    const product = await createProduct();
    const post = (body: object) => api().post("/products").set(bearer(admin.token)).send(body);

    expect((await post({ ...validProduct, priceCents: -5 })).status).toBe(400);
    expect((await post({ ...validProduct, priceCents: 19.99 })).status).toBe(400); // money is integer cents
    expect((await post({ ...validProduct, stock: -1 })).status).toBe(400);
    expect((await post({ ...validProduct, name: "" })).status).toBe(400);

    // stock cannot be overwritten through the general update endpoint
    const sneaky = await api().patch(`/products/${product.id}`).set(bearer(admin.token)).send({ stock: 999 });
    expect(sneaky.status).toBe(400);
    expect((await api().patch(`/products/${product.id}`).set(bearer(admin.token)).send({})).status).toBe(400);
  });

  it("soft-deletes: hidden from the shop, but the row stays for order history", async () => {
    const admin = await createUser("ADMIN");
    const product = await createProduct();

    const del = await api().delete(`/products/${product.id}`).set(bearer(admin.token));
    expect(del.status).toBe(204);

    expect((await api().get(`/products/${product.id}`)).status).toBe(404);
    expect((await api().get("/products")).body.data).toHaveLength(0);
    expect(await prisma.product.count()).toBe(1);
  });
});

describe("PATCH /products/:id/stock", () => {
  it("applies relative changes and refuses to go below zero", async () => {
    const admin = await createUser("ADMIN");
    const product = await createProduct({ stock: 5 });
    const adjust = (delta: number) =>
      api().patch(`/products/${product.id}/stock`).set(bearer(admin.token)).send({ delta });

    expect((await adjust(10)).body.stock).toBe(15);
    expect((await adjust(-15)).body.stock).toBe(0);

    const tooMuch = await adjust(-1);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(product.id)).toBe(0);

    expect((await adjust(0)).status).toBe(400);
  });

  it("is enforced by the database too: a direct write cannot make stock negative", async () => {
    const product = await createProduct({ stock: 1 });

    await expect(prisma.product.update({ where: { id: product.id }, data: { stock: -1 } })).rejects.toThrow();
    expect(await stockOf(product.id)).toBe(1);
  });
});
