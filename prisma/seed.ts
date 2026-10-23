import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

  // Admin accounts are never created through the public API; they are seeded here.
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Store Admin",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
      cart: { create: {} },
    },
  });

  // A demo customer (for local demos only)
  await prisma.user.upsert({
    where: { email: "customer@example.com" },
    update: {},
    create: {
      email: "customer@example.com",
      name: "Demo Customer",
      role: "CUSTOMER",
      passwordHash: await bcrypt.hash("Password123!", 12),
      cart: { create: {} },
    },
  });

  if ((await prisma.product.count()) === 0) {
    await prisma.product.createMany({
      data: [
        { name: "Ceramic Mug", description: "350ml hand-glazed ceramic mug", priceCents: 1250, stock: 40 },
        { name: "Notebook A5", description: "Dotted notebook, 120 pages", priceCents: 899, stock: 100 },
        { name: "Desk Lamp", description: "LED desk lamp with dimmer", priceCents: 3499, stock: 15 },
        { name: "Wireless Mouse", description: "Ergonomic 2.4GHz wireless mouse", priceCents: 2199, stock: 25 },
        { name: "Water Bottle", description: "750ml stainless steel bottle", priceCents: 1899, stock: 60 },
        { name: "Backpack", description: "20L water-resistant backpack", priceCents: 5999, stock: 10 },
        { name: "Phone Stand", description: "Adjustable aluminium phone stand", priceCents: 1299, stock: 3 },
        { name: "USB-C Cable", description: "1m braided USB-C cable", priceCents: 799, stock: 200 },
      ],
    });
  }

  console.log(`Seed complete. Admin login: ${adminEmail}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
