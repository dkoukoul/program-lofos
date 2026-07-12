import { describe, test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { activities, leaders, programs, sections, type Leader } from "../db/schema";
import { createSession } from "../lib/auth";
import admin from "./admin";

beforeAll(() => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

const app = new Hono();
app.route("/admin", admin);

async function makeSection(type: "agele" | "omada" | "koinotita") {
  const [existing] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
  if (existing) return existing;
  const [section] = await db
    .insert(sections)
    .values({ type, name: type, icalPublicToken: crypto.randomUUID() })
    .returning();
  return section!;
}

async function makeLeader(overrides: Partial<Pick<Leader, "role" | "sectionId">> = {}): Promise<Leader> {
  const [leader] = await db
    .insert(leaders)
    .values({
      name: "Test Leader",
      email: `${crypto.randomUUID()}@example.com`,
      role: overrides.role ?? "section_leader",
      sectionId: overrides.sectionId ?? null,
      createdAt: new Date(),
    })
    .returning();
  return leader!;
}

async function cookieFor(leader: Leader): Promise<string> {
  const token = await createSession(leader.id, null);
  return `session=${token}`;
}

async function makeProgram(sectionId: number | null, overrides: Partial<{ status: "draft" | "published" }> = {}) {
  const [program] = await db
    .insert(programs)
    .values({
      sectionId,
      periodStart: new Date(2026, 6, 1),
      periodEnd: new Date(2026, 6, 31),
      status: overrides.status ?? "draft",
      createdAt: new Date(),
    })
    .returning();
  return program!;
}

function activityFormBody(overrides: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams({
    date: "2026-07-05",
    type: "typical",
    location: "Λόφος",
    startTime: "11:00",
    endTime: "13:00",
    cost: "",
    whatToBring: "παγούρι",
    customFieldTitle0: "",
    customFieldDescription0: "",
    customFieldTitle1: "",
    customFieldDescription1: "",
    customFieldTitle2: "",
    customFieldDescription2: "",
  });
  for (const [key, value] of Object.entries(overrides)) params.set(key, value);
  return params;
}

describe("Πρόσβαση σε πρόγραμμα (authorization)", () => {
  test("section_leader μπλοκάρεται σε πρόγραμμα άλλου τμήματος", async () => {
    const sectionA = await makeSection("agele");
    const sectionB = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: sectionA.id });
    const otherProgram = await makeProgram(sectionB.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${otherProgram.id}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  test("section_leader μπλοκάρεται στο system πρόγραμμα", async () => {
    const section = await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${systemProgram.id}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  test("system_staff έχει πρόσβαση σε οποιοδήποτε πρόγραμμα", async () => {
    const section = await makeSection("agele");
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(staff);

    const res = await app.request(`/admin/programs/${program.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  test("χωρίς session -> redirect στο login", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);
    const res = await app.request(`/admin/programs/${program.id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });
});

describe("Δημιουργία/επεξεργασία/διαγραφή δράσης", () => {
  test("create -> edit -> delete round-trip", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const createRes = await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody(),
    });
    expect(createRes.status).toBe(302);
    expect(createRes.headers.get("location")).toBe(`/admin/programs/${program.id}`);

    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.location).toBe("Λόφος");
    expect(created?.whatToBring).toBe("παγούρι");

    const editRes = await app.request(`/admin/programs/${program.id}/activities/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ location: "Πλατεία" }),
    });
    expect(editRes.status).toBe(302);

    const [updated] = await db.select().from(activities).where(eq(activities.id, created!.id));
    expect(updated?.location).toBe("Πλατεία");

    const deleteRes = await app.request(`/admin/programs/${program.id}/activities/${created!.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(302);

    const remaining = await db.select().from(activities).where(eq(activities.id, created!.id));
    expect(remaining.length).toBe(0);
  });

  test("no_activity: τα άλλα πεδία μένουν null", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-12", type: "no_activity" }),
    });

    const [created] = await db
      .select()
      .from(activities)
      .where(eq(activities.programId, program.id));
    expect(created?.type).toBe("no_activity");
    expect(created?.location).toBeNull();
    expect(created?.startsAt).toBeNull();
    expect(created?.whatToBring).toBeNull();
  });

  test("quick-typical δημιουργεί Τυπική στην επόμενη διαθέσιμη Κυριακή με τα defaults", async () => {
    const section = await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${program.id}/activities/quick-typical`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/activities\/\d+\/edit$/);

    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.type).toBe("typical");
    expect(created?.location).toBe("Λόφος");
    expect(created?.date.getDay()).toBe(0);
  });

  test("quick-no-activity μαρκάρει την επόμενη Κυριακή ως Χωρίς δράση", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${program.id}/activities/quick-no-activity`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(302);

    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.type).toBe("no_activity");
  });
});

describe("Επικάλυψη ίδιας ημέρας (ALLOW_ACTIVITY_OVERLAP)", () => {
  test("μπλοκάρεται default (χωρίς env var)", async () => {
    delete process.env.ALLOW_ACTIVITY_OVERLAP;
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-19" }),
    });

    const res = await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-19" }),
    });

    expect(res.status).toBe(422);
    const rows = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(rows.length).toBe(1);
  });

  test("επιτρέπεται με προειδοποίηση όταν ALLOW_ACTIVITY_OVERLAP=true", async () => {
    process.env.ALLOW_ACTIVITY_OVERLAP = "true";
    try {
      const section = await makeSection("omada");
      const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
      const program = await makeProgram(section.id);
      const cookie = await cookieFor(leader);

      await app.request(`/admin/programs/${program.id}/activities`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: activityFormBody({ date: "2026-07-19" }),
      });

      const res = await app.request(`/admin/programs/${program.id}/activities`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: activityFormBody({ date: "2026-07-19" }),
      });

      expect(res.status).toBe(302);
      const rows = await db.select().from(activities).where(eq(activities.programId, program.id));
      expect(rows.length).toBe(2);
    } finally {
      delete process.env.ALLOW_ACTIVITY_OVERLAP;
    }
  });
});

describe("Αλλαγές μετά τη δημοσίευση", () => {
  test("επεξεργασία δημοσιευμένης δράσης μαρκάρει τα αλλαγμένα πεδία", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-26" }),
    });
    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));

    await db.update(programs).set({ status: "published", publishedAt: new Date() }).where(eq(programs.id, program.id));

    await app.request(`/admin/programs/${program.id}/activities/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-26", location: "Νέος τόπος" }),
    });

    const [updated] = await db.select().from(activities).where(eq(activities.id, created!.id));
    expect(updated?.changedAfterPublishFields).toEqual(["location"]);
  });
});
