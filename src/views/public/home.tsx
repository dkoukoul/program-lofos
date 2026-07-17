import type { activities, programs, sections } from "../../db/schema";
import { selectFeaturedActivity } from "../../lib/schedule";
import {
  ACTIVITY_TYPE_INFO,
  ActivityCard,
  CHANGED_FIELD_LABELS,
  PublicLayout,
  SECTION_LABELS,
  SECTION_LOGOS,
  SECTION_ORDER,
  SECTION_VARIANTS,
  formatDateNumeric,
  formatPeriod,
  formatTimeRange,
  formatWeekday,
} from "./layout";

type ActivityRow = typeof activities.$inferSelect;
type SectionType = typeof sections.$inferSelect.type;

type SectionBlock = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: ActivityRow[];
};

/** Μπροστινή όψη: η τρέχουσα/επόμενη δράση με έμφαση σε ημέρα/ημερομηνία/ώρα. */
function FeaturedActivity({ activity }: { activity: ActivityRow }) {
  const typeInfo = ACTIVITY_TYPE_INFO[activity.type];
  const changedFields = activity.changedAfterPublishFields ?? [];

  if (activity.type === "no_activity") {
    return (
      <div class="card-featured card-featured--no-activity">
        <p class="card-next-label">Επόμενη Κυριακή</p>
        <p class="card-weekday">{formatWeekday(activity.date)}</p>
        <p class="card-daymonth">{formatDateNumeric(activity.date)}</p>
        <p class="card-no-activity">{typeInfo.icon} Δεν θα γίνει συγκέντρωση.</p>
      </div>
    );
  }

  const timeRange = formatTimeRange(activity.startsAt, activity.endsAt);

  return (
    <div class="card-featured">
      <p class="card-next-label">Επόμενη δράση</p>
      {(activity.isSystemWide || changedFields.length > 0) && (
        <div class="activity-badges">
          {activity.isSystemWide && <span class="badge badge-system">🛡️ Δράση Συστήματος</span>}
          {changedFields.map((field) => (
            <span class="badge badge-changed">✏️ {CHANGED_FIELD_LABELS[field] ?? "Άλλαξε κάτι"}</span>
          ))}
        </div>
      )}
      <p class="card-weekday">{formatWeekday(activity.date)}</p>
      <p class="card-daymonth">{formatDateNumeric(activity.date)}</p>
      {timeRange && <p class="card-time">🕒 {timeRange}</p>}
      <p class="card-type">
        {typeInfo.icon} {typeInfo.label}
      </p>
      {activity.location && <p class="card-location">📍 {activity.location}</p>}
    </div>
  );
}

function CardHeader({ type, label }: { type: SectionType; label: string }) {
  return (
    <div class="card-head">
      <img class="card-emoji" src={SECTION_LOGOS[type]} alt="" aria-hidden="true" />
      <h2 class="card-head-title">{label}</h2>
    </div>
  );
}

function SectionCard({ block }: { block: SectionBlock }) {
  const { section, program, scheduleActivities } = block;
  const type = section.type;
  const label = SECTION_LABELS[type];
  const accent = SECTION_VARIANTS[type].accent;
  const featured = selectFeaturedActivity(scheduleActivities);

  // Χωρίς δημοσιευμένο πρόγραμμα ή χωρίς δράσεις: στατική κάρτα, δεν χρειάζεται flip.
  if (!program || !featured) {
    return (
      <article class={`play-card play-card--static section-${type}`} style={`--card-accent:${accent}`}>
        <div class="play-card-face">
          <CardHeader type={type} label={label} />
          <div class="card-body card-body--center">
            <p class="empty-state">
              {!program ? "Δεν υπάρχει ακόμα δημοσιευμένο πρόγραμμα." : "Το πρόγραμμα δεν έχει ακόμα δράσεις."}
            </p>
          </div>
          <a href={`/${type}`} class="flip-btn flip-btn--primary card-cta">
            Σελίδα τμήματος →
          </a>
        </div>
      </article>
    );
  }

  return (
    <article class={`play-card section-${type}`} style={`--card-accent:${accent}`}>
      <div class="play-card-inner">
        <div class="play-card-face play-card-front">
          <img class="card-watermark" src={SECTION_LOGOS[type]} alt="" aria-hidden="true" />
          <CardHeader type={type} label={label} />
          <div class="card-body">
            <FeaturedActivity activity={featured} />
          </div>
          <button type="button" class="flip-btn flip-btn--primary" aria-label={`Δες το πλήρες πρόγραμμα για ${label}`}>
            Πλήρες πρόγραμμα ⟳
          </button>
        </div>

        <div class="play-card-face play-card-back">
          <div class="card-head card-head--back">
            <div class="card-head-identity">
              <img class="card-emoji" src={SECTION_LOGOS[type]} alt="" aria-hidden="true" />
              <h2 class="card-head-title">{label}</h2>
            </div>
            <a href={`/${type}`} class="flip-btn flip-btn--back">
              Περισσότερα ↗
            </a>
          </div>
          <p class="period card-back-period">{formatPeriod(program.periodStart, program.periodEnd)}</p>
          <div class="card-scroll">
            <ul class="activity-list card-full-list">
              {scheduleActivities.map((activity) => (
                <ActivityCard activity={activity} />
              ))}
            </ul>
          </div>
          <button type="button" class="flip-btn flip-btn--primary card-cta" aria-label={`Επιστροφή στην επόμενη δράση για ${label}`}>
            ⟲ Πίσω
          </button>
        </div>
      </div>
    </article>
  );
}

const FLIP_SCRIPT = `(function(){document.querySelectorAll('.flip-btn').forEach(function(btn){btn.addEventListener('click',function(){var card=btn.closest('.play-card');if(card)card.classList.toggle('is-flipped');});});})();`;

export function HomePage({
  blocks,
  loginStatus,
  loginError,
  isLoggedIn,
}: {
  blocks: SectionBlock[];
  loginStatus?: string;
  loginError?: string;
  isLoggedIn?: boolean;
}) {
  return (
    <PublicLayout
      title="Πρόγραμμα δράσεων — 4ο Σύστημα Αεροπροσκόπων Ηρακλείου"
      bodyClass="home"
      loginStatus={loginStatus}
      loginError={loginError}
      isLoggedIn={isLoggedIn}
    >
      <section class="intro">
        <h1>Πρόγραμμα δράσεων</h1>
        <p>Το πρόγραμμα του μήνα για κάθε τμήμα του 4ου Συστήματος. Γύρνα την κάρτα για το πλήρες πρόγραμμα.</p>
      </section>

      <div class="section-cards">
        {SECTION_ORDER.map((type) => {
          const block = blocks.find((b) => b.section.type === type);
          if (!block) return null;
          return <SectionCard block={block} />;
        })}
      </div>

      <script dangerouslySetInnerHTML={{ __html: FLIP_SCRIPT }} />
    </PublicLayout>
  );
}
