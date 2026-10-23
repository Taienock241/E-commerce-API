# API Reference

Base URL: `http://localhost:3000`. All bodies are JSON. Money is always **integer cents** (`1250` = 12.50).

**Authentication:** send `Authorization: Bearer <token>` (token from register/login).

**Errors** always have this shape:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Not enough stock for \"Mug\"", "details": { "available": 1, "requested": 2 } } }
```

| Status | Meaning                                                                          |
| ------ | -------------------------------------------------------------------------------- |
| 400    | Validation error / malformed JSON / empty cart / bad `Idempotency-Key`           |
| 401    | Missing or invalid token / wrong credentials                                     |
| 403    | Authenticated but not allowed (e.g. customer calling an admin endpoint)          |
| 404    | Not found (also used for other customers' orders, so ids cannot be probed)       |
| 409    | Conflict: not enough stock, invalid status transition, duplicate email           |
| 429    | Too many login/registration attempts                                             |
| 500    | Unexpected server error (details are never exposed)                              |

Paginated lists return `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`
and accept `?page=1&limit=10` (limit max 100).

---

## Auth

| Method | Path             | Access | Description                         |
| ------ | ---------------- | ------ | ----------------------------------- |
| POST   | `/auth/register` | public | Create a customer account           |
| POST   | `/auth/login`    | public | Log in                              |
| GET    | `/auth/me`       | user   | Current user                        |

`POST /auth/register`
```json
{ "email": "ann@example.com", "password": "Password123!", "name": "Ann" }
```
Password: 8–72 characters. Response `201`:
```json
{ "user": { "id": "…", "email": "ann@example.com", "name": "Ann", "role": "CUSTOMER", "createdAt": "…" }, "token": "…" }
```
Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`.

`POST /auth/login` → `200` same shape as above. Error: `401 INVALID_CREDENTIALS`.

## Products

| Method | Path                  | Access | Description                                              |
| ------ | --------------------- | ------ | -------------------------------------------------------- |
| GET    | `/products`           | public | List active products. Query: `search`, `page`, `limit`  |
| GET    | `/products/:id`       | public | Get one active product                                   |
| POST   | `/products`           | admin  | Create                                                   |
| PATCH  | `/products/:id`       | admin  | Update `name`, `description`, `priceCents`, `isActive`   |
| PATCH  | `/products/:id/stock` | admin  | Atomic relative stock change                             |
| DELETE | `/products/:id`       | admin  | Soft delete (hides the product), `204`                   |

`POST /products`
```json
{ "name": "Ceramic Mug", "description": "350ml mug", "priceCents": 1250, "stock": 40 }
```
`PATCH /products/:id` accepts any subset of `name`, `description`, `priceCents`, `isActive`. Unknown fields
(including `stock`) are rejected with `400`.

`PATCH /products/:id/stock`
```json
{ "delta": -3 }
```
Positive = restock, negative = write-off. Returns the product. `409 INSUFFICIENT_STOCK` if stock would drop below 0.

`GET /products?search=mug&page=1&limit=10` searches name and description (case-insensitive).

## Cart

All cart endpoints require a logged-in user and act on that user's cart.

| Method | Path                     | Description                                       |
| ------ | ------------------------ | ------------------------------------------------- |
| GET    | `/cart`                  | View cart with server-computed totals             |
| POST   | `/cart/items`            | Add a product (quantities merge)                  |
| PATCH  | `/cart/items/:productId` | Set a quantity                                    |
| DELETE | `/cart/items/:productId` | Remove a product, `204`                           |

`POST /cart/items`
```json
{ "productId": "…", "quantity": 2 }
```
Quantity: integer 1–100. Errors: `404 PRODUCT_NOT_FOUND`, `409 INSUFFICIENT_STOCK`.

Cart response (also returned by add and update):
```json
{
  "items": [
    { "productId": "…", "name": "Ceramic Mug", "unitPriceCents": 1250, "quantity": 2, "lineTotalCents": 2500, "available": true }
  ],
  "itemCount": 2,
  "totalCents": 2500
}
```
`available` is `false` if the product was hidden or stock dropped below the quantity in the cart. The cart total is
informational; the order total is recomputed at checkout.

## Orders (customer)

| Method | Path                 | Description                                              |
| ------ | -------------------- | -------------------------------------------------------- |
| POST   | `/orders`            | Place an order from the cart                             |
| GET    | `/orders`            | Own order history, newest first. Query: `status`, `page`, `limit` |
| GET    | `/orders/:id`        | One of your orders (admins can view any)                 |
| POST   | `/orders/:id/cancel` | Cancel your own order while it is `PENDING`              |

`POST /orders` requires the header `Idempotency-Key: <unique string, 8-100 chars, e.g. a UUID>`. The body is ignored.

- `201` with the new order.
- `200` with the original order and header `Idempotent-Replayed: true` if the key was already used (safe retry).
- `400 EMPTY_CART`, `400 INVALID_IDEMPOTENCY_KEY`
- `409 INSUFFICIENT_STOCK` / `409 PRODUCT_UNAVAILABLE`: nothing is changed and the cart is kept.

Order object:
```json
{
  "id": "…",
  "userId": "…",
  "status": "PENDING",
  "totalCents": 2500,
  "createdAt": "…",
  "updatedAt": "…",
  "items": [
    { "id": "…", "productId": "…", "productName": "Ceramic Mug", "unitPriceCents": 1250, "quantity": 2 }
  ]
}
```
Statuses: `PENDING`, `PAID`, `SHIPPED`, `DELIVERED`, `CANCELLED`.

## Orders (admin)

| Method | Path                         | Description                                                            |
| ------ | ---------------------------- | ---------------------------------------------------------------------- |
| GET    | `/admin/orders`              | All orders. Query: `status`, `userId`, `page`, `limit`                 |
| PATCH  | `/admin/orders/:id/status`   | Change status. Body: `{ "status": "PAID" }`                            |

Allowed transitions: `PENDING → PAID | CANCELLED`, `PAID → SHIPPED | CANCELLED`, `SHIPPED → DELIVERED`.
Anything else returns `409 INVALID_STATUS_TRANSITION`. Cancelling restores the items to stock (exactly once).
Customers cannot call these endpoints (`403`).

## Health

`GET /health` → `{ "status": "ok" }`

## Example session (curl)

```bash
# log in as the seeded admin
TOKEN=$(curl -s localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# list products
curl -s 'localhost:3000/products?search=mug'

# add to cart and check out (as a customer token)
curl -s localhost:3000/cart/items -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"productId":"<id>","quantity":1}'
curl -s -X POST localhost:3000/orders -H "Authorization: Bearer $CUSTOMER_TOKEN" -H "Idempotency-Key: $(uuidgen)"
```
