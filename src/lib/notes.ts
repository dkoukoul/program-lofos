import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import {
  activityCustomFields,
  programs,
  systemNotes,
  type Activity,
  type SystemNote,
} from "../db/schema";
import { formatDateNumeric, formatPeriod } from "../views/public/layout";

export type ActivityCustomField = { title: string; description: string };

/** Ό,τι κρέμεται από μια δράση και δεν ζει στη γραμμή της: δυναμικά πεδία + Σημειώσεις Συστήματος. */
export type ActivityExtras = {
  customFields: ActivityCustomField[];
  notes: SystemNote[];
};

export type DetailedActivity = Activity & ActivityExtras;

/** Το εύρος μιας σημείωσης σε αναγνώσιμη μορφή: μία ημερομηνία αν έναρξη = λήξη, αλλιώς εύρος. */
export function formatNoteRange(note: Pick<SystemNote, "dateStart" | "dateEnd">): string {
  return note.dateStart.getTime() === note.dateEnd.getTime()
    ? formatDateNumeric(note.dateStart)
    : formatPeriod(note.dateStart, note.dateEnd);
}

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/** Καλύπτει η σημείωση τη συγκεκριμένη ημέρα; Σύγκριση σε ακρίβεια ημέρας, άκρα inclusive. */
export function noteCoversDate(note: Pick<SystemNote, "dateStart" | "dateEnd">, date: Date): boolean {
  const day = startOfDay(date);
  return startOfDay(note.dateStart) <= day && day <= startOfDay(note.dateEnd);
}

/**
 * Οι Σημειώσεις Συστήματος που "κολλάνε" σε μια δράση: όσες καλύπτουν την ημέρα της.
 * Σε δράσεις τύπου "Χωρίς δράση" δεν εμφανίζεται ποτέ σημείωση — η σημείωση είναι
 * αυστηρά επιπλέον πεδίο πραγματικής δράσης (purpose doc §5.2).
 */
export function notesForActivity<T extends Pick<Activity, "date" | "type">>(
  notes: SystemNote[],
  activity: T,
): SystemNote[] {
  if (activity.type === "no_activity") return [];
  return notes
    .filter((note) => noteCoversDate(note, activity.date))
    .sort((a, b) => a.dateStart.getTime() - b.dateStart.getTime() || a.id - b.id);
}

/** Οι Σημειώσεις Συστήματος που τέμνονται με ένα διάστημα ημερομηνιών. */
export async function getSystemNotesInRange(
  rangeStart: Date,
  rangeEnd: Date,
  options: { publishedOnly: boolean },
): Promise<SystemNote[]> {
  const systemProgramFilter = options.publishedOnly
    ? and(isNull(programs.sectionId), eq(programs.status, "published"))
    : isNull(programs.sectionId);

  const rows = await db
    .select({ note: systemNotes })
    .from(systemNotes)
    .innerJoin(programs, eq(systemNotes.programId, programs.id))
    .where(and(systemProgramFilter, lte(systemNotes.dateStart, rangeEnd), gte(systemNotes.dateEnd, rangeStart)));

  return rows.map((row) => row.note);
}

/** Όλες οι Σημειώσεις Συστήματος ενός προγράμματος, χρονολογικά. */
export async function getProgramNotes(programId: number): Promise<SystemNote[]> {
  return db
    .select()
    .from(systemNotes)
    .where(eq(systemNotes.programId, programId))
    .orderBy(systemNotes.dateStart);
}

async function getCustomFieldsByActivity(activityIds: number[]): Promise<Map<number, ActivityCustomField[]>> {
  const byActivity = new Map<number, ActivityCustomField[]>();
  if (activityIds.length === 0) return byActivity;

  const rows = await db
    .select({
      activityId: activityCustomFields.activityId,
      title: activityCustomFields.title,
      description: activityCustomFields.description,
    })
    .from(activityCustomFields)
    .where(inArray(activityCustomFields.activityId, activityIds))
    .orderBy(activityCustomFields.id);

  for (const row of rows) {
    const list = byActivity.get(row.activityId) ?? [];
    list.push({ title: row.title, description: row.description });
    byActivity.set(row.activityId, list);
  }
  return byActivity;
}

/**
 * Γεμίζει κάθε δράση με τα δυναμικά της πεδία και τις Σημειώσεις Συστήματος που
 * καλύπτουν την ημέρα της — ένα query ανά concern για όλη τη λίστα, όχι ανά δράση.
 * `publishedOnly` = δημόσια προβολή/iCal (μόνο δημοσιευμένα προγράμματα Συστήματος)·
 * false = διαχειριστικό, όπου φαίνεται και ό,τι είναι ακόμα πρόχειρο.
 */
export async function attachActivityExtras<T extends Activity>(
  activityRows: T[],
  options: { publishedOnly: boolean },
): Promise<(T & ActivityExtras)[]> {
  if (activityRows.length === 0) return [];

  const dates = activityRows.map((activity) => activity.date.getTime());
  const notes = await getSystemNotesInRange(
    new Date(Math.min(...dates)),
    new Date(Math.max(...dates)),
    options,
  );
  const customFieldsByActivity = await getCustomFieldsByActivity(activityRows.map((activity) => activity.id));

  return activityRows.map((activity) => ({
    ...activity,
    customFields: customFieldsByActivity.get(activity.id) ?? [],
    notes: notesForActivity(notes, activity),
  }));
}

