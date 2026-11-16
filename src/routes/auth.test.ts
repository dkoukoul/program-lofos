import { describe, test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { leaders, sessions } from "../db/schema";
import { hashToken, setLeaderPassword } from "../lib/auth";
import auth from "./auth";

beforeAll(() => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

const app = new Hono();
app.route("/auth", auth);

const PASSWORD = "σωστός-κωδικός-123";

async function makeLeaderWithPassword(password: string | null = PASSWORD) {
  const email = `route-pw-${crypto.randomUUID()}@example.com`;
  const [leader] = await db
    .insert(leaders)
    .values({ name: "Test", email, role: "system_staff", sectionId: null, createdAt: new Date() })
    .returning();
  if (password) await setLeaderPassword(leader!.id, password);
  return leader!;
}

function loginPassword(fields: Record<string, string>) {
  return app.request("/auth/login-password", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function sessionTokenFrom(res: Response): string | null {
  const match = /session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  return match ? match[1]! : null;
}

describe("POST /auth/login-password", () => {
  test("σωστός κωδικός → session με authMethod=password και redirect στο /admin", async () => {
    const leader = await makeLeaderWithPassword();
    const res = await loginPassword({ email: leader.email, password: PASSWORD, returnTo: "/" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
    const token = sessionTokenFrom(res);
    expect(token).not.toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token!)));
    expect(row?.leaderId).toBe(leader.id);
    expect(row?.authMethod).toBe("password");
  });

  test("το email δεν είναι case-sensitive", async () => {
    const leader = await makeLeaderWithPassword();
    const res = await loginPassword({ email: leader.email.toUpperCase(), password: PASSWORD });
    expect(res.headers.get("location")).toBe("/admin");
  });

  test("λάθος κωδικός → γενικό μήνυμα, χωρίς session cookie", async () => {
    const leader = await makeLeaderWithPassword();
    const res = await loginPassword({ email: leader.email, password: "λάθος-κωδικός-1", returnTo: "/omada" });

    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toStartWith("/omada?loginStatus=error");
    expect(decodeURIComponent(location)).toContain("Λάθος email ή κωδικός.");
    expect(sessionTokenFrom(res)).toBeNull();
  });

  test("άγνωστο email και χρήστης χωρίς κωδικό παίρνουν το ίδιο μήνυμα με τον λάθος κωδικό", async () => {
    const noPassword = await makeLeaderWithPassword(null);
    const unknown = await loginPassword({ email: `nobody-${crypto.randomUUID()}@example.com`, password: PASSWORD });
    const withoutPw = await loginPassword({ email: noPassword.email, password: PASSWORD });
    expect(unknown.headers.get("location")).toBe(withoutPw.headers.get("location"));
    expect(decodeURIComponent(unknown.headers.get("location")!)).toContain("Λάθος email ή κωδικός.");
  });

  test("κενός κωδικός → πέφτει στη ροή magic link (loginStatus=sent)", async () => {
    const res = await loginPassword({ email: `nobody-${crypto.randomUUID()}@example.com`, password: "", returnTo: "/" });
    expect(res.headers.get("location")).toBe("/?loginStatus=sent");
    expect(sessionTokenFrom(res)).toBeNull();
  });

  test("μη επιτρεπτό returnTo αγνοείται (κανένα open redirect)", async () => {
    const leader = await makeLeaderWithPassword();
    const res = await loginPassword({ email: leader.email, password: "λάθος", returnTo: "https://evil.example" });
    expect(res.headers.get("location")).toStartWith("/?loginStatus=error");
  });

  test("rate limit: μετά από 10 προσπάθειες ανά email μπλοκάρει ακόμα και τον σωστό κωδικό", async () => {
    const leader = await makeLeaderWithPassword();
    for (let i = 0; i < 10; i++) {
      await loginPassword({ email: leader.email, password: `λάθος-${i}` });
    }
    const res = await loginPassword({ email: leader.email, password: PASSWORD });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("Πολλές προσπάθειες");
    expect(sessionTokenFrom(res)).toBeNull();
  });
});
