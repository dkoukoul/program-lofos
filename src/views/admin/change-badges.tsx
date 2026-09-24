import type { Activity, Leader } from "../../db/schema";
import { changeGroupsOf } from "../../lib/activities";
import { changeGroupLabel } from "../public/layout";
import { InfoTip } from "./info-tip";

/** Ό,τι χρειάζεται το block ετικετών αλλαγής — όχι ολόκληρη η δράση, ώστε να μπορεί να ξαναγίνει render μόνο του. */
export type ChangeBadgesActivity = Pick<
  Activity,
  "id" | "programId" | "changedAfterPublishFields" | "hiddenChangeGroups"
>;

/** id του block, ώστε το htmx swap μετά το toggle να αντικαθιστά ακριβώς αυτή τη δράση. */
export function activityChangesId(activityId: number): string {
  return `activity-changes-${activityId}`;
}

const TIP =
  "Οι κόκκινες ετικέτες δείχνουν στους γονείς τι άλλαξε μετά τη δημοσίευση. Ως επιτελείο μπορείς να κρύψεις όποια δεν αξίζει να τη δουν (π.χ. διόρθωση τυπογραφικού) και να την επαναφέρεις όποτε θες. Η απόκρυψη αφορά μόνο την προβολή — αν το ίδιο πεδίο ξαναλλάξει, η ετικέτα εμφανίζεται ξανά αυτόματα.";

/**
 * Οι ετικέτες αλλαγής μιας δράσης μέσα στο διαχειριστικό: το επιτελείο τις βλέπει ως
 * κουμπιά (απόκρυψη/επαναφορά από το δημόσιο πρόγραμμα, purpose doc §5.4), ο βαθμοφόρος
 * τμήματος μόνο ως ενδείξεις — η αλλαγή κατάστασης περνάει πάντα από server-side έλεγχο
 * ρόλου στο POST route, όχι από αυτή την απόκρυψη στο UI (§6 architecture doc).
 */
export function ActivityChangeBadges({
  activity,
  leader,
}: {
  activity: ChangeBadgesActivity;
  leader: Leader;
}) {
  const groups = changeGroupsOf(activity.changedAfterPublishFields ?? []);
  if (groups.length === 0) return null;

  const hiddenGroups = activity.hiddenChangeGroups ?? [];
  const canToggle = leader.role === "system_staff";

  return (
    <div class="activity-changes" id={activityChangesId(activity.id)}>
      <span class="activity-changes-label">
        Ετικέτες αλλαγών:
        {canToggle && <InfoTip text={TIP} />}
      </span>
      {groups.map((group) => {
        const hidden = hiddenGroups.includes(group);
        const label = changeGroupLabel(group);
        const badgeClass = `badge badge-changed${hidden ? " badge-changed--hidden" : ""}`;

        if (!canToggle) {
          return (
            <span class={badgeClass} title={hidden ? "Δεν εμφανίζεται στο δημόσιο πρόγραμμα" : undefined}>
              ✏️ {label}
              {hidden && <span class="badge-changed-state"> (κρυφή)</span>}
            </span>
          );
        }

        return (
          <button
            type="button"
            class={`${badgeClass} badge-toggle`}
            hx-post={`/admin/programs/${activity.programId}/activities/${activity.id}/changes/${group}/toggle`}
            hx-target={`#${activityChangesId(activity.id)}`}
            hx-swap="outerHTML"
            aria-pressed={hidden ? "false" : "true"}
            aria-label={`${hidden ? "Επαναφορά" : "Απόκρυψη"} της ετικέτας «${label}» ${hidden ? "στο" : "από το"} δημόσιο πρόγραμμα`}
            title={hidden ? "Κρυφή — κάνε κλικ για επαναφορά" : "Φαίνεται στους γονείς — κάνε κλικ για απόκρυψη"}
          >
            ✏️ {label} <span class="badge-changed-state">{hidden ? "↺" : "✕"}</span>
          </button>
        );
      })}
    </div>
  );
}
