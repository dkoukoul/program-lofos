import type { Leader, Program, SystemNote } from "../../db/schema";
import { formatNoteRange } from "../../lib/notes";
import { AdminLayout } from "./layout";
import { InfoTip } from "./info-tip";
import { DateInput } from "./date-input";
import { toDateInputValue } from "./wizard/form";

export const NOTE_TEXT_MAX = 300;

export type SystemNoteFormValues = {
  text: string;
  dateStart: string;
  dateEnd: string;
};

export function noteFormValues(note: SystemNote): SystemNoteFormValues {
  return {
    text: note.text,
    dateStart: toDateInputValue(note.dateStart),
    dateEnd: toDateInputValue(note.dateEnd),
  };
}

const NOTE_INFO_TIP =
  "Μια Σημείωση Συστήματος δεν είναι δράση: είναι ένα κείμενο που κολλάει σαν επιπλέον πεδίο σε κάθε δράση κάθε τμήματος μέσα στο εύρος ημερομηνιών που θα ορίσεις. Π.χ. σημείωση «Αγιασμός» για τις 18/10 εμφανίζεται μέσα στη δράση της Αγέλης, της Ομάδας και της Κοινότητας εκείνης της ημέρας. Αν ένα τμήμα δεν έχει δράση εκείνη τη μέρα (ή την έχει δηλώσει «Χωρίς δράση»), η σημείωση δεν εμφανίζεται πουθενά για αυτό το τμήμα.";

function NoteFields({ values }: { values: SystemNoteFormValues }) {
  return (
    <>
      <label for="noteText">Σημείωση</label>
      <textarea
        id="noteText"
        name="text"
        rows={2}
        maxlength={NOTE_TEXT_MAX}
        required
        placeholder="π.χ. Αγιασμός στις 10:00 στον Άγιο Μηνά"
      >
        {values.text}
      </textarea>

      <label for="noteDateStart">Από</label>
      <DateInput id="noteDateStart" name="dateStart" value={values.dateStart} required />

      <label for="noteDateEnd">Έως</label>
      <DateInput id="noteDateEnd" name="dateEnd" value={values.dateEnd} required />
    </>
  );
}

/**
 * Οι Σημειώσεις Συστήματος ζουν μέσα στο πρόγραμμα Συστήματος (programs.sectionId = null) και
 * ακολουθούν το draft→published του — άρα το panel εμφανίζεται μόνο σε αυτή την οθόνη
 * προγράμματος, όχι στα προγράμματα τμημάτων.
 */
export function SystemNotesPanel({ program, notes }: { program: Program; notes: SystemNote[] }) {
  return (
    <section class="system-notes">
      <div class="system-notes-head">
        <h2>Σημειώσεις Συστήματος</h2>
        <InfoTip text={NOTE_INFO_TIP} />
      </div>

      {notes.length === 0 ? (
        <p class="empty-state">Δεν υπάρχει ακόμα σημείωση σε αυτή την περίοδο.</p>
      ) : (
        <ul class="system-notes-list">
          {notes.map((note) => (
            <li class="system-note-card">
              <a href={`/admin/programs/${program.id}/notes/${note.id}/edit`} class="system-note-link">
                <span class="period">{formatNoteRange(note)}</span>
                <span class="system-note-text">{note.text}</span>
                {note.changedAfterPublish && <span class="badge badge-changed">✏️ Άλλαξε η σημείωση</span>}
              </a>
              <form method="post" action={`/admin/programs/${program.id}/notes/${note.id}/delete`}>
                <button
                  type="submit"
                  class="icon-btn icon-btn--danger"
                  title="Διαγραφή"
                  aria-label="Διαγραφή σημείωσης"
                  onclick="return confirm('Διαγραφή σημείωσης;');"
                >
                  🗑
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form method="post" action={`/admin/programs/${program.id}/notes`} class="system-note-form">
        <NoteFields values={{ text: "", dateStart: "", dateEnd: "" }} />
        <button type="submit" class="button button-primary">
          + Προσθήκη σημείωσης
        </button>
      </form>
    </section>
  );
}

export function SystemNoteFormPage({
  leader,
  program,
  noteId,
  values,
  error,
}: {
  leader: Leader;
  program: Program;
  noteId: number;
  values: SystemNoteFormValues;
  error?: string;
}) {
  return (
    <AdminLayout title="Επεξεργασία σημείωσης" leader={leader}>
      <h1>Επεξεργασία σημείωσης</h1>
      <InfoTip text={NOTE_INFO_TIP} />
      {error && <p class="error">{error}</p>}
      <form method="post" action={`/admin/programs/${program.id}/notes/${noteId}`} class="system-note-form">
        <NoteFields values={values} />
        <div class="form-actions">
          <button type="submit" class="button button-primary">
            Αποθήκευση
          </button>
          <a class="button" href={`/admin/programs/${program.id}`}>
            Ακύρωση
          </a>
        </div>
      </form>
    </AdminLayout>
  );
}
