import express from "express";
import helmet from "helmet";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { authRoutes } from "./modules/auth/auth.routes";
import { cartRoutes } from "./modules/cart/cart.routes";
import { adminOrderRoutes, orderRoutes } from "./modules/orders/orders.routes";
import { productRoutes } from "./modules/products/products.routes";

export const app = express();

app.use(helmet());
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/cart", cartRoutes);
app.use("/orders", orderRoutes);
app.use("/admin/orders", adminOrderRoutes);

app.use(notFound);
app.use(errorHandler);
