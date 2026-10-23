import { Router } from "express";
import { AppError } from "../../errors";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth";
import { uuidSchema } from "../../lib/validation";
import {
  adminOrderListQuerySchema,
  changeOrderStatus,
  getOrder,
  idempotencyKeySchema,
  listAllOrders,
  listMyOrders,
  orderListQuerySchema,
  placeOrder,
  updateStatusSchema,
} from "./orders.service";

// ---- Customer routes: /orders ----
export const orderRoutes = Router();
orderRoutes.use(requireAuth);

// The body is intentionally ignored: the order is built from the server-side cart and database prices.
orderRoutes.post("/", async (req, res) => {
  const key = idempotencyKeySchema.safeParse(req.header("Idempotency-Key"));
  if (!key.success) {
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Send a unique Idempotency-Key header (8-100 characters, e.g. a UUID)",
    );
  }

  const { order, replayed } = await placeOrder(currentUser(req).id, key.data);

  if (replayed) res.setHeader("Idempotent-Replayed", "true");
  res.status(replayed ? 200 : 201).json(order);
});

orderRoutes.get("/", async (req, res) => {
  res.json(await listMyOrders(currentUser(req).id, orderListQuerySchema.parse(req.query)));
});

orderRoutes.get("/:id", async (req, res) => {
  res.json(await getOrder(uuidSchema.parse(req.params.id), currentUser(req)));
});

orderRoutes.post("/:id/cancel", async (req, res) => {
  res.json(await changeOrderStatus(uuidSchema.parse(req.params.id), "CANCELLED", currentUser(req)));
});

// ---- Admin routes: /admin/orders ----
export const adminOrderRoutes = Router();
adminOrderRoutes.use(requireAuth, requireRole("ADMIN"));

adminOrderRoutes.get("/", async (req, res) => {
  res.json(await listAllOrders(adminOrderListQuerySchema.parse(req.query)));
});

adminOrderRoutes.patch("/:id/status", async (req, res) => {
  const { status } = updateStatusSchema.parse(req.body);
  res.json(await changeOrderStatus(uuidSchema.parse(req.params.id), status, currentUser(req)));
});
