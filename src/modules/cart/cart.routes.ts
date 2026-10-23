import { Router } from "express";
import { currentUser, requireAuth } from "../../middleware/auth";
import { uuidSchema } from "../../lib/validation";
import { addItem, addItemSchema, getCart, removeItem, updateItem, updateItemSchema } from "./cart.service";

export const cartRoutes = Router();

// Every cart route needs a logged-in user, and always operates on THAT user's cart (never an id from the URL).
cartRoutes.use(requireAuth);

cartRoutes.get("/", async (req, res) => {
  res.json(await getCart(currentUser(req).id));
});

cartRoutes.post("/items", async (req, res) => {
  res.json(await addItem(currentUser(req).id, addItemSchema.parse(req.body)));
});

cartRoutes.patch("/items/:productId", async (req, res) => {
  const productId = uuidSchema.parse(req.params.productId);
  res.json(await updateItem(currentUser(req).id, productId, updateItemSchema.parse(req.body)));
});

cartRoutes.delete("/items/:productId", async (req, res) => {
  await removeItem(currentUser(req).id, uuidSchema.parse(req.params.productId));
  res.status(204).end();
});
