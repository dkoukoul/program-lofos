import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import { activities, programs } from "../db/schema";

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
): T | null {
  const published = candidatePrograms.filter((program) => program.status === "published");
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

export type SectionSchedule = {
  program: ProgramRow | null;
  activities: ActivityRow[];
};

/** Πρόγραμμα + δράσεις (merged με Δράσεις Συστήματος) προς δημόσια προβολή για ένα τμήμα. */
export async function getSectionSchedule(sectionId: number, now: Date = new Date()): Promise<SectionSchedule> {
  const sectionPrograms = await db.select().from(programs).where(eq(programs.sectionId, sectionId));
  const activeProgram = selectActiveProgram(sectionPrograms, now);

  if (!activeProgram) return { program: null, activities: [] };

  const sectionActivities = await db
    .select()
    .from(activities)
    .where(eq(activities.programId, activeProgram.id));

  const systemPrograms = await db
    .select()
    .from(programs)
    .where(and(isNull(programs.sectionId), eq(programs.status, "published")));

  const systemProgramIds = systemPrograms.map((program) => program.id);

  const systemActivities = systemProgramIds.length
    ? await db
        .select()
        .from(activities)
        .where(
          and(
            inArray(activities.programId, systemProgramIds),
            gte(activities.date, activeProgram.periodStart),
            lte(activities.date, activeProgram.periodEnd),
          ),
        )
    : [];

  return {
    program: activeProgram,
    activities: mergeAndSortActivities(sectionActivities, systemActivities),
  };
}
