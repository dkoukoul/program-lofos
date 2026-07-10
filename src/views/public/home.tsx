import type { activities, programs, sections } from "../../db/schema";
import { ActivityCard, PublicLayout, SECTION_LABELS, SECTION_ORDER, formatPeriod } from "./layout";

type SectionBlock = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: (typeof activities.$inferSelect)[];
};

export function HomePage({
  blocks,
  loginStatus,
  loginError,
}: {
  blocks: SectionBlock[];
  loginStatus?: string;
  loginError?: string;
}) {
  return (
    <PublicLayout
      title="Πρόγραμμα δράσεων — 4ο Σύστημα Αεροπροσκόπων Ηρακλείου"
      loginStatus={loginStatus}
      loginError={loginError}
    >
      <section class="intro">
        <h1>Πρόγραμμα δράσεων</h1>
        <p>Το πρόγραμμα του μήνα για κάθε τμήμα του 4ου Συστήματος. Διάλεξε τμήμα για την πλήρη σελίδα του.</p>
      </section>

      {SECTION_ORDER.map((type) => {
        const block = blocks.find((b) => b.section.type === type);
        if (!block) return null;
        const { section, program, scheduleActivities } = block;

        return (
          <section class={`section-block section-${type}`}>
            <div class="section-block-header">
              <h2>{SECTION_LABELS[type]}</h2>
              <a href={`/${type}`} class="section-link">
                Πλήρες πρόγραμμα →
              </a>
            </div>
            {program && <p class="period">{formatPeriod(program.periodStart, program.periodEnd)}</p>}
            {!program ? (
              <p class="empty-state">Δεν υπάρχει ακόμα δημοσιευμένο πρόγραμμα.</p>
            ) : scheduleActivities.length === 0 ? (
              <p class="empty-state">Το πρόγραμμα δεν έχει ακόμα δράσεις.</p>
            ) : (
              <ul class="activity-list">
                {scheduleActivities.map((activity) => (
                  <ActivityCard activity={activity} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </PublicLayout>
  );
}
