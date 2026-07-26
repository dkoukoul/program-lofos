import { describe, test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../db/client";
import { activities, programs, sections } from "../db/schema";
import { getPublishedSectionActivities, mergeAndSortActivities, selectActiveProgram, selectFeaturedActivity } from "./schedule";

const DAY_MS = 24 * 60 * 60 * 1000;

function program(overrides: Partial<{ periodStart: Date; periodEnd: Date; status: "draft" | "published" }>) {
  return {
    periodStart: new Date(0),
    periodEnd: new Date(0),
    status: "published" as const,
    ...overrides,
  };
}

describe("selectActiveProgram", () => {
  const now = new Date(2026, 6, 15);

  test("prefers the published program that covers now", () => {
    const current = program({ periodStart: new Date(2026, 6, 1), periodEnd: new Date(2026, 6, 31) });
    const past = program({ periodStart: new Date(2026, 5, 1), periodEnd: new Date(2026, 5, 30) });
    expect(selectActiveProgram([past, current], now)).toBe(current);
  });

  test("ignores draft programs even if they cover now", () => {
    const draft = program({
      periodStart: new Date(2026, 6, 1),
      periodEnd: new Date(2026, 6, 31),
      status: "draft",
    });
    expect(selectActiveProgram([draft], now)).toBeNull();
  });

  test("falls back to the nearest upcoming published program", () => {
    const nearUpcoming = program({ periodStart: new Date(2026, 7, 1), periodEnd: new Date(2026, 7, 31) });
    const farUpcoming = program({ periodStart: new Date(2026, 8, 1), periodEnd: new Date(2026, 8, 30) });
    expect(selectActiveProgram([farUpcoming, nearUpcoming], now)).toBe(nearUpcoming);
  });

  test("falls back to the nearest past published program when nothing current or upcoming", () => {
    const recentPast = program({ periodStart: new Date(2026, 5, 1), periodEnd: new Date(2026, 5, 30) });
    const olderPast = program({ periodStart: new Date(2026, 4, 1), periodEnd: new Date(2026, 4, 31) });
    expect(selectActiveProgram([olderPast, recentPast], now)).toBe(recentPast);
  });

  test("returns null when there are no published programs", () => {
    expect(selectActiveProgram([], now)).toBeNull();
  });
});

describe("mergeAndSortActivities", () => {
  test("sorts merged activities chronologically", () => {
    const early = { date: new Date(2026, 6, 5) };
    const late = { date: new Date(2026, 6, 19) };
    const middle = { date: new Date(2026, 6, 12) };
    expect(mergeAndSortActivities([late, early], [middle])).toEqual([early, middle, late]);
  });

  test("a system-wide activity replaces a section activity on the same day", () => {
    const day = new Date(2026, 6, 12);
    const sectionActivity = { date: day, location: "Λόφος" };
    const systemActivity = { date: day, location: "Πλατεία" };
    const result = mergeAndSortActivities([sectionActivity], [systemActivity]);
    expect(result).toEqual([systemActivity]);
  });

  test("keeps section activities that do not collide with system-wide ones", () => {
    const sectionActivity = { date: new Date(2026, 6, 5) };
    const systemActivity = { date: new Date(2026, 6, 12) };
    const result = mergeAndSortActivities([sectionActivity], [systemActivity]);
    expect(result).toEqual([sectionActivity, systemActivity]);
  });
});

describe("selectFeaturedActivity", () => {
  const now = new Date(2026, 6, 15);

  test("returns null when there are no activities", () => {
    expect(selectFeaturedActivity([], now)).toBeNull();
  });

  test("prefers the first activity from today onwards", () => {
    const past = { date: new Date(2026, 6, 5) };
    const next = { date: new Date(2026, 6, 19) };
    const later = { date: new Date(2026, 6, 26) };
    expect(selectFeaturedActivity([past, next, later], now)).toBe(next);
  });

  test("treats an activity happening today as the featured one", () => {
    const today = { date: new Date(2026, 6, 15) };
    const later = { date: new Date(2026, 6, 22) };
    expect(selectFeaturedActivity([today, later], now)).toBe(today);
  });

  test("falls back to the most recent activity when all are in the past", () => {
    const older = { date: new Date(2026, 6, 1) };
    const recent = { date: new Date(2026, 6, 8) };
    expect(selectFeaturedActivity([older, recent], now)).toBe(recent);
  });
});

async function getOrCreateSection(type: "agele" | "omada" | "koinotita") {
  const [existing] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(sections)
    .values({ type, name: type, icalPublicToken: crypto.randomUUID() })
    .returning();
  return created!;
}

describe("getPublishedSectionActivities", () => {
  beforeAll(() => {
    migrate(db, { migrationsFolder: "./src/db/migrations" });
  });

  // Ξεχωριστό εύρος ετών (2097+) ώστε να μην συγκρούεται με δεδομένα άλλων tests στο κοινό test db.
  test("merges across all published periods, excludes drafts, applies system-wide overrides per period", async () => {
    const section = await getOrCreateSection("agele");

    const [publishedJan] = await db
      .insert(programs)
      .values({
        sectionId: section.id,
        periodStart: new Date(2097, 0, 1),
        periodEnd: new Date(2097, 0, 31),
        status: "published",
        createdAt: new Date(),
      })
      .returning();
    const [draftFeb] = await db
      .insert(programs)
      .values({
        sectionId: section.id,
        periodStart: new Date(2097, 1, 1),
        periodEnd: new Date(2097, 1, 28),
        status: "draft",
        createdAt: new Date(),
      })
      .returning();
    const [systemProgram] = await db
      .insert(programs)
      .values({
        sectionId: null,
        periodStart: new Date(2097, 0, 1),
        periodEnd: new Date(2097, 11, 31),
        status: "published",
        createdAt: new Date(),
      })
      .returning();

    const jan5 = { programId: publishedJan!.id, isSystemWide: false, type: "typical" as const, date: new Date(2097, 0, 5), createdAt: new Date(), updatedAt: new Date() };
    const jan12Section = { programId: publishedJan!.id, isSystemWide: false, type: "typical" as const, date: new Date(2097, 0, 12), createdAt: new Date(), updatedAt: new Date() };
    const feb5Draft = { programId: draftFeb!.id, isSystemWide: false, type: "typical" as const, date: new Date(2097, 1, 5), createdAt: new Date(), updatedAt: new Date() };
    const jan12System = { programId: systemProgram!.id, isSystemWide: true, type: "other" as const, date: new Date(2097, 0, 12), createdAt: new Date(), updatedAt: new Date() };
    const marchSystem = { programId: systemProgram!.id, isSystemWide: true, type: "other" as const, date: new Date(2097, 2, 1), createdAt: new Date(), updatedAt: new Date() };

    const [insertedJan5, insertedJan12Section, insertedFeb5Draft, insertedJan12System] = await Promise.all([
      db.insert(activities).values(jan5).returning(),
      db.insert(activities).values(jan12Section).returning(),
      db.insert(activities).values(feb5Draft).returning(),
      db.insert(activities).values(jan12System).returning(),
    ]);
    await db.insert(activities).values(marchSystem);

    const result = await getPublishedSectionActivities(section.id);
    const scoped = result.filter((activity) => activity.date >= new Date(2097, 0, 1) && activity.date < new Date(2097, 2, 1));

    // Το feb5Draft (draft πρόγραμμα) πρέπει να λείπει, και το jan12System πρέπει να αντικαταστήσει το jan12Section.
    expect(scoped.map((activity) => activity.id)).toEqual([
      insertedJan5[0]!.id,
      insertedJan12System[0]!.id,
    ]);
    expect(scoped.some((activity) => activity.id === insertedJan12Section[0]!.id)).toBe(false);
    expect(scoped.some((activity) => activity.id === insertedFeb5Draft[0]!.id)).toBe(false);
    // Η Δράση Συστήματος του Μαρτίου δεν εμπίπτει σε καμία δημοσιευμένη περίοδο του τμήματος -> αποκλείεται.
    expect(result.some((activity) => activity.date.getTime() === marchSystem.date.getTime())).toBe(false);
  });

  test("excludes activities from a section's draft-only period entirely", async () => {
    const section = await getOrCreateSection("omada");
    const [draftOnly] = await db
      .insert(programs)
      .values({
        sectionId: section.id,
        periodStart: new Date(2098, 0, 1),
        periodEnd: new Date(2098, 0, 31),
        status: "draft",
        createdAt: new Date(),
      })
      .returning();
    await db.insert(activities).values({
      programId: draftOnly!.id,
      isSystemWide: false,
      type: "typical",
      date: new Date(2098, 0, 5),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getPublishedSectionActivities(section.id);
    expect(result.some((activity) => activity.date.getFullYear() === 2098)).toBe(false);
  });
});
