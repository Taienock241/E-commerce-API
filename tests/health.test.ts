import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("health and root routes", () => {
  it("returns API information from GET /", async () => {
    const res = await api().get("/");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("E-commerce API");
  });

  it("returns NOT_FOUND for unknown routes", async () => {
    const res = await api().get("/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
