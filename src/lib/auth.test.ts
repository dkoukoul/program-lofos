import { describe, test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { leaders, magicLinks, sessions } from "../db/schema";
import { createMagicLink, createSession, checkRateLimit, hashToken, requireAuth, verifyMagicLink } from "./auth";

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
