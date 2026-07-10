import type { activities } from "../db/schema";

type ActivityType = (typeof activities.$inferSelect)["type"];
type ActivityRow = typeof activities.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivityTypeDefaults = {
  location?: string;
  startTime?: string;
  endTime?: string;
  whatToBring?: string;
};

/** Defaults ανά τύπο δράσης (purpose doc §4). */
export function typeDefaults(type: ActivityType): ActivityTypeDefaults {
  switch (type) {
    case "typical":
      return { location: "Λόφος", startTime: "11:00", endTime: "13:00", whatToBring: "παγούρι" };
    case "other":
      return { whatToBring: "πλήρης προσκοπική στολή" };
    default:
      return {};
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * Οι επόμενες `count` Κυριακές εντός [periodStart, periodEnd] που δεν έχουν ήδη
 * καταχωρημένη δράση. Η πρώτη τιμή τροφοδοτεί το default του date picker, όλες
 * τροφοδοτούν τα smart date chips (ux-ui-guidelines §2.1).
 */
export function nextAvailableSundays(
  existingDates: Date[],
  periodStart: Date,
  periodEnd: Date,
  count = 3,
): Date[] {
  const result: Date[] = [];
  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getDay() !== 0) {
    cursor.setDate(cursor.getDate() + 1);
  }

  while (cursor.getTime() <= periodEnd.getTime() && result.length < count) {
    if (!existingDates.some((existing) => isSameDay(existing, cursor))) {
      result.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  return result;
}

/** Υπάρχουσα δράση την ίδια ημέρα (ίδιου section, system-wide, ή "Χωρίς δράση"), αν υπάρχει. */
export function findOverlap<T extends Pick<ActivityRow, "date">>(
  candidateActivities: T[],
  date: Date,
): T | null {
  return candidateActivities.find((activity) => isSameDay(activity.date, date)) ?? null;
}

export type OverlapDecision = "ok" | "warn" | "block";

/** Πολιτική επικάλυψης βάσει env var `ALLOW_ACTIVITY_OVERLAP` (§6 architecture doc, default false). */
export function checkOverlapPolicy(existing: unknown | null, allowOverlapEnv: boolean): OverlapDecision {
  if (!existing) return "ok";
  return allowOverlapEnv ? "warn" : "block";
}

const TRACKED_FIELDS = ["date", "location", "startsAt", "endsAt", "cost", "whatToBring"] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

/**
 * Ονόματα πεδίων που πραγματικά άλλαξαν σε σχέση με πριν, ενωμένα (unique) με
 * όσα ήδη ήταν σημειωμένα ως αλλαγμένα (purpose doc §5.4 — δεν καθαρίζει ποτέ
 * αυτόματα, μένει ορατό μέχρι νεότερη δημοσίευση).
 */
export function diffChangedFields(
  before: Pick<ActivityRow, TrackedField>,
  after: Pick<ActivityRow, TrackedField>,
  existingChangedFields: string[] = [],
): string[] {
  const newlyChanged = TRACKED_FIELDS.filter((field) => !valuesEqual(before[field], after[field]));
  return [...new Set([...existingChangedFields, ...newlyChanged])];
}
