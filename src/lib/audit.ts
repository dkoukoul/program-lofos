/**
 * Ίχνος αλλαγών δράσεων: μία JSON γραμμή ανά write στο stdout → systemd journal
 * (§13 architecture doc). Σκοπός: να απαντιέται το "ποιος άλλαξε τι και πότε" όταν
 * δύο βαθμοφόροι δουλεύουν ταυτόχρονα, χωρίς νέο πίνακα/migration.
 *
 *   journalctl -u program-lofos -o cat | grep '"event":"activity_change"'
 *
 * Μόνο id + όνομα βαθμοφόρου — ποτέ email ή token.
 */

export type ActivityAuditAction =
  | "create"
  | "quick_typical"
  | "quick_no_activity"
  | "update"
  | "quick_edit"
  | "toggle_change_badge"
  | "delete";

export interface ActivityAuditInput {
  action: ActivityAuditAction;
  leader: { id: number; name: string };
  program: { id: number; sectionId: number | null };
  activity: { id: number; date: Date; type: string };
  /** Πεδία που άλλαξαν σε αυτό το request (μόνο σε update/quick_edit). */
  changedFields?: string[];
  /** Ελεύθερη επιπλέον πληροφορία, π.χ. ποια ετικέτα αλλαγής έγινε toggle. */
  detail?: string;
  at?: Date;
}

function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function activityAuditEntry(input: ActivityAuditInput): Record<string, unknown> {
  return {
    event: "activity_change",
    at: (input.at ?? new Date()).toISOString(),
    action: input.action,
    leaderId: input.leader.id,
    leaderName: input.leader.name,
    programId: input.program.id,
    sectionId: input.program.sectionId,
    activityId: input.activity.id,
    activityDate: localDate(input.activity.date),
    activityType: input.activity.type,
    ...(input.changedFields ? { changedFields: input.changedFields } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export function logActivityChange(input: ActivityAuditInput): void {
  // Το audit δεν πρέπει ποτέ να ρίξει το ίδιο το write.
  try {
    console.log(JSON.stringify(activityAuditEntry(input)));
  } catch (err) {
    console.error("Αποτυχία καταγραφής αλλαγής δράσης", err);
  }
}
