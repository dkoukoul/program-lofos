import type { Leader, Program } from "../../db/schema";
import type { MonthChoice, SundayCoverage } from "../../lib/program-overview";
import { formatDateNumeric } from "../public/layout";
import { AdminLayout } from "./layout";
import { InfoTip } from "./info-tip";
import { toDateInputValue } from "./wizard/form";
import { STATUS_LABELS, periodTitle, previewUrl, scopeLabel, type SectionKind } from "./program-labels";

export type DashboardProgram = {
  program: Program;
  activityCount: number;
  /** null για το πρόγραμμα Συστήματος — δεν έχει "μία δράση κάθε Κυριακή". */
  coverage: SundayCoverage | null;
};

export type DashboardScope = {
  kind: SectionKind;
  /** id τμήματος για τη δημιουργία προγράμματος· null για το Σύστημα. */
  sectionId: number | null;
  current: DashboardProgram | null;
  next: DashboardProgram | null;
  /** Μήνας χωρίς πρόγραμμα, που προτείνεται για δημιουργία με ένα κλικ. */
  suggestion: MonthChoice | null;
};

function ProgramSummary({ label, entry, kind }: { label: string; entry: DashboardProgram; kind: SectionKind }) {
  const { program, activityCount, coverage } = entry;
  const missing = coverage?.missingUpcoming ?? [];

  return (
    <div class="dash-program">
      <div class="dash-program-head">
        <span class="dash-program-when">{label}</span>
        <a class="dash-program-title" href={`/admin/programs/${program.id}`}>
          {periodTitle(program)}
        </a>
        <span class={`badge badge-status-${program.status}`}>{STATUS_LABELS[program.status]}</span>
      </div>
      <p class="dash-program-stats">
        {activityCount === 1 ? "1 δράση" : `${activityCount} δράσεις`}
        {coverage && coverage.total > 0 && ` · ${coverage.covered}/${coverage.total} Κυριακές`}
        {program.status === "draft" && " · δεν το βλέπουν ακόμα οι γονείς"}
      </p>
      {missing.length > 0 && (
        <p class="dash-program-missing">
          ⚠ Χωρίς δράση ακόμα: {missing.map((date) => formatDateNumeric(date)).join(", ")}
        </p>
      )}
      <div class="dash-program-actions">
        <a class="button button-small button-primary" href={`/admin/programs/${program.id}`}>
          {missing.length > 0 ? "Συμπλήρωση" : "Άνοιγμα"}
        </a>
        <a class="button button-small" href={previewUrl(kind === "system" ? "agele" : kind, program.id)}>
          👁 Προεπισκόπηση
        </a>
      </div>
    </div>
  );
}

function ScopeCard({ scope }: { scope: DashboardScope }) {
  const { kind, current, next, suggestion } = scope;

  return (
    <section class={`dash-card scope-${kind}`}>
      <h2 class="dash-card-title">{scopeLabel(kind)}</h2>
      {current ? (
        <ProgramSummary label="Τώρα" entry={current} kind={kind} />
      ) : (
        <p class="empty-state">Κανένα πρόγραμμα για σήμερα.</p>
      )}
      {next && <ProgramSummary label="Επόμενο" entry={next} kind={kind} />}
      {suggestion && (
        <form method="post" action="/admin/programs" class="dash-suggestion">
          <input type="hidden" name="periodStart" value={toDateInputValue(suggestion.start)} />
          <input type="hidden" name="periodEnd" value={toDateInputValue(suggestion.end)} />
          <input type="hidden" name="sectionId" value={scope.sectionId ?? ""} />
          <span class="dash-suggestion-text">Δεν υπάρχει πρόγραμμα για {suggestion.label}.</span>
          <button type="submit" class="button button-small">
            + Δημιουργία {suggestion.label}
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * Αρχική διαχειριστικού (ux-ui-guidelines §2.0): μία κάρτα ανά τμήμα που απαντά στο
 * "τι πρέπει να κάνω τώρα;" — τρέχον/επόμενο πρόγραμμα, πόσες Κυριακές λείπουν, τι δεν
 * έχει δημοσιευτεί, και δημιουργία του επόμενου μήνα με ένα κλικ.
 */
export function AdminDashboardPage({ leader, scopes }: { leader: Leader; scopes: DashboardScope[] }) {
  return (
    <AdminLayout title="Αρχική" leader={leader} wide nav="home">
      <div class="programs-header">
        <h1>Καλώς ήρθες, {leader.name.split(" ")[0]}</h1>
        <InfoTip text="Εδώ βλέπεις με μια ματιά το τρέχον και το επόμενο πρόγραμμα κάθε τμήματος: πόσες Κυριακές έχουν ήδη δράση, ποιες λείπουν και αν έχει δημοσιευτεί. «👁 Προεπισκόπηση» δείχνει τη δημόσια σελίδα όπως θα τη δουν οι γονείς, μαζί με ό,τι είναι ακόμα πρόχειρο." />
      </div>
      <div class="dash-grid">
        {scopes.map((scope) => (
          <ScopeCard scope={scope} />
        ))}
      </div>
    </AdminLayout>
  );
}
