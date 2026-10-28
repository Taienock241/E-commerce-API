import express from "express";
import helmet from "helmet";
import path from "node:path";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { authRoutes } from "./modules/auth/auth.routes";
import { cartRoutes } from "./modules/cart/cart.routes";
import { adminOrderRoutes, orderRoutes } from "./modules/orders/orders.routes";
import { productRoutes } from "./modules/products/products.routes";

export const app = express();

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(process.cwd(), "web", "dist"), { index: false }));
// Serve frontend assets while keeping GET / available for the API information response below.
app.use(express.static(path.join(process.cwd(), "public"), { index: false }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({
    name: "E-commerce API",
    status: "ok",
    endpoints: ["/health", "/products", "/auth/register", "/auth/login", "/cart", "/orders", "/admin/orders"],
    docs: "See docs/API.md",
  });
});

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/cart", cartRoutes);
app.use("/orders", orderRoutes);
app.use("/admin/orders", adminOrderRoutes);

app.use(notFound);
app.use(errorHandler);
