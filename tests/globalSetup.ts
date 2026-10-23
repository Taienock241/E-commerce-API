import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./testDb";

// Runs once before all tests: applies every migration (including the CHECK constraints) to the test database.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
