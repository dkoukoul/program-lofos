import type { Activity, Leader, Program } from "../../../db/schema";
import { ACTIVITY_TYPE_INFO, formatDateNumeric, googleMapsUrl } from "../../public/layout";
import { typeDefaults, type ActivityTypeDefaults } from "../../../lib/activities";
import { AdminLayout } from "../layout";
import { InfoTip } from "../info-tip";
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

const TIME_HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const TIME_MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/**
 * Δύο native <select> (ώρα/λεπτά) αντί για <input type="time">: το Firefox desktop δεν δείχνει
 * κανένα picker UI για type="time" (μόνο spinners), ενώ τα <select> δίνουν συνεπή εμφάνιση σε όλα
 * τα browsers. Ο συνδυασμός γράφεται σε κρυφό input με το ίδιο name ώστε η φόρμα/routes να μη
 * χρειάζονται αλλαγή — η συγχρονισμός γίνεται από το script στο AdminLayout.
 */
export function TimeInput({ id, name, value }: { id?: string; name: string; value: string }) {
  const [h, m] = value.includes(":") ? value.split(":") : ["", ""];
  return (
    <span class="time-input" data-time-input>
      <input type="hidden" name={name} value={value} data-time-value />
      <select id={id} aria-label="Ώρα" data-time-hour>
        <option value="" selected={h === ""}>
          --
        </option>
        {TIME_HOURS.map((hh) => (
          <option value={hh} selected={hh === h}>
            {hh}
          </option>
        ))}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Λεπτά" data-time-minute>
        <option value="" selected={m === ""}>
          --
        </option>
        {TIME_MINUTES.map((mm) => (
          <option value={mm} selected={mm === m}>
            {mm}
          </option>
        ))}
      </select>
    </span>
  );
}

export type CustomFieldValue = { title: string; description: string };

export type ActivityFormValues = {
  date: Date;
  type: ActivityType;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
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
    locationLat: null,
    locationLng: null,
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
    locationLat: activity.locationLat,
    locationLng: activity.locationLng,
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
        <label for="location">Τοποθεσία</label>
        <input type="text" id="location" name="location" value={values.location} maxlength={200} />

        <input type="hidden" id="locationLat" name="locationLat" value={values.locationLat ?? ""} />
        <input type="hidden" id="locationLng" name="locationLng" value={values.locationLng ?? ""} />
        <div class="location-picker">
          <button type="button" class="button location-picker-toggle" id="location-picker-toggle">
            📍 Επιλογή στον χάρτη
          </button>
          <span id="location-picker-status" class="location-picker-status">
            {values.locationLat != null && values.locationLng != null && (
              <>
                Επιλεγμένο σημείο —{" "}
                <a href={googleMapsUrl(values.locationLat, values.locationLng)} target="_blank" rel="noopener noreferrer">
                  🗺️ άνοιγμα στο Google Maps
                </a>{" "}
                · <button type="button" data-location-clear class="link-button">Καθαρισμός</button>
              </>
            )}
          </span>
          <div id="location-picker-map" class="location-picker-map" hidden={values.locationLat == null}></div>
        </div>

        {values.type === "multi_day" ? (
          <>
            <label for="startTime">Ημερομηνία έναρξης (ώρα)</label>
            <TimeInput id="startTime" name="startTime" value={values.startTime} />
            <label for="endTime">Ημερομηνία/ώρα λήξης</label>
            <TimeInput id="endTime" name="endTime" value={values.endTime} />
          </>
        ) : (
          <>
            <label for="startTime">Ώρα έναρξης</label>
            <TimeInput id="startTime" name="startTime" value={values.startTime} />
            <label for="endTime">Ώρα λήξης</label>
            <TimeInput id="endTime" name="endTime" value={values.endTime} />
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
        <InfoTip text="Έως 3 προαιρετικά ζεύγη τίτλος/περιγραφή, για ό,τι δεν καλύπτεται από κόστος/τι-να-κρατάνε (π.χ. οδηγίες, σημείο συνάντησης). Κενά πεδία αγνοούνται στην αποθήκευση." />
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
        <InfoTip text="Τα κουμπιά από κάτω προτείνουν τις επόμενες διαθέσιμες Κυριακές, αλλά μπορείς πάντα να διαλέξεις οποιαδήποτε άλλη ημέρα από το ημερολόγιο. Αν υπάρχει ήδη δράση εκείνη τη μέρα, θα εμφανιστεί προειδοποίηση." />
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
        <InfoTip text="Κάθε τύπος προσυμπληρώνει ό,τι συνηθίζεται (π.χ. η Τυπική βάζει αυτόματα ώρα/τόπο) — όλα τα πεδία μένουν ελεύθερα επεξεργάσιμα. Δεν υπάρχει ξεχωριστή επιλογή «Δράση Συστήματος»: καθορίζεται αυτόματα από το αν βρίσκεσαι στο πρόγραμμα «Σύστημα»." />
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

/**
 * Χειρισμός του optional map picker (Leaflet + OpenStreetMap tiles, vendored χωρίς API key —
 * βλ. docs/decisions.md). Ζει ΕΚΤΟΣ του #activity-fields (που αντικαθίσταται μέσω htmx σε κάθε
 * αλλαγή τύπου δράσης), άρα τρέχει μία φορά ανά φόρτωση σελίδας· ακούει `htmx:afterSwap` για να
 * ξαναρχικοποιήσει το map instance μετά από κάθε τέτοιο swap (το παλιό DOM node καταστρέφεται).
 */
const LOCATION_PICKER_SCRIPT = `(function(){
  var DEFAULT_CENTER=[35.3387,25.1442];
  var map=null, marker=null;
  function els(){
    return {
      lat: document.getElementById('locationLat'),
      lng: document.getElementById('locationLng'),
      mapDiv: document.getElementById('location-picker-map'),
      status: document.getElementById('location-picker-status')
    };
  }
  function renderStatus(lat,lng){
    var e=els();
    if(!e.status) return;
    if(lat==null||lng==null){ e.status.innerHTML=''; return; }
    var url='https://www.google.com/maps/search/?api=1&query='+lat+','+lng;
    e.status.innerHTML='Επιλεγμένο σημείο — <a href="'+url+'" target="_blank" rel="noopener noreferrer">🗺️ άνοιγμα στο Google Maps</a> · <button type="button" data-location-clear class="link-button">Καθαρισμός</button>';
  }
  function setCoords(lat,lng){
    var e=els();
    if(e.lat) e.lat.value=lat;
    if(e.lng) e.lng.value=lng;
    renderStatus(lat,lng);
  }
  function clearCoords(){
    var e=els();
    if(e.lat) e.lat.value='';
    if(e.lng) e.lng.value='';
    if(marker){ marker.remove(); marker=null; }
    renderStatus(null,null);
  }
  function ensureMap(){
    var e=els();
    if(!e.mapDiv||map||typeof L==='undefined') return;
    var initialLat=e.lat&&e.lat.value?parseFloat(e.lat.value):null;
    var initialLng=e.lng&&e.lng.value?parseFloat(e.lng.value):null;
    var center=(initialLat!=null&&initialLng!=null)?[initialLat,initialLng]:DEFAULT_CENTER;
    map=L.map(e.mapDiv).setView(center, initialLat!=null?15:13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom:19
    }).addTo(map);
    if(initialLat!=null&&initialLng!=null){ marker=L.marker(center).addTo(map); }
    map.on('click', function(ev){
      var lat=ev.latlng.lat.toFixed(6), lng=ev.latlng.lng.toFixed(6);
      if(marker){ marker.setLatLng(ev.latlng); } else { marker=L.marker(ev.latlng).addTo(map); }
      setCoords(lat,lng);
    });
  }
  if(typeof L!=='undefined'){
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:'/public/vendor/leaflet/images/marker-icon-2x.png',
      iconUrl:'/public/vendor/leaflet/images/marker-icon.png',
      shadowUrl:'/public/vendor/leaflet/images/marker-shadow.png'
    });
  }
  document.addEventListener('click', function(ev){
    if(ev.target.closest('#location-picker-toggle')){
      var e=els();
      if(!e.mapDiv) return;
      var hidden=e.mapDiv.hasAttribute('hidden');
      if(hidden){
        e.mapDiv.removeAttribute('hidden');
        ensureMap();
        setTimeout(function(){ if(map) map.invalidateSize(); }, 0);
      } else {
        e.mapDiv.setAttribute('hidden','');
      }
    }
    if(ev.target.closest('[data-location-clear]')){ clearCoords(); }
  });
  document.body.addEventListener('htmx:afterSwap', function(ev){
    if(ev.target&&ev.target.id==='activity-fields'){ map=null; marker=null; }
  });
  document.addEventListener('DOMContentLoaded', function(){
    var e=els();
    if(e.mapDiv&&!e.mapDiv.hasAttribute('hidden')) ensureMap();
  });
})();`;

const LEAFLET_HEAD = (
  <>
    <link rel="stylesheet" href="/public/vendor/leaflet/leaflet.css" />
    <script src="/public/vendor/leaflet/leaflet.js" />
  </>
);

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
    <AdminLayout title={title} leader={leader} extraHead={LEAFLET_HEAD}>
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
      {editingActivityId && (
        <form method="post" action={`/admin/programs/${program.id}/activities/${editingActivityId}/delete`}>
          <button
            type="submit"
            class="icon-btn icon-btn--danger"
            title="Διαγραφή δράσης"
            aria-label="Διαγραφή δράσης"
            onclick="return confirm('Διαγραφή δράσης;');"
          >
            🗑
          </button>
        </form>
      )}
      <script dangerouslySetInnerHTML={{ __html: LOCATION_PICKER_SCRIPT }} />
    </AdminLayout>
  );
}

export { ActivityFields };
