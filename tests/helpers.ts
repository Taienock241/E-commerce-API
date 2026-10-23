import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";

export const PASSWORD = "Password123!";

export const api = () => request(app);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function resetDb() {
  // Safety net: never wipe a database that is not clearly a test database.
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to truncate a database whose name does not contain '_test'");
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OrderItem", "Order", "CartItem", "Cart", "Product", "User" RESTART IDENTITY CASCADE',
  );
}

/** Creates a user directly in the database (so admins can exist), then logs in through the real API. */
export async function createUser(role: Role = "CUSTOMER") {
  const email = `${role.toLowerCase()}-${randomUUID()}@test.dev`;
  const user = await prisma.user.create({
    data: { email, name: `Test ${role}`, role, passwordHash: await bcrypt.hash(PASSWORD, 4), cart: { create: {} } },
  });
  const res = await api().post("/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Test login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, token: res.body.token as string };
}

export function createProduct(
  overrides: Partial<{ name: string; description: string; priceCents: number; stock: number; isActive: boolean }> = {},
) {
  return prisma.product.create({
    data: { name: "Test Product", description: "A test product", priceCents: 1000, stock: 10, ...overrides },
  });
}

export async function addToCart(token: string, productId: string, quantity = 1) {
  const res = await api().post("/cart/items").set(bearer(token)).send({ productId, quantity });
  if (res.status !== 200) throw new Error(`addToCart failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}

export function checkout(token: string, key: string = randomUUID()) {
  return api().post("/orders").set(bearer(token)).set("Idempotency-Key", key).send({});
}

export async function stockOf(productId: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { stock: true } });
  return product.stock;
}
