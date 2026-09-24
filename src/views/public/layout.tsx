import type { activities, sections, SystemNote } from "../../db/schema";
import type { ActivityCustomField, DetailedActivity } from "../../lib/notes";
import { LoginForm } from "../admin/login";

type SectionType = typeof sections.$inferSelect.type;
type ActivityRow = typeof activities.$inferSelect;

export const SECTION_ORDER: SectionType[] = ["agele", "omada", "koinotita"];

export const SECTION_LABELS: Record<SectionType, string> = {
  agele: "Αγέλη",
  omada: "Ομάδα",
  koinotita: "Κοινότητα",
};

export type SectionVariant = {
  type: SectionType;
  accent: string;
  bodyClass: string;
};

/** Ταυτότητα ανά τμήμα (accent/theme class) — πηγή αλήθειας για δημόσιες σελίδες + αρχική. */
export const SECTION_VARIANTS: Record<SectionType, SectionVariant> = {
  agele: { type: "agele", accent: "#eab308", bodyClass: "theme-agele" },
  omada: { type: "omada", accent: "#16a34a", bodyClass: "theme-omada" },
  koinotita: { type: "koinotita", accent: "#dc2626", bodyClass: "theme-koinotita" },
};

/** Λογότυπα τμήματος (public/images) — εικονίδιο ταυτότητας στις κάρτες της αρχικής. */
export const SECTION_LOGOS: Record<SectionType, string> = {
  agele: "/public/images/Logo_cubs.png",
  omada: "/public/images/Logo_scouts.png",
  koinotita: "/public/images/Logo_explorers.png",
};

export type SectionDocument = {
  /** Διαδρομή του PDF μέσα στο `public/docs/` (σερβίρεται ως στατικό αρχείο). */
  href: string;
  label: string;
  /** Όνομα αρχείου που βλέπει ο επισκέπτης όταν το κατεβάζει. */
  downloadName: string;
  hint: string;
};

/** Κοινό σε όλα τα τμήματα — απαραίτητο για κάθε συμμετοχή σε δράση (ΣΕΠ). */
const HEALTH_FORM: SectionDocument = {
  href: "/public/docs/deltio-ygeias.pdf",
  label: "Ατομικό Δελτίο Υγείας",
  downloadName: "Ατομικό Δελτίο Υγείας.pdf",
  hint: "Συμπληρώνεται από γονέα και ιατρό στην αρχή κάθε προσκοπικής περιόδου.",
};

function parentsGuide(sectionLabel: string, file: string): SectionDocument {
  return {
    href: `/public/docs/${file}`,
    label: "Ενημερωτικό γονέων",
    downloadName: `Ενημερωτικό γονέων ${sectionLabel}.pdf`,
    hint: `Τι είναι και πώς λειτουργεί η ${sectionLabel}, παιδαγωγικοί στόχοι, επικοινωνία με το επιτελείο.`,
  };
}

/** Έγγραφα προς λήψη ανά τμήμα (δημόσια σελίδα τμήματος) — πηγή αλήθειας. */
export const SECTION_DOCUMENTS: Record<SectionType, SectionDocument[]> = {
  agele: [parentsGuide("Αγέλης", "enimerotiko-goneon-ageli.pdf"), HEALTH_FORM],
  omada: [parentsGuide("Ομάδας", "enimerotiko-goneon-omada.pdf"), HEALTH_FORM],
  koinotita: [HEALTH_FORM],
};

export const ACTIVITY_TYPE_INFO: Record<ActivityRow["type"], { icon: string; label: string }> = {
  typical: { icon: "🏕️", label: "Τυπική συγκέντρωση" },
  day_trip: { icon: "🚌", label: "Ημερήσια δράση" },
  multi_day: { icon: "🎒", label: "Διήμερη δράση" },
  other: { icon: "⭐", label: "Άλλη δράση" },
  no_activity: { icon: "🚫", label: "Χωρίς δράση" },
};

export const CHANGED_FIELD_LABELS: Record<string, string> = {
  location: "Άλλαξε η τοποθεσία",
  locationLat: "Άλλαξε η τοποθεσία",
  locationLng: "Άλλαξε η τοποθεσία",
  startsAt: "Άλλαξε η ώρα έναρξης",
  endsAt: "Άλλαξε η ώρα λήξης",
  date: "Άλλαξε η ημερομηνία",
  cost: "Άλλαξε το κόστος",
  whatToBring: "Άλλαξε τι να κρατάνε",
};

/** Ετικέτες αλλαγμένων πεδίων, deduped (π.χ. `location`+`locationLat`+`locationLng` μαζί → μία ετικέτα "Άλλαξε η τοποθεσία"). */
export function changedFieldLabels(changedFields: string[]): string[] {
  return [...new Set(changedFields.map((field) => CHANGED_FIELD_LABELS[field] ?? "Άλλαξε κάτι"))];
}

/** Google Maps link για προαιρετικές συντεταγμένες τοποθεσίας δράσης. */
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Δημόσιο, μη μαντεύσιμο .ics URL τμήματος (§9 architecture doc) — απόλυτο, βάσει BASE_URL. */
export function icalFeedUrl(section: Pick<typeof sections.$inferSelect, "id" | "icalPublicToken">): string {
  return `${process.env.BASE_URL ?? ""}/ical/${section.id}/${section.icalPublicToken}.ics`;
}

/** Ίδιο URL με πρωτόκολλο webcal:// — ανοίγει απευθείας τη ροή "εγγραφή" σε Ημερολόγιο στα περισσότερα κινητά/desktop clients. */
export function icalWebcalUrl(section: Pick<typeof sections.$inferSelect, "id" | "icalPublicToken">): string {
  return icalFeedUrl(section).replace(/^https?:\/\//, "webcal://");
}

const timeFormatter = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const weekdayFormatter = new Intl.DateTimeFormat("el-GR", { weekday: "long" });
const shortWeekdayFormatter = new Intl.DateTimeFormat("el-GR", { weekday: "short" });
/** Αριθμητική ημερομηνία σε μορφή ηη/μμ/εεεε (δεσμευτική σε όλη την εφαρμογή, βλ. ux-ui-guidelines §1). */
const numericDateFormatter = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Ημερομηνία σε μορφή ηη/μμ/εεεε (π.χ. "05/08/2026"). */
export function formatDateNumeric(date: Date): string {
  return numericDateFormatter.format(date);
}

/** Ημέρα + ημερομηνία ηη/μμ/εεεε (π.χ. "Τρίτη, 05/08/2026"). */
export function formatActivityDate(date: Date): string {
  return `${weekdayFormatter.format(date)}, ${formatDateNumeric(date)}`;
}

export function formatActivityTime(date: Date): string {
  return timeFormatter.format(date);
}

/** Μόνο η ημέρα (π.χ. "Κυριακή") — για έντονη προβολή στην κάρτα της αρχικής. */
export function formatWeekday(date: Date): string {
  return weekdayFormatter.format(date);
}

/** Σύντομη ημέρα + αριθμός (π.χ. "Κυρ 13/07/2026") — για τη σύνοψη μήνα στην πίσω όψη. */
export function formatShortDay(date: Date): string {
  return `${shortWeekdayFormatter.format(date)} ${formatDateNumeric(date)}`;
}

/** Εύρος ωρών σε 24ωρη μορφή, ή null αν δεν υπάρχει ώρα έναρξης. */
export function formatTimeRange(startsAt: Date | null, endsAt: Date | null): string | null {
  if (!startsAt) return null;
  return endsAt ? `${formatActivityTime(startsAt)} – ${formatActivityTime(endsAt)}` : formatActivityTime(startsAt);
}

export function formatPeriod(periodStart: Date, periodEnd: Date): string {
  return `${formatDateNumeric(periodStart)} – ${formatDateNumeric(periodEnd)}`;
}

/**
 * Τα δυναμικά πεδία της δράσης (τίτλος + περιγραφή, purpose doc §4) — εμφανίζονται μόνο
 * όσα έχουν συμπληρωθεί, ποτέ κενό πεδίο (ux-ui-guidelines §3.1).
 */
export function ActivityCustomFields({ customFields }: { customFields: ActivityCustomField[] }) {
  const filled = customFields.filter((field) => field.title !== "" || field.description !== "");
  if (filled.length === 0) return null;

  return (
    <dl class="activity-custom-fields">
      {filled.map((field) => (
        <>
          {field.title && <dt>{field.title}</dt>}
          {field.description && <dd>{field.description}</dd>}
        </>
      ))}
    </dl>
  );
}

/**
 * Σημειώσεις Συστήματος που καλύπτουν την ημέρα της δράσης (purpose doc §5.2) — επιπλέον
 * πεδίο μέσα στην κάρτα, κοινό σε όλα τα τμήματα, όχι ξεχωριστή δράση. Εικονίδιο + κείμενο
 * ("Σύστημα"), όχι μόνο χρώμα, ώστε να είναι σαφές και χωρίς αντίληψη χρώματος (§3.1).
 */
export function ActivitySystemNotes({ notes }: { notes: SystemNote[] }) {
  if (notes.length === 0) return null;

  return (
    <ul class="activity-system-notes">
      {notes.map((note) => (
        <li class="activity-system-note">
          <span class="activity-system-note-label">📣 Σύστημα</span> {note.text}
          {note.changedAfterPublish && <span class="badge badge-changed">✏️ Άλλαξε η σημείωση</span>}
        </li>
      ))}
    </ul>
  );
}

export function ActivityCard({ activity }: { activity: DetailedActivity }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  const changedFields = activity.changedAfterPublishFields ?? [];

  if (activity.type === "no_activity") {
    return (
      <li class="activity-card activity-card--no-activity">
        <div class="activity-date">{formatActivityDate(activity.date)}</div>
        <p class="activity-no-activity-note">
          {typeInfo.icon} Δεν θα γίνει συγκέντρωση αυτή την ημέρα.
        </p>
      </li>
    );
  }

  return (
    <li class="activity-card">
      <div class="activity-date">{formatActivityDate(activity.date)}</div>
      <div class="activity-body">
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
        {activity.cost && <p class="activity-cost">💶 {activity.cost}</p>}
        {activity.whatToBring && <p class="activity-what-to-bring">🎒 Τι να φέρετε: {activity.whatToBring}</p>}
        <ActivityCustomFields customFields={activity.customFields} />
        <ActivitySystemNotes notes={activity.notes} />
      </div>
    </li>
  );
}

/**
 * Χρήσιμα PDF έγγραφα προς λήψη (ενημερωτικό γονέων ανά τμήμα, Ατομικό Δελτίο Υγείας σε όλα).
 * Δευτερεύον περιεχόμενο: μπαίνει κάτω από το πρόγραμμα, ώστε να μην ανταγωνίζεται τις δράσεις (§3.1).
 */
export function SectionDocuments({ type }: { type: SectionType }) {
  const documents = SECTION_DOCUMENTS[type];
  if (documents.length === 0) return null;

  return (
    <section class="section-documents" aria-labelledby="section-documents-heading">
      <h2 id="section-documents-heading">Χρήσιμα έγγραφα</h2>
      <ul class="document-list">
        {documents.map((document) => (
          <li>
            <a class="document-link" href={document.href} download={document.downloadName}>
              <span class="document-icon" aria-hidden="true">
                📄
              </span>
              <span class="document-text">
                <span class="document-label">{document.label}</span>
                <span class="document-hint">{document.hint}</span>
              </span>
              <span class="document-action">Λήψη PDF ⬇</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SectionNav({ active }: { active?: SectionType }) {
  return (
    <nav class="section-nav" aria-label="Επιλογή τμήματος">
      {SECTION_ORDER.map((type) => (
        <a href={`/${type}`} class={active === type ? "active" : ""} aria-current={active === type ? "page" : undefined}>
          {SECTION_LABELS[type]}
        </a>
      ))}
    </nav>
  );
}

type PublicLayoutProps = {
  title: string;
  activeSection?: SectionType;
  accent?: string;
  bodyClass?: string;
  loginStatus?: string;
  loginError?: string;
  isLoggedIn?: boolean;
  children: unknown;
};

export function PublicLayout({
  title,
  activeSection,
  accent,
  bodyClass,
  loginStatus,
  loginError,
  isLoggedIn,
  children,
}: PublicLayoutProps) {
  const currentPath = activeSection ? `/${activeSection}` : "/";

  return (
    <html lang="el">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/public/styles.css" />
        {accent && (
          <style dangerouslySetInnerHTML={{ __html: `:root { --section-accent: ${accent}; }` }} />
        )}
      </head>
      <body class={bodyClass}>
        <header class="site-header">
          <a class="site-title" href="/" aria-label="Αρχική — 4ο Σύστημα Αεροπροσκόπων Ηρακλείου">
            <img
              class="site-logo"
              src="/public/images/%CE%9B%CE%BF%CE%B3%CF%8C%CF%84%CF%85%CF%80%CE%BF%20%CE%91%CF%80%CE%BB%CF%8C.png"
              alt=""
              aria-hidden="true"
            />
          </a>
          <SectionNav active={activeSection} />
          {isLoggedIn ? (
            <a href="/admin" class="login-trigger" aria-label="Διαχείριση δράσεων" title="Διαχείριση δράσεων">
              🛠️
            </a>
          ) : (
            <a
              href={`/auth/login?returnTo=${encodeURIComponent(currentPath)}`}
              class="login-trigger"
              aria-label="Σύνδεση βαθμοφόρων"
              title="Σύνδεση βαθμοφόρων"
              onclick="event.preventDefault(); document.getElementById('login-dialog').showModal();"
            >
              🔑
            </a>
          )}
        </header>

        <main>{children}</main>

        <footer class="site-footer">
          <p>4ο Σύστημα Αεροπροσκόπων Ηρακλείου — program.lofos.gr</p>
        </footer>

        <dialog id="login-dialog">
          <form method="dialog" class="dialog-close-form">
            <button type="submit" aria-label="Κλείσιμο">
              ✕
            </button>
          </form>
          <LoginForm error={loginError} linkSent={loginStatus === "sent"} returnTo={currentPath} />
        </dialog>

        {loginStatus && (
          <script
            dangerouslySetInnerHTML={{ __html: "document.getElementById('login-dialog').showModal();" }}
          />
        )}

        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){document.addEventListener('pointermove',function(e){document.body.style.setProperty('--mx',(e.clientX/window.innerWidth*100)+'%');document.body.style.setProperty('--my',(e.clientY/window.innerHeight*100)+'%');});})();`,
          }}
        />
      </body>
    </html>
  );
}

export function SectionSchedulePage({
  section,
  program,
  scheduleActivities,
  variant,
  loginStatus,
  loginError,
  isLoggedIn,
}: {
  section: typeof sections.$inferSelect;
  program: { periodStart: Date; periodEnd: Date; themeTitle: string | null } | null;
  scheduleActivities: DetailedActivity[];
  variant: SectionVariant;
  loginStatus?: string;
  loginError?: string;
  isLoggedIn?: boolean;
}) {
  const label = SECTION_LABELS[variant.type];

  return (
    <PublicLayout
      title={`${label} — πρόγραμμα δράσεων`}
      activeSection={variant.type}
      accent={variant.accent}
      bodyClass={variant.bodyClass}
      loginStatus={loginStatus}
      loginError={loginError}
      isLoggedIn={isLoggedIn}
    >
      <section class="hero">
        <img class="hero-logo" src={SECTION_LOGOS[variant.type]} alt="" aria-hidden="true" />
        <h1>{program?.themeTitle || label}</h1>
        {program && <p class="period">{formatPeriod(program.periodStart, program.periodEnd)}</p>}
      </section>

      <section class="ical-subscribe">
        <a class="btn-ical" href={icalWebcalUrl(section)}>
          📅 Πρόσθεσε στο ημερολόγιο του κινητού σου
        </a>
        <p class="ical-subscribe-hint">
          Το πρόγραμμα της {label} ενημερώνεται αυτόματα στο ημερολόγιό σου. Αν το κουμπί δεν ανοίξει το
          ημερολόγιο, αντέγραψε το link:{" "}
          <a href={icalFeedUrl(section)} class="ical-subscribe-link">
            {icalFeedUrl(section)}
          </a>
        </p>
      </section>

      {!program ? (
        <p class="empty-state">Δεν υπάρχει ακόμα δημοσιευμένο πρόγραμμα για την {label}.</p>
      ) : scheduleActivities.length === 0 ? (
        <p class="empty-state">Το πρόγραμμα δεν έχει ακόμα δράσεις.</p>
      ) : (
        <ul class="activity-list">
          {scheduleActivities.map((activity) => (
            <ActivityCard activity={activity} />
          ))}
        </ul>
      )}

      <SectionDocuments type={variant.type} />
    </PublicLayout>
  );
}
