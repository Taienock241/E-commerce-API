import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { AppError } from "../errors";

export function signToken(userId: string): string {
  return jwt.sign({}, config.jwtSecret, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Authentication: who is calling?
 * The token only proves identity. The user and their CURRENT role are read from the database on every
 * request, so a deleted user or a demoted admin loses access immediately instead of when the token expires.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
  }


  let userId: string;
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) throw new Error("Malformed token");
    userId = payload.sub;
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) throw new AppError(401, "INVALID_TOKEN", "Invalid or expired token");

  req.user = user;
  next();
}

/** Authorization: is this caller allowed to do this? Always used after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
    }
    next();
  };
}

export function currentUser(req: Request): { id: string; role: Role } {
  if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user;
}
