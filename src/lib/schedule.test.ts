import { describe, test, expect } from "bun:test";
import { mergeAndSortActivities, selectActiveProgram, selectFeaturedActivity } from "./schedule";

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
