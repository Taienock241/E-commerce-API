# E-commerce Backend API

A REST API for an online store. Customers browse products, manage a shopping cart, place orders and track
purchases. Administrators manage products, inventory and order statuses.

**Stack:** TypeScript · Node.js + Express 5 · PostgreSQL · Prisma 6 · Vitest + Supertest · Zod · JWT · bcrypt

> Prisma is pinned to v6 (classic `prisma-client-js` setup). Prisma 7 changed client generation and configuration,
> so upgrading means following their migration guide.

## Features

- Registration and login, bcrypt password hashing, JWT authentication, `CUSTOMER` / `ADMIN` roles
- Products: create, view, update, soft-delete, search, pagination, atomic stock adjustments (admin)
- Cart: add, update, remove, with stock validation
- Orders: placed from the cart in one database transaction, totals computed on the server, prices snapshotted,
  order history, status tracking, cancellation (restores stock)
- Safe under concurrency (no overselling) and safe to retry (idempotency keys)

## Setup

Requirements: Node.js 20+, Docker (for PostgreSQL).

```bash
npm install
cp .env.example .env          # then set JWT_SECRET (>= 32 chars)
npm run db:up                 # starts PostgreSQL (databases: ecommerce and ecommerce_test)
npm run db:deploy             # applies the migrations
npm run db:seed               # creates an admin, a demo customer and sample products
npm run dev                   # http://localhost:3000
```

Seeded accounts (change the admin password in `.env` before seeding anywhere real):

| Role     | Email                  | Password       |
| -------- | ---------------------- | -------------- |
| Admin    | `admin@example.com`    | `ChangeMe123!` |
| Customer | `customer@example.com` | `Password123!` |

If you already had a Postgres volume from before, the test database may not exist. Create it with
`docker exec ecommerce-db psql -U postgres -c "CREATE DATABASE ecommerce_test"`.

## Running the tests

```bash
npm test            # applies migrations to ecommerce_test, then runs every test
npm run typecheck
```

Tests use their own database and refuse to run against any database whose name does not contain `_test`.
Highlights:

- two customers race for the last item: exactly one wins, stock ends at 0
- 10 customers compete for 5 units: exactly 5 orders, no more
- a failed order rolls back everything (stock, order, cart untouched)
- the same `Idempotency-Key` sent twice (even simultaneously) creates one order and reduces stock once
- client-supplied prices and totals are ignored; the price paid survives later price changes
- authorization: customers cannot manage products or change order status; other customers' orders return 404
- the database itself refuses negative stock (CHECK constraint)

## Demonstration

With the server running and the database seeded:

```bash
npm run demo
```

It walks through: admin creates a product with 1 unit in stock → two customers race to buy it → one wins and one
gets a clear `409 INSUFFICIENT_STOCK` → the winner's retry returns the same order → the admin moves the order to
DELIVERED → order history.

## API documentation

See [docs/API.md](docs/API.md) for every endpoint, request/response example and error code.

## Project structure

```
prisma/
  schema.prisma                         data model
  migrations/…_init                     tables, relations, indexes
  migrations/…_add_check_constraints    CHECK constraints (stock >= 0, quantity > 0, ...)
  seed.ts
src/
  app.ts, server.ts, config.ts, db.ts, errors.ts
  middleware/   auth.ts (requireAuth, requireRole), errorHandler.ts
  modules/      auth/  products/  cart/  orders/     (each: *.routes.ts thin HTTP layer, *.service.ts business rules)
tests/          one file per module + helpers
scripts/demo.ts
docs/API.md
```

## Database design

| Table       | Purpose                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `User`      | email (unique), bcrypt `passwordHash`, `role`                                            |
| `Product`   | name, description, `priceCents`, `stock`, `isActive` (soft delete)                        |
| `Cart`      | one per user (`userId` unique)                                                           |
| `CartItem`  | unique `(cartId, productId)`; quantity > 0                                               |
| `Order`     | `status`, `totalCents`, `idempotencyKey`; unique `(userId, idempotencyKey)`              |
| `OrderItem` | snapshot of `productName`, `unitPriceCents`, `quantity` at purchase time                 |

- Money is stored as integer cents, never floats.
- Foreign keys: orders and order items use `RESTRICT` on products/users so history can never be orphaned;
  carts cascade with their user.
- Indexes: unique email, unique `(cartId, productId)`, unique `(userId, idempotencyKey)`, `(userId, createdAt)` for
  order history, `(isActive, createdAt)` for the product listing, plus foreign key indexes.
- Product search uses `ILIKE '%term%'`, which is fine at this scale. For a large catalogue, add a `pg_trgm` GIN index.

## Design decisions (code-defense notes)

**Why the server calculates totals.** The client is not trusted. `POST /orders` ignores its body entirely: items
come from the server-side cart and prices from the database (`placeOrder` in `src/modules/orders/orders.service.ts`).

**Two customers, one last item.** Stock is claimed with a single conditional statement:
`UPDATE "Product" SET stock = stock - qty WHERE id = ? AND "isActive" AND stock >= qty`. Postgres row-locks the
product during the update, so concurrent buyers are serialized. The second buyer re-evaluates `stock >= qty` after the
first commits, matches zero rows, and receives `409`. A "read stock, then write stock" approach would let both pass the
check. A database `CHECK (stock >= 0)` is the safety net underneath.

**Why transactions.** An order changes several tables (stock, `Order`, `OrderItem`, cart). If any step fails, e.g.
the third item is out of stock, the stock already claimed for the first two items must be released. The transaction
guarantees all-or-nothing, so there are no half-created orders and no stock that disappears.

**Deadlocks.** Cart items are always processed in `productId` order (also when cancelling), so two overlapping
checkouts always lock rows in the same order.

**Protecting customer data and admin operations.**
- Passwords: bcrypt (cost 12), never returned or logged; login gives the same error for unknown email and wrong password.
- Registration always creates a `CUSTOMER`; the role is never read from the request. Admins are seeded.
- `requireAuth` loads the user and current role from the database on every request, so deleted or demoted users lose
  access immediately. `requireRole("ADMIN")` guards product writes, stock changes and order status changes.
- Customers only ever query by the `userId` from their token; another customer's order or cart item is a `404`.
- Input validation with Zod on every route; Helmet security headers; rate limiting on login/registration;
  errors never leak internals (`500` responses are generic).

**Failed orders.** Any failure rolls the transaction back: stock, order and cart are unchanged, and the cart is kept so
the customer can fix it and retry. Errors have stable codes (`INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`, `EMPTY_CART`).

**Duplicate requests.** `POST /orders` requires an `Idempotency-Key` header. A repeat with the same key returns the
original order (`200`, header `Idempotent-Replayed: true`) instead of buying twice. The unique constraint on
`(userId, idempotencyKey)` guarantees this even when two identical requests arrive at the same instant. Emptying the
cart inside the transaction is a second layer of protection.

**Status changes.** Allowed transitions: `PENDING → PAID | CANCELLED`, `PAID → SHIPPED | CANCELLED`,
`SHIPPED → DELIVERED`. Updates are compare-and-set (`WHERE status = <value just read>`), so two simultaneous
cancellations restore stock only once. Payment is not integrated: an admin marks an order `PAID`.

**Soft delete.** `DELETE /products/:id` hides a product instead of removing the row, because order items reference it.

**Inventory edits.** The general `PATCH /products/:id` rejects `stock`. Admins use `PATCH /products/:id/stock` with a
relative `delta`, applied atomically, so an admin edit can never overwrite stock that customers just bought.

## Known limitations / possible extensions

- No real payment processing (status `PAID` is set by an admin).
- Access tokens only (no refresh tokens or logout/revocation).
- Cart quantities are validated against stock when added, but stock is only *reserved* at checkout.
- Ideas: payment simulation, email notifications, discount codes, reviews, Docker image for the API, deployment.
