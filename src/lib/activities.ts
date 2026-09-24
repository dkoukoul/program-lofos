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

const TRACKED_FIELDS = [
  "date",
  "location",
  "locationLat",
  "locationLng",
  "startsAt",
  "endsAt",
  "cost",
  "whatToBring",
] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function newlyChangedFields(
  before: Pick<ActivityRow, TrackedField>,
  after: Pick<ActivityRow, TrackedField>,
): TrackedField[] {
  return TRACKED_FIELDS.filter((field) => !valuesEqual(before[field], after[field]));
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
  return [...new Set([...existingChangedFields, ...newlyChangedFields(before, after)])];
}

/**
 * Πολλά πεδία → μία ορατή ετικέτα αλλαγής: το κλειδί ομάδας είναι η μονάδα που κρύβει
 * ή επαναφέρει το επιτελείο (purpose doc §5.4), γι' αυτό οι τρεις στήλες τοποθεσίας
 * μοιράζονται το ίδιο κλειδί — δεν έχει νόημα να κρυφτεί το "location" και να μείνει
 * ορατό το "locationLat", αφού δείχνουν την ίδια ετικέτα στον επισκέπτη.
 */
const CHANGE_GROUP_BY_FIELD: Record<string, string> = {
  date: "date",
  location: "location",
  locationLat: "location",
  locationLng: "location",
  startsAt: "startsAt",
  endsAt: "endsAt",
  cost: "cost",
  whatToBring: "whatToBring",
};

/** Κλειδί ομάδας ετικέτας για ένα πεδίο· άγνωστο πεδίο (π.χ. από παλιά δεδομένα) → "other". */
export function changeGroupOf(field: string): string {
  return CHANGE_GROUP_BY_FIELD[field] ?? "other";
}

/** Τα κλειδιά ομάδων των αλλαγμένων πεδίων, unique και με τη σειρά που εμφανίστηκαν. */
export function changeGroupsOf(changedFields: string[]): string[] {
  return [...new Set(changedFields.map(changeGroupOf))];
}

/**
 * Οι ομάδες που πρέπει να πάψουν να είναι κρυμμένες επειδή το πεδίο τους ξαναλλάξει:
 * μια νέα αλλαγή είναι νέα πληροφορία για τον επισκέπτη, άρα ακυρώνει προηγούμενη
 * απόκρυψη από το επιτελείο (purpose doc §5.4).
 */
export function unhideReChangedGroups(
  before: Pick<ActivityRow, TrackedField>,
  after: Pick<ActivityRow, TrackedField>,
  hiddenGroups: string[] = [],
): string[] {
  const reChanged = new Set(changeGroupsOf(newlyChangedFields(before, after)));
  return hiddenGroups.filter((group) => !reChanged.has(group));
}

/** Οι ομάδες ετικετών που βλέπει ο επισκέπτης: οι αλλαγμένες, μείον όσες έκρυψε το επιτελείο. */
export function visibleChangeGroups(
  activity: Pick<ActivityRow, "changedAfterPublishFields" | "hiddenChangeGroups">,
): string[] {
  const hidden = activity.hiddenChangeGroups ?? [];
  return changeGroupsOf(activity.changedAfterPublishFields ?? []).filter((group) => !hidden.includes(group));
}
