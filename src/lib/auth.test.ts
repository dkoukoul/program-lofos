import { describe, test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { leaders, magicLinks, sessions } from "../db/schema";
import {
  PASSWORD_MAX_LENGTH,
  checkRateLimit,
  createMagicLink,
  createSession,
  destroyOtherSessions,
  hashToken,
  requireAuth,
  setLeaderPassword,
  verifyMagicLink,
  verifyPasswordLogin,
} from "./auth";

beforeAll(() => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

async function makeLeader(email: string) {
  const [leader] = await db
    .insert(leaders)
    .values({ name: "Test", email, role: "system_staff", sectionId: null, createdAt: new Date() })
    .returning();
  return leader!;
}

describe("magic links", () => {
  test("verifyMagicLink returns the leader for a valid token", async () => {
    const leader = await makeLeader(`valid-${crypto.randomUUID()}@example.com`);
    const token = await createMagicLink(leader.id);
    const result = await verifyMagicLink(token);
    expect(result?.id).toBe(leader.id);
  });

  test("verifyMagicLink rejects an already-used token (single-use)", async () => {
    const leader = await makeLeader(`used-${crypto.randomUUID()}@example.com`);
    const token = await createMagicLink(leader.id);
    await verifyMagicLink(token);
    const secondAttempt = await verifyMagicLink(token);
    expect(secondAttempt).toBeNull();
  });

  test("verifyMagicLink rejects an expired token", async () => {
    const leader = await makeLeader(`expired-${crypto.randomUUID()}@example.com`);
    const token = await createMagicLink(leader.id);
    await db
      .update(magicLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(magicLinks.tokenHash, hashToken(token)));

    const result = await verifyMagicLink(token);
    expect(result).toBeNull();
  });

  test("verifyMagicLink rejects an unknown token", async () => {
    const result = await verifyMagicLink("unknown-token");
    expect(result).toBeNull();
  });
});

describe("sessions", () => {
  test("createSession stores a hashed, non-expired session for the leader", async () => {
    const leader = await makeLeader(`session-${crypto.randomUUID()}@example.com`);
    const token = await createSession(leader.id, "test-agent");
    const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    expect(row?.leaderId).toBe(leader.id);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("requireAuth middleware", () => {
  test("redirects to /auth/login without a session cookie", async () => {
    const app = new Hono();
    app.get("/protected", requireAuth, (c) => c.text("ok"));

    const res = await app.request("/protected");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  test("allows access and exposes the leader with a valid session cookie", async () => {
    const leader = await makeLeader(`mw-${crypto.randomUUID()}@example.com`);
    const token = await createSession(leader.id, null);
    const app = new Hono();
    app.get("/protected", requireAuth, (c) => c.text(c.get("leader").email));

    const res = await app.request("/protected", { headers: { cookie: `session=${token}` } });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(leader.email);
  });
});

describe("rate limiter", () => {
  test("allows up to the configured limit, then blocks", () => {
    const key = `rate-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key)).toBe(true);
    }
    expect(checkRateLimit(key)).toBe(false);
  });
});

describe("κωδικός (password login)", () => {
  const PASSWORD = "σωστός-κωδικός-123";

  test("setLeaderPassword αποθηκεύει argon2id hash, ποτέ plaintext", async () => {
    const leader = await makeLeader(`pw-hash-${crypto.randomUUID()}@example.com`);
    await setLeaderPassword(leader.id, PASSWORD);
    const [row] = await db.select().from(leaders).where(eq(leaders.id, leader.id));
    expect(row?.passwordHash).toStartWith("$argon2id$");
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  test("verifyPasswordLogin επιστρέφει τον βαθμοφόρο με σωστό email+κωδικό", async () => {
    const email = `pw-ok-${crypto.randomUUID()}@example.com`;
    const leader = await makeLeader(email);
    await setLeaderPassword(leader.id, PASSWORD);
    expect((await verifyPasswordLogin(email, PASSWORD))?.id).toBe(leader.id);
  });

  test("verifyPasswordLogin απορρίπτει λάθος κωδικό", async () => {
    const email = `pw-wrong-${crypto.randomUUID()}@example.com`;
    const leader = await makeLeader(email);
    await setLeaderPassword(leader.id, PASSWORD);
    expect(await verifyPasswordLogin(email, "λάθος-κωδικός-123")).toBeNull();
  });

  test("verifyPasswordLogin απορρίπτει βαθμοφόρο χωρίς κωδικό (μόνο magic link)", async () => {
    const email = `pw-none-${crypto.randomUUID()}@example.com`;
    await makeLeader(email);
    expect(await verifyPasswordLogin(email, PASSWORD)).toBeNull();
  });

  test("verifyPasswordLogin απορρίπτει άγνωστο email", async () => {
    expect(await verifyPasswordLogin(`nobody-${crypto.randomUUID()}@example.com`, PASSWORD)).toBeNull();
  });

  test("verifyPasswordLogin απορρίπτει απενεργοποιημένο βαθμοφόρο ακόμα και με σωστό κωδικό", async () => {
    const email = `pw-inactive-${crypto.randomUUID()}@example.com`;
    const leader = await makeLeader(email);
    await setLeaderPassword(leader.id, PASSWORD);
    await db.update(leaders).set({ active: false }).where(eq(leaders.id, leader.id));
    expect(await verifyPasswordLogin(email, PASSWORD)).toBeNull();
  });

  test("verifyPasswordLogin απορρίπτει κενό ή υπερβολικά μεγάλο κωδικό", async () => {
    const email = `pw-len-${crypto.randomUUID()}@example.com`;
    const leader = await makeLeader(email);
    await setLeaderPassword(leader.id, PASSWORD);
    expect(await verifyPasswordLogin(email, "")).toBeNull();
    expect(await verifyPasswordLogin(email, "x".repeat(PASSWORD_MAX_LENGTH + 1))).toBeNull();
  });

  test("createSession καταγράφει τον τρόπο σύνδεσης (default magic_link)", async () => {
    const leader = await makeLeader(`pw-method-${crypto.randomUUID()}@example.com`);
    const linkToken = await createSession(leader.id, null);
    const pwToken = await createSession(leader.id, null, "password");
    const [linkRow] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(linkToken)));
    const [pwRow] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(pwToken)));
    expect(linkRow?.authMethod).toBe("magic_link");
    expect(pwRow?.authMethod).toBe("password");
  });

  test("destroyOtherSessions κρατά μόνο το τρέχον session του βαθμοφόρου", async () => {
    const leader = await makeLeader(`pw-others-${crypto.randomUUID()}@example.com`);
    const other = await makeLeader(`pw-others-b-${crypto.randomUUID()}@example.com`);
    const current = await createSession(leader.id, null);
    await createSession(leader.id, null);
    await createSession(leader.id, null);
    await createSession(other.id, null);

    await destroyOtherSessions(leader.id, current);

    const remaining = await db.select().from(sessions).where(eq(sessions.leaderId, leader.id));
    expect(remaining.map((row) => row.tokenHash)).toEqual([hashToken(current)]);
    const othersRemaining = await db.select().from(sessions).where(eq(sessions.leaderId, other.id));
    expect(othersRemaining.length).toBe(1);
  });

  test("checkRateLimit δέχεται δικά του όρια ανά key", () => {
    const key = `password:${crypto.randomUUID()}`;
    expect(checkRateLimit(key, { max: 2, windowMs: 60_000 })).toBe(true);
    expect(checkRateLimit(key, { max: 2, windowMs: 60_000 })).toBe(true);
    expect(checkRateLimit(key, { max: 2, windowMs: 60_000 })).toBe(false);
  });
});
