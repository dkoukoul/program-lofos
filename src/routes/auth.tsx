import { Hono, type Context } from "hono";
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
  verifyPasswordLogin,
} from "../lib/auth";
import { sendMagicLinkEmail } from "../lib/notify";
import { LoginPage } from "../views/admin/login";

const requestLinkSchema = z.object({ email: z.string().trim().email() });
const passwordLoginSchema = z.object({ email: z.string().trim().email(), password: z.string() });

// Προσπάθειες σύνδεσης με κωδικό ανά email: αρκετά χαλαρό για τυπογραφικά λάθη, αρκετά σφιχτό
// ώστε να αποκλείει brute force (το magic link μένει διαθέσιμο αν κάποιος "κλειδωθεί").
const PASSWORD_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

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

function loginErrorRedirect(c: Context, returnTo: string, message: string) {
  return c.redirect(`${returnTo}?loginStatus=error&loginError=${encodeURIComponent(message)}`);
}

auth.post("/request-link", async (c) => {
  const body = await c.req.parseBody();
  return handleRequestLink(c, body);
});

async function handleRequestLink(c: Context, body: Record<string, unknown>) {
  const returnTo = sanitizeReturnTo(body.returnTo);
  const parsed = requestLinkSchema.safeParse(body);

  if (!parsed.success) {
    return loginErrorRedirect(c, returnTo, "Δώσε ένα έγκυρο email.");
  }

  const email = parsed.data.email.toLowerCase();

  if (!checkRateLimit(email)) {
    return loginErrorRedirect(c, returnTo, "Πολλά αιτήματα. Δοκίμασε ξανά σε λίγο.");
  }

  const [leader] = await db.select().from(leaders).where(eq(leaders.email, email)).limit(1);

  if (leader?.active) {
    const rawToken = await createMagicLink(leader.id);
    const verifyUrl = `${process.env.BASE_URL ?? ""}/auth/verify?token=${rawToken}`;
    await sendMagicLinkEmail(leader.email, verifyUrl);
  }

  return c.redirect(`${returnTo}?loginStatus=sent`);
}

auth.post("/login-password", async (c) => {
  const body = await c.req.parseBody();

  // Enter με κενό κωδικό (π.χ. χρήστης που δεν έχει ορίσει ποτέ κωδικό) → στέλνουμε magic link,
  // αντί για ένα μπερδεμένο "λάθος κωδικός".
  if (typeof body.password !== "string" || body.password.length === 0) {
    return handleRequestLink(c, body);
  }

  const returnTo = sanitizeReturnTo(body.returnTo);
  const parsed = passwordLoginSchema.safeParse(body);
  if (!parsed.success) return loginErrorRedirect(c, returnTo, "Δώσε ένα έγκυρο email.");

  const email = parsed.data.email.toLowerCase();
  if (!checkRateLimit(`password:${email}`, PASSWORD_RATE_LIMIT)) {
    return loginErrorRedirect(
      c,
      returnTo,
      "Πολλές προσπάθειες. Δοκίμασε ξανά σε λίγο ή ζήτησε σύνδεσμο στο email σου.",
    );
  }

  const leader = await verifyPasswordLogin(email, parsed.data.password);
  if (!leader) return loginErrorRedirect(c, returnTo, "Λάθος email ή κωδικός.");

  const sessionToken = await createSession(leader.id, c.req.header("user-agent") ?? null, "password");
  setSessionCookie(c, sessionToken);
  return c.redirect("/admin");
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
