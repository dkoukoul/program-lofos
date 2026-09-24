import type { Leader } from "../../db/schema";
import { DATE_PLACEHOLDER } from "./date-input";

type AdminLayoutProps = {
  title: string;
  leader: Leader;
  wide?: boolean;
  extraHead?: unknown;
  children: unknown;
};

/**
 * Οδηγεί το popup ώρας (βλ. TimeInput στο wizard/form.tsx): το κουμπί-πεδίο ("11:00") ανοίγει ένα
 * <dialog> με τις scroll-wheel ρόδες ώρας/λεπτών, συγχρονίζει το κρυφό input που διαβάζουν τα
 * routes + το ίδιο το κουμπί σε κάθε scroll/click/πληκτρολόγιο, και ξανα-αρχικοποιεί μετά από htmx
 * swaps (αλλαγή τύπου δράσης, quick-edit γραμμές) — τα scroll events δεν κάνουν bubble, άρα
 * χρειάζεται άμεσο listener ανά ρόδα (data-wheel-ready flag ώστε να μην διπλο-αρχικοποιείται). Το
 * scroll position αρχικοποιείται στο άνοιγμα του dialog (όχι στο page load) γιατί ένα κλειστό
 * <dialog> δεν έχει πραγματικό layout — scrollTop σε κρυφό element δεν "πιάνει".
 */
const WHEEL_TIME_SCRIPT = `(function(){
  var ROW = 44;
  function opts(wheel){ return wheel.querySelectorAll('.wheel-option'); }
  function clampIndex(wheel, idx){
    var max = opts(wheel).length - 1;
    if (idx < 0) return 0;
    if (idx > max) return max;
    return idx;
  }
  function currentIndex(wheel){
    return clampIndex(wheel, Math.round(wheel.scrollTop / ROW));
  }
  function selectedValue(wheel){
    var el = wheel.querySelector('.wheel-option[aria-selected="true"]');
    return el ? el.getAttribute('data-value') : '';
  }
  function indexOfValue(wheel, value){
    var list = opts(wheel);
    for (var i = 0; i < list.length; i++){
      if (list[i].getAttribute('data-value') === value) return i;
    }
    return 0;
  }
  function indexOfSelected(wheel){
    var list = opts(wheel);
    for (var i = 0; i < list.length; i++){
      if (list[i].getAttribute('aria-selected') === 'true') return i;
    }
    return 0;
  }
  function setIndex(wheel, idx, smooth){
    idx = clampIndex(wheel, idx);
    var list = opts(wheel);
    for (var i = 0; i < list.length; i++){
      list[i].setAttribute('aria-selected', i === idx ? 'true' : 'false');
    }
    if (smooth && wheel.scrollTo) {
      wheel.scrollTo({ top: idx * ROW, behavior: 'smooth' });
    } else {
      wheel.scrollTop = idx * ROW;
    }
  }
  function reconcile(wrap){
    var hourWheel = wrap.querySelector('[data-wheel-hour]');
    var minWheel = wrap.querySelector('[data-wheel-minute]');
    var hidden = wrap.querySelector('[data-time-value]');
    var trigger = wrap.querySelector('[data-time-trigger]');
    if (!hourWheel || !minWheel || !hidden) return;
    var hourVal = selectedValue(hourWheel);
    var minVal = selectedValue(minWheel);
    if (hourVal && !minVal) { setIndex(minWheel, indexOfValue(minWheel, '00'), true); minVal = '00'; }
    else if (minVal && !hourVal) { setIndex(hourWheel, indexOfValue(hourWheel, '00'), true); hourVal = '00'; }
    hidden.value = (hourVal && minVal) ? (hourVal + ':' + minVal) : '';
    if (trigger) trigger.textContent = hidden.value ? hidden.value : '--:--';
  }
  function initWheel(wheel){
    if (wheel.getAttribute('data-wheel-ready')) return;
    wheel.setAttribute('data-wheel-ready', '1');
    var timer = null;
    wheel.addEventListener('scroll', function(){
      if (timer) clearTimeout(timer);
      timer = setTimeout(function(){
        setIndex(wheel, currentIndex(wheel), false);
        var wrap = wheel.closest('[data-time-input]');
        if (wrap) reconcile(wrap);
      }, 120);
    }, { passive: true });
  }
  function initAll(root){
    (root || document).querySelectorAll('.wheel').forEach(initWheel);
  }
  document.addEventListener('click', function(ev){
    var trigger = ev.target.closest && ev.target.closest('[data-time-trigger]');
    if (trigger) {
      var wrap = trigger.closest('[data-time-input]');
      var dialog = wrap && wrap.querySelector('[data-time-dialog]');
      if (!dialog) return;
      dialog.querySelectorAll('.wheel').forEach(function(wheel){
        initWheel(wheel);
        setIndex(wheel, indexOfSelected(wheel), false);
      });
      dialog.showModal();
      return;
    }
    var opt = ev.target.closest && ev.target.closest('.wheel-option');
    if (opt) {
      var wheel = opt.closest('.wheel');
      if (!wheel) return;
      setIndex(wheel, Array.prototype.indexOf.call(opts(wheel), opt), true);
      var wrap2 = wheel.closest('[data-time-input]');
      if (wrap2) reconcile(wrap2);
      return;
    }
    var done = ev.target.closest && ev.target.closest('[data-time-dialog-done]');
    if (done) {
      var dlg = done.closest('dialog');
      if (dlg) dlg.close();
      return;
    }
    if (ev.target.tagName === 'DIALOG' && ev.target.hasAttribute('data-time-dialog')) {
      ev.target.close();
    }
  });
  document.addEventListener('keydown', function(ev){
    var wheel = ev.target && ev.target.closest && ev.target.closest('.wheel');
    if (!wheel) return;
    var idx = currentIndex(wheel);
    if (ev.key === 'ArrowDown') idx = idx + 1;
    else if (ev.key === 'ArrowUp') idx = idx - 1;
    else if (ev.key === 'Home') idx = 0;
    else if (ev.key === 'End') idx = opts(wheel).length - 1;
    else return;
    ev.preventDefault();
    setIndex(wheel, idx, true);
    var wrap = wheel.closest('[data-time-input]');
    if (wrap) reconcile(wrap);
  });
  document.body.addEventListener('htmx:afterSwap', function(ev){ initAll(ev.target); });
  initAll(document);
})();`;

/**
 * Χειρίζεται τα πεδία ημερομηνίας (βλ. DateInput στο date-input.tsx):
 * α) ανοίγει το native picker σε click οπουδήποτε μέσα στο πεδίο, όχι μόνο στο εικονίδιο,
 * β) κρατά συγχρονισμένο το ορατό ελληνικό κείμενο (ηη/μμ/εεεε) με την ISO τιμή του input —
 *    και μετά από htmx swaps ή προγραμματιστική αλλαγή (date chips), γι' αυτό τα chips στέλνουν
 *    `change` με `bubbles: true` ώστε να φτάνει στον delegated listener,
 * γ) σε browsers χωρίς `showPicker()` (το διάφανο input δεν θα ήταν χρησιμοποιήσιμο) γυρνάει σε
 *    fallback που δείχνει το native πεδίο ως έχει — μόνο εκεί χάνεται η ελληνική μορφή.
 */
const DATE_INPUT_SCRIPT = `(function(){
  var PLACEHOLDER = '${DATE_PLACEHOLDER}';
  if (typeof HTMLInputElement === 'undefined' || typeof HTMLInputElement.prototype.showPicker !== 'function') {
    document.documentElement.classList.add('no-date-picker');
  }
  function greek(value){
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value || '');
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
  }
  function sync(input){
    var wrap = input.closest && input.closest('[data-date-input]');
    if (!wrap) return;
    var display = wrap.querySelector('[data-date-display]');
    if (!display) return;
    var text = greek(input.value);
    display.textContent = text || PLACEHOLDER;
    if (text) display.classList.remove('is-empty');
    else display.classList.add('is-empty');
  }
  function syncAll(root){
    if (!root || !root.querySelectorAll) return;
    var list = root.querySelectorAll('input[data-date-value]');
    for (var i = 0; i < list.length; i++) sync(list[i]);
  }
  function onValueEvent(ev){
    var input = ev.target && ev.target.closest && ev.target.closest('input[data-date-value]');
    if (input) sync(input);
  }
  document.addEventListener('input', onValueEvent);
  document.addEventListener('change', onValueEvent);
  document.addEventListener('click', function(ev){
    var input = ev.target.closest && ev.target.closest('input[type="date"]');
    if (!input || typeof input.showPicker !== 'function') return;
    try { input.showPicker(); } catch (e) {}
  });
  document.body.addEventListener('htmx:afterSwap', function(ev){ syncAll(ev.target); });
  syncAll(document);
})();`;

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
          <a
            class="icon-btn admin-site-link"
            href="/"
            target="_blank"
            rel="noopener"
            title="Δημόσιο site (νέα καρτέλα)"
            aria-label="Δημόσιο site — άνοιγμα σε νέα καρτέλα"
          >
            🌐
          </a>
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
        <script dangerouslySetInnerHTML={{ __html: WHEEL_TIME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: DATE_INPUT_SCRIPT }} />
      </body>
    </html>
  );
}
