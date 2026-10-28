import type { Cart } from "../api/types";

export function cartWithQuantity(cart: Cart, productId: string, quantity: number): Cart {
  const items = cart.items
    .map((item) => item.productId === productId ? {
      ...item,
      quantity,
      lineTotalCents: item.unitPriceCents * quantity,
    } : item)
    .filter((item) => item.quantity > 0);
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
  };
}
