import type { Leader, Program, sections } from "../../db/schema";
import { SECTION_LABELS } from "../public/layout";
import { formatPeriod } from "../public/layout";
import { AdminLayout } from "./layout";

type SectionRow = typeof sections.$inferSelect;

const STATUS_LABELS: Record<Program["status"], string> = {
  draft: "Πρόχειρο",
  published: "Δημοσιευμένο",
};

function programLabel(program: Program, sectionsById: Map<number, SectionRow>): string {
  if (program.sectionId === null) return "Σύστημα";
  return SECTION_LABELS[sectionsById.get(program.sectionId)!.type];
}

export function ProgramsIndexPage({
  leader,
  programsList,
  sectionsById,
}: {
  leader: Leader;
  programsList: Program[];
  sectionsById: Map<number, SectionRow>;
}) {
  return (
    <AdminLayout title="Προγράμματα" leader={leader}>
      <div class="programs-header">
        <h1>Προγράμματα</h1>
        <a class="button button-primary" href="/admin/programs/new">
          + Νέο πρόγραμμα
        </a>
      </div>

      {programsList.length === 0 ? (
        <p class="empty-state">Δεν υπάρχει ακόμα κανένα πρόγραμμα.</p>
      ) : (
        <ul class="programs-list">
          {programsList.map((program) => (
            <li class="program-card">
              <a href={`/admin/programs/${program.id}`}>
                <strong>{programLabel(program, sectionsById)}</strong>
                <span class="period">{formatPeriod(program.periodStart, program.periodEnd)}</span>
                <span class={`badge badge-status-${program.status}`}>{STATUS_LABELS[program.status]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}

export function ProgramForm({
  leader,
  sectionsList,
  error,
}: {
  leader: Leader;
  sectionsList: SectionRow[];
  error?: string;
}) {
  return (
    <AdminLayout title="Νέο πρόγραμμα" leader={leader}>
      <h1>Νέο πρόγραμμα</h1>
      {error && <p class="error">{error}</p>}
      <form method="post" action="/admin/programs" class="program-form">
        <label for="periodStart">Έναρξη περιόδου</label>
        <input type="date" id="periodStart" name="periodStart" required />

        <label for="periodEnd">Λήξη περιόδου</label>
        <input type="date" id="periodEnd" name="periodEnd" required />

        {leader.role === "system_staff" ? (
          <>
            <label for="sectionId">Τμήμα</label>
            <select id="sectionId" name="sectionId">
              <option value="">Σύστημα (Δράσεις Συστήματος, όλα τα τμήματα)</option>
              {sectionsList.map((section) => (
                <option value={section.id}>{SECTION_LABELS[section.type]}</option>
              ))}
            </select>
          </>
        ) : (
          <input type="hidden" name="sectionId" value={leader.sectionId ?? ""} />
        )}

        <button type="submit" class="button button-primary">
          Δημιουργία
        </button>
      </form>
    </AdminLayout>
  );
}
