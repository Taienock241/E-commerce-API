import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. Loaded from the database on every request, never trusted from the token. */
      user?: { id: string; role: Role };
    }
  }
}

export {};
