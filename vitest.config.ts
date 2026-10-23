import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/testDb";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // These override anything in .env, so tests can never touch your dev database.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-secret-test-secret-test-secret-1234",
      JWT_EXPIRES_IN: "1h",
      BCRYPT_ROUNDS: "4",
    },
  },
});
