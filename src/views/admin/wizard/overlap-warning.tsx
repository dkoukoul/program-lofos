import type { Activity } from "../../../db/schema";
import { ACTIVITY_TYPE_INFO, formatActivityDate, formatActivityTime } from "../../public/layout";

/**
 * Preview κάρτα της ήδη υπάρχουσας δράσης εκείνη την ημέρα, αντί για απλό μήνυμα
 * (ux-ui-guidelines §2.1, ιδέα #4 — overlap preview). Η ίδια τιμή του
 * `ALLOW_ACTIVITY_OVERLAP` env var (§6 architecture doc) καθορίζει αν μπλοκάρει
 * ή απλώς προειδοποιεί· ο πραγματικός έλεγχος γίνεται πάντα ξανά server-side στο submit.
 */
export function OverlapWarning({
  existing,
  blocked,
  editingActivityId,
}: {
  existing: Activity | null;
  blocked: boolean;
  editingActivityId?: number;
}) {
  if (!existing || existing.id === editingActivityId) return null;

  const typeInfo = ACTIVITY_TYPE_INFO[existing.type];

  return (
    <div class={`overlap-warning ${blocked ? "overlap-warning--blocked" : "overlap-warning--soft"}`}>
      <p>
        {blocked
          ? "Υπάρχει ήδη δράση αυτή την ημέρα — δεν μπορείς να αποθηκεύσεις άλλη."
          : "Υπάρχει ήδη δράση αυτή την ημέρα. Μπορείς να συνεχίσεις, αλλά έλεγξε πρώτα:"}
      </p>
      <a class="overlap-preview-card" href={`/admin/programs/${existing.programId}/activities/${existing.id}/edit`}>
        <span class="badge badge-type">
          {typeInfo.icon} {typeInfo.label}
        </span>
        {existing.startsAt && <span class="activity-time">🕒 {formatActivityTime(existing.startsAt)}</span>}
        {existing.location && <span class="activity-location">📍 {existing.location}</span>}
        <span class="overlap-preview-date">{formatActivityDate(existing.date)}</span>
      </a>
    </div>
  );
}
