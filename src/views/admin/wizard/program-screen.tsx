import type { Leader, Program, SystemNote } from "../../../db/schema";
import { isTimeTbd } from "../../../lib/activities";
import type { DetailedActivity } from "../../../lib/notes";
import type { SundayCoverage, TimelineItem } from "../../../lib/program-overview";
import {
  ACTIVITY_TYPE_INFO,
  ActivityCustomFields,
  ActivitySystemNotes,
  formatActivityDate,
  formatActivityTime,
  formatPeriod,
  googleMapsUrl,
} from "../../public/layout";
import { AdminLayout } from "../layout";
import { ActivityChangeBadges } from "../change-badges";
import { InfoTip } from "../info-tip";
import { SystemNotesPanel } from "../notes";
import { STATUS_LABELS, periodTitle, previewUrl, scopeLabel, type SectionKind } from "../program-labels";
import { TimeInput, toDateInputValue, toTimeInputValue } from "./form";

export function activityCardId(activityId: number): string {
  return `activity-${activityId}`;
}

function cardUrl(activity: Pick<DetailedActivity, "id" | "programId">, suffix: string): string {
  return `/admin/programs/${activity.programId}/activities/${activity.id}/${suffix}`;
}

function ActivityTime({ activity }: { activity: DetailedActivity }) {
  if (activity.type === "no_activity") return null;
  if (isTimeTbd(activity)) return <p class="activity-time">🕒 Δεν έχει οριστεί ώρα ακόμα</p>;
  return (
    <p class="activity-time">
      🕒 {activity.startsAt ? formatActivityTime(activity.startsAt) : "?"}
      {activity.endsAt ? ` – ${formatActivityTime(activity.endsAt)}` : ""}
    </p>
  );
}

function ActivityLocation({ activity }: { activity: DetailedActivity }) {
  if (!activity.location) return null;
  if (activity.locationLat != null && activity.locationLng != null) {
    return (
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
    );
  }
  return <p class="activity-location">📍 {activity.location}</p>;
}

/**
 * Κάρτα δράσης στην οθόνη προγράμματος. Δείχνει ό,τι θα δει ο επισκέπτης (ux-ui-guidelines §2.2)
 * και δύο ενέργειες: γρήγορη αλλαγή τόπου/ώρας μέσα στην ίδια κάρτα (htmx) και πλήρη επεξεργασία.
 * Η διαγραφή ζει μόνο μέσα στην πλήρη επεξεργασία, ώστε να μην πατιέται κατά λάθος από τη λίστα.
 */
export function AdminActivityCard({ activity, leader }: { activity: DetailedActivity; leader: Leader }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  const editUrl = cardUrl(activity, "edit");

  return (
    <li
      id={activityCardId(activity.id)}
      class={`activity-card${activity.type === "no_activity" ? " activity-card--no-activity" : ""}`}
    >
      <a href={editUrl} class="activity-card-link">
        <div class="activity-date">{formatActivityDate(activity.date)}</div>
        <div class="activity-badges">
          <span class="badge badge-type">
            {typeInfo.icon} {typeInfo.label}
          </span>
          {activity.isSystemWide && <span class="badge badge-system">🛡️ Δράση Συστήματος</span>}
        </div>
        <ActivityTime activity={activity} />
      </a>
      {/* Εκτός του <a> του edit-link: τα toggles απόκρυψης είναι κουμπιά, δεν μπορούν να ζουν μέσα σε link. */}
      <ActivityChangeBadges activity={activity} leader={leader} />
      {/* Εκτός του <a> του edit-link: ένα <a> Google Maps δεν μπορεί να είναι εμφωλευμένο μέσα σε άλλο <a>. */}
      <ActivityLocation activity={activity} />
      <ActivityCustomFields customFields={activity.customFields} />
      <ActivitySystemNotes notes={activity.notes} />
      <div class="activity-card-actions">
        {activity.type !== "no_activity" && (
          <button
            type="button"
            class="button button-small"
            hx-get={`${cardUrl(activity, "quick-edit")}?view=card`}
            hx-target={`#${activityCardId(activity.id)}`}
            hx-swap="outerHTML"
          >
            ✎ Τόπος/ώρα
          </button>
        )}
        <a class="button button-small" href={editUrl}>
          Επεξεργασία
        </a>
      </div>
    </li>
  );
}

/** Η ίδια κάρτα σε κατάσταση γρήγορης αλλαγής τόπου/ώρας — ίδιο endpoint με τον πίνακα «Όλες οι δράσεις». */
export function AdminActivityCardEditForm({ activity }: { activity: DetailedActivity }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  return (
    <li id={activityCardId(activity.id)} class="activity-card activity-card--editing">
      <div class="activity-date">{formatActivityDate(activity.date)}</div>
      <div class="activity-badges">
        <span class="badge badge-type">
          {typeInfo.icon} {typeInfo.label}
        </span>
      </div>
      <form
        class="quick-edit-form quick-edit-form--card"
        hx-post={`${cardUrl(activity, "quick-edit")}?view=card`}
        hx-target={`#${activityCardId(activity.id)}`}
        hx-swap="outerHTML"
      >
        <label class="quick-edit-label">
          Τοποθεσία
          <input type="text" name="location" value={activity.location ?? ""} placeholder="Τοποθεσία" maxlength={200} />
        </label>
        <span class="quick-edit-time">
          <TimeInput name="startTime" value={activity.startsAt ? toTimeInputValue(activity.startsAt) : ""} />
          <span aria-hidden="true">–</span>
          <TimeInput name="endTime" value={activity.endsAt ? toTimeInputValue(activity.endsAt) : ""} />
        </span>
        <span class="quick-edit-actions">
          <button type="submit" class="button button-primary button-small">
            ✓ Αποθήκευση
          </button>
          <button
            type="button"
            class="button button-small"
            hx-get={cardUrl(activity, "card")}
            hx-target={`#${activityCardId(activity.id)}`}
            hx-swap="outerHTML"
          >
            Άκυρο
          </button>
        </span>
      </form>
    </li>
  );
}

/** Δράση Συστήματος μέσα στο πρόγραμμα τμήματος: φαίνεται (έτσι θα τη δει ο γονέας) αλλά δεν αλλάζει από εδώ. */
function SystemActivityCard({ activity, leader }: { activity: DetailedActivity; leader: Leader }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  return (
    <li class="activity-card activity-card--readonly">
      <div class="activity-date">{formatActivityDate(activity.date)}</div>
      <div class="activity-badges">
        <span class="badge badge-system">🛡️ Δράση Συστήματος</span>
        <span class="badge badge-type">
          {typeInfo.icon} {typeInfo.label}
        </span>
      </div>
      <ActivityTime activity={activity} />
      <ActivityLocation activity={activity} />
      <p class="hint">
        Ορίζεται στο πρόγραμμα Συστήματος και εμφανίζεται αυτόματα σε όλα τα τμήματα.
        {leader.role === "system_staff" && (
          <>
            {" "}
            <a href={cardUrl(activity, "edit")}>Επεξεργασία</a>
          </>
        )}
      </p>
    </li>
  );
}

/** Κυριακή της περιόδου χωρίς καμία δράση: συμπληρώνεται με ένα tap, ακριβώς για αυτή τη μέρα. */
function EmptySundaySlot({ program, date, isPast }: { program: Program; date: Date; isPast: boolean }) {
  const dateValue = toDateInputValue(date);
  return (
    <li class={`activity-slot${isPast ? " activity-slot--past" : ""}`}>
      <div class="activity-date">{formatActivityDate(date)}</div>
      <p class="activity-slot-note">
        {isPast ? "Πέρασε χωρίς καταχώρηση." : "⚠ Δεν έχει οριστεί ακόμα τι γίνεται αυτή την Κυριακή."}
      </p>
      <div class="activity-slot-actions">
        <form method="post" action={`/admin/programs/${program.id}/activities/quick-typical`}>
          <input type="hidden" name="date" value={dateValue} />
          <button type="submit" class="button button-small">
            + Τυπική
          </button>
        </form>
        <form method="post" action={`/admin/programs/${program.id}/activities/quick-no-activity`}>
          <input type="hidden" name="date" value={dateValue} />
          <button type="submit" class="button button-small">
            🚫 Χωρίς δράση
          </button>
        </form>
        <a class="button button-small" href={`/admin/programs/${program.id}/activities/new?date=${dateValue}`}>
          Άλλη…
        </a>
      </div>
    </li>
  );
}

const SLOT_TIP =
  "Κάθε Κυριακή της περιόδου που δεν έχει ακόμα δράση εμφανίζεται ως κενή θέση. «+ Τυπική» βάζει αμέσως μια Τυπική δράση (11:00–13:00, Λόφος, παγούρι) εκείνη τη μέρα — αν χρειάζεται, αλλάζεις τόπο/ώρα από την κάρτα. «🚫 Χωρίς δράση» δηλώνει ότι δεν γίνεται συγκέντρωση. «Άλλη…» ανοίγει τον πλήρη οδηγό για εκείνη τη μέρα. Για δράση σε μέρα που δεν είναι Κυριακή, πάτα «+ Δράση σε άλλη μέρα».";

export function ProgramScreen({
  leader,
  program,
  kind,
  timeline,
  coverage,
  notes,
  error,
  now = new Date(),
}: {
  leader: Leader;
  program: Program;
  kind: SectionKind;
  timeline: TimelineItem<DetailedActivity>[];
  /** Κάλυψη Κυριακών — μόνο για προγράμματα τμήματος (το Σύστημα δεν έχει "μία δράση κάθε Κυριακή"). */
  coverage: SundayCoverage | null;
  /** Οι Σημειώσεις Συστήματος του προγράμματος — μόνο για το πρόγραμμα Συστήματος. */
  notes: SystemNote[];
  error?: string;
  now?: Date;
}) {
  const title = `${scopeLabel(kind)} · ${periodTitle(program)}`;
  const ownCount = timeline.filter((item) => item.kind === "activity").length;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  // Το Σύστημα δεν έχει δική του δημόσια σελίδα: η προεπισκόπηση το δείχνει μέσα από την Αγέλη
  // (και από εκεί αλλάζει τμήμα το banner της προεπισκόπησης).
  const preview = previewUrl(kind === "system" ? "agele" : kind, program.id);

  return (
    <AdminLayout title={title} leader={leader} nav="programs">
      <a class="back-link" href="/admin/programs">
        ← Όλα τα προγράμματα
      </a>
      <div class="program-header">
        <div>
          <h1>{title}</h1>
          {kind === "system" && (
            <InfoTip text="Οι δράσεις αυτού του προγράμματος είναι Δράσεις Συστήματος — εμφανίζονται αυτόματα σε όλα τα τμήματα (Αγέλη/Ομάδα/Κοινότητα), χωρίς να χρειάζεται να τις προσθέσει ξεχωριστά κάθε βαθμοφόρος." />
          )}
          <p class="period">{formatPeriod(program.periodStart, program.periodEnd)}</p>
        </div>
      </div>

      <div class={`program-toolbar program-toolbar--${program.status}`}>
        <div class="program-toolbar-status">
          <span class={`badge badge-status-${program.status}`}>{STATUS_LABELS[program.status]}</span>
          <span class="program-toolbar-summary">
            {ownCount === 1 ? "1 δράση" : `${ownCount} δράσεις`}
            {coverage && coverage.total > 0 && ` · ${coverage.covered}/${coverage.total} Κυριακές`}
          </span>
          <span class="program-toolbar-hint">
            {program.status === "draft"
              ? "Δεν το βλέπουν ακόμα οι γονείς."
              : "Το βλέπουν οι γονείς — κάθε αλλαγή επισημαίνεται και στέλνει email."}
          </span>
        </div>
        <div class="program-toolbar-actions">
          <a class="button" href={preview}>
            👁 Προεπισκόπηση
          </a>
          {program.status === "draft" && (
            <form method="post" action={`/admin/programs/${program.id}/publish`}>
              <button
                type="submit"
                class="button button-primary"
                onclick="return confirm('Δημοσίευση; Το πρόγραμμα θα γίνει αμέσως ορατό στους γονείς και θα σταλεί email στους βαθμοφόρους.');"
              >
                Δημοσίευση
              </button>
            </form>
          )}
        </div>
      </div>

      {error && <p class="error">{error}</p>}

      <div class="program-list-header">
        <h2>Δράσεις</h2>
        {coverage && <InfoTip text={SLOT_TIP} />}
        <a class="button" href={`/admin/programs/${program.id}/activities/new`}>
          {coverage ? "+ Δράση σε άλλη μέρα" : "+ Νέα δράση"}
        </a>
      </div>

      {timeline.length === 0 ? (
        <p class="empty-state">Δεν υπάρχουν ακόμα δράσεις σε αυτό το πρόγραμμα.</p>
      ) : (
        <ul class="activity-list program-timeline">
          {timeline.map((item) => {
            if (item.kind === "activity") return <AdminActivityCard activity={item.activity} leader={leader} />;
            if (item.kind === "system") return <SystemActivityCard activity={item.activity} leader={leader} />;
            return <EmptySundaySlot program={program} date={item.date} isPast={item.date < startOfToday} />;
          })}
        </ul>
      )}

      {program.sectionId === null && <SystemNotesPanel program={program} notes={notes} />}

      <details class="danger-zone">
        <summary>Διαγραφή προγράμματος</summary>
        <p class="hint">
          Διαγράφει το πρόγραμμα μαζί με όλες τις δράσεις του{program.sectionId === null ? " και τις Σημειώσεις Συστήματος" : ""}.
          Δεν αναιρείται.
        </p>
        <form method="post" action={`/admin/programs/${program.id}/delete`}>
          <button
            type="submit"
            class="button button-danger"
            onclick="return confirm('Οριστική διαγραφή του προγράμματος και όλων των δράσεών του;');"
          >
            🗑 Διαγραφή «{title}»
          </button>
        </form>
      </details>
    </AdminLayout>
  );
}
