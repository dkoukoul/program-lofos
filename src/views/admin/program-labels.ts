import type { Program, sections } from "../../db/schema";
import { monthTitle } from "../../lib/program-overview";
import { SECTION_LABELS, formatPeriod } from "../public/layout";

type SectionRow = typeof sections.$inferSelect;

/** Σε ποιο τμήμα ανήκει ένα πρόγραμμα — "system" για το πρόγραμμα Συστήματος (sectionId === null). */
export type SectionKind = "system" | SectionRow["type"];

/** Σειρά εμφάνισης των "χώρων" του διαχειριστικού: Σύστημα πρώτα, μετά τα τμήματα κατά ηλικία. */
export const SCOPE_ORDER: SectionKind[] = ["system", "agele", "omada", "koinotita"];

export const STATUS_LABELS: Record<Program["status"], string> = {
  draft: "Πρόχειρο",
  published: "Δημοσιευμένο",
};

export function scopeLabel(kind: SectionKind): string {
  return kind === "system" ? "Σύστημα" : SECTION_LABELS[kind];
}

export function programKind(program: Program, sectionsById: Map<number, SectionRow>): SectionKind {
  return program.sectionId === null ? "system" : sectionsById.get(program.sectionId)!.type;
}

/** "Δεκέμβριος 2026" για ολόκληρο μήνα, αλλιώς το εύρος "01/12/2026 – 15/12/2026". */
export function periodTitle(program: Pick<Program, "periodStart" | "periodEnd">): string {
  return monthTitle(program) ?? formatPeriod(program.periodStart, program.periodEnd);
}

/** Πλήρης τίτλος προγράμματος: "Ομάδα · Δεκέμβριος 2026". */
export function programTitle(program: Program, sectionsById: Map<number, SectionRow>): string {
  return `${scopeLabel(programKind(program, sectionsById))} · ${periodTitle(program)}`;
}

export function previewUrl(kind: Exclude<SectionKind, "system">, programId?: number): string {
  return `/admin/preview/${kind}${programId ? `?program=${programId}` : ""}`;
}
