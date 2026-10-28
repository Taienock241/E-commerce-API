import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    proxy: {
      "/auth": "http://localhost:3000",
      "/products": "http://localhost:3000",
      "/cart": "http://localhost:3000",
      "/orders": "http://localhost:3000",
      "/admin": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  test: { include: ["src/**/*.webtest.tsx"], environment: "jsdom", setupFiles: ["./src/testSetup.ts"] },
});
