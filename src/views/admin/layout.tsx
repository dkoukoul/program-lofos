import type { Leader } from "../../db/schema";

type AdminLayoutProps = {
  title: string;
  leader: Leader;
  wide?: boolean;
  extraHead?: unknown;
  children: unknown;
};

/**
 * Συγχρονίζει τα ζεύγη ώρας/λεπτών <select> (βλ. TimeInput στο wizard/form.tsx) με το κρυφό input
 * που διαβάζουν τα routes. Event delegation στο document ώστε να δουλεύει και μετά από htmx swaps
 * (αλλαγή τύπου δράσης, quick-edit γραμμές) χωρίς re-init.
 */
const TIME_INPUT_SCRIPT = `document.addEventListener('change', function(ev){
  var t = ev.target;
  var isHour = t.matches && t.matches('[data-time-hour]');
  var isMinute = t.matches && t.matches('[data-time-minute]');
  if(!isHour && !isMinute) return;
  var wrap = t.closest('[data-time-input]');
  if(!wrap) return;
  var hourSel = wrap.querySelector('[data-time-hour]');
  var minSel = wrap.querySelector('[data-time-minute]');
  var hidden = wrap.querySelector('[data-time-value]');
  if(!hourSel || !minSel || !hidden) return;
  if(isHour && hourSel.value && !minSel.value) minSel.value = '00';
  if(isMinute && minSel.value && !hourSel.value) hourSel.value = '00';
  hidden.value = (hourSel.value && minSel.value) ? (hourSel.value + ':' + minSel.value) : '';
});`;

export function AdminLayout({ title, leader, wide, extraHead, children }: AdminLayoutProps) {
  return (
    <html lang="el">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — program.lofos.gr</title>
        <link rel="stylesheet" href="/public/styles.css" />
        <script src="/public/vendor/htmx.min.js" defer />
        {extraHead}
      </head>
      <body class="admin">
        <header class="site-header">
          <a class="site-title" href="/admin" aria-label="Αρχική διαχειριστικού">
            <img
              class="site-logo"
              src="/public/images/%CE%9B%CE%BF%CE%B3%CF%8C%CF%84%CF%85%CF%80%CE%BF%20%CE%91%CF%80%CE%BB%CF%8C.png"
              alt=""
              aria-hidden="true"
            />
            4ο Σύστημα — Διαχειριστικό
          </a>
          <span class="admin-leader">{leader.name}</span>
          <a class="icon-btn admin-help-link" href="/admin/help" title="Οδηγός χρήσης" aria-label="Οδηγός χρήσης">
            ❓
          </a>
          <form method="post" action="/auth/logout" class="admin-logout">
            <button type="submit" class="button">
              Αποσύνδεση
            </button>
          </form>
        </header>
        <main class={wide ? "admin-main admin-main--wide" : "admin-main"}>{children}</main>
        <script dangerouslySetInnerHTML={{ __html: TIME_INPUT_SCRIPT }} />
      </body>
    </html>
  );
}
