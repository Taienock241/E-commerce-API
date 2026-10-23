-- Prisma's schema language cannot express CHECK constraints, so they live in a hand-written migration.
-- They protect data integrity even if application code has a bug.

-- Stock can never go negative: even a buggy query cannot oversell a product.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_non_negative" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_non_negative" CHECK ("priceCents" >= 0);

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_total_non_negative" CHECK ("totalCents" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unit_price_non_negative" CHECK ("unitPriceCents" >= 0);
