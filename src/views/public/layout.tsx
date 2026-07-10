import type { activities, sections } from "../../db/schema";
import { LoginForm } from "../admin/login";

type SectionType = typeof sections.$inferSelect.type;
type ActivityRow = typeof activities.$inferSelect;

export const SECTION_ORDER: SectionType[] = ["agele", "omada", "koinotita"];

export const SECTION_LABELS: Record<SectionType, string> = {
  agele: "Αγέλη",
  omada: "Ομάδα",
  koinotita: "Κοινότητα",
};

export const ACTIVITY_TYPE_INFO: Record<ActivityRow["type"], { icon: string; label: string }> = {
  typical: { icon: "🏕️", label: "Τυπική συγκέντρωση" },
  day_trip: { icon: "🚌", label: "Ημερήσια δράση" },
  multi_day: { icon: "🎒", label: "Διήμερη δράση" },
  other: { icon: "⭐", label: "Άλλη δράση" },
  no_activity: { icon: "🚫", label: "Χωρίς δράση" },
};

export const CHANGED_FIELD_LABELS: Record<string, string> = {
  location: "Άλλαξε ο τόπος",
  startsAt: "Άλλαξε η ώρα έναρξης",
  endsAt: "Άλλαξε η ώρα λήξης",
  date: "Άλλαξε η ημερομηνία",
  cost: "Άλλαξε το κόστος",
  whatToBring: "Άλλαξε τι να κρατάνε",
};

const dateFormatter = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long" });
const timeFormatter = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatActivityDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatActivityTime(date: Date): string {
  return timeFormatter.format(date);
}

export function formatPeriod(periodStart: Date, periodEnd: Date): string {
  const start = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long" }).format(periodStart);
  const end = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric" }).format(
    periodEnd,
  );
  return `${start} – ${end}`;
}

export function ActivityCard({ activity }: { activity: ActivityRow }) {
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
        {activity.cost && <p class="activity-cost">💶 {activity.cost}</p>}
        {activity.whatToBring && <p class="activity-what-to-bring">🎒 Τι να φέρετε: {activity.whatToBring}</p>}
      </div>
    </li>
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
  children: unknown;
};

export function PublicLayout({
  title,
  activeSection,
  accent,
  bodyClass,
  loginStatus,
  loginError,
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
            4ο Σύστημα Αεροπροσκόπων Ηρακλείου
          </a>
          <SectionNav active={activeSection} />
          <a
            href={`/auth/login?returnTo=${encodeURIComponent(currentPath)}`}
            class="login-trigger"
            onclick="event.preventDefault(); document.getElementById('login-dialog').showModal();"
          >
            Σύνδεση βαθμοφόρων
          </a>
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

type SectionScheduleVariant = {
  type: SectionType;
  accent: string;
  heroEmoji?: string;
  bodyClass: string;
};

export function SectionSchedulePage({
  section,
  program,
  scheduleActivities,
  variant,
  loginStatus,
  loginError,
}: {
  section: typeof sections.$inferSelect;
  program: { periodStart: Date; periodEnd: Date; themeTitle: string | null } | null;
  scheduleActivities: ActivityRow[];
  variant: SectionScheduleVariant;
  loginStatus?: string;
  loginError?: string;
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
    >
      <section class="hero">
        {variant.heroEmoji && (
          <span class="hero-emoji" aria-hidden="true">
            {variant.heroEmoji}
          </span>
        )}
        <h1>{program?.themeTitle || label}</h1>
        {program && <p class="period">{formatPeriod(program.periodStart, program.periodEnd)}</p>}
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
    </PublicLayout>
  );
}
