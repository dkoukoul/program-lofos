import type { Leader, Program, sections } from "../../db/schema";
import type { MonthChoice } from "../../lib/program-overview";
import { SECTION_LABELS, formatPeriod } from "../public/layout";
import { AdminLayout } from "./layout";
import { InfoTip } from "./info-tip";
import { DateInput } from "./date-input";
import { toDateInputValue } from "./wizard/form";
import { STATUS_LABELS, periodTitle, scopeLabel, type SectionKind } from "./program-labels";

type SectionRow = typeof sections.$inferSelect;

export type ProgramListEntry = {
  program: Program;
  activityCount: number;
  isCurrent: boolean;
};

export type ProgramGroup = { kind: SectionKind; entries: ProgramListEntry[] };

/**
 * Λίστα προγραμμάτων ομαδοποιημένη ανά τμήμα, νεότερα πρώτα (ux-ui-guidelines §2.2α).
 * Η διαγραφή δεν ζει εδώ — μόνο μέσα στην οθόνη του προγράμματος, ώστε να μην πατιέται κατά λάθος.
 */
export function ProgramsIndexPage({ leader, groups }: { leader: Leader; groups: ProgramGroup[] }) {
  const isEmpty = groups.every((group) => group.entries.length === 0);

  return (
    <AdminLayout title="Προγράμματα" leader={leader} nav="programs">
      <div class="programs-header">
        <h1>Προγράμματα</h1>
        <a class="button button-primary" href="/admin/programs/new">
          + Νέο πρόγραμμα
        </a>
      </div>

      {isEmpty ? (
        <p class="empty-state">Δεν υπάρχει ακόμα κανένα πρόγραμμα.</p>
      ) : (
        groups.map((group) => (
          <section class={`programs-group scope-${group.kind}`}>
            <div class="programs-group-header">
              <h2>{scopeLabel(group.kind)}</h2>
              <a class="link-button" href={`/admin/programs/new?section=${group.kind}`}>
                + Νέο
              </a>
            </div>
            {group.entries.length === 0 ? (
              <p class="empty-state">Κανένα πρόγραμμα ακόμα.</p>
            ) : (
              <ul class="programs-list">
                {group.entries.map(({ program, activityCount, isCurrent }) => (
                  <li class="program-card">
                    <a href={`/admin/programs/${program.id}`}>
                      <span class="program-card-title">
                        <strong>{periodTitle(program)}</strong>
                        {isCurrent && <span class="badge badge-current">Τρέχον</span>}
                      </span>
                      <span class="program-card-meta">
                        <span class={`badge badge-status-${program.status}`}>{STATUS_LABELS[program.status]}</span>
                        <span class="period">
                          {activityCount === 1 ? "1 δράση" : `${activityCount} δράσεις`}
                          {periodTitle(program) !== formatPeriod(program.periodStart, program.periodEnd) &&
                            ` · ${formatPeriod(program.periodStart, program.periodEnd)}`}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </AdminLayout>
  );
}

/** Τα chips μηνών γεμίζουν τα δύο πεδία ημερομηνίας — τα πεδία μένουν πάντα ελεύθερα επεξεργάσιμα. */
const MONTH_CHIP_SCRIPT = `(function(){
  document.addEventListener('click', function(ev){
    var chip = ev.target.closest && ev.target.closest('[data-month-start]');
    if (!chip) return;
    var pairs = [['periodStart', chip.getAttribute('data-month-start')], ['periodEnd', chip.getAttribute('data-month-end')]];
    pairs.forEach(function(pair){
      var input = document.getElementById(pair[0]);
      if (!input) return;
      input.value = pair[1];
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.querySelectorAll('[data-month-start]').forEach(function(c){ c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
  });
})();`;

export function ProgramForm({
  leader,
  sectionsList,
  monthChoices,
  selectedSection,
  values,
  error,
}: {
  leader: Leader;
  sectionsList: SectionRow[];
  monthChoices: MonthChoice[];
  /** Προεπιλογή τμήματος (μόνο επιτελείο): "system" ή id τμήματος. */
  selectedSection?: string;
  values?: { periodStart: string; periodEnd: string };
  error?: string;
}) {
  return (
    <AdminLayout title="Νέο πρόγραμμα" leader={leader} nav="programs">
      <a class="back-link" href="/admin/programs">
        ← Όλα τα προγράμματα
      </a>
      <h1>Νέο πρόγραμμα</h1>
      <InfoTip text="Ένα πρόγραμμα είναι μια περίοδος (συνήθως ένας μήνας, αλλά μπορεί να είναι οποιοδήποτε εύρος ημερομηνιών) που περιέχει τις δράσεις της. Ξεκινά ως Πρόχειρο, ορατό μόνο στους βαθμοφόρους — γίνεται δημόσιο όταν το δημοσιεύσεις." />
      {error && <p class="error">{error}</p>}
      <form method="post" action="/admin/programs" class="program-form">
        {leader.role === "system_staff" ? (
          <>
            <label for="sectionId">Τμήμα</label>
            <InfoTip text="Επίλεξε «Σύστημα» για να δημιουργήσεις το ειδικό πρόγραμμα Δράσεων Συστήματος — αυτές εμφανίζονται αυτόματα σε όλα τα τμήματα, χωρίς να χρειάζεται να τις προσθέσει ξεχωριστά κάθε βαθμοφόρος." />
            <select id="sectionId" name="sectionId">
              <option value="" selected={selectedSection === "system"}>
                Σύστημα (Δράσεις Συστήματος, όλα τα τμήματα)
              </option>
              {sectionsList.map((section) => (
                <option value={section.id} selected={selectedSection === String(section.id)}>
                  {SECTION_LABELS[section.type]}
                </option>
              ))}
            </select>
          </>
        ) : (
          <input type="hidden" name="sectionId" value={leader.sectionId ?? ""} />
        )}

        <span class="form-label">Μήνας</span>
        <div class="date-chips" role="group" aria-label="Γρήγορη επιλογή μήνα">
          {monthChoices.map((month) => (
            <button
              type="button"
              class="chip"
              aria-pressed="false"
              data-month-start={toDateInputValue(month.start)}
              data-month-end={toDateInputValue(month.end)}
            >
              {month.label}
            </button>
          ))}
        </div>
        <p class="hint">Διάλεξε μήνα ή όρισε δικό σου εύρος ημερομηνιών παρακάτω.</p>

        <label for="periodStart">Έναρξη περιόδου</label>
        <DateInput id="periodStart" name="periodStart" value={values?.periodStart} required />

        <label for="periodEnd">Λήξη περιόδου</label>
        <DateInput id="periodEnd" name="periodEnd" value={values?.periodEnd} required />

        <button type="submit" class="button button-primary">
          Δημιουργία
        </button>
      </form>
      <script dangerouslySetInnerHTML={{ __html: MONTH_CHIP_SCRIPT }} />
    </AdminLayout>
  );
}
