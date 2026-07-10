import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { leaders } from "../db/schema";
import {
  checkRateLimit,
  clearSessionCookie,
  createMagicLink,
  createSession,
  destroySessionByToken,
  getSessionCookie,
  requireAuth,
  setSessionCookie,
  verifyMagicLink,
} from "../lib/auth";
import { sendMagicLinkEmail } from "../lib/notify";
import { LoginPage } from "../views/admin/login";

const requestLinkSchema = z.object({ email: z.string().trim().email() });

// Μόνο οι δημόσιες σελίδες που φιλοξενούν το login popup επιτρέπονται ως returnTo,
// ώστε να αποκλείεται open-redirect μέσω αυθαίρετου query param.
const ALLOWED_RETURN_PATHS = new Set(["/", "/agele", "/omada", "/koinotita"]);

function sanitizeReturnTo(value: unknown): string {
  return typeof value === "string" && ALLOWED_RETURN_PATHS.has(value) ? value : "/";
}

const auth = new Hono();

auth.get("/login", (c) => {
  const returnTo = sanitizeReturnTo(c.req.query("returnTo"));
  return c.html(<LoginPage returnTo={returnTo} />);
});

auth.post("/request-link", async (c) => {
  const body = await c.req.parseBody();
  const returnTo = sanitizeReturnTo(body.returnTo);
  const parsed = requestLinkSchema.safeParse(body);

  if (!parsed.success) {
    return c.redirect(`${returnTo}?loginStatus=error&loginError=${encodeURIComponent("Δώσε ένα έγκυρο email.")}`);
  }

  const email = parsed.data.email.toLowerCase();

  if (!checkRateLimit(email)) {
    return c.redirect(
      `${returnTo}?loginStatus=error&loginError=${encodeURIComponent("Πολλά αιτήματα. Δοκίμασε ξανά σε λίγο.")}`,
    );
  }

  const [leader] = await db.select().from(leaders).where(eq(leaders.email, email)).limit(1);

  if (leader) {
    const rawToken = await createMagicLink(leader.id);
    const verifyUrl = `${process.env.BASE_URL ?? ""}/auth/verify?token=${rawToken}`;
    await sendMagicLinkEmail(leader.email, verifyUrl);
  }

  return c.redirect(`${returnTo}?loginStatus=sent`);
});

auth.get("/verify", async (c) => {
  const token = c.req.query("token");
  const leader = token ? await verifyMagicLink(token) : null;

  if (!leader) {
    return c.html(<LoginPage error="Ο σύνδεσμος έληξε ή έχει ήδη χρησιμοποιηθεί." />, 400);
  }

  const sessionToken = await createSession(leader.id, c.req.header("user-agent") ?? null);
  setSessionCookie(c, sessionToken);
  return c.redirect("/admin");
});

auth.post("/logout", requireAuth, async (c) => {
  const rawToken = getSessionCookie(c);
  if (rawToken) await destroySessionByToken(rawToken);
  clearSessionCookie(c);
  return c.redirect("/auth/login");
});

export default auth;
