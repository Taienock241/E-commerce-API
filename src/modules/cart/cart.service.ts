import { z } from "zod";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { uuidSchema } from "../../lib/validation";

const quantity = z.number().int().min(1).max(100);

export const addItemSchema = z.object({ productId: uuidSchema, quantity });
export const updateItemSchema = z.object({ quantity });

function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
}

/**
 * The cart is for browsing and planning. Stock checks here are a courtesy to the customer:
 * stock can still change before checkout, so the authoritative check happens atomically in placeOrder.
 */
export async function getCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { product: { select: { id: true, name: true, priceCents: true, stock: true, isActive: true } } },
      },
    },
  });

  const items = (cart?.items ?? []).map((item) => ({
    productId: item.productId,
    name: item.product.name,
    unitPriceCents: item.product.priceCents,
    quantity: item.quantity,
    lineTotalCents: item.product.priceCents * item.quantity,
    // false when the product was hidden or stock dropped below the quantity in the cart
    available: item.product.isActive && item.product.stock >= item.quantity,
  }));

  return {
    items,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    totalCents: items.reduce((sum, i) => sum + i.lineTotalCents, 0),
  };
}

export async function addItem(userId: string, input: z.infer<typeof addItemSchema>) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, isActive: true } });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
  });

  const requested = (existing?.quantity ?? 0) + input.quantity;
  if (requested > product.stock) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Only ${product.stock} in stock`, {
      productId: product.id,
      available: product.stock,
      requested,
    });
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity: input.quantity },
    update: { quantity: { increment: input.quantity } },
  });

  return getCart(userId);
}

export async function updateItem(userId: string, productId: string, input: z.infer<typeof updateItemSchema>) {
  const item = await prisma.cartItem.findFirst({
    where: { productId, cart: { userId } }, // scoped to the caller's own cart
    include: { product: true },
  });
  if (!item) throw new AppError(404, "CART_ITEM_NOT_FOUND", "Item is not in your cart");

  if (input.quantity > item.product.stock) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Only ${item.product.stock} in stock`, {
      productId,
      available: item.product.stock,
      requested: input.quantity,
    });
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, productId: string) {
  const { count } = await prisma.cartItem.deleteMany({ where: { productId, cart: { userId } } });
  if (count === 0) throw new AppError(404, "CART_ITEM_NOT_FOUND", "Item is not in your cart");
}
