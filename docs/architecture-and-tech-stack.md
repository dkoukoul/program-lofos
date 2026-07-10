# program.lofos.gr — Αρχιτεκτονική & Tech Stack

> Προαπαιτούμενο: [purpose-and-scope.md](./purpose-and-scope.md). Εδώ ορίζουμε ΠΩΣ χτίζεται το σύστημα.
> Αρχή: κρατάμε τα πάντα όσο πιο απλά γίνεται — ένας server, ένα αρχείο βάσης, ελάχιστα εξαρτήματα.

## 1. Επισκόπηση αρχιτεκτονικής

Μονολιθική εφαρμογή: ένας Bun process σερβίρει και το API και τις σελίδες (SSR). Καμία ξεχωριστή build/deploy διαδικασία για frontend.

```
                          ┌─────────────────────────────┐
 Browser (βαθμοφόρος)     │        VPS (existing)        │
 Browser (γονέας/παιδί) ─▶│  Caddy (TLS, reverse proxy)  │
                          │            │                  │
                          │            ▼                  │
                          │   Bun + Hono app (systemd)    │
                          │   - SSR JSX σελίδες + htmx    │
                          │   - JSON API (minimal)        │
                          │   - Auth (magic link)         │
                          │   - iCal generator             │
                          │            │                  │
                          │            ▼                  │
                          │   SQLite αρχείο (bun:sqlite)  │
                          │   /data/app.db                 │
                          │   /data/uploads/ (εικόνες)     │
                          └─────────────┬────────────────┘
                                        │
                                        ▼
                                 Resend (email API)
```

## 2. Tech stack

| Επίπεδο | Επιλογή | Γιατί |
|---|---|---|
| Runtime | **Bun** | Όπως ζητήθηκε — γρήγορο, ενσωματωμένο TS, ενσωματωμένο SQLite driver. |
| Γλώσσα | **TypeScript** | Type safety σε όλο το stack, βοηθάει πολύ έναν LLM agent να μη σπάει πράγματα ακούσια. |
| Web framework | **Hono** | Ελαφρύ, τρέχει native πάνω σε Bun, υποστηρίζει JSX για SSR + JSON routes στο ίδιο app. Πολύ διαδεδομένο, άρα καλά τεκμηριωμένο για coding agents. |
| Frontend rendering | **Server-rendered JSX (Hono/JSX)** + **htmx** για interactivity χωρίς reload (π.χ. προσθήκη δράσης, dynamic πεδία, ανανέωση καρτών προγράμματος) | Καμία ξεχωριστή SPA, κανένα build step, ένα deployment artifact. |
| CSS | Απλό, χειρόγραφο CSS με **CSS custom properties** για το theming (χρώματα/λογότυπο ανά τμήμα/περίοδο) | Χωρίς Tailwind build pipeline προς το παρόν — μπορεί να προστεθεί Φάση 2 αν χρειαστεί. |
| Βάση δεδομένων | **SQLite** αρχείο, μέσω `bun:sqlite` (native driver) | Όπως ζητήθηκε. Μηδενικό διαχειριστικό βάρος, ένα αρχείο, εύκολο backup. |
| ORM / query layer | **Drizzle ORM** (drizzle-orm + drizzle-kit) πάνω από bun:sqlite | Type-safe queries, schema-as-code, αυτόματα migrations. Αποφεύγει raw SQL string concatenation (SQL injection risk) χωρίς να προσθέτει βαριά αφαίρεση. |
| Validation | **Zod** | Validation σε forms/API στο ίδιο σημείο που ορίζονται και οι τύποι. |
| Auth | Custom **magic-link (passwordless)** πάνω σε Hono middleware | Βλ. §5. |
| Email | **Resend** (API) | Επιλέχθηκε από εσάς. Transactional emails για magic link + ειδοποιήσεις δημοσίευσης/αλλαγών. |
| iCal | **ical-generator** (npm package) | Παράγει σωστά .ics χωρίς να γράψουμε τη μορφή με το χέρι. |
| Reverse proxy / TLS | **Caddy** | Αυτόματο HTTPS (Let's Encrypt) με ελάχιστο config, πολύ πιο απλό από nginx+certbot. |
| Process management | **systemd** service | Ήδη διαθέσιμο σε κάθε Linux VPS, χωρίς ανάγκη για Docker. |
| Testing | `bun:test` | Ενσωματωμένο στο Bun, καμία επιπλέον εξάρτηση. |

## 3. Δομή project

```
program-lofos/
├── src/
│   ├── db/
│   │   ├── schema.ts        # Drizzle schema (πίνακες)
│   │   ├── client.ts        # σύνδεση bun:sqlite + drizzle
│   │   └── migrations/      # auto-generated από drizzle-kit
│   ├── routes/
│   │   ├── public.ts        # δημόσιες σελίδες ανά τμήμα (χωρίς auth)
│   │   ├── admin.ts         # πρόγραμμα/δράσεις (auth required)
│   │   ├── auth.ts          # magic link request/verify, logout
│   │   └── ical.ts          # .ics endpoints
│   ├── views/                # JSX components (SSR)
│   │   ├── public/
│   │   └── admin/
│   ├── emails/                # email templates (magic link, ειδοποιήσεις)
│   ├── lib/
│   │   ├── auth.ts            # session/cookie helpers, middleware
│   │   ├── authorize.ts       # έλεγχος δικαιωμάτων ανά ρόλο/τμήμα
│   │   └── notify.ts          # Resend wrapper
│   └── index.ts               # Hono app entrypoint
├── public/                    # στατικά assets (css, uploaded εικόνες)
├── data/                      # app.db, uploads/  (εκτός git)
├── docs/
├── .env.example
└── package.json
```

## 4. Data model (εννοιολογικά, θα οριστικοποιηθεί σε migration)

- `sections` (τμήματα): id, τύπος (αγέλη/ομάδα/κοινότητα — σταθερά 3 rows), theme_color, logo_path
- `leaders` (βαθμοφόροι/επιτελείο): id, όνομα, email, role (`section_leader` | `system_staff`), section_id (null αν system_staff)
- `magic_links`: id, leader_id, token_hash, expires_at, used_at
- `sessions`: id, leader_id, token_hash, expires_at, created_at, user_agent (για revocation)
- `programs` (περίοδοι προγράμματος): id, section_id (null αν είναι Σύστημα-wide πρόγραμμα-container — βλ. σημείωση), period_start, period_end, status (`draft`|`published`), theme overrides (χρώμα/εικόνες), published_at
- `activities` (δράσεις): id, program_id, section_id (ή flag `is_system_wide`), type, location, starts_at, ends_at, cost, what_to_bring, created/updated timestamps, `changed_after_publish_fields` (json λίστα πεδίων που άλλαξαν μετά τη δημοσίευση, για το UI badge)
- `activity_custom_fields`: id, activity_id, τίτλος, περιγραφή
- `activity_participants`: activity_id, leader_id (many-to-many, ποιοι βαθμοφόροι συμμετέχουν)

> Θα οριστικοποιηθεί ως πρώτο migration με το Drizzle schema όταν ξεκινήσουμε την υλοποίηση.

## 5. Auth & sessions (magic link)

Ροή:
1. Ο χρήστης βάζει το email του στη φόρμα login.
2. Ο server ελέγχει αν υπάρχει `leader` με αυτό το email (αν όχι, επιστρέφει το ίδιο γενικό μήνυμα — δεν αποκαλύπτουμε ποια emails υπάρχουν).
3. Δημιουργείται τυχαίο token (κρυπτογραφικά ασφαλές, π.χ. 32 bytes), αποθηκεύεται **hashed** στο `magic_links` με λήξη 15 λεπτών.
4. Στέλνεται email (Resend) με link `https://program.lofos.gr/auth/verify?token=...`.
5. Στο click, ο server επαληθεύει το token (hash match, μη ληγμένο, μη χρησιμοποιημένο), το μαρκάρει used, δημιουργεί εγγραφή στο `sessions` και θέτει cookie:
   - `httpOnly`, `secure`, `sameSite=lax`
   - Το cookie περιέχει μόνο ένα αδιαφανές session id (όχι δεδομένα χρήστη) — validation γίνεται server-side στο `sessions` table σε κάθε request.
6. Λήξη session: π.χ. 30 ημέρες, ανανεώσιμη· δυνατότητα revoke από τον admin (διαγραφή γραμμής στο `sessions`).

Rate limiting στο endpoint αίτησης magic link (π.χ. max 5 αιτήματα/ώρα/email) για αποφυγή κατάχρησης του Resend quota.

## 6. Εξουσιοδότηση (authorization)

Middleware σε κάθε mutating route ελέγχει:
- `system_staff` → δικαίωμα σε όλα τα τμήματα και δράσεις Συστήματος.
- `section_leader` → δικαίωμα **μόνο** σε `program`/`activity` όπου `section_id` == δικό του section.
- Καμία εξαίρεση client-side μόνο· ο έλεγχος γίνεται πάντα server-side πριν από κάθε write.

## 7. Email ειδοποιήσεις (Resend)

Triggers (όπως ορίστηκε στο purpose doc):
- Δημοσίευση νέου προγράμματος → email στους βαθμοφόρους του τμήματος + επιτελείο.
- Αλλαγή σε ήδη δημοσιευμένο πρόγραμμα → email με ό,τι άλλαξε, στους ίδιους παραλήπτες.
- Magic link login.

Retry: αν αποτύχει η κλήση στο Resend API, log το σφάλμα· δεν μπλοκάρει τη δημοσίευση (η δημοσίευση πετυχαίνει ούτως ή άλλως, το email είναι best-effort με 1 retry).

## 8. Theming & αρχεία (εικόνες/λογότυπα)

- Αποθήκευση uploaded εικόνων στο τοπικό filesystem (`/data/uploads/`), σερβίρονται στατικά από τον Bun/Hono server.
- Περιορισμοί στο upload: μόνο `image/jpeg|png|webp`, μέγιστο μέγεθος (π.χ. 2MB), το αρχείο αποθηκεύεται με τυχαίο (UUID) filename — ποτέ το αρχικό filename του χρήστη, ώστε να αποφεύγεται path traversal / conflicts.
- Χρώματα θέματος αποθηκεύονται ως hex values σε πεδία της βάσης, εφαρμόζονται μέσω CSS custom properties στο SSR HTML.

## 9. iCal

- Ένα endpoint ανά τμήμα: `/ical/:section_id/:public_token.ics`
- `public_token`: τυχαίο, μη μαντεύσιμο (UUID v4), αποθηκευμένο στο `sections`, με δυνατότητα rotation από τον admin αν χρειαστεί να ανακληθεί ένα link που έχει διαρρεύσει.
- Περιλαμβάνει μόνο δράσεις από `published` programs.
- Παράγεται on-the-fly σε κάθε request (χωρίς caching αρχικά — ο όγκος δεδομένων είναι μικρός).

## 10. Ασφάλεια — checklist

- **Transport**: HTTPS παντού, μέσω Caddy (auto TLS, auto-renew).
- **Auth**: tokens (magic link + sessions) αποθηκεύονται πάντα hashed, ποτέ plaintext στη βάση· short-lived, single-use magic links· rate limiting στο request-link endpoint.
- **Cookies**: `httpOnly` + `secure` + `sameSite=lax`, session revocable server-side.
- **CSRF**: CSRF token σε όλες τις state-changing φόρμες/htmx requests (Hono CSRF middleware ή custom double-submit cookie).
- **Authorization**: server-side έλεγχος ρόλου/ιδιοκτησίας τμήματος σε κάθε write route (§6) — ποτέ μόνο UI-level.
- **SQL injection**: αποκλειστικά μέσω Drizzle parameterized queries, καμία raw string concatenation.
- **XSS**: SSR JSX auto-escaping για όλο το user-generated περιεχόμενο· κανένα πεδίο δεν επιτρέπει raw HTML input (μόνο plain text).
- **File uploads**: whitelist τύπου/μεγέθους, τυχαία filenames, σερβίρισμα από dedicated static path χωρίς εκτέλεση.
- **Secrets**: σε `.env` (RESEND_API_KEY, SESSION_SECRET, DATABASE_PATH), ποτέ σε git (`.gitignore`).
- **iCal links**: μη μαντεύσιμα, με δυνατότητα rotation.
- **Least privilege**: ο Bun process τρέχει με μη-root χρήστη στο VPS, με πρόσβαση μόνο στον δικό του φάκελο `/data`.

## 11. Deployment & hosting

- Υπάρχον VPS. Καμία ανάγκη για Docker — ένα systemd unit τρέχει `bun run src/index.ts`, restart on failure.
- Caddy μπροστά, με `program.lofos.gr` να κάνει reverse proxy στο local port του Bun app· Caddy αναλαμβάνει αυτόματα το TLS certificate.
- Deploy διαδικασία (απλή, χειροκίνητη αρχικά): `git pull` → `bun install` → `bun run db:migrate` → `systemctl restart program-lofos`. Μπορεί να αυτοματοποιηθεί αργότερα (π.χ. GitHub Actions + SSH) αν χρειαστεί — Φάση 2.

## 12. Backups

- Νυχτερινό cron job που αντιγράφει `data/app.db` (μέσω SQLite `.backup` command για ασφαλές snapshot εν ώρα λειτουργίας) + `data/uploads/` σε δεύτερο τοπικό φάκελο ή/και εξωτερικό αποθηκευτικό χώρο (π.χ. rsync σε άλλο μηχάνημα ή cloud storage).
- Retention: π.χ. τελευταίες 14 ημερήσιες + 6 μηνιαίες αντιγραφές — μπορεί να απλοποιηθεί αν δεν χρειάζεται τόση ιστορικότητα.

## 13. Logs / παρατηρησιμότητα

- Απλό structured console logging (JSON lines) του Hono app → αρχείο ή systemd journal (`journalctl -u program-lofos`).
- Καμία επιπλέον υποδομή (Sentry/Grafana κ.λπ.) στη Φάση 1 — μπορεί να προστεθεί αν φανεί ανάγκη.

## 14. Εκτός πεδίου Φάσης 1 / πιθανά επόμενα βήματα

- Docker/CI-CD αυτοματοποίηση deploy.
- Caching στο iCal endpoint (αν ο όγκος trafic το χρειαστεί).
- Image resizing/optimization pipeline για τα uploaded λογότυπα/εικόνες.
- Παρακολούθηση σφαλμάτων (π.χ. Sentry) αν το app μεγαλώσει.
