import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { api, bearer, createUser, PASSWORD, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const newUser = { email: "ann@example.com", password: PASSWORD, name: "Ann" };

describe("POST /auth/register", () => {
  it("creates a customer, returns a token, and never exposes the password hash", async () => {
    const res = await api().post("/auth/register").send({ ...newUser, email: "Ann@Example.com" });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "ann@example.com", role: "CUSTOMER" });
    expect(res.body.user.passwordHash).  toBeUndefined();
  });

  it("stores a bcrypt hash, not the plain password", async () => {
    await api().post("/auth/register").send(newUser);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: newUser.email } });
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("cannot be used to create an admin", async () => {
    const res = await api().post("/auth/register").send({ ...newUser, role: "ADMIN" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("CUSTOMER");
  });

  it("rejects a duplicate email with 409", async () => {
    await api().post("/auth/register").send(newUser);
    const res = await api().post("/auth/register").send({ ...newUser, email: "ANN@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects invalid input with 400", async () => {
    const res = await api().post("/auth/register").send({ email: "not-an-email", password: "short", name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await api().post("/auth/register").set("Content-Type", "application/json").send("{ nope");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    await api().post("/auth/register").send(newUser);
    const res = await api().post("/auth/login").send({ email: newUser.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await api().post("/auth/register").send(newUser);

    const wrongPassword = await api().post("/auth/login").send({ email: newUser.email, password: "WrongPassword1" });
    const unknownEmail = await api().post("/auth/login").send({ email: "nobody@example.com", password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});

describe("GET /auth/me", () => {
  it("requires a valid token", async () => {
    expect((await api().get("/auth/me")).status).toBe(401);
    expect((await api().get("/auth/me").set(bearer("garbage"))).status).toBe(401);
  });

  it("returns the current user", async () => {
    const { user, token } = await createUser("CUSTOMER");
    const res = await api().get("/auth/me").set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, email: user.email, role: "CUSTOMER" });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("stops working immediately when the user is deleted", async () => {
    const { user, token } = await createUser("CUSTOMER");
    await prisma.user.delete({ where: { id: user.id } });

    expect((await api().get("/auth/me").set(bearer(token))).status).toBe(401);
  });
});
