import type { Program } from "../../db/schema";
import { SECTION_LABELS, SECTION_ORDER } from "../public/layout";
import { STATUS_LABELS, periodTitle, previewUrl } from "./program-labels";

type SectionType = (typeof SECTION_ORDER)[number];

/**
 * Banner πάνω από τη σελίδα τμήματος στην προεπισκόπηση (ux-ui-guidelines §2.5): λέει καθαρά
 * ότι αυτό ΔΕΝ είναι ακόμα ό,τι βλέπουν οι γονείς, γυρίζει πίσω στο διαχειριστικό και — αν το
 * πρόγραμμα είναι πρόχειρο — δημοσιεύει χωρίς να χρειάζεται να βρεις ξανά το κουμπί.
 */
export function PreviewBanner({
  sectionType,
  focusProgram,
  shownProgram,
  switchableSections,
}: {
  sectionType: SectionType;
  /** Το πρόγραμμα από το οποίο ήρθε ο βαθμοφόρος (?program=), αν υπάρχει. */
  focusProgram: Program | null;
  /** Το πρόγραμμα τμήματος που προβάλλεται τελικά (μπορεί να διαφέρει από το focus όταν αυτό είναι του Συστήματος). */
  shownProgram: Program | null;
  /** Τμήματα που μπορεί να δει ο συνδεδεμένος (επιτελείο: όλα· βαθμοφόρος: μόνο το δικό του). */
  switchableSections: SectionType[];
}) {
  const backHref = focusProgram ? `/admin/programs/${focusProgram.id}` : "/admin";
  const publishable = focusProgram?.status === "draft" ? focusProgram : null;

  return (
    <div class="preview-banner" role="region" aria-label="Προεπισκόπηση">
      <div class="preview-banner-text">
        <strong>👁 Προεπισκόπηση</strong> — έτσι θα δουν οι γονείς τη σελίδα της {SECTION_LABELS[sectionType]}, με
        ό,τι είναι ακόμα πρόχειρο να φαίνεται σαν δημοσιευμένο.
        {focusProgram?.sectionId === null && (
          <span class="preview-banner-status">
            {" "}
            Πρόγραμμα Συστήματος {periodTitle(focusProgram)}: <strong>{STATUS_LABELS[focusProgram.status]}</strong>.
          </span>
        )}
        {shownProgram && (
          <span class="preview-banner-status">
            {" "}
            Πρόγραμμα {periodTitle(shownProgram)}: <strong>{STATUS_LABELS[shownProgram.status]}</strong>.
          </span>
        )}
      </div>
      {switchableSections.length > 1 && (
        <nav class="preview-banner-sections" aria-label="Προεπισκόπηση άλλου τμήματος">
          {switchableSections.map((type) => (
            <a
              href={previewUrl(type, focusProgram?.id)}
              class={type === sectionType ? "active" : undefined}
              aria-current={type === sectionType ? "page" : undefined}
            >
              {SECTION_LABELS[type]}
            </a>
          ))}
        </nav>
      )}
      <div class="preview-banner-actions">
        <a class="button button-small" href={backHref}>
          ← Πίσω στο διαχειριστικό
        </a>
        {publishable && (
          <form method="post" action={`/admin/programs/${publishable.id}/publish`}>
            <button
              type="submit"
              class="button button-small button-primary"
              onclick="return confirm('Δημοσίευση; Το πρόγραμμα θα γίνει αμέσως ορατό στους γονείς και θα σταλεί email στους βαθμοφόρους.');"
            >
              {publishable.sectionId === null ? "Δημοσίευση προγράμματος Συστήματος" : "Δημοσίευση"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
