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

## 2026-07-10 — Bootstrap των 3 σταθερών sections μέσα στο `db:migrate`
Τα `sections` (Αγέλη/Ομάδα/Κοινότητα) είναι σταθερά δεδομένα αναφοράς χωρίς κανέναν άλλο μηχανισμό δημιουργίας τους. Αντί για ξεχωριστό manual seed script (όπως το `db:seed` για τον πρώτο leader), τα 3 rows δημιουργούνται idempotent μέσα στο `src/db/migrate.ts` μετά τα migrations — έτσι κάθε `bun run db:migrate` εγγυάται ότι υπάρχουν, χωρίς επιπλέον χειροκίνητο βήμα.

## 2026-07-10 — Login popup: native `<dialog>` + SSR redirect αντί για htmx
Η δημόσια σελίδα (αρχική + τμήματα) έχει "Σύνδεση βαθμοφόρων" πάνω δεξιά που ανοίγει native `<dialog>` με το ίδιο `LoginForm` component που χρησιμοποιεί και η standalone `/auth/login` σελίδα (fallback χωρίς JS). Η φόρμα κάνει κανονικό POST σε `/auth/request-link`, ο server κάνει redirect πίσω στη σελίδα προέλευσης (`returnTo`, whitelisted σε `/`, `/agele`, `/omada`, `/koinotita`) με `?loginStatus=sent|error`, και ένα μικρό inline script ξανανοίγει το dialog αν υπάρχει το query param. Επιλέχθηκε αντί για htmx (το τεκμηριωμένο εργαλείο interactivity) γιατί το htmx δεν είναι ακόμα wired στο project (κανένα script/static serving) και η ροή δεν χρειάζεται partial swap· η επιλογή htmx θα αξιολογηθεί ξανά όταν χτιστεί το wizard, που πραγματικά το χρειάζεται.

## 2026-07-10 — Προστέθηκε ξεχωριστό πεδίο `activities.date` στο schema
Το data model του architecture doc §4 περιέγραφε μόνο `starts_at`/`ends_at`, αλλά για `type = "no_activity"` όλα τα πεδία ώρας/τόπου μένουν null (purpose doc §4) — άρα χρειάζεται ένα πάντα-υποχρεωτικό πεδίο ημέρας για να "καταλαμβάνει" τη θέση και να τροφοδοτεί τον έλεγχο επικάλυψης (§6). Προστέθηκε `date` (timestamp, not null) ξεχωριστό από τα προαιρετικά πλέον `starts_at`/`ends_at`/`location`/`cost`/`what_to_bring`. Καθαρά τεχνική λεπτομέρεια υλοποίησης, δεν αλλάζει κανένα λειτουργικό κανόνα.
