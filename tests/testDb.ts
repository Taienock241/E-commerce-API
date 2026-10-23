// Tests run against their own database ("ecommerce_test", created by docker/init-test-db.sql).
// Override with TEST_DATABASE_URL if yours lives elsewhere. The name must contain "_test".
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ecommerce_test?schema=public";
