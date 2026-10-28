import type { OrderStatus } from "../api/types";

export const allowedNextStatuses: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const progressStatuses: OrderStatus[] = ["PENDING", "PAID", "SHIPPED", "DELIVERED"];
