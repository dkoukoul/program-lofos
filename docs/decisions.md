# Τεχνικές αποφάσεις (log)

Σύντομες καταχωρήσεις για μικρότερες τεχνικές αποφάσεις που δεν αξίζουν αλλαγή σε ολόκληρη ενότητα του [architecture-and-tech-stack.md](./architecture-and-tech-stack.md). Μία-δύο γραμμές αρκούν: ημερομηνία, τι αποφασίστηκε, γιατί.

Οι μεγάλες αποφάσεις (stack, data model, security model) μένουν στο architecture doc — εδώ μπαίνει ό,τι είναι πιο local/λεπτομερειακό (π.χ. "διαλέξαμε library X αντί για Y επειδή Z").

---

<!-- Παράδειγμα μορφής:
## 2026-08-01 — Τίτλος απόφασης
Τι αποφασίστηκε, σε 1-2 προτάσεις, και γιατί (ποιο πρόβλημα έλυσε ή ποιο trade-off έγινε).
-->

## 2026-07-10 — Πλήρη per-τμήμα δημόσια templates μπαίνουν στη Φάση 1
Το purpose doc §7 όριζε τα πλήρη, διαφορετικά templates ανά τμήμα/μήνα ως πιθανή Φάση 2 (μόνο χρώμα/λογότυπο/εικόνες ήταν Φάση 1). Αποφασίστηκε να μπουν στη Φάση 1: κάθε τμήμα έχει δικό του template προσαρμοσμένο στην ηλικιακή του ομάδα, με προαιρετικό μηνιαίο "θέμα" (κυρίως για την Αγέλη). Λεπτομέρειες στο νέο [docs/ux-ui-guidelines.md](./ux-ui-guidelines.md).

## 2026-07-10 — Έλεγχος επικαλυπτόμενων δράσεων ίδιας ημέρας: env var, default "όχι"
Ο έλεγχος για δύο δράσεις (ίδιου τμήματος, ή με Δράση Συστήματος/"Χωρίς δράση") την ίδια ημέρα γίνεται ρυθμίσιμος μέσω env var `ALLOW_ACTIVITY_OVERLAP` αντί για σταθερό, hard-coded κανόνα — ώστε να καλύπτεται πιθανή μελλοντική ανάγκη χωρίς αλλαγή κώδικα. Default: `false` (δεν επιτρέπεται), γιατί το σύνηθες σενάριο είναι λάθος/διπλοκαταχώρηση, όχι σκόπιμη επικάλυψη.

## 2026-07-10 — Δράσεις Συστήματος: ξεχωριστό "system πρόγραμμα" χωρίς section
Το architecture doc §4 άφηνε ανοιχτό πώς μια Δράση Συστήματος συνδέεται με τα 3 ξεχωριστά per-section προγράμματα. Επιλέχθηκε: `programs.section_id` είναι nullable· όταν είναι null, το πρόγραμμα είναι "system πρόγραμμα" — container αποκλειστικά για Δράσεις Συστήματος, δημιουργείται μία φορά από το επιτελείο. Η δημόσια σελίδα κάθε τμήματος συγχωνεύει (merge) τις δράσεις του δικού της per-section προγράμματος με τις δράσεις του system προγράμματος βάσει επικάλυψης ημερομηνιών, κατά το rendering. Εναλλακτική (αντιγραφή σε 3 ξεχωριστές εγγραφές δράσης) απορρίφθηκε γιατί απαιτεί πολύπλοκο sync στο write-path.

## 2026-07-10 — systemd unit: `/opt/program-lofos` + dedicated non-root user, όχι `/root`
Δημιουργήθηκε [deploy/program-lofos.service](../deploy/program-lofos.service) (μόνο το αρχείο, δεν εγκαταστάθηκε). Ακολουθεί το ήδη τεκμηριωμένο least-privilege §10: μη-root χρήστης (`lofos`), όχι root όπως σε ένα ήδη υπάρχον service παράδειγμα σε αυτό το VPS. Επειδή `/root` μπλοκάρει πλήρως πρόσβαση σε μη-root χρήστες, το production deploy path πρέπει να είναι εκτός `/root` (π.χ. `/opt/program-lofos`) — άρα το §11 deploy step προϋποθέτει μελλοντικό μεταφορά/clone εκεί, και system-wide εγκατάσταση bun (π.χ. `/usr/local/bin/bun`) αφού το `/root/.bun` επίσης δεν είναι προσβάσιμο. Καμία εγκατάσταση/enable έγινε — production action, εκκρεμεί χειροκίνητο βήμα του χρήστη.

## 2026-07-10 — Auth: HMAC-SHA256 με `SESSION_SECRET` για token hashing
Τα magic-link/session tokens (32 τυχαία bytes) αποθηκεύονται ως HMAC-SHA256(SESSION_SECRET, token) αντί για απλό SHA-256, ώστε το ήδη υπάρχον `SESSION_SECRET` env var να χρησιμοποιείται ουσιαστικά (defense-in-depth πέρα από την τυχαιότητα του token).

## 2026-07-10 — Auth: `hono/csrf` built-in middleware αντί για custom double-submit cookie
Το architecture doc §10 άφηνε ανοιχτή την επιλογή. Επιλέχθηκε το built-in `hono/csrf` (Origin-header check σε unsafe methods) — μηδενικό νέο dependency, καλύπτει το requirement χωρίς επιπλέον κώδικα.

## 2026-07-10 — Auth: dev fallback όταν λείπει `RESEND_API_KEY`
Χωρίς `RESEND_API_KEY` (τοπικό dev), το magic-link URL τυπώνεται στο console αντί να αποσταλεί μέσω Resend — απαραίτητο για να μπορεί να δοκιμαστεί η ροή login σε browser χωρίς πραγματικό API key.

## 2026-07-10 — Auth: bootstrap πρώτου λογαριασμού μέσω `bun run db:seed`
Δεν υπάρχει self-registration, άρα χρειάζεται ένας τρόπος να μπει ο πρώτος `system_staff` leader στη βάση. Επιλέχθηκε μικρό CLI script (`src/db/seed.ts`) αντί για UI διαχείρισης leaders (αυτό μένει εκτός scope, μελλοντικό task στο `admin.ts`).

**Αντικαταστάθηκε από την απόφαση 2026-07-10 (`config/leaders.json`) παρακάτω** — το `db:seed` αφαιρέθηκε.

## 2026-07-10 — Πρόσβαση χρηστών μέσω `config/leaders.json` αντί για UI ή CLI ανά χρήστη
Για να αποφευχθεί η ανάγκη admin UI στη Φάση 1, επιλέχθηκε ένα JSON config αρχείο (`config/leaders.json`, εκτός git — §4α architecture doc) ως πηγή αλήθειας για ποιοι επιτρέπεται να συνδεθούν και με τι ρόλο/τμήμα, αντί για: (α) UI διαχείρισης, (β) ξεχωριστό CLI ανά προσθήκη χρήστη (`db:seed`). Συγχρονίζεται στο `leaders` table αυτόματα σε κάθε εκκίνηση server (`syncLeadersFromConfig`), με upsert-ανά-email και soft-deactivation (`active` flag) όσων αφαιρεθούν — όχι hard delete, γιατί `sessions`/`magic_links`/`activity_participants` έχουν FK στο `leaders.id`. Η deactivation ανακαλεί άμεσα sessions/magic links. Εναλλακτικά εξετάστηκε πλήρης αντικατάσταση του `leaders` table από το JSON (χωρίς DB persistence) — απορρίφθηκε γιατί θα απαιτούσε αλλαγή των FK σε email-based αναφορές σε τρία σημεία, μεγαλύτερος κίνδυνος για μικρό όφελος. Το `db:seed` script αφαιρέθηκε (αντικαταστάθηκε πλήρως).

## 2026-07-10 — Bootstrap των 3 σταθερών sections μέσα στο `db:migrate`
Τα `sections` (Αγέλη/Ομάδα/Κοινότητα) είναι σταθερά δεδομένα αναφοράς χωρίς κανέναν άλλο μηχανισμό δημιουργίας τους. Αντί για ξεχωριστό manual seed script (όπως το `db:seed` για τον πρώτο leader), τα 3 rows δημιουργούνται idempotent μέσα στο `src/db/migrate.ts` μετά τα migrations — έτσι κάθε `bun run db:migrate` εγγυάται ότι υπάρχουν, χωρίς επιπλέον χειροκίνητο βήμα.

## 2026-07-10 — Login popup: native `<dialog>` + SSR redirect αντί για htmx
Η δημόσια σελίδα (αρχική + τμήματα) έχει "Σύνδεση βαθμοφόρων" πάνω δεξιά που ανοίγει native `<dialog>` με το ίδιο `LoginForm` component που χρησιμοποιεί και η standalone `/auth/login` σελίδα (fallback χωρίς JS). Η φόρμα κάνει κανονικό POST σε `/auth/request-link`, ο server κάνει redirect πίσω στη σελίδα προέλευσης (`returnTo`, whitelisted σε `/`, `/agele`, `/omada`, `/koinotita`) με `?loginStatus=sent|error`, και ένα μικρό inline script ξανανοίγει το dialog αν υπάρχει το query param. Επιλέχθηκε αντί για htmx (το τεκμηριωμένο εργαλείο interactivity) γιατί το htmx δεν είναι ακόμα wired στο project (κανένα script/static serving) και η ροή δεν χρειάζεται partial swap· η επιλογή htmx θα αξιολογηθεί ξανά όταν χτιστεί το wizard, που πραγματικά το χρειάζεται.

## 2026-07-10 — Προστέθηκε ξεχωριστό πεδίο `activities.date` στο schema
Το data model του architecture doc §4 περιέγραφε μόνο `starts_at`/`ends_at`, αλλά για `type = "no_activity"` όλα τα πεδία ώρας/τόπου μένουν null (purpose doc §4) — άρα χρειάζεται ένα πάντα-υποχρεωτικό πεδίο ημέρας για να "καταλαμβάνει" τη θέση και να τροφοδοτεί τον έλεγχο επικάλυψης (§6). Προστέθηκε `date` (timestamp, not null) ξεχωριστό από τα προαιρετικά πλέον `starts_at`/`ends_at`/`location`/`cost`/`what_to_bring`. Καθαρά τεχνική λεπτομέρεια υλοποίησης, δεν αλλάζει κανένα λειτουργικό κανόνα.

## 2026-07-10 — Ροή δράσεων: 4 νέες UX ιδέες πέρα από το αρχικό κείμενο του ux-ui-guidelines §2.1
Κατά την υλοποίηση της ροής δημιουργίας/επεξεργασίας Δράσεων, εγκρίθηκαν με τον χρήστη 4 προσθήκες πέρα από το ήδη τεκμηριωμένο wizard: (1) quick-add "+ Τυπική Κυριακή" που παρακάμπτει εντελώς το wizard για τη συνηθέστερη περίπτωση, (2) one-tap "🚫 Χωρίς δράση" από τη λίστα, (3) smart date chips με τις επόμενες διαθέσιμες Κυριακές πάνω από το date picker, (4) overlap preview κάρτα (τύπος/ώρα/τόπος + link) αντί για απλό κείμενο προειδοποίησης. Ενημερώθηκε το `docs/ux-ui-guidelines.md` §2.1/§2.2 ταυτόχρονα με τον κώδικα (`src/routes/admin.tsx`, `src/views/admin/wizard/`).

## 2026-07-10 — htmx: vendored single-file `public/vendor/htmx.min.js`, όχι npm dependency
Το wizard δράσεων είναι το πρώτο σημείο που πραγματικά χρειάζεται partial swaps (type-based defaults, overlap check on date change) — η προηγούμενη απόφαση ("Login popup") είχε αφήσει ανοιχτό το πώς θα μπει το htmx. Αντί για `htmx.org` ως npm dependency (θα απαιτούσε copy-step σε κάθε deploy, αφού δεν υπάρχει build pipeline), κατέβηκε ένα static `htmx.min.js` (v1.9.12) απευθείας στο `public/vendor/`, σερβίρεται από το ήδη υπάρχον static middleware. Καμία εξωτερική CDN εξάρτηση σε runtime.

## 2026-07-10 — Δράσεις: fixed 3 slots για "δυναμικά πεδία" αντί για ελεύθερης-μορφής add/remove
Το purpose doc §4/§8 άφηνε ανοιχτή την ακριβή μορφή των δυναμικών πεδίων ("όσα χρειαστούν"). Για το MVP, το wizard δείχνει πάντα 3 προαιρετικά ζεύγη τίτλος/περιγραφή (κενά αγνοούνται στο save) αντί για dynamic add/remove μέσω htmx — απλούστερο, καλύπτει τη συντριπτική πλειοψηφία των περιπτώσεων. Αν χρειαστεί περισσότερα από 3, θα προστεθεί dynamic add-row σε επόμενο pass.

## 2026-07-10 — Email ειδοποιήσεις δημοσίευσης/αλλαγής: awaited, όχι fire-and-forget
Το §7 architecture doc ζητά best-effort αποστολή που δεν μπλοκάρει τη λειτουργία. Αφού το `sendEmail` helper στο `notify.ts` ήδη καταπίνει κάθε σφάλμα εσωτερικά (retry + catch, ποτέ throw), το publish/update route κάνει `await` στην αποστολή αντί για fire-and-forget `void` — ίδια εγγύηση non-blocking, αλλά ντετερμινιστική συμπεριφορά (χρήσιμο και για τα integration tests).

## 2026-07-12 — Δημόσιο header: auth-aware "Σύνδεση βαθμοφόρων" ↔ "Διαχείριση δράσεων"
Οι δημόσιες σελίδες (`/`, `/agele`, `/omada`, `/koinotita`) δεν διάβαζαν καθόλου το session cookie, οπότε το header έδειχνε πάντα το "Σύνδεση βαθμοφόρων" popup — ακόμα κι όταν ο βαθμοφόρος ήταν ήδη logged in, με αποτέλεσμα να του ζητά ξανά email. Προστέθηκε `getOptionalLeader(c)` στο `src/lib/auth.ts` (resolve session χωρίς redirect) και τα public routes περνούν `isLoggedIn` στο `PublicLayout`: όταν υπάρχει ενεργό session το trigger γίνεται link "Διαχείριση δράσεων" → `/admin`, αλλιώς μένει το login popup. Το ίδιο το auth (cookie 30 μέρες) δούλευε ήδη σωστά· έλειπε μόνο η προβολή της κατάστασης στο δημόσιο header.

## 2026-07-13 — Ημερομηνίες: ενιαία αριθμητική μορφή ηη/μμ/εεεε παντού
Οι textual μορφές ημερομηνίας (π.χ. "5 Αυγούστου" χωρίς έτος στο `formatPeriod`/`formatDayMonth`) ήταν ασυνεπείς μεταξύ τους, και τα quick-pick date chips στο wizard δράσεων (`src/views/admin/wizard/form.tsx`) έδειχναν raw ISO string (`2026-08-05`) αφού επαναχρησιμοποιούσαν το `toDateInputValue` helper του native date input και ως ορατό label. Ενοποιήθηκε σε αριθμητική μορφή ηη/μμ/εεεε παντού (διαχειριστικό, δημόσια προβολή, emails) μέσω νέου `formatDateNumeric` στο `src/views/public/layout.tsx`· το όνομα ημέρας (όπου εμφανίζεται) προηγείται ως κείμενο αλλά δεν αντικαθιστά πια την αριθμητική ημερομηνία. Κανόνας τεκμηριωμένος ως δεσμευτικός στο [ux-ui-guidelines.md §1](./ux-ui-guidelines.md), mirror του ήδη υπάρχοντος κανόνα 24ώρου για την ώρα.

## 2026-07-26 — Οδηγός χρήσης διαχειριστικού + info tips: static page + native `<details>`, καμία JS βιβλιοθήκη
Προστέθηκε στατικός οδηγός χρήσης (`/admin/help`, `src/views/admin/help.tsx`) και μικρά info tips (ⓘ) σε μη προφανή σημεία του διαχειριστικού (`InfoTip`, `src/views/admin/info-tip.tsx`). Το `InfoTip` υλοποιήθηκε πάνω σε native `<details>/<summary>` αντί για JS tooltip βιβλιοθήκη ή custom hover/click listener — μηδενικό νέο dependency, λειτουργεί εγγενώς με tap (κρίσιμο σε κινητό, §1 ux-ui-guidelines) και πληκτρολόγιο. Επειδή το `<details>` δεν είναι phrasing content, τοποθετείται πάντα ως sibling μετά το label/heading/summary, ποτέ ως παιδί τους (θα ήταν άκυρο HTML μέσα σε `<label>`/`<h1>`/`<summary>`). Το header του διαχειριστικού απέκτησε ένα τέταρτο σταθερό σημείο (icon-link "❓" προς τον οδηγό) αντί να μπει το link μέσα στο ήδη τεκμηριωμένο τριμερές layout — ενημερώθηκε το [ux-ui-guidelines.md §2.0/§2.4](./ux-ui-guidelines.md). Ο οδηγός πρέπει να ενημερώνεται σε κάθε αλλαγή ροής διαχειριστικού (καταγράφηκε ως κανόνας στο CLAUDE.md).

## 2026-07-26 — "Τόπος" → "Τοποθεσία" + προαιρετικός map picker: Leaflet vendored, όχι Google Maps JS API
Το πεδίο μετονομάστηκε σε "Τοποθεσία" (label μόνο· η στήλη DB/το identifier παραμένουν `location`, δεν αξίζει migration μετονομασίας μόνο για ένα ελληνικό label). Προστέθηκαν προαιρετικές συντεταγμένες (`activities.location_lat`/`location_lng`, real, nullable) από έναν map picker στο πλήρες wizard. Επιλέχθηκε **Leaflet + OpenStreetMap tiles**, vendored ως static αρχεία στο `public/vendor/leaflet/` (ίδιο μοτίβο με το htmx, βλ. απόφαση 2026-07-10 "htmx: vendored single-file"), αντί για Google Maps JavaScript API — τελευταία απαιτεί API key το οποίο (ακόμα κι αν γίνει domain-restricted) έρχεται σε ένταση με τον κανόνα "ποτέ API key στο public repo" (CLAUDE.md). Όταν υπάρχουν συντεταγμένες, η τοποθεσία εμφανίζεται παντού (δημόσια προβολή + διαχειριστικό) ως link με εικονίδιο χάρτη (🗺️) προς Google Maps (`/maps/search/?api=1&query=lat,lng` — απλό URL, όχι API, δεν χρειάζεται key για απλό deep link). Το quick-edit (μόνο κείμενο, χωρίς picker — §2.0 ux-ui-guidelines) καθαρίζει τις συντεταγμένες αν αλλάξει το κείμενο τοποθεσίας εκεί, ώστε να μην μείνουν "ορφανές" σε λάθος σημείο. Το change-tracking μετά τη δημοσίευση (`TRACKED_FIELDS`) παρακολουθεί τα `locationLat`/`locationLng` σαν ξεχωριστά πεδία, αλλά η ετικέτα badge είναι ίδια με του `location` ("Άλλαξε η τοποθεσία") και μαζεύεται deduped (`changedFieldLabels`) ώστε μια ταυτόχρονη αλλαγή κειμένου+σημείου να μην εμφανίζει τριπλό badge.

## 2026-07-26 — iCal feed: όλες οι δημοσιευμένες περίοδοι τμήματος, όχι μόνο η τρέχουσα
Υλοποιήθηκε το `src/routes/ical.ts` (ήταν placeholder) πάνω στο ήδη προδιαγεγραμμένο σχήμα `/ical/:section_id/:public_token.ics` (§9 architecture doc, `sections.ical_public_token` υπήρχε ήδη στο schema). Το §5.7 purpose doc λέει ότι το feed αντανακλά "ό,τι φαίνεται στη δημόσια σελίδα" — η σελίδα τμήματος όμως δείχνει μόνο μία (τρέχουσα/πλησιέστερη) περίοδο. Επιλέχθηκε να συμπεριλαμβάνει **όλες** τις δημοσιευμένες περιόδους του τμήματος (ιστορικές + τρέχουσα + μελλοντικές, `getPublishedSectionActivities` στο `src/lib/schedule.ts`), γιατί μια συνδρομή ημερολογίου που "παγώνει" μετά τον τρέχοντα μήνα αναιρεί τον σκοπό της (§5.7: "ενημερώνεται αυτόματα όταν γίνονται αλλαγές"). Παραμένει συνεπές με το "μόνο δημοσιευμένες" — draft προγράμματα αποκλείονται πάντα. Δράσεις τύπου "Χωρίς δράση" περιλαμβάνονται ως all-day events (ίδια λογική με το badge στη δημόσια σελίδα), ώστε ο συνδρομητής να μην τις μπερδέψει με απουσία προγράμματος. Το κουμπί εγγραφής στη δημόσια σελίδα τμήματος (`src/views/public/layout.tsx`) χρησιμοποιεί `webcal://` scheme (αυτόματο άνοιγμα σε Ημερολόγιο σε Apple/πολλά mobile clients) με fallback σε απλό `https://` link για χειροκίνητη εισαγωγή (π.χ. Google Calendar "from URL").
