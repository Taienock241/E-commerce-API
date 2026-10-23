import { OrderStatus, Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { pageMeta, paginationSchema, uuidSchema } from "../../lib/validation";

type Actor = { id: string; role: Role };

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_\-:.]+$/, "may only contain letters, digits and _ - : .");

export const orderListQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(OrderStatus).optional(),
});
export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  userId: uuidSchema.optional(),
});
export const updateStatusSchema = z.object({ status: z.nativeEnum(OrderStatus) });

const orderInclude = { items: { orderBy: { productName: "asc" } } } satisfies Prisma.OrderInclude;

// totalCents is a 32-bit INTEGER column
const MAX_ORDER_TOTAL_CENTS = 2_000_000_000;

const orderNotFound = () => new AppError(404, "ORDER_NOT_FOUND", "Order not found");

function findOrderByKey(userId: string, idempotencyKey: string) {
  return prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: orderInclude,
  });
}

/**
 * Turns the user's cart into an order. Everything below happens in ONE database transaction:
 * either the order exists AND the stock is reduced AND the cart is empty, or nothing changed at all.
 */
export async function placeOrder(userId: string, idempotencyKey: string) {
  // Retry of a request that already succeeded: return the original order instead of buying twice.
  const replay = await findOrderByKey(userId, idempotencyKey);
  if (replay) return { order: replay, replayed: true };

  try {
    const order = await prisma.$transaction(
      async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { userId },
          // Always lock products in the same order (by id) so two checkouts can never deadlock each other.
          include: { items: { orderBy: { productId: "asc" } } },
        });
        if (!cart || cart.items.length === 0) {
          throw new AppError(400, "EMPTY_CART", "Your cart is empty");
        }

        // 1) Claim stock atomically. This single statement is both the check and the decrement:
        //      UPDATE "Product" SET stock = stock - $qty WHERE id = $id AND "isActive" AND stock >= $qty
        //    Postgres row-locks the product while it runs, so two buyers of the last item are serialized:
        //    the second one re-checks "stock >= qty" after the first commits, matches 0 rows, and fails.
        for (const item of cart.items) {
          const { count } = await tx.product.updateMany({
            where: { id: item.productId, isActive: true, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });

          if (count === 0) {
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            if (!product || !product.isActive) {
              throw new AppError(409, "PRODUCT_UNAVAILABLE", "A product in your cart is no longer available", {
                productId: item.productId,
              });
            }
            throw new AppError(409, "INSUFFICIENT_STOCK", `Not enough stock for "${product.name}"`, {
              productId: product.id,
              available: product.stock,
              requested: item.quantity,
            });
          }
        }

        // 2) Read prices only now. We hold row locks on these products until commit,
        //    so an admin cannot change a price between "read" and "order created".
        const products = await tx.product.findMany({ where: { id: { in: cart.items.map((i) => i.productId) } } });
        const byId = new Map(products.map((p) => [p.id, p]));

        const lines = cart.items.map((item) => {
          const product = byId.get(item.productId)!;
          return {
            productId: product.id,
            productName: product.name, // snapshot
            unitPriceCents: product.priceCents, // snapshot
            quantity: item.quantity,
          };
        });

        // 3) The total is computed here from database prices. Nothing in the request can influence it.
        const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
        if (totalCents > MAX_ORDER_TOTAL_CENTS) {
          throw new AppError(400, "ORDER_TOTAL_TOO_LARGE", "Order total is too large");
        }

        // 4) Create the order with its items, and empty the cart.
        const created = await tx.order.create({
          data: { userId, idempotencyKey, totalCents, status: "PENDING", items: { create: lines } },
          include: orderInclude,
        });
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return created;
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    return { order, replayed: false };
  } catch (err) {
    // Two identical requests at the same moment: one wins, the other fails (unique key, empty cart, ...).
    // If a winner exists for this key, the loser should report the winner's order, not an error.
    const winner = await findOrderByKey(userId, idempotencyKey);
    if (winner) return { order: winner, replayed: true };
    throw err;
  }
}

async function listOrders(where: Prisma.OrderWhereInput, page: number, limit: number) {
  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { data, meta: pageMeta(page, limit, total) };
}

/** A customer's own order history. The userId always comes from the token, never from the request. */
export function listMyOrders(userId: string, query: z.infer<typeof orderListQuerySchema>) {
  return listOrders({ userId, ...(query.status && { status: query.status }) }, query.page, query.limit);
}

export function listAllOrders(query: z.infer<typeof adminOrderListQuerySchema>) {
  return listOrders(
    { ...(query.status && { status: query.status }), ...(query.userId && { userId: query.userId }) },
    query.page,
    query.limit,
  );
}

/** Customers only find their own orders (someone else's order is a 404, not a 403, so ids can't be probed). */
export async function getOrder(orderId: string, actor: Actor) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(actor.role === "ADMIN" ? {} : { userId: actor.id }) },
    include: orderInclude,
  });
  if (!order) throw orderNotFound();
  return order;
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Moves an order to a new status. Admins may make any allowed transition; customers may only
 * cancel their own PENDING orders. Cancelling puts the items back in stock.
 */
export async function changeOrderStatus(orderId: string, next: OrderStatus, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(actor.role === "ADMIN" ? {} : { userId: actor.id }) },
      include: { items: { orderBy: { productId: "asc" } } }, // same lock order as placeOrder
    });
    if (!order) throw orderNotFound();

    if (actor.role !== "ADMIN" && (next !== "CANCELLED" || order.status !== "PENDING")) {
      throw new AppError(409, "ORDER_NOT_CANCELLABLE", "Only pending orders can be cancelled by the customer");
    }
    if (!ALLOWED_TRANSITIONS[order.status].includes(next)) {
      throw new AppError(409, "INVALID_STATUS_TRANSITION", `Cannot change status from ${order.status} to ${next}`);
    }

    // Compare-and-set: only succeeds if the status is still what we just read. If two requests try to
    // cancel at once, exactly one matches, so stock is restored exactly once.
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: next },
    });
    if (count === 0) {
      throw new AppError(409, "ORDER_STATUS_CHANGED", "The order was changed by another request, please retry");
    }

    if (next === "CANCELLED") {
      for (const item of order.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  });
}
