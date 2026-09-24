import { describe, test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { activities, leaders, programs, sections, systemNotes, type Leader } from "../db/schema";
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

describe("Αρχική διαχειριστικού (/admin)", () => {
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

    const res = await app.request("/admin", { headers: { cookie } });
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

    const all = await app.request("/admin", { headers: { cookie } });
    const allHtml = await all.text();
    expect(allHtml).toContain("STAFF-ΑΓΕΛΗ");
    expect(allHtml).toContain("STAFF-ΚΟΙΝΟΤΗΤΑ");

    const filtered = await app.request(`/admin?section=${sectionA.type}`, { headers: { cookie } });
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

    const res = await app.request("/admin?sort=date&dir=desc", { headers: { cookie } });
    const html = await res.text();
    const laterIdx = html.indexOf("SORT-ΤΕΛΕΥΤΑΙΑ");
    const earlierIdx = html.indexOf("SORT-ΠΡΩΤΗ");
    expect(laterIdx).toBeGreaterThan(-1);
    expect(earlierIdx).toBeGreaterThan(-1);
    expect(laterIdx).toBeLessThan(earlierIdx);
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
