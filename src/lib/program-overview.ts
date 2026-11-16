/**
 * Καθαρή (χωρίς DB) λογική επισκόπησης προγραμμάτων για το διαχειριστικό
 * (ux-ui-guidelines §2.0/§2.2): ποιες Κυριακές μιας περιόδου έχουν/δεν έχουν δράση,
 * ποιο πρόγραμμα είναι "τρέχον"/"επόμενο", ποιος μήνας λείπει, ετικέτες περιόδου.
 */

type Dated = { date: Date };
type Period = { periodStart: Date; periodEnd: Date };

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * Μια Κυριακή θεωρείται "καλυμμένη" αν υπάρχει δράση την ίδια μέρα ή το αμέσως
 * προηγούμενο Σάββατο (π.χ. συγκέντρωση Σαββάτου αντί για Κυριακή) — τότε δεν
 * τη δείχνουμε ως κενή θέση ούτε ως "Χωρίς δράση ακόμα".
 */
function coversSunday(activity: Dated, sunday: Date): boolean {
  const saturday = new Date(sunday);
  saturday.setDate(saturday.getDate() - 1);
  return sameDay(activity.date, sunday) || sameDay(activity.date, saturday);
}

/** Όλες οι Κυριακές μέσα στην περίοδο (συμπεριλαμβανομένων των άκρων). */
export function sundaysInPeriod(periodStart: Date, periodEnd: Date): Date[] {
  const result: Date[] = [];
  const cursor = startOfDay(periodStart);
  while (cursor.getDay() !== 0) cursor.setDate(cursor.getDate() + 1);
  const end = startOfDay(periodEnd);
  while (cursor.getTime() <= end.getTime()) {
    result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

export type TimelineItem<A extends Dated> =
  | { kind: "activity"; date: Date; activity: A }
  | { kind: "system"; date: Date; activity: A }
  | { kind: "empty"; date: Date };

/**
 * Χρονολογική λίστα της οθόνης προγράμματος: οι δράσεις του προγράμματος, οι Δράσεις
 * Συστήματος της περιόδου (μόνο για ανάγνωση — ορίζονται στο πρόγραμμα Συστήματος) και,
 * αν ζητηθεί, μία "κενή θέση" για κάθε Κυριακή που δεν έχει καμία από τις δύο (ούτε την ίδια
 * μέρα ούτε το προηγούμενο Σάββατο).
 */
export function buildProgramTimeline<A extends Dated>(
  own: A[],
  system: A[],
  period: Period,
  { emptySundays }: { emptySundays: boolean },
): TimelineItem<A>[] {
  const items: TimelineItem<A>[] = [
    ...own.map((activity) => ({ kind: "activity" as const, date: activity.date, activity })),
    ...system.map((activity) => ({ kind: "system" as const, date: activity.date, activity })),
  ];
  if (emptySundays) {
    for (const sunday of sundaysInPeriod(period.periodStart, period.periodEnd)) {
      const occupied = [...own, ...system].some((activity) => coversSunday(activity, sunday));
      if (!occupied) items.push({ kind: "empty", date: sunday });
    }
  }
  const order = { activity: 0, system: 1, empty: 2 } as const;
  return items.sort(
    (a, b) => startOfDay(a.date).getTime() - startOfDay(b.date).getTime() || order[a.kind] - order[b.kind],
  );
}

export type SundayCoverage = {
  total: number;
  covered: number;
  /** Κυριακές χωρίς καμία δράση, από σήμερα και μετά — αυτές που αξίζει να συμπληρωθούν. */
  missingUpcoming: Date[];
};

/** Πόσες Κυριακές της περιόδου έχουν ήδη κάποια δράση (δική του ή Συστήματος, ή "Χωρίς δράση") την ίδια μέρα ή το προηγούμενο Σάββατο. */
export function sundayCoverage(occupying: Dated[], period: Period, now: Date = new Date()): SundayCoverage {
  const sundays = sundaysInPeriod(period.periodStart, period.periodEnd);
  const today = startOfDay(now);
  const missing = sundays.filter((sunday) => !occupying.some((activity) => coversSunday(activity, sunday)));
  return {
    total: sundays.length,
    covered: sundays.length - missing.length,
    missingUpcoming: missing.filter((sunday) => sunday.getTime() >= today.getTime()),
  };
}

/** Το πρόγραμμα που καλύπτει σήμερα και το αμέσως επόμενο — οποιασδήποτε κατάστασης. */
export function currentAndNextProgram<P extends Period>(
  candidatePrograms: P[],
  now: Date = new Date(),
): { current: P | null; next: P | null } {
  const today = startOfDay(now);
  const current =
    candidatePrograms.find(
      (program) => startOfDay(program.periodStart) <= today && today <= startOfDay(program.periodEnd),
    ) ?? null;
  const next =
    [...candidatePrograms]
      .filter((program) => startOfDay(program.periodStart) > today)
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())[0] ?? null;
  return { current, next };
}

export type MonthChoice = { start: Date; end: Date; label: string };

const monthLabelFormatter = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" });

/** Ολόκληρος ημερολογιακός μήνας (monthIndex: 0 = Ιανουάριος· υπερχείλιση επιτρέπεται). */
export function monthPeriod(year: number, monthIndex: number): MonthChoice {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return { start, end, label: capitalize(monthLabelFormatter.format(start)) };
}

/** Ο τρέχων μήνας και οι επόμενοι — τα chips γρήγορης επιλογής στο "Νέο πρόγραμμα". */
export function upcomingMonths(now: Date, count: number): MonthChoice[] {
  return Array.from({ length: count }, (_, i) => monthPeriod(now.getFullYear(), now.getMonth() + i));
}

function overlaps(program: Period, month: MonthChoice): boolean {
  return startOfDay(program.periodStart) <= month.end && startOfDay(program.periodEnd) >= month.start;
}

/**
 * Ποιον μήνα να προτείνουμε για δημιουργία με ένα κλικ στην αρχική: τον τρέχοντα αν δεν
 * τον καλύπτει κανένα πρόγραμμα, αλλιώς τον επόμενο, αλλιώς τίποτα.
 */
export function suggestMonthToCreate(existing: Period[], now: Date = new Date()): MonthChoice | null {
  return upcomingMonths(now, 2).find((month) => !existing.some((program) => overlaps(program, month))) ?? null;
}

function isWholeMonth(period: Period): boolean {
  const { periodStart: s, periodEnd: e } = period;
  return (
    s.getDate() === 1 &&
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    e.getDate() === new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate()
  );
}

/** "Δεκέμβριος 2026" για ολόκληρο μήνα — αλλιώς null (ο καλών δείχνει το εύρος ημερομηνιών). */
export function monthTitle(period: Period): string | null {
  return isWholeMonth(period) ? capitalize(monthLabelFormatter.format(period.periodStart)) : null;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("el-GR") + text.slice(1);
}
