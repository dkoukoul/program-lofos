export function programChangedEmail(params: {
  sectionLabel: string;
  activityDate: string;
  changedLabels: string[];
  url: string;
}): { subject: string; html: string } {
  return {
    subject: `Άλλαξε δράση στο δημοσιευμένο πρόγραμμα — ${params.sectionLabel}`,
    html: `
      <p>Μια δράση στις <strong>${params.activityDate}</strong> άλλαξε μετά τη δημοσίευση (${params.sectionLabel}):</p>
      <ul>${params.changedLabels.map((label) => `<li>${label}</li>`).join("")}</ul>
      <p><a href="${params.url}">${params.url}</a></p>
    `.trim(),
  };
}
