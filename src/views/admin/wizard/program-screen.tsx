import type { Activity, Leader, Program } from "../../../db/schema";
import {
  ACTIVITY_TYPE_INFO,
  changedFieldLabels,
  formatActivityDate,
  formatActivityTime,
  formatPeriod,
  googleMapsUrl,
} from "../../public/layout";
import { AdminLayout } from "../layout";
import { InfoTip } from "../info-tip";

const STATUS_LABELS: Record<Program["status"], string> = {
  draft: "Πρόχειρο",
  published: "Δημοσιευμένο",
};

function AdminActivityCard({ activity }: { activity: Activity }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  const changedFields = activity.changedAfterPublishFields ?? [];
  const editUrl = `/admin/programs/${activity.programId}/activities/${activity.id}/edit`;

  return (
    <li class={`activity-card${activity.type === "no_activity" ? " activity-card--no-activity" : ""}`}>
      <a href={editUrl} class="activity-card-link">
        <div class="activity-date">{formatActivityDate(activity.date)}</div>
        <div class="activity-badges">
          <span class="badge badge-type">
            {typeInfo.icon} {typeInfo.label}
          </span>
          {activity.isSystemWide && <span class="badge badge-system">🛡️ Δράση Συστήματος</span>}
          {changedFieldLabels(changedFields).map((label) => (
            <span class="badge badge-changed">✏️ {label}</span>
          ))}
        </div>
        {(activity.startsAt || activity.endsAt) && (
          <p class="activity-time">
            🕒 {activity.startsAt ? formatActivityTime(activity.startsAt) : "?"}
            {activity.endsAt ? ` – ${formatActivityTime(activity.endsAt)}` : ""}
          </p>
        )}
      </a>
      {/* Εκτός του <a> του edit-link: ένα <a> Google Maps δεν μπορεί να είναι εμφωλευμένο μέσα σε άλλο <a>. */}
      {activity.location &&
        (activity.locationLat != null && activity.locationLng != null ? (
          <p class="activity-location">
            <a
              href={googleMapsUrl(activity.locationLat, activity.locationLng)}
              target="_blank"
              rel="noopener noreferrer"
              class="location-link"
            >
              🗺️ {activity.location}
            </a>
          </p>
        ) : (
          <p class="activity-location">📍 {activity.location}</p>
        ))}
      <form method="post" action={`/admin/programs/${activity.programId}/activities/${activity.id}/delete`}>
        <button
          type="submit"
          class="icon-btn icon-btn--danger"
          title="Διαγραφή"
          aria-label="Διαγραφή δράσης"
          onclick="return confirm('Διαγραφή δράσης;');"
        >
          🗑
        </button>
      </form>
    </li>
  );
}

export function ProgramScreen({
  leader,
  program,
  activitiesList,
}: {
  leader: Leader;
  program: Program;
  activitiesList: Activity[];
}) {
  const label = program.sectionId === null ? "Σύστημα" : undefined;

  return (
    <AdminLayout title={label ?? "Πρόγραμμα"} leader={leader}>
      <div class="program-header">
        <div>
          <h1>{label ?? "Πρόγραμμα"}</h1>
          {label === "Σύστημα" && (
            <InfoTip text="Οι δράσεις αυτού του προγράμματος είναι Δράσεις Συστήματος — εμφανίζονται αυτόματα σε όλα τα τμήματα (Αγέλη/Ομάδα/Κοινότητα), χωρίς να χρειάζεται να τις προσθέσει ξεχωριστά κάθε βαθμοφόρος." />
          )}
          <p class="period">{formatPeriod(program.periodStart, program.periodEnd)}</p>
        </div>
        <div class="program-header-actions">
          <span class={`badge badge-status-${program.status}`}>{STATUS_LABELS[program.status]}</span>
          {program.status === "draft" && (
            <form method="post" action={`/admin/programs/${program.id}/publish`}>
              <button type="submit" class="button button-primary">
                Δημοσίευση
              </button>
            </form>
          )}
        </div>
      </div>

      <div class="quick-actions">
        <InfoTip text="Το «+ Τυπική Κυριακή» δημιουργεί αμέσως μια τυπική δράση (11:00–13:00, Λόφος, παγούρι) στην επόμενη διαθέσιμη Κυριακή και ανοίγει σε επεξεργασία για τυχόν αλλαγές. Το «🚫 Χωρίς δράση» μαρκάρει την επόμενη Κυριακή ως χωρίς συγκέντρωση. Για κάθε άλλη περίπτωση, χρησιμοποίησε «+ Νέα δράση»." />
        <form method="post" action={`/admin/programs/${program.id}/activities/quick-typical`}>
          <button type="submit" class="button">
            + Τυπική Κυριακή
          </button>
        </form>
        <form method="post" action={`/admin/programs/${program.id}/activities/quick-no-activity`}>
          <button type="submit" class="button" onclick="return confirm('Σήμανση της επόμενης Κυριακής ως Χωρίς δράση;');">
            🚫 Χωρίς δράση
          </button>
        </form>
        <a class="button" href={`/admin/programs/${program.id}/activities/new`}>
          + Νέα δράση
        </a>
      </div>

      {activitiesList.length === 0 ? (
        <p class="empty-state">Δεν υπάρχουν ακόμα δράσεις σε αυτό το πρόγραμμα.</p>
      ) : (
        <ul class="activity-list">
          {activitiesList.map((activity) => (
            <AdminActivityCard activity={activity} />
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}
