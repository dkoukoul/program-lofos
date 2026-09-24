/**
 * Το κείμενο της σημείωσης το γράφει βαθμοφόρος και εδώ καταλήγει μέσα σε HTML email —
 * άρα escape-άρεται (κανένα πεδίο δεν δέχεται raw HTML, βλ. CLAUDE.md §9 / §10 architecture doc).
 * Τα υπόλοιπα email templates interpolate-άρουν μόνο σταθερά δικά μας strings.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function systemNoteChangedEmail(params: { range: string; text: string; url: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: "Άλλαξε Σημείωση Συστήματος σε δημοσιευμένο πρόγραμμα",
    html: `
      <p>Μια Σημείωση Συστήματος για <strong>${escapeHtml(params.range)}</strong> άλλαξε μετά τη δημοσίευση:</p>
      <p>${escapeHtml(params.text)}</p>
      <p>Εμφανίζεται σε κάθε δράση κάθε τμήματος μέσα σε αυτό το διάστημα.</p>
      <p><a href="${params.url}">${params.url}</a></p>
    `.trim(),
  };
}
