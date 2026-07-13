import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { leaders, magicLinks, sessions, type Leader } from "../db/schema";

const SESSION_COOKIE_NAME = "session";
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET δεν έχει οριστεί");
  return secret;
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(rawToken: string): string {
  const hasher = new Bun.CryptoHasher("sha256", sessionSecret());
  hasher.update(rawToken);
  return hasher.digest("hex");
}

export async function createMagicLink(leaderId: number): Promise<string> {
  const rawToken = generateToken();
  const now = new Date();
  await db.insert(magicLinks).values({
    leaderId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
    createdAt: now,
  });
  return rawToken;
}

export async function verifyMagicLink(rawToken: string): Promise<Leader | null> {
  const tokenHash = hashToken(rawToken);
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(and(eq(magicLinks.tokenHash, tokenHash), isNull(magicLinks.usedAt)))
    .limit(1);

  if (!link || link.expiresAt.getTime() < Date.now()) return null;

  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id));

  const [leader] = await db.select().from(leaders).where(eq(leaders.id, link.leaderId)).limit(1);
  if (!leader?.active) return null;
  return leader;
}

export async function createSession(leaderId: number, userAgent: string | null): Promise<string> {
  const rawToken = generateToken();
  const now = new Date();
  await db.insert(sessions).values({
    leaderId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    userAgent,
  });
  return rawToken;
}

async function findLeaderBySessionToken(rawToken: string): Promise<Leader | null> {
  const tokenHash = hashToken(rawToken);
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const [leader] = await db.select().from(leaders).where(eq(leaders.id, session.leaderId)).limit(1);
  if (!leader?.active) return null;
  return leader;
}

export async function destroySessionByToken(rawToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(rawToken)));
}

const isProduction = process.env.NODE_ENV === "production";

export function setSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

declare module "hono" {
  interface ContextVariableMap {
    leader: Leader;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const rawToken = getSessionCookie(c);
  const leader = rawToken ? await findLeaderBySessionToken(rawToken) : null;

  if (!leader) {
    clearSessionCookie(c);
    return c.redirect("/auth/login");
  }

  c.set("leader", leader);
  await next();
}

/** Επιστρέφει τον συνδεδεμένο βαθμοφόρο αν υπάρχει έγκυρο session, αλλιώς null — χωρίς redirect. Για δημόσιες σελίδες που απλώς προσαρμόζουν το header. */
export async function getOptionalLeader(c: Context): Promise<Leader | null> {
  const rawToken = getSessionCookie(c);
  return rawToken ? findLeaderBySessionToken(rawToken) : null;
}

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) return false;

  bucket.count += 1;
  return true;
}
