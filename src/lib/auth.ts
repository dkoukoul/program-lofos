import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq, and, isNull, ne } from "drizzle-orm";
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

export type AuthMethod = "magic_link" | "password";

export async function createSession(
  leaderId: number,
  userAgent: string | null,
  authMethod: AuthMethod = "magic_link",
): Promise<string> {
  const rawToken = generateToken();
  const now = new Date();
  await db.insert(sessions).values({
    leaderId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    userAgent,
    authMethod,
  });
  return rawToken;
}

async function findSessionByToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const [leader] = await db.select().from(leaders).where(eq(leaders.id, session.leaderId)).limit(1);
  if (!leader?.active) return null;
  return { session, leader };
}

async function findLeaderBySessionToken(rawToken: string): Promise<Leader | null> {
  return (await findSessionByToken(rawToken))?.leader ?? null;
}

// ---- Κωδικός (προαιρετικός, δίπλα στο magic link — §5 architecture doc) ----

export const PASSWORD_MIN_LENGTH = 10;
// Άνω όριο ώστε ένα τεράστιο input να μη γίνει φτηνό DoS πάνω στο (σκόπιμα αργό) argon2id.
export const PASSWORD_MAX_LENGTH = 128;

// Hash ενός τυχαίου κωδικού, για "dummy" verify όταν ο χρήστης δεν υπάρχει ή δεν έχει κωδικό —
// ο χρόνος απόκρισης δεν πρέπει να αποκαλύπτει ποια emails υπάρχουν / έχουν κωδικό.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= Bun.password.hash(generateToken(), "argon2id");
  return dummyHashPromise;
}

export async function setLeaderPassword(leaderId: number, password: string): Promise<void> {
  const passwordHash = await Bun.password.hash(password, "argon2id");
  await db.update(leaders).set({ passwordHash }).where(eq(leaders.id, leaderId));
}

/** Επιστρέφει τον ενεργό βαθμοφόρο αν email+κωδικός ταιριάζουν, αλλιώς null (ίδια απάντηση για κάθε αποτυχία). */
export async function verifyPasswordLogin(email: string, password: string): Promise<Leader | null> {
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return null;

  const [leader] = await db.select().from(leaders).where(eq(leaders.email, email)).limit(1);
  const hash = leader?.active && leader.passwordHash ? leader.passwordHash : null;

  if (!hash) {
    await Bun.password.verify(password, await dummyHash());
    return null;
  }

  return (await Bun.password.verify(password, hash)) ? leader! : null;
}

export async function verifyLeaderPassword(leader: Leader, password: string): Promise<boolean> {
  if (!leader.passwordHash || password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return false;
  return Bun.password.verify(password, leader.passwordHash);
}

/** Μετά από αλλαγή κωδικού: ανακαλεί όλα τα άλλα sessions του βαθμοφόρου, κρατά μόνο το τρέχον. */
export async function destroyOtherSessions(leaderId: number, currentRawToken: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.leaderId, leaderId), ne(sessions.tokenHash, hashToken(currentRawToken))));
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
    authMethod: AuthMethod;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const rawToken = getSessionCookie(c);
  const found = rawToken ? await findSessionByToken(rawToken) : null;

  if (!found) {
    clearSessionCookie(c);
    return c.redirect("/auth/login");
  }

  c.set("leader", found.leader);
  c.set("authMethod", found.session.authMethod);
  await next();
}

/** Επιστρέφει τον συνδεδεμένο βαθμοφόρο αν υπάρχει έγκυρο session, αλλιώς null — χωρίς redirect. Για δημόσιες σελίδες που απλώς προσαρμόζουν το header. */
export async function getOptionalLeader(c: Context): Promise<Leader | null> {
  const rawToken = getSessionCookie(c);
  return rawToken ? findLeaderBySessionToken(rawToken) : null;
}

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

/**
 * In-memory fixed-window rate limit. Default: 5 αιτήματα/ώρα (magic-link requests, §5).
 * Οι προσπάθειες σύνδεσης με κωδικό χρησιμοποιούν δικό τους key prefix και όρια.
 */
export function checkRateLimit(
  key: string,
  { max = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_MS }: { max?: number; windowMs?: number } = {},
): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= max) return false;

  bucket.count += 1;
  return true;
}
