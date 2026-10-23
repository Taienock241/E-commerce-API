import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { uuidSchema } from "../../lib/validation";
import {
  adjustStock,
  adjustStockSchema,
  createProduct,
  createProductSchema,
  deactivateProduct,
  getProduct,
  listProducts,
  listQuerySchema,
  updateProduct,
  updateProductSchema,
} from "./products.service";

export const productRoutes = Router();

const adminOnly = [requireAuth, requireRole("ADMIN")];

// Public: anyone can browse
productRoutes.get("/", async (req, res) => {
  res.json(await listProducts(listQuerySchema.parse(req.query)));
});

productRoutes.get("/:id", async (req, res) => {
  res.json(await getProduct(uuidSchema.parse(req.params.id)));
});

// Admin only
productRoutes.post("/", ...adminOnly, async (req, res) => {
  res.status(201).json(await createProduct(createProductSchema.parse(req.body)));
});

productRoutes.patch("/:id", ...adminOnly, async (req, res) => {
  const id = uuidSchema.parse(req.params.id);
  res.json(await updateProduct(id, updateProductSchema.parse(req.body)));
});

productRoutes.patch("/:id/stock", ...adminOnly, async (req, res) => {
  const id = uuidSchema.parse(req.params.id);
  const { delta } = adjustStockSchema.parse(req.body);
  res.json(await adjustStock(id, delta));
});

productRoutes.delete("/:id", ...adminOnly, async (req, res) => {
  await deactivateProduct(uuidSchema.parse(req.params.id));
  res.status(204).end();
});
