import { Router } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../../config";
import { currentUser, requireAuth } from "../../middleware/auth";
import { getProfile, login, loginSchema, register, registerSchema } from "./auth.service";

export const authRoutes = Router();

// Slows down password guessing. Disabled in tests, which log in many times from one address.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test",
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts, please try again later" } },
});

authRoutes.post("/register", authLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await register(input));
});

authRoutes.post("/login", authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  res.json(await login(input));
});

authRoutes.get("/me", requireAuth, async (req, res) => {
  res.json(await getProfile(currentUser(req).id));
});
