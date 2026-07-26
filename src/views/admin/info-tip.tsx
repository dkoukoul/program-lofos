/**
 * Μικρό, tap-friendly info tip (ⓘ) — CSS/HTML native `<details>`, καμία JS βιβλιοθήκη.
 * Λειτουργεί με tap σε κινητό (όχι μόνο hover) και με πληκτρολόγιο (native <details> focus/enter).
 */
export function InfoTip({ text, label = "Πληροφορίες" }: { text: string; label?: string }) {
  return (
    <details class="info-tip">
      <summary aria-label={label} title={label}>
        ⓘ
      </summary>
      <p>{text}</p>
    </details>
  );
}
