export function magicLinkEmail(verifyUrl: string): { subject: string; html: string } {
  return {
    subject: "Σύνδεση στο program.lofos.gr",
    html: `
      <p>Γεια σου,</p>
      <p>Πάτησε τον παρακάτω σύνδεσμο για να συνδεθείς στο program.lofos.gr. Ο σύνδεσμος ισχύει για 15 λεπτά και μπορεί να χρησιμοποιηθεί μία φορά.</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Αν δεν ζήτησες εσύ αυτό το email, αγνόησέ το.</p>
    `.trim(),
  };
}
