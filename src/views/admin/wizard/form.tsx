import type { Activity, Leader, Program } from "../../../db/schema";
import { ACTIVITY_TYPE_INFO, formatDateNumeric } from "../../public/layout";
import { typeDefaults, type ActivityTypeDefaults } from "../../../lib/activities";
import { AdminLayout } from "../layout";
import { OverlapWarning } from "./overlap-warning";

type ActivityType = Activity["type"];

const ACTIVITY_TYPE_ORDER: ActivityType[] = ["typical", "day_trip", "multi_day", "other", "no_activity"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type CustomFieldValue = { title: string; description: string };

export type ActivityFormValues = {
  date: Date;
  type: ActivityType;
  location: string;
  startTime: string;
  endTime: string;
  cost: string;
  whatToBring: string;
  customFields: CustomFieldValue[];
  participantIds: number[];
};

const EMPTY_CUSTOM_FIELDS: CustomFieldValue[] = [{ title: "", description: "" }, { title: "", description: "" }, { title: "", description: "" }];

export function defaultFormValues(type: ActivityType, date: Date): ActivityFormValues {
  const defaults: ActivityTypeDefaults = typeDefaults(type);
  return {
    date,
    type,
    location: defaults.location ?? "",
    startTime: defaults.startTime ?? "",
    endTime: defaults.endTime ?? "",
    cost: "",
    whatToBring: defaults.whatToBring ?? "",
    customFields: EMPTY_CUSTOM_FIELDS,
    participantIds: [],
  };
}

export function formValuesFromActivity(
  activity: Activity,
  customFields: CustomFieldValue[],
  participantIds: number[],
): ActivityFormValues {
  return {
    date: activity.date,
    type: activity.type,
    location: activity.location ?? "",
    startTime: activity.startsAt ? toTimeInputValue(activity.startsAt) : "",
    endTime: activity.endsAt ? toTimeInputValue(activity.endsAt) : "",
    cost: activity.cost ?? "",
    whatToBring: activity.whatToBring ?? "",
    customFields:
      customFields.length > 0
        ? [...customFields, ...EMPTY_CUSTOM_FIELDS].slice(0, Math.max(3, customFields.length))
        : EMPTY_CUSTOM_FIELDS,
    participantIds,
  };
}

function ActivityFields({
  values,
  participantsAvailable,
}: {
  values: ActivityFormValues;
  participantsAvailable: Leader[];
}) {
  if (values.type === "no_activity") {
    return (
      <p class="hint">
        Καμία άλλη πληροφορία δεν χρειάζεται — η ημερομηνία απλώς μαρκάρεται ως "Χωρίς δράση".
      </p>
    );
  }

  return (
    <>
      <section class="wizard-step">
        <label for="location">Τόπος</label>
        <input type="text" id="location" name="location" value={values.location} maxlength={200} />

        {values.type === "multi_day" ? (
          <>
            <label for="startTime">Ημερομηνία έναρξης (ώρα)</label>
            <input type="time" id="startTime" name="startTime" value={values.startTime} />
            <label for="endTime">Ημερομηνία/ώρα λήξης</label>
            <input type="time" id="endTime" name="endTime" value={values.endTime} />
          </>
        ) : (
          <>
            <label for="startTime">Ώρα έναρξης</label>
            <input type="time" id="startTime" name="startTime" value={values.startTime} />
            <label for="endTime">Ώρα λήξης</label>
            <input type="time" id="endTime" name="endTime" value={values.endTime} />
          </>
        )}
      </section>

      <details class="wizard-step wizard-step--optional">
        <summary>Προαιρετικά</summary>
        <label for="cost">Κόστος συμμετοχής</label>
        <input type="text" id="cost" name="cost" value={values.cost} maxlength={100} placeholder="π.χ. 5€" />
        <label for="whatToBring">Τι να κρατάνε</label>
        <input type="text" id="whatToBring" name="whatToBring" value={values.whatToBring} maxlength={200} />
        {participantsAvailable.length > 0 && (
          <>
            <label for="participantIds">Συμμετέχοντες βαθμοφόροι</label>
            <select id="participantIds" name="participantIds" multiple size={Math.min(4, participantsAvailable.length)}>
              {participantsAvailable.map((p) => (
                <option value={p.id} selected={values.participantIds.includes(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
      </details>

      <details class="wizard-step wizard-step--optional">
        <summary>Δυναμικά πεδία</summary>
        {values.customFields.map((field, index) => (
          <fieldset class="custom-field">
            <label for={`customFieldTitle${index}`}>Τίτλος</label>
            <input type="text" id={`customFieldTitle${index}`} name={`customFieldTitle${index}`} value={field.title} maxlength={100} />
            <label for={`customFieldDescription${index}`}>Περιγραφή</label>
            <textarea id={`customFieldDescription${index}`} name={`customFieldDescription${index}`} maxlength={1000}>
              {field.description}
            </textarea>
          </fieldset>
        ))}
      </details>
    </>
  );
}

export function ActivityFormBody({
  program,
  values,
  dateChips,
  overlap,
  editingActivityId,
  actionUrl,
  participantsAvailable,
}: {
  program: Program;
  values: ActivityFormValues;
  dateChips: Date[];
  overlap: { existing: Activity | null; blocked: boolean };
  editingActivityId?: number;
  actionUrl: string;
  participantsAvailable: Leader[];
}) {
  const checkDateUrl = `/admin/programs/${program.id}/activities/check-date`;
  const fieldsUrl = `/admin/programs/${program.id}/activities/fields`;

  return (
    <form method="post" action={actionUrl} class="activity-form">
      <section class="wizard-step">
        <label for="date">Ημερομηνία</label>
        {dateChips.length > 0 && (
          <div class="date-chips">
            {dateChips.map((chip) => (
              <button
                type="button"
                class="chip"
                onclick={`var d=document.getElementById('date'); d.value='${toDateInputValue(chip)}'; d.dispatchEvent(new Event('change'));`}
              >
                {formatDateNumeric(chip)}
              </button>
            ))}
          </div>
        )}
        <input
          type="date"
          id="date"
          name="date"
          value={toDateInputValue(values.date)}
          required
          hx-get={checkDateUrl}
          hx-trigger="change"
          hx-target="#overlap-warning"
          hx-swap="innerHTML"
          hx-include="#date,#editingActivityId"
        />
        <input type="hidden" id="editingActivityId" name="editingActivityId" value={editingActivityId ?? ""} />
        <div id="overlap-warning">
          <OverlapWarning existing={overlap.existing} blocked={overlap.blocked} editingActivityId={editingActivityId} />
        </div>

        <label for="type">Τύπος δράσης</label>
        <select
          id="type"
          name="type"
          hx-get={fieldsUrl}
          hx-trigger="change"
          hx-target="#activity-fields"
          hx-swap="innerHTML"
          hx-include="#type,#date"
        >
          {ACTIVITY_TYPE_ORDER.map((type) => (
            <option value={type} selected={type === values.type}>
              {ACTIVITY_TYPE_INFO[type].icon} {ACTIVITY_TYPE_INFO[type].label}
            </option>
          ))}
        </select>
      </section>

      <div id="activity-fields">
        <ActivityFields values={values} participantsAvailable={participantsAvailable} />
      </div>

      <button type="submit" class="button button-primary sticky-save">
        Αποθήκευση
      </button>
    </form>
  );
}

export function ActivityFormPage({
  leader,
  program,
  values,
  dateChips,
  overlap,
  editingActivityId,
  title,
  participantsAvailable,
}: {
  leader: Leader;
  program: Program;
  values: ActivityFormValues;
  dateChips: Date[];
  overlap: { existing: Activity | null; blocked: boolean };
  editingActivityId?: number;
  title: string;
  participantsAvailable: Leader[];
}) {
  const actionUrl = editingActivityId
    ? `/admin/programs/${program.id}/activities/${editingActivityId}`
    : `/admin/programs/${program.id}/activities`;

  return (
    <AdminLayout title={title} leader={leader}>
      <h1>{title}</h1>
      <ActivityFormBody
        program={program}
        values={values}
        dateChips={dateChips}
        overlap={overlap}
        editingActivityId={editingActivityId}
        actionUrl={actionUrl}
        participantsAvailable={participantsAvailable}
      />
    </AdminLayout>
  );
}

export { ActivityFields };
