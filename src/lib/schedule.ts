import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import { activities, programs } from "../db/schema";
import { attachActivityExtras, type DetailedActivity } from "./notes";

type ProgramRow = typeof programs.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;

/**
 * Επιλέγει ποιο πρόγραμμα (δημοσιευμένο) δείχνουμε δημόσια: προτεραιότητα στο
 * τρέχον/ενεργό (καλύπτει το "now"), αλλιώς το πλησιέστερο επόμενο, αλλιώς το
 * πλησιέστερο προηγούμενο — purpose doc §3.3/§5.6.
 */
export function selectActiveProgram<T extends Pick<ProgramRow, "periodStart" | "periodEnd" | "status">>(
  candidatePrograms: T[],
  now: Date = new Date(),
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): T | null {
  // includeDrafts: μόνο για την προεπισκόπηση του διαχειριστικού — η δημόσια προβολή βλέπει
  // πάντα μόνο δημοσιευμένα.
  const published = includeDrafts
    ? candidatePrograms
    : candidatePrograms.filter((program) => program.status === "published");
  if (published.length === 0) return null;

  const current = published.find((program) => program.periodStart <= now && now <= program.periodEnd);
  if (current) return current;

  const upcoming = [...published]
    .filter((program) => program.periodStart > now)
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())[0];
  if (upcoming) return upcoming;

  const past = [...published]
    .filter((program) => program.periodEnd < now)
    .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
  return past ?? null;
}

/**
 * Συγχωνεύει τις δράσεις τμήματος με τις Δράσεις Συστήματος της ίδιας περιόδου.
 * Μία Δράση Συστήματος αντικαθιστά τυχόν δράση τμήματος την ίδια ημέρα
 * (purpose doc §2 γλωσσάρι "Δράση Συστήματος").
 */
export function mergeAndSortActivities<T extends Pick<ActivityRow, "date">>(
  sectionActivities: T[],
  systemActivities: T[],
): T[] {
  const systemDates = new Set(systemActivities.map((activity) => activity.date.toDateString()));
  const nonOverriddenSectionActivities = sectionActivities.filter(
    (activity) => !systemDates.has(activity.date.toDateString()),
  );
  return [...nonOverriddenSectionActivities, ...systemActivities].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

/**
 * Επιλέγει τη δράση που προβάλλεται "σε πρώτο πλάνο" στην κάρτα του τμήματος
 * στην αρχική: την πρώτη δράση από σήμερα και μετά (η σημερινή μετράει ως
 * επόμενη για όλη την ημέρα). Ποτέ δράση του παρελθόντος — αν δεν υπάρχει
 * επόμενη, επιστρέφει null. Προϋποθέτει δράσεις ταξινομημένες χρονολογικά
 * αύξουσα (όπως τις επιστρέφει η getPublishedSectionActivities).
 */
export function selectFeaturedActivity<T extends Pick<ActivityRow, "date">>(
  sortedActivities: T[],
  now: Date = new Date(),
): T | null {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return sortedActivities.find((activity) => activity.date >= startOfToday) ?? null;
}

/** Πόσες ημέρες πριν από τη δράση εμφανίζονται στον επισκέπτη οι ετικέτες αλλαγών της (purpose doc §5.4). */
export const CHANGE_BADGE_WINDOW_DAYS = 5;

/**
 * Η μόνη δράση που επιτρέπεται να δείξει ετικέτες αλλαγών στη δημόσια σελίδα: η επόμενη
 * χρονικά (βλ. selectFeaturedActivity), και μόνο αν απέχει ≤ CHANGE_BADGE_WINDOW_DAYS
 * ημερολογιακές ημέρες από σήμερα. Αλλαγή σε πιο μακρινή δράση δεν χρειάζεται να
 * τονιστεί — ο γονέας θα δει απλά τα τρέχοντα στοιχεία της (purpose doc §5.4).
 */
export function selectChangeBadgeActivity<T extends Pick<ActivityRow, "date">>(
  sortedActivities: T[],
  now: Date = new Date(),
): T | null {
  const next = selectFeaturedActivity(sortedActivities, now);
  if (!next) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfActivityDay = new Date(next.date);
  startOfActivityDay.setHours(0, 0, 0, 0);
  // round: ανθεκτικό σε αλλαγή θερινής/χειμερινής ώρας (μέρα 23 ή 25 ωρών).
  const daysUntil = Math.round((startOfActivityDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  return daysUntil <= CHANGE_BADGE_WINDOW_DAYS ? next : null;
}

/**
 * Αφαιρεί για τη δημόσια προβολή τις ενδείξεις αλλαγών (πεδίων δράσης και Σημειώσεων
 * Συστήματος) από κάθε δράση εκτός της `selectChangeBadgeActivity`. Επιστρέφει αντίγραφα —
 * η καταγραφή των αλλαγών στη βάση/στο διαχειριστικό μένει ανέπαφη.
 */
export function limitChangeBadges<T extends DetailedActivity>(sortedActivities: T[], now: Date = new Date()): T[] {
  const eligible = selectChangeBadgeActivity(sortedActivities, now);
  return sortedActivities.map((activity) =>
    activity.id === eligible?.id
      ? activity
      : {
          ...activity,
          changedAfterPublishFields: [],
          notes: activity.notes.map((note) => (note.changedAfterPublish ? { ...note, changedAfterPublish: false } : note)),
        },
  );
}

export type SectionSchedule = {
  program: ProgramRow | null;
  activities: DetailedActivity[];
};

/** Περίοδος προς προβολή: ένα πρόγραμμα τμήματος, ή (μόνο στην προεπισκόπηση) σκέτη περίοδος χωρίς πρόγραμμα τμήματος. */
type SchedulePeriod = { sectionProgramId: number | null; periodStart: Date; periodEnd: Date };

/**
 * Δράσεις μιας περιόδου τμήματος, merged με τις Δράσεις Συστήματος της ίδιας περιόδου.
 * `includeDrafts`: και πρόχειρες Δράσεις/Σημειώσεις Συστήματος — μόνο για την προεπισκόπηση.
 */
async function scheduleActivitiesFor(period: SchedulePeriod, includeDrafts: boolean): Promise<DetailedActivity[]> {
  const sectionActivities =
    period.sectionProgramId === null
      ? []
      : await db.select().from(activities).where(eq(activities.programId, period.sectionProgramId));

  const systemPrograms = await db
    .select()
    .from(programs)
    .where(includeDrafts ? isNull(programs.sectionId) : and(isNull(programs.sectionId), eq(programs.status, "published")));

  const systemProgramIds = systemPrograms.map((program) => program.id);

  const systemActivities = systemProgramIds.length
    ? await db
        .select()
        .from(activities)
        .where(
          and(
            inArray(activities.programId, systemProgramIds),
            gte(activities.date, period.periodStart),
            lte(activities.date, period.periodEnd),
          ),
        )
    : [];

  return attachActivityExtras(mergeAndSortActivities(sectionActivities, systemActivities), {
    publishedOnly: !includeDrafts,
  });
}

/** Πρόγραμμα + δράσεις (merged με Δράσεις Συστήματος) προς δημόσια προβολή για ένα τμήμα. */
export async function getSectionSchedule(sectionId: number, now: Date = new Date()): Promise<SectionSchedule> {
  const sectionPrograms = await db.select().from(programs).where(eq(programs.sectionId, sectionId));
  const activeProgram = selectActiveProgram(sectionPrograms, now);

  if (!activeProgram) return { program: null, activities: [] };

  return {
    program: activeProgram,
    activities: limitChangeBadges(
      await scheduleActivitiesFor(
        { sectionProgramId: activeProgram.id, periodStart: activeProgram.periodStart, periodEnd: activeProgram.periodEnd },
        false,
      ),
      now,
    ),
  };
}

export type PreviewSchedule = {
  /** Ό,τι χρειάζεται το hero της σελίδας τμήματος· null = δεν υπάρχει τίποτα να προβληθεί. */
  program: Pick<ProgramRow, "periodStart" | "periodEnd" | "themeTitle"> | null;
  activities: DetailedActivity[];
};

/**
 * Προεπισκόπηση της σελίδας τμήματος όπως θα φαινόταν αν δημοσιεύονταν τα πάντα
 * (ux-ui-guidelines §2.5): πρόχειρα προγράμματα, Δράσεις και Σημειώσεις Συστήματος μαζί.
 * - `focus` πρόγραμμα τμήματος → αυτό ακριβώς.
 * - `focus` πρόγραμμα Συστήματος → το πρόγραμμα του τμήματος που επικαλύπτει την περίοδό του
 *   (αν δεν υπάρχει, σκέτη η περίοδος του Συστήματος, μόνο με τις Δράσεις Συστήματος).
 * - χωρίς `focus` → ίδια επιλογή "ενεργού" με τη δημόσια σελίδα, αλλά μετρώντας και τα πρόχειρα.
 * Η εξουσιοδότηση (ποιος βλέπει ποιο τμήμα/πρόγραμμα) γίνεται στο route, όχι εδώ.
 */
export async function getPreviewSectionSchedule(
  sectionId: number,
  focus: ProgramRow | null,
  now: Date = new Date(),
): Promise<PreviewSchedule> {
  const sectionPrograms = await db.select().from(programs).where(eq(programs.sectionId, sectionId));

  let period: SchedulePeriod | null = null;
  let program: PreviewSchedule["program"] = null;

  if (focus && focus.sectionId === sectionId) {
    program = focus;
  } else if (focus && focus.sectionId === null) {
    const overlapping = sectionPrograms
      .filter((p) => p.periodStart <= focus.periodEnd && p.periodEnd >= focus.periodStart)
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
    const containing = overlapping.find((p) => p.periodStart <= focus.periodStart && focus.periodStart <= p.periodEnd);
    program = containing ?? overlapping[0] ?? { periodStart: focus.periodStart, periodEnd: focus.periodEnd, themeTitle: null };
  } else {
    program = selectActiveProgram(sectionPrograms, now, { includeDrafts: true });
  }

  if (!program) return { program: null, activities: [] };
  period = {
    sectionProgramId: "id" in program && typeof program.id === "number" ? program.id : null,
    periodStart: program.periodStart,
    periodEnd: program.periodEnd,
  };
  return { program, activities: limitChangeBadges(await scheduleActivitiesFor(period, true), now) };
}

/**
 * Όλες οι δράσεις (merged με Δράσεις Συστήματος, ανά περίοδο) απ' όλα τα
 * δημοσιευμένα προγράμματα ενός τμήματος — ιστορικά + τρέχοντα + μελλοντικά.
 * Χρησιμοποιείται από το iCal feed (§9 architecture doc), που πρέπει να
 * αντανακλά όλες τις δημοσιευμένες δράσεις, όχι μόνο την τρέχουσα περίοδο.
 */
export async function getPublishedSectionActivities(sectionId: number): Promise<DetailedActivity[]> {
  const sectionPrograms = await db
    .select()
    .from(programs)
    .where(and(eq(programs.sectionId, sectionId), eq(programs.status, "published")));

  if (sectionPrograms.length === 0) return [];

  const sectionProgramIds = sectionPrograms.map((program) => program.id);
  const sectionActivities = await db
    .select()
    .from(activities)
    .where(inArray(activities.programId, sectionProgramIds));

  const systemPrograms = await db
    .select()
    .from(programs)
    .where(and(isNull(programs.sectionId), eq(programs.status, "published")));

  const systemProgramIds = systemPrograms.map((program) => program.id);
  const systemActivities = systemProgramIds.length
    ? await db.select().from(activities).where(inArray(activities.programId, systemProgramIds))
    : [];

  const merged = sectionPrograms.flatMap((program) => {
    const periodSectionActivities = sectionActivities.filter((activity) => activity.programId === program.id);
    const periodSystemActivities = systemActivities.filter(
      (activity) => activity.date >= program.periodStart && activity.date <= program.periodEnd,
    );
    return mergeAndSortActivities(periodSectionActivities, periodSystemActivities);
  });

  return attachActivityExtras(
    merged.sort((a, b) => a.date.getTime() - b.date.getTime()),
    { publishedOnly: true },
  );
}
