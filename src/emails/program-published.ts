export function programPublishedEmail(params: { sectionLabel: string; period: string; url: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: `Δημοσιεύτηκε το πρόγραμμα — ${params.sectionLabel}`,
    html: `
      <p>Το πρόγραμμα δράσεων (${params.period}) για ${params.sectionLabel} μόλις δημοσιεύτηκε και είναι πλέον ορατό στη δημόσια σελίδα.</p>
      <p><a href="${params.url}">${params.url}</a></p>
    `.trim(),
  };
}
