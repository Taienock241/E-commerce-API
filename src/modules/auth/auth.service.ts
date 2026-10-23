import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../../config";
import { prisma } from "../../db";
import { AppError, isPrismaError } from "../../errors";
import { signToken } from "../../middleware/auth";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // bcrypt only uses the first 72 bytes of a password, hence the upper limit
  password: z.string().min(8, "Password must be at least 8 characters").max(72, "Password must be at most 72 characters"),
  name: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

// Fields that are safe to return. passwordHash is deliberately absent.
const publicUser = { id: true, email: true, name: true, role: true, createdAt: true } as const;

// Compared against when the email is unknown, so "no such user" and "wrong password"
// take about the same time and cannot be told apart.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", config.bcryptRounds);

export async function register(input: z.infer<typeof registerSchema>) {
  const passwordHash = await bcrypt.hash(input.password, config.bcryptRounds);
  try {
    // The role is never taken from the request: public registration always creates a CUSTOMER.
    const user = await prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash, role: "CUSTOMER", cart: { create: {} } },
      select: publicUser,
    });
    return { user, token: signToken(user.id) };
  } catch (err) {
    if (isPrismaError(err, "P2002")) {
      throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  }
}

export async function login(input: z.infer<typeof loginSchema>) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  // Same message for both failures, so attackers cannot discover which emails are registered.
  if (!user || !passwordOk) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    token: signToken(user.id),
  };
}

export function getProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
}
