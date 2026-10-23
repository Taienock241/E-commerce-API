import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { AppError, isPrismaError } from "../../errors";
import { pageMeta, paginationSchema } from "../../lib/validation";

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000);
const priceCents = z.number().int().min(0).max(100_000_000);
const stock = z.number().int().min(0).max(1_000_000);

export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
});

export const createProductSchema = z.object({
  name,
  description: description.default(""),
  priceCents,
  stock,
});

// strict(): sending "stock" here is rejected on purpose. Stock changes go through adjustStock,
// which is atomic, so an admin edit can never overwrite stock that customers just bought.
export const updateProductSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    priceCents: priceCents.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const adjustStockSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, { message: "delta must not be 0" }),
});

const notFound = () => new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");

export async function listProducts(query: z.infer<typeof listQuerySchema>) {
  const { page, limit, search } = query;

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], // id makes the order stable between pages
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { data, meta: pageMeta(page, limit, total) };
}

export async function getProduct(id: string) {
  const product = await prisma.product.findFirst({ where: { id, isActive: true } });
  if (!product) throw notFound();
  return product;
}

export function createProduct(input: z.infer<typeof createProductSchema>) {
  return prisma.product.create({ data: input });
}

export async function updateProduct(id: string, input: z.infer<typeof updateProductSchema>) {
  try {
    return await prisma.product.update({ where: { id }, data: input });
  } catch (err) {
    if (isPrismaError(err, "P2025")) throw notFound();
    throw err;
  }
}

/** "Delete" = hide. Rows are kept because order items reference them. */
export async function deactivateProduct(id: string) {
  try {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
  } catch (err) {
    if (isPrismaError(err, "P2025")) throw notFound();
    throw err;
  }
}

/**
 * Relative, atomic stock change (+ restock, - write-off).
 * For a decrease, the WHERE clause only matches if enough stock exists, so stock can never go below zero.
 */
export async function adjustStock(id: string, delta: number) {
  const { count } = await prisma.product.updateMany({
    where: delta < 0 ? { id, stock: { gte: -delta } } : { id },
    data: { stock: { increment: delta } },
  });

  if (count === 0) {
    const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw notFound();
    throw new AppError(409, "INSUFFICIENT_STOCK", "Stock cannot go below zero");
  }

  return prisma.product.findUniqueOrThrow({ where: { id } });
}
