/**
 * Πεδίο ημερομηνίας που δείχνει **πάντα** ηη/μμ/εεεε (§1 ux-ui-guidelines), ανεξάρτητα από το
 * locale του browser — το native `<input type="date">` δείχνει mm/dd/yyyy σε συσκευές με en-US.
 * Το native input παραμένει η πηγή τιμής (ISO `yyyy-mm-dd`), του validation και του picker: μένει
 * στη σελίδα με το ίδιο `id`/`name`/htmx attributes (routes, hx-include και το `change` event δεν
 * αλλάζουν καθόλου), απλώς γίνεται διάφανο overlay πάνω από ένα δικό μας span με την ελληνική
 * μορφή. Ο συγχρονισμός του span σε κάθε αλλαγή γίνεται από το `DATE_INPUT_SCRIPT` στο AdminLayout.
 */

/** ISO `yyyy-mm-dd` → `ηη/μμ/εεεε`. Κενό string αν η τιμή δεν είναι έγκυρη ISO ημερομηνία. */
export function formatDateInputValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** Ό,τι δείχνει το πεδίο όσο δεν έχει επιλεγεί ημερομηνία — ίδιο κείμενο και στο client script. */
export const DATE_PLACEHOLDER = "ηη/μμ/εεεε";

export function DateInput({
  id,
  name,
  value = "",
  required,
  hx,
}: {
  id?: string;
  name: string;
  value?: string;
  required?: boolean;
  /** htmx attributes που πρέπει να μείνουν πάνω στο ίδιο το native input (π.χ. hx-get/hx-trigger). */
  hx?: Record<string, string>;
}) {
  const display = formatDateInputValue(value);
  return (
    <span class="date-input" data-date-input>
      <span class={display ? "date-display" : "date-display is-empty"} data-date-display aria-hidden="true">
        {display || DATE_PLACEHOLDER}
      </span>
      <input
        type="date"
        class="date-native"
        id={id}
        name={name}
        value={value}
        required={required}
        data-date-value
        {...hx}
      />
    </span>
  );
}
