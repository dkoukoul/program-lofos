import { describe, test, expect, beforeAll, spyOn } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import {
  activities,
  activityCustomFields,
  activityParticipants,
  leaders,
  programs,
  sections,
  systemNotes,
  type Leader,
} from "../db/schema";
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
    fullUniform: "on",
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

  test("GET /programs/new δεν παγιδεύεται από το requireProgramAccess (route-ordering regression)", async () => {
    const leader = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/new`, { headers: { cookie } });
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

describe("Οδηγός χρήσης (/admin/help)", () => {
  test("απαιτεί σύνδεση", async () => {
    const res = await app.request("/admin/help");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  test("συνδεδεμένος βαθμοφόρος βλέπει τον οδηγό", async () => {
    const leader = await makeLeader();
    const cookie = await cookieFor(leader);

    const res = await app.request("/admin/help", { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Οδηγός χρήσης");
  });
});

describe("Διαγραφή προγράμματος", () => {
  test("section_leader διαγράφει το πρόγραμμα του και τις δράσεις του", async () => {
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
    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));

    const deleteRes = await app.request(`/admin/programs/${program.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(302);
    expect(deleteRes.headers.get("location")).toBe("/admin/programs");

    const remainingPrograms = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(remainingPrograms.length).toBe(0);
    const remainingActivities = await db.select().from(activities).where(eq(activities.id, created!.id));
    expect(remainingActivities.length).toBe(0);
  });

  test("section_leader δεν μπορεί να διαγράψει πρόγραμμα άλλου τμήματος", async () => {
    const sectionA = await makeSection("agele");
    const sectionB = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: sectionA.id });
    const otherProgram = await makeProgram(sectionB.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${otherProgram.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(403);

    const stillThere = await db.select().from(programs).where(eq(programs.id, otherProgram.id));
    expect(stillThere.length).toBe(1);
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
    expect(created?.fullUniform).toBe(true);

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
    expect(created?.locationLat).toBeNull();
    expect(created?.locationLng).toBeNull();
    expect(created?.startsAt).toBeNull();
    expect(created?.whatToBring).toBeNull();
    expect(created?.fullUniform).toBe(false);
  });

  test("«Πλήρης προσκοπική στολή»: ξε-τσεκαρισμένο αποθηκεύεται false, τσεκαρισμένο εμφανίζεται δημόσια πάνω από το «Τι να φέρετε»", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const body = activityFormBody();
    body.delete("fullUniform");
    await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.fullUniform).toBe(false);

    const editPage = await (
      await app.request(`/admin/programs/${program.id}/activities/${created!.id}/edit`, { headers: { cookie } })
    ).text();
    expect(editPage).toContain('name="fullUniform"');
    expect(editPage).not.toMatch(/name="fullUniform"[^>]*checked/);

    let preview = await (await app.request(`/admin/preview/${section.type}?program=${program.id}`, { headers: { cookie } })).text();
    expect(preview).not.toContain("Πλήρης προσκοπική στολή");

    await app.request(`/admin/programs/${program.id}/activities/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody(),
    });
    preview = await (await app.request(`/admin/preview/${section.type}?program=${program.id}`, { headers: { cookie } })).text();
    const uniformAt = preview.indexOf("Πλήρης προσκοπική στολή");
    expect(uniformAt).toBeGreaterThan(-1);
    expect(uniformAt).toBeLessThan(preview.indexOf("Τι να φέρετε"));
  });

  test("νέα δράση: «Πλήρης προσκοπική στολή» προεπιλεγμένο, και η αλλαγή τύπου σέβεται το ξε-τσεκάρισμα", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);
    const fieldsUrl = `/admin/programs/${program.id}/activities/fields?date=2026-07-05`;

    const fresh = await (await app.request(`${fieldsUrl}&type=other`, { headers: { cookie } })).text();
    expect(fresh).toMatch(/name="fullUniform"[^>]*checked/);

    const unchecked = await (
      await app.request(`${fieldsUrl}&type=day_trip&fullUniformShown=1`, { headers: { cookie } })
    ).text();
    expect(unchecked).toContain('name="fullUniform"');
    expect(unchecked).not.toMatch(/name="fullUniform"[^>]*checked/);
  });

  test("«Δεν έχει οριστεί ώρα»: αγνοεί τις ώρες της φόρμας και η επεξεργασία το δείχνει τσεκαρισμένο", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    // Οι ρόδες ώρας κρατάνε ακόμα τα defaults της Τυπικής (κρυμμένες) — το checkbox υπερισχύει.
    await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ date: "2026-07-19", timeTbd: "on" }),
    });
    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.startsAt).toBeNull();
    expect(created?.endsAt).toBeNull();

    const editPage = await app.request(`/admin/programs/${program.id}/activities/${created!.id}/edit`, {
      headers: { cookie },
    });
    expect(await editPage.text()).toMatch(/name="timeTbd"[^>]*checked/);

    const listPage = await app.request(`/admin/programs/${program.id}`, { headers: { cookie } });
    expect(await listPage.text()).toContain("Δεν έχει οριστεί ώρα ακόμα");
  });

  test("νέα δράση χωρίς default ώρες δεν έχει προεπιλεγμένο το «Δεν έχει οριστεί ώρα»", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${program.id}/activities/fields?type=day_trip&date=2026-07-05`, {
      headers: { cookie },
    });
    const html = await res.text();
    expect(html).toContain('name="timeTbd"');
    expect(html).not.toMatch(/name="timeTbd"[^>]*checked/);
  });

  test("αλλαγή τύπου με τσεκαρισμένο «Δεν έχει οριστεί ώρα» δεν ξαναγεμίζει τις default ώρες", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const res = await app.request(
      `/admin/programs/${program.id}/activities/fields?type=typical&date=2026-07-05&timeTbd=on&startTime=&endTime=`,
      { headers: { cookie } },
    );
    const html = await res.text();
    expect(html).toMatch(/name="timeTbd"[^>]*checked/);
    expect(html).not.toContain('value="11:00"');
  });

  test("αποθηκεύει προαιρετικές συντεταγμένες τοποθεσίας και τις εμφανίζει ως link Google Maps", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const createRes = await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ locationLat: "35.3387", locationLng: "25.1442" }),
    });
    expect(createRes.status).toBe(302);

    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.locationLat).toBeCloseTo(35.3387);
    expect(created?.locationLng).toBeCloseTo(25.1442);

    const editPage = await app.request(`/admin/programs/${program.id}/activities/${created!.id}/edit`, {
      headers: { cookie },
    });
    const html = await editPage.text();
    expect(html).toContain("google.com/maps/search");
    expect(html).toContain("35.3387");
  });

  test("απορρίπτει μερικές (μόνο lat, χωρίς lng) ή εκτός εύρους συντεταγμένες", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const partialRes = await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ locationLat: "35.3387", location: "Πλατεία Ελευθερίας" }),
    });
    expect(partialRes.status).toBe(400);
    // Ξαναδείχνει τη φόρμα με ό,τι είχε γραφτεί, όχι λευκή σελίδα με raw error text.
    expect(partialRes.headers.get("content-type")).toContain("text/html");
    const partialHtml = await partialRes.text();
    expect(partialHtml).toContain("Νέα δράση");
    expect(partialHtml).toContain('value="Πλατεία Ελευθερίας"');
    expect(partialHtml).toContain("Χρειάζονται και οι δύο συντεταγμένες τοποθεσίας");

    const outOfRangeRes = await app.request(`/admin/programs/${program.id}/activities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: activityFormBody({ locationLat: "999", locationLng: "25.1442" }),
    });
    expect(outOfRangeRes.status).toBe(400);
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
    expect(created?.fullUniform).toBe(true);
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

  test("quick-typical χωρίς διαθέσιμη Κυριακή: redirect με error param που εμφανίζεται σαν μήνυμα στη σελίδα προγράμματος", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    // Περίοδος χωρίς καμία Κυριακή μέσα, ώστε nextAvailableSundays να μην επιστρέψει τίποτα.
    const [program] = await db
      .insert(programs)
      .values({
        sectionId: section.id,
        periodStart: new Date(2026, 6, 6),
        periodEnd: new Date(2026, 6, 6),
        status: "draft",
        createdAt: new Date(),
      })
      .returning();
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${program!.id}/activities/quick-typical`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/admin/programs/${program!.id}?error=no-available-sunday`);

    const page = await app.request(res.headers.get("location")!, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Δεν υπάρχει άλλη διαθέσιμη Κυριακή σε αυτή την περίοδο");
  });

  test("αλλαγή τύπου δράσης διατηρεί ήδη γραμμένα πεδία, γεμίζει defaults μόνο στα κενά", async () => {
    const section = await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);

    const params = new URLSearchParams({
      type: "other",
      date: "2026-07-05",
      location: "Πλατεία",
      locationLat: "",
      locationLng: "",
      startTime: "10:00",
      endTime: "",
      cost: "",
      whatToBring: "παγούρι",
    });

    const res = await app.request(`/admin/programs/${program.id}/activities/fields?${params.toString()}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Το ήδη γραμμένο κείμενο δεν σβήνεται από τα defaults του νέου τύπου.
    expect(html).toContain('value="Πλατεία"');
    expect(html).toContain('value="10:00"');
    expect(html).toContain('value="παγούρι"');
    // Κενό πεδίο (endTime) γεμίζει με ό,τι default έχει ο νέος τύπος (κανένα για "other").
    expect(html).toContain('value=""');
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

describe("Όλες οι δράσεις (/admin/activities)", () => {
  test("section_leader βλέπει μόνο δράσεις του δικού του τμήματος", async () => {
    const sectionA = await makeSection("agele");
    const sectionB = await makeSection("omada");
    const programA = await makeProgram(sectionA.id);
    const programB = await makeProgram(sectionB.id);
    const systemProgram = await makeProgram(null);

    await db.insert(activities).values([
      {
        programId: programA.id,
        type: "typical",
        date: new Date(2026, 6, 5),
        location: "ΜΟΝΟ-ΑΓΕΛΗ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: programB.id,
        type: "typical",
        date: new Date(2026, 6, 6),
        location: "ΜΟΝΟ-ΟΜΑΔΑ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: systemProgram.id,
        isSystemWide: true,
        type: "typical",
        date: new Date(2026, 6, 7),
        location: "ΜΟΝΟ-ΣΥΣΤΗΜΑ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const leader = await makeLeader({ role: "section_leader", sectionId: sectionA.id });
    const cookie = await cookieFor(leader);

    const res = await app.request("/admin/activities", { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ΜΟΝΟ-ΑΓΕΛΗ");
    expect(html).not.toContain("ΜΟΝΟ-ΟΜΑΔΑ");
    expect(html).not.toContain("ΜΟΝΟ-ΣΥΣΤΗΜΑ");
    // section_leader δεν έχει επιλογή φίλτρου τμήματος (είναι ήδη περιορισμένος).
    expect(html).not.toContain('name="section"');
  });

  test("system_staff βλέπει δράσεις όλων των τμημάτων και του συστήματος, με φίλτρο τμήματος", async () => {
    const sectionA = await makeSection("agele");
    const sectionC = await makeSection("koinotita");
    const programA = await makeProgram(sectionA.id);
    const programC = await makeProgram(sectionC.id);

    await db.insert(activities).values([
      {
        programId: programA.id,
        type: "typical",
        date: new Date(2026, 6, 10),
        location: "STAFF-ΑΓΕΛΗ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: programC.id,
        type: "typical",
        date: new Date(2026, 6, 11),
        location: "STAFF-ΚΟΙΝΟΤΗΤΑ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);

    const all = await app.request("/admin/activities", { headers: { cookie } });
    const allHtml = await all.text();
    expect(allHtml).toContain("STAFF-ΑΓΕΛΗ");
    expect(allHtml).toContain("STAFF-ΚΟΙΝΟΤΗΤΑ");

    const filtered = await app.request(`/admin/activities?section=${sectionA.type}`, { headers: { cookie } });
    const filteredHtml = await filtered.text();
    expect(filteredHtml).toContain("STAFF-ΑΓΕΛΗ");
    expect(filteredHtml).not.toContain("STAFF-ΚΟΙΝΟΤΗΤΑ");
  });

  test("ταξινόμηση κατά ημερομηνία σέβεται dir=desc", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);

    await db.insert(activities).values([
      {
        programId: program.id,
        type: "typical",
        date: new Date(2026, 6, 1),
        location: "SORT-ΠΡΩΤΗ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: program.id,
        type: "typical",
        date: new Date(2026, 6, 28),
        location: "SORT-ΤΕΛΕΥΤΑΙΑ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);

    const res = await app.request("/admin/activities?sort=date&dir=desc", { headers: { cookie } });
    const html = await res.text();
    const laterIdx = html.indexOf("SORT-ΤΕΛΕΥΤΑΙΑ");
    const earlierIdx = html.indexOf("SORT-ΠΡΩΤΗ");
    expect(laterIdx).toBeGreaterThan(-1);
    expect(earlierIdx).toBeGreaterThan(-1);
    expect(laterIdx).toBeLessThan(earlierIdx);
  });

  test("φίλτρο τύπου και κατάστασης περιορίζει τις γραμμές", async () => {
    const section = await makeSection("agele");
    const draftProgram = await makeProgram(section.id);
    const publishedProgram = await makeProgram(section.id, { status: "published" });

    await db.insert(activities).values([
      {
        programId: draftProgram.id,
        type: "typical",
        date: new Date(2026, 6, 4),
        location: "FILTER-ΤΥΠΙΚΗ-ΠΡΟΧΕΙΡΟ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: publishedProgram.id,
        type: "day_trip",
        date: new Date(2026, 6, 11),
        location: "FILTER-ΗΜΕΡΗΣΙΑ-ΔΗΜΟΣΙΕΥΜΕΝΟ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);

    const byType = await app.request("/admin/activities?type=day_trip", { headers: { cookie } });
    const byTypeHtml = await byType.text();
    expect(byTypeHtml).toContain("FILTER-ΗΜΕΡΗΣΙΑ-ΔΗΜΟΣΙΕΥΜΕΝΟ");
    expect(byTypeHtml).not.toContain("FILTER-ΤΥΠΙΚΗ-ΠΡΟΧΕΙΡΟ");

    const byStatus = await app.request("/admin/activities?status=draft", { headers: { cookie } });
    const byStatusHtml = await byStatus.text();
    expect(byStatusHtml).toContain("FILTER-ΤΥΠΙΚΗ-ΠΡΟΧΕΙΡΟ");
    expect(byStatusHtml).not.toContain("FILTER-ΗΜΕΡΗΣΙΑ-ΔΗΜΟΣΙΕΥΜΕΝΟ");
  });

  test("κάθε γραμμή φέρει την κλάση χρώματος του τμήματός της", async () => {
    const sectionA = await makeSection("agele");
    const systemProgram = await makeProgram(null);
    const agelProgram = await makeProgram(sectionA.id);

    await db.insert(activities).values([
      {
        programId: agelProgram.id,
        type: "typical",
        date: new Date(2026, 6, 4),
        location: "ΧΡΩΜΑ-ΑΓΕΛΗ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: systemProgram.id,
        type: "other",
        date: new Date(2026, 6, 5),
        location: "ΧΡΩΜΑ-ΣΥΣΤΗΜΑ",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);

    const html = await (await app.request("/admin/activities", { headers: { cookie } })).text();
    expect(html).toContain("home-row home-row--agele");
    expect(html).toContain("home-row home-row--system");
  });

  test("χωρίς session -> redirect στο login", async () => {
    const res = await app.request("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });
});

describe("Γρήγορη επεξεργασία (quick-edit) από την αρχική", () => {
  async function makeActivity(programId: number, overrides: Partial<Record<string, unknown>> = {}) {
    const [activity] = await db
      .insert(activities)
      .values({
        programId,
        type: "typical",
        date: new Date(2026, 6, 5),
        location: "Λόφος",
        startsAt: new Date(2026, 6, 5, 11, 0),
        endsAt: new Date(2026, 6, 5, 13, 0),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      })
      .returning();
    return activity!;
  }

  test("GET quick-edit επιστρέφει inline φόρμα με τόπο/ώρα", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id);

    const res = await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="location"');
    expect(html).toContain('name="startTime"');
    expect(html).toContain("Λόφος");
  });

  test("POST quick-edit ενημερώνει τόπο/ώρα χωρίς να αλλάζει τύπο/ημερομηνία", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id);

    const res = await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Ζωολογικός Κήπος", startTime: "10:00", endTime: "12:30" }),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ζωολογικός Κήπος");

    const [updated] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(updated?.location).toBe("Ζωολογικός Κήπος");
    expect(updated?.startsAt?.getHours()).toBe(10);
    expect(updated?.endsAt?.getHours()).toBe(12);
    expect(updated?.type).toBe("typical");
    expect(updated?.date.getDate()).toBe(5);
  });

  test("POST quick-edit καθαρίζει τις συντεταγμένες αν αλλάξει το κείμενο τοποθεσίας", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id, { locationLat: 35.3387, locationLng: 25.1442 });

    await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Νέα τοποθεσία", startTime: "11:00", endTime: "13:00" }),
    });

    const [updated] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(updated?.locationLat).toBeNull();
    expect(updated?.locationLng).toBeNull();
  });

  test("POST quick-edit κρατάει τις συντεταγμένες αν το κείμενο τοποθεσίας μένει ίδιο", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id, { locationLat: 35.3387, locationLng: 25.1442 });

    await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Λόφος", startTime: "12:00", endTime: "13:00" }),
    });

    const [updated] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(updated?.locationLat).toBeCloseTo(35.3387);
    expect(updated?.locationLng).toBeCloseTo(25.1442);
  });

  test("POST quick-edit σε δημοσιευμένο πρόγραμμα μαρκάρει τα αλλαγμένα πεδία", async () => {
    const section = await makeSection("omada");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id);

    await db.update(programs).set({ status: "published", publishedAt: new Date() }).where(eq(programs.id, program.id));

    await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Νέος τόπος", startTime: "11:00", endTime: "13:00" }),
    });

    const [updated] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(updated?.changedAfterPublishFields).toEqual(["location"]);
  });

  test("δράση χωρίς-δράση (no_activity) δεν αλλάζει από quick-edit POST", async () => {
    const section = await makeSection("koinotita");
    const program = await makeProgram(section.id);
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeActivity(program.id, {
      type: "no_activity",
      location: null,
      startsAt: null,
      endsAt: null,
    });

    const res = await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Θα έπρεπε να αγνοηθεί" }),
    });
    expect(res.status).toBe(200);

    const [unchanged] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(unchanged?.location).toBeNull();
  });

  test("section_leader άλλου τμήματος μπλοκάρεται (403)", async () => {
    const sectionA = await makeSection("agele");
    const sectionB = await makeSection("omada");
    const programA = await makeProgram(sectionA.id);
    const activity = await makeActivity(programA.id);
    const otherLeader = await makeLeader({ role: "section_leader", sectionId: sectionB.id });
    const cookie = await cookieFor(otherLeader);

    const res = await app.request(`/admin/programs/${programA.id}/activities/${activity.id}/quick-edit`, {
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("Σημειώσεις Συστήματος", () => {
  function noteBody(overrides: Record<string, string> = {}): URLSearchParams {
    const params = new URLSearchParams({
      text: "Αγιασμός",
      dateStart: "2026-07-18",
      dateEnd: "2026-07-18",
    });
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return params;
  }

  test("create -> edit -> delete round-trip από το επιτελείο", async () => {
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(staff);

    const createRes = await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody(),
    });
    expect(createRes.status).toBe(302);

    const [created] = await db.select().from(systemNotes).where(eq(systemNotes.programId, systemProgram.id));
    expect(created?.text).toBe("Αγιασμός");
    expect(created?.dateStart).toEqual(new Date(2026, 6, 18));
    expect(created?.changedAfterPublish).toBe(false);

    const editForm = await app.request(`/admin/programs/${systemProgram.id}/notes/${created!.id}/edit`, {
      headers: { cookie },
    });
    expect(editForm.status).toBe(200);

    const editRes = await app.request(`/admin/programs/${systemProgram.id}/notes/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ text: "Αγιασμός στις 10:00", dateEnd: "2026-07-19" }),
    });
    expect(editRes.status).toBe(302);

    const [updated] = await db.select().from(systemNotes).where(eq(systemNotes.id, created!.id));
    expect(updated?.text).toBe("Αγιασμός στις 10:00");
    expect(updated?.dateEnd).toEqual(new Date(2026, 6, 19));
    // Το πρόγραμμα ήταν draft, άρα καμία σήμανση αλλαγής.
    expect(updated?.changedAfterPublish).toBe(false);

    const deleteRes = await app.request(`/admin/programs/${systemProgram.id}/notes/${created!.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(302);
    expect((await db.select().from(systemNotes).where(eq(systemNotes.id, created!.id))).length).toBe(0);
  });

  test("αλλαγή σε δημοσιευμένο πρόγραμμα Συστήματος σημειώνεται μόνιμα", async () => {
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const systemProgram = await makeProgram(null, { status: "published" });
    const cookie = await cookieFor(staff);

    await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody(),
    });
    const [created] = await db.select().from(systemNotes).where(eq(systemNotes.programId, systemProgram.id));
    expect(created?.changedAfterPublish).toBe(false);

    await app.request(`/admin/programs/${systemProgram.id}/notes/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ text: "Αγιασμός — άλλαξε η ώρα" }),
    });
    const [changed] = await db.select().from(systemNotes).where(eq(systemNotes.id, created!.id));
    expect(changed?.changedAfterPublish).toBe(true);

    // Αποθήκευση χωρίς καμία αλλαγή δεν ξεσημαίνει ό,τι είχε ήδη σημειωθεί.
    await app.request(`/admin/programs/${systemProgram.id}/notes/${created!.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ text: "Αγιασμός — άλλαξε η ώρα" }),
    });
    const [stillChanged] = await db.select().from(systemNotes).where(eq(systemNotes.id, created!.id));
    expect(stillChanged?.changedAfterPublish).toBe(true);
  });

  test("το επιτελείο δεν μπορεί να βάλει σημείωση σε πρόγραμμα τμήματος (403)", async () => {
    const section = await makeSection("agele");
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const sectionProgram = await makeProgram(section.id);
    const cookie = await cookieFor(staff);

    const res = await app.request(`/admin/programs/${sectionProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody(),
    });
    expect(res.status).toBe(403);
    expect((await db.select().from(systemNotes).where(eq(systemNotes.programId, sectionProgram.id))).length).toBe(0);
  });

  test("section_leader μπλοκάρεται στο πρόγραμμα Συστήματος (403)", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody(),
    });
    expect(res.status).toBe(403);
  });

  test("ανάποδο εύρος ημερομηνιών απορρίπτεται (400)", async () => {
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(staff);

    const res = await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ dateStart: "2026-07-20", dateEnd: "2026-07-18" }),
    });
    expect(res.status).toBe(400);
    expect((await db.select().from(systemNotes).where(eq(systemNotes.programId, systemProgram.id))).length).toBe(0);
  });

  test("κενό κείμενο απορρίπτεται (400)", async () => {
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(staff);

    const res = await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ text: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("η διαγραφή προγράμματος Συστήματος παίρνει μαζί και τις σημειώσεις του", async () => {
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const systemProgram = await makeProgram(null);
    const cookie = await cookieFor(staff);

    await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody(),
    });
    expect((await db.select().from(systemNotes).where(eq(systemNotes.programId, systemProgram.id))).length).toBe(1);

    const res = await app.request(`/admin/programs/${systemProgram.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(302);
    expect((await db.select().from(systemNotes).where(eq(systemNotes.programId, systemProgram.id))).length).toBe(0);
  });

  test("η σημείωση φαίνεται μέσα στην κάρτα δράσης τμήματος στο διαχειριστικό", async () => {
    const section = await makeSection("koinotita");
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);

    const systemProgram = await makeProgram(null);
    await app.request(`/admin/programs/${systemProgram.id}/notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: noteBody({ text: "Αγιασμός στον Άγιο Μηνά" }),
    });

    const sectionProgram = await makeProgram(section.id);
    await db.insert(activities).values({
      programId: sectionProgram.id,
      type: "typical",
      date: new Date(2026, 6, 18),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.request(`/admin/programs/${sectionProgram.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Αγιασμός στον Άγιο Μηνά");
  });
});

describe("Ετικέτες αλλαγής: απόκρυψη/επαναφορά (μόνο επιτελείο)", () => {
  async function makeChangedActivity(programId: number, changedFields: string[] = ["location"]) {
    const [activity] = await db
      .insert(activities)
      .values({
        programId,
        type: "typical",
        date: new Date(2026, 6, 5),
        location: "Λόφος",
        startsAt: new Date(2026, 6, 5, 11, 0),
        endsAt: new Date(2026, 6, 5, 13, 0),
        changedAfterPublishFields: changedFields,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return activity!;
  }

  function toggleUrl(programId: number, activityId: number, group: string) {
    return `/admin/programs/${programId}/activities/${activityId}/changes/${group}/toggle`;
  }

  test("system_staff κρύβει μια ετικέτα και την επαναφέρει με δεύτερο toggle", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id, { status: "published" });
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);
    const activity = await makeChangedActivity(program.id, ["location", "locationLat", "cost"]);

    const hide = await app.request(toggleUrl(program.id, activity.id, "location"), { method: "POST", headers: { cookie } });
    expect(hide.status).toBe(200);
    const [hidden] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(hidden?.hiddenChangeGroups).toEqual(["location"]);

    const restore = await app.request(toggleUrl(program.id, activity.id, "location"), { method: "POST", headers: { cookie } });
    expect(restore.status).toBe(200);
    const [restored] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(restored?.hiddenChangeGroups).toEqual([]);
  });

  test("section_leader δεν μπορεί να κρύψει ετικέτα (403) ούτε στο δικό του πρόγραμμα", async () => {
    const section = await makeSection("omada");
    const program = await makeProgram(section.id, { status: "published" });
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const activity = await makeChangedActivity(program.id);

    const res = await app.request(toggleUrl(program.id, activity.id, "location"), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);

    const [unchanged] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(unchanged?.hiddenChangeGroups).toBeNull();
  });

  test("ομάδα που δεν αντιστοιχεί σε καταγεγραμμένη αλλαγή -> 404", async () => {
    const section = await makeSection("koinotita");
    const program = await makeProgram(section.id, { status: "published" });
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);
    const activity = await makeChangedActivity(program.id, ["location"]);

    const res = await app.request(toggleUrl(program.id, activity.id, "cost"), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(404);

    const [unchanged] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(unchanged?.hiddenChangeGroups).toBeNull();
  });

  test("νέα αλλαγή στο ίδιο πεδίο επαναφέρει την κρυμμένη ετικέτα", async () => {
    const section = await makeSection("agele");
    const program = await makeProgram(section.id, { status: "published" });
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const cookie = await cookieFor(staff);
    const activity = await makeChangedActivity(program.id, ["location"]);

    await app.request(toggleUrl(program.id, activity.id, "location"), { method: "POST", headers: { cookie } });

    await app.request(`/admin/programs/${program.id}/activities/${activity.id}/quick-edit`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ location: "Πλατεία Ελευθερίας", startTime: "11:00", endTime: "13:00" }),
    });

    const [updated] = await db.select().from(activities).where(eq(activities.id, activity.id));
    expect(updated?.hiddenChangeGroups).toEqual([]);
  });

  test("η οθόνη προγράμματος δείχνει κουμπιά toggle στο επιτελείο, απλές ενδείξεις στον βαθμοφόρο", async () => {
    const section = await makeSection("omada");
    const program = await makeProgram(section.id, { status: "published" });
    const staff = await makeLeader({ role: "system_staff", sectionId: null });
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const activity = await makeChangedActivity(program.id, ["location"]);

    const staffRes = await app.request(`/admin/programs/${program.id}`, { headers: { cookie: await cookieFor(staff) } });
    const staffHtml = await staffRes.text();
    expect(staffHtml).toContain("Άλλαξε η τοποθεσία");
    expect(staffHtml).toContain(toggleUrl(program.id, activity.id, "location"));

    const leaderRes = await app.request(`/admin/programs/${program.id}`, { headers: { cookie: await cookieFor(leader) } });
    const leaderHtml = await leaderRes.text();
    expect(leaderHtml).toContain("Άλλαξε η τοποθεσία");
    expect(leaderHtml).not.toContain(toggleUrl(program.id, activity.id, "location"));
  });
});

describe("Διαγραφή δράσης: ownership check", () => {
  test("δράση άλλου τμήματος μέσω δικού μου program id → 404 και δεν σβήνεται τίποτα της", async () => {
    const mySection = await makeSection("agele");
    const otherSection = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: mySection.id });
    const otherLeader = await makeLeader({ role: "section_leader", sectionId: otherSection.id });
    const myProgram = await makeProgram(mySection.id);
    const otherProgram = await makeProgram(otherSection.id);
    const cookie = await cookieFor(leader);

    const [foreign] = await db
      .insert(activities)
      .values({
        programId: otherProgram.id,
        type: "day_trip",
        date: new Date(2026, 6, 12),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    await db.insert(activityCustomFields).values({ activityId: foreign!.id, title: "Μονοήμερη", description: "" });
    await db.insert(activityParticipants).values({ activityId: foreign!.id, leaderId: otherLeader.id });

    const res = await app.request(`/admin/programs/${myProgram.id}/activities/${foreign!.id}/delete`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(404);

    expect((await db.select().from(activities).where(eq(activities.id, foreign!.id))).length).toBe(1);
    expect(
      (await db.select().from(activityCustomFields).where(eq(activityCustomFields.activityId, foreign!.id))).length,
    ).toBe(1);
    expect(
      (await db.select().from(activityParticipants).where(eq(activityParticipants.activityId, foreign!.id))).length,
    ).toBe(1);
  });
});

describe("Ίχνος αλλαγών δράσεων (audit log)", () => {
  function auditLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
    return spy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is string => typeof arg === "string" && arg.includes('"activity_change"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  test("create/update/delete γράφουν ποιος βαθμοφόρος, ποια δράση και τι άλλαξε", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgram(section.id);
    const cookie = await cookieFor(leader);
    const spy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await app.request(`/admin/programs/${program.id}/activities`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: activityFormBody({ date: "2026-07-12" }),
      });
      const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));

      await app.request(`/admin/programs/${program.id}/activities/${created!.id}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: activityFormBody({ date: "2026-07-12", type: "other", location: "Τείχη" }),
      });
      await app.request(`/admin/programs/${program.id}/activities/${created!.id}/delete`, {
        method: "POST",
        headers: { cookie },
      });

      const lines = auditLines(spy).filter((l) => l.activityId === created!.id);
      expect(lines.map((l) => l.action)).toEqual(["create", "update", "delete"]);
      for (const line of lines) {
        expect(line.leaderId).toBe(leader.id);
        expect(line.programId).toBe(program.id);
        expect(line.sectionId).toBe(section.id);
        expect(line.activityDate).toBe("2026-07-12");
      }
      expect(lines[1]!.changedFields).toEqual(["type", "location"]);
      expect(JSON.stringify(lines)).not.toContain(leader.email);
    } finally {
      spy.mockRestore();
    }
  });

  test("αποτυχημένη διαγραφή (ξένη δράση) δεν γράφει audit γραμμή", async () => {
    const mySection = await makeSection("agele");
    const otherSection = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: mySection.id });
    const myProgram = await makeProgram(mySection.id);
    const otherProgram = await makeProgram(otherSection.id);
    const cookie = await cookieFor(leader);
    const [foreign] = await db
      .insert(activities)
      .values({ programId: otherProgram.id, type: "typical", date: new Date(2026, 6, 19), createdAt: new Date(), updatedAt: new Date() })
      .returning();
    const spy = spyOn(console, "log").mockImplementation(() => {});

    try {
      await app.request(`/admin/programs/${myProgram.id}/activities/${foreign!.id}/delete`, {
        method: "POST",
        headers: { cookie },
      });
      expect(auditLines(spy).filter((l) => l.activityId === foreign!.id)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---- Επανασχεδιασμός διαχειριστικού: αρχική, λίστα, οθόνη προγράμματος, προεπισκόπηση ----

async function makeProgramFor(
  sectionId: number | null,
  periodStart: Date,
  periodEnd: Date,
  status: "draft" | "published" = "draft",
) {
  const [program] = await db
    .insert(programs)
    .values({ sectionId, periodStart, periodEnd, status, createdAt: new Date() })
    .returning();
  return program!;
}

async function makeActivity(programId: number, date: Date, overrides: Partial<typeof activities.$inferInsert> = {}) {
  const [activity] = await db
    .insert(activities)
    .values({ programId, type: "typical", date, createdAt: new Date(), updatedAt: new Date(), ...overrides })
    .returning();
  return activity!;
}

function currentMonth() {
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
}

describe("Αρχική διαχειριστικού (/admin) — κάρτες ανά τμήμα", () => {
  test("ο βαθμοφόρος βλέπει μόνο την κάρτα του τμήματός του, με το τρέχον πρόγραμμα και τις κενές Κυριακές", async () => {
    const section = await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const { start, end } = currentMonth();
    const program = await makeProgramFor(section.id, start, end);
    const cookie = await cookieFor(leader);

    const html = await (await app.request("/admin", { headers: { cookie } })).text();
    expect(html).toContain("scope-koinotita");
    expect(html).not.toContain("scope-agele");
    expect(html).not.toContain("scope-system");
    expect(html).toContain(`/admin/programs/${program.id}`);
    expect(html).toContain("Τώρα");
    expect(html).toContain(`/admin/preview/koinotita?program=${program.id}`);
  });

  test("το επιτελείο βλέπει Σύστημα + όλα τα τμήματα και πρόταση δημιουργίας για μήνα που λείπει", async () => {
    await makeSection("agele");
    await makeSection("omada");
    await makeSection("koinotita");
    const staff = await makeLeader({ role: "system_staff" });
    const cookie = await cookieFor(staff);

    const html = await (await app.request("/admin", { headers: { cookie } })).text();
    for (const kind of ["system", "agele", "omada", "koinotita"]) expect(html).toContain(`scope-${kind}`);
    expect(html).toContain("+ Δημιουργία");
    expect(html).toContain('action="/admin/programs"');
  });
});

describe("Λίστα προγραμμάτων & δημιουργία", () => {
  test("ο βαθμοφόρος δεν βλέπει προγράμματα άλλου τμήματος", async () => {
    const mine = await makeSection("agele");
    const other = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: mine.id });
    const foreign = await makeProgramFor(other.id, new Date(2027, 2, 1), new Date(2027, 2, 31));
    const cookie = await cookieFor(leader);

    const html = await (await app.request("/admin/programs", { headers: { cookie } })).text();
    expect(html).toContain("scope-agele");
    expect(html).not.toContain(`/admin/programs/${foreign.id}"`);
  });

  test("ίδιο τμήμα + ίδια περίοδος δεύτερη φορά (διπλό κλικ) ανοίγει το υπάρχον, δεν φτιάχνει διπλότυπο", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const cookie = await cookieFor(leader);
    const body = new URLSearchParams({ periodStart: "2027-05-01", periodEnd: "2027-05-31", sectionId: "" });

    const first = await app.request("/admin/programs", { method: "POST", headers: { cookie }, body });
    const second = await app.request("/admin/programs", { method: "POST", headers: { cookie }, body });
    expect(second.headers.get("location")).toBe(first.headers.get("location"));
  });

  test("η φόρμα νέου προγράμματος έχει chips μηνών", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const html = await (await app.request("/admin/programs/new", { headers: { cookie: await cookieFor(leader) } })).text();
    expect(html).toContain("data-month-start=");
  });
});

describe("Οθόνη προγράμματος: χρονολόγιο & κενές Κυριακές", () => {
  test("τίτλος με τμήμα/μήνα, κενές Κυριακές με συντομεύσεις, Δράση Συστήματος μόνο για ανάγνωση", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    // Φεβρουάριος 2027: Κυριακές 7, 14, 21, 28.
    const program = await makeProgramFor(section.id, new Date(2027, 1, 1), new Date(2027, 1, 28));
    await makeActivity(program.id, new Date(2027, 1, 7));
    const system = await makeProgramFor(null, new Date(2027, 1, 1), new Date(2027, 1, 28));
    await makeActivity(system.id, new Date(2027, 1, 14), { isSystemWide: true });
    const cookie = await cookieFor(leader);

    const html = await (await app.request(`/admin/programs/${program.id}`, { headers: { cookie } })).text();
    expect(html).toContain("Αγέλη · Φεβρουάριος 2027");
    expect(html).toContain('value="2027-02-21"');
    expect(html).toContain('value="2027-02-28"');
    expect(html).not.toContain('name="date" value="2027-02-07"');
    expect(html).not.toContain('name="date" value="2027-02-14"');
    expect(html).toContain("activity-card--readonly");
    expect(html).toContain("2/4 Κυριακές");
  });

  test("+ Τυπική σε συγκεκριμένη Κυριακή: δημιουργεί εκείνη τη μέρα και γυρίζει στη λίστα", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgramFor(section.id, new Date(2027, 1, 1), new Date(2027, 1, 28));
    const cookie = await cookieFor(leader);

    const res = await app.request(`/admin/programs/${program.id}/activities/quick-typical`, {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams({ date: "2027-02-21" }),
    });
    const [created] = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(created?.date).toEqual(new Date(2027, 1, 21));
    expect(res.headers.get("location")).toBe(`/admin/programs/${program.id}#activity-${created!.id}`);
  });

  test("συντόμευση σε μέρα που έχει ήδη δράση ή εκτός περιόδου → error, τίποτα δεν δημιουργείται", async () => {
    const section = await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgramFor(section.id, new Date(2027, 1, 1), new Date(2027, 1, 28));
    await makeActivity(program.id, new Date(2027, 1, 7));
    const cookie = await cookieFor(leader);
    const url = `/admin/programs/${program.id}/activities/quick-no-activity`;

    const taken = await app.request(url, { method: "POST", headers: { cookie }, body: new URLSearchParams({ date: "2027-02-07" }) });
    expect(taken.headers.get("location")).toContain("error=date-taken");
    const outside = await app.request(url, { method: "POST", headers: { cookie }, body: new URLSearchParams({ date: "2027-03-07" }) });
    expect(outside.headers.get("location")).toContain("error=date-outside-period");

    const rows = await db.select().from(activities).where(eq(activities.programId, program.id));
    expect(rows).toHaveLength(1);
  });

  test("«Άλλη…» ανοίγει τον οδηγό με προεπιλεγμένη την ημερομηνία της κενής θέσης", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgramFor(section.id, new Date(2027, 1, 1), new Date(2027, 1, 28));
    const html = await (
      await app.request(`/admin/programs/${program.id}/activities/new?date=2027-02-21`, {
        headers: { cookie: await cookieFor(leader) },
      })
    ).text();
    expect(html).toContain('value="2027-02-21"');
  });

  test("γρήγορη αλλαγή μέσα στην κάρτα (?view=card): φόρμα σε <li>, αποθήκευση επιστρέφει την κάρτα", async () => {
    const section = await makeSection("agele");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgramFor(section.id, new Date(2027, 1, 1), new Date(2027, 1, 28));
    const activity = await makeActivity(program.id, new Date(2027, 1, 7), { location: "Λόφος" });
    const cookie = await cookieFor(leader);
    const base = `/admin/programs/${program.id}/activities/${activity.id}/quick-edit?view=card`;

    const form = await (await app.request(base, { headers: { cookie } })).text();
    expect(form).toStartWith(`<li id="activity-${activity.id}"`);
    expect(form).toContain("activity-card--editing");

    const saved = await app.request(base, {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams({ location: "Παραλία", startTime: "10:00", endTime: "12:00" }),
    });
    const html = await saved.text();
    expect(html).toStartWith(`<li id="activity-${activity.id}"`);
    expect(html).toContain("Παραλία");
  });
});

describe("Προεπισκόπηση (/admin/preview/:τμήμα)", () => {
  test("απαιτεί σύνδεση", async () => {
    const res = await app.request("/admin/preview/agele");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  test("ο βαθμοφόρος βλέπει το πρόχειρο του τμήματός του, με banner και πρόχειρες Δράσεις Συστήματος", async () => {
    const section = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: section.id });
    const program = await makeProgramFor(section.id, new Date(2027, 3, 1), new Date(2027, 3, 30));
    await makeActivity(program.id, new Date(2027, 3, 4), { location: "Πρόχειρος-Τόπος-Ομάδας" });
    const system = await makeProgramFor(null, new Date(2027, 3, 1), new Date(2027, 3, 30));
    await makeActivity(system.id, new Date(2027, 3, 11), { location: "Πρόχειρη-Δράση-Συστήματος", isSystemWide: true });

    const res = await app.request(`/admin/preview/omada?program=${program.id}`, {
      headers: { cookie: await cookieFor(leader) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("preview-banner");
    expect(html).toContain("noindex");
    expect(html).toContain("Πρόχειρος-Τόπος-Ομάδας");
    expect(html).toContain("Πρόχειρη-Δράση-Συστήματος");
    expect(html).toContain(`/admin/programs/${program.id}/publish`);
  });

  test("ο βαθμοφόρος δεν βλέπει προεπισκόπηση άλλου τμήματος (403)", async () => {
    const mine = await makeSection("agele");
    await makeSection("koinotita");
    const leader = await makeLeader({ role: "section_leader", sectionId: mine.id });
    const res = await app.request("/admin/preview/koinotita", { headers: { cookie: await cookieFor(leader) } });
    expect(res.status).toBe(403);
  });

  test("ο βαθμοφόρος δεν μπορεί να περάσει ξένο πρόγραμμα στο ?program= (403)", async () => {
    const mine = await makeSection("agele");
    const other = await makeSection("omada");
    const leader = await makeLeader({ role: "section_leader", sectionId: mine.id });
    const foreign = await makeProgramFor(other.id, new Date(2027, 3, 1), new Date(2027, 3, 30));
    const system = await makeProgramFor(null, new Date(2027, 3, 1), new Date(2027, 3, 30));
    const cookie = await cookieFor(leader);

    expect((await app.request(`/admin/preview/agele?program=${foreign.id}`, { headers: { cookie } })).status).toBe(403);
    expect((await app.request(`/admin/preview/agele?program=${system.id}`, { headers: { cookie } })).status).toBe(403);
  });

  test("πρόγραμμα άλλου τμήματος από αυτό του URL → redirect στη σωστή προεπισκόπηση (επιτελείο)", async () => {
    await makeSection("agele");
    const omada = await makeSection("omada");
    const staff = await makeLeader({ role: "system_staff" });
    const program = await makeProgramFor(omada.id, new Date(2027, 3, 1), new Date(2027, 3, 30));
    const res = await app.request(`/admin/preview/agele?program=${program.id}`, {
      headers: { cookie: await cookieFor(staff) },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/admin/preview/omada?program=${program.id}`);
  });

  test("άγνωστο τμήμα → 404", async () => {
    const staff = await makeLeader({ role: "system_staff" });
    const res = await app.request("/admin/preview/xyz", { headers: { cookie: await cookieFor(staff) } });
    expect(res.status).toBe(404);
  });
});
