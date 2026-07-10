import type { Activity, Leader, Program } from "../../../db/schema";
import {
  ACTIVITY_TYPE_INFO,
  CHANGED_FIELD_LABELS,
  formatActivityDate,
  formatActivityTime,
  formatPeriod,
} from "../../public/layout";
import { AdminLayout } from "../layout";

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
          {changedFields.map((field) => (
            <span class="badge badge-changed">✏️ {CHANGED_FIELD_LABELS[field] ?? "Άλλαξε κάτι"}</span>
          ))}
        </div>
        {(activity.startsAt || activity.endsAt) && (
          <p class="activity-time">
            🕒 {activity.startsAt ? formatActivityTime(activity.startsAt) : "?"}
            {activity.endsAt ? ` – ${formatActivityTime(activity.endsAt)}` : ""}
          </p>
        )}
        {activity.location && <p class="activity-location">📍 {activity.location}</p>}
      </a>
      <form method="post" action={`/admin/programs/${activity.programId}/activities/${activity.id}/delete`}>
        <button type="submit" class="link-button link-button--danger" onclick="return confirm('Διαγραφή δράσης;');">
          Διαγραφή
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
