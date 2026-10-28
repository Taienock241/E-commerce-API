import "dotenv/config";

const mainUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ecommerce?schema=public";

// Same server and password as DATABASE_URL, but the "ecommerce_test" database.
function testUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  url.pathname = "/ecommerce_test";
  return url.toString();
}

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? testUrl(mainUrl);
