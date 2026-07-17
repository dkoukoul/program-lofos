import { db } from "./src/db/client";
import { sections, programs, activities, activityCustomFields, activityParticipants } from "./src/db/schema";
import { eq } from "drizzle-orm";

// Καθαρισμός όλων των υπαρχουσών δράσεων (και ό,τι εξαρτάται από αυτές) πριν το seeding.
// Τα programs μένουν ως έχουν.
await db.delete(activityParticipants);
await db.delete(activityCustomFields);
await db.delete(activities);

const [agele] = await db.select().from(sections).where(eq(sections.type, "agele")).limit(1);
const [omada] = await db.select().from(sections).where(eq(sections.type, "omada")).limit(1);
const [koinotita] = await db.select().from(sections).where(eq(sections.type, "koinotita")).limit(1);

const now = new Date();

function at(y: number, m: number, d: number, hh = 0, mm = 0) {
  return new Date(y, m - 1, d, hh, mm);
}

const septStart = at(2026, 9, 1);
const septEnd = at(2026, 9, 30, 23, 59);

const [ageleProgram] = await db.insert(programs).values({
  sectionId: agele!.id, periodStart: septStart, periodEnd: septEnd,
  status: "published", publishedAt: now, createdAt: now,
}).returning();

const [omadaProgram] = await db.insert(programs).values({
  sectionId: omada!.id, periodStart: septStart, periodEnd: septEnd,
  status: "published", publishedAt: now, createdAt: now,
}).returning();

const [koinotitaProgram] = await db.insert(programs).values({
  sectionId: koinotita!.id, periodStart: septStart, periodEnd: septEnd,
  status: "published", publishedAt: now, createdAt: now,
}).returning();

const [systemProgram] = await db.insert(programs).values({
  sectionId: null, periodStart: septStart, periodEnd: septEnd,
  status: "published", publishedAt: now, createdAt: now,
}).returning();

// Αγέλη
await db.insert(activities).values([
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "typical",
    date: at(2026, 9, 6), location: "Λόφος",
    startsAt: at(2026, 9, 6, 11, 0), endsAt: at(2026, 9, 6, 13, 0),
    whatToBring: "παγούρι", createdAt: now, updatedAt: now,
  },
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "day_trip",
    date: at(2026, 9, 13), location: "Συνάντηση: Λόφος – Προορισμός: Τείχη",
    startsAt: at(2026, 9, 13, 10, 0), endsAt: at(2026, 9, 13, 15, 0),
    whatToBring: "ταπεράκι με φαγητό, παγούρι με νερό",
    createdAt: now, updatedAt: now,
  },
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "typical",
    date: at(2026, 9, 20), location: "Λόφος",
    startsAt: at(2026, 9, 20, 11, 0), endsAt: at(2026, 9, 20, 13, 0),
    whatToBring: "παγούρι", createdAt: now, updatedAt: now,
  },
]);

// Ομάδα
await db.insert(activities).values([
  {
    programId: omadaProgram!.id, isSystemWide: false, type: "typical",
    date: at(2026, 9, 6), location: "Λόφος",
    startsAt: at(2026, 9, 6, 11, 0), endsAt: at(2026, 9, 6, 13, 0),
    whatToBring: "παγούρι", createdAt: now, updatedAt: now,
  },
  {
    programId: omadaProgram!.id, isSystemWide: false, type: "no_activity",
    date: at(2026, 9, 13), createdAt: now, updatedAt: now,
  },
  {
    programId: omadaProgram!.id, isSystemWide: false, type: "multi_day",
    date: at(2026, 9, 19), location: "Συνάντηση: ΚΤΕΛ – Προορισμός: Παράδεισος",
    startsAt: at(2026, 9, 19, 9, 0), endsAt: at(2026, 9, 20, 18, 0),
    cost: "25€", createdAt: now, updatedAt: now,
  },
]);

// Κοινότητα
await db.insert(activities).values([
  {
    programId: koinotitaProgram!.id, isSystemWide: false, type: "other",
    date: at(2026, 9, 6), location: "Πεζά",
    startsAt: at(2026, 9, 6, 10, 0), endsAt: at(2026, 9, 6, 12, 0),
    cost: "6€", createdAt: now, updatedAt: now,
  },
  {
    programId: koinotitaProgram!.id, isSystemWide: false, type: "other",
    date: at(2026, 9, 13), location: "Λόφος",
    startsAt: at(2026, 9, 13, 16, 0), endsAt: at(2026, 9, 13, 20, 0),
    createdAt: now, updatedAt: now,
  },
  {
    programId: koinotitaProgram!.id, isSystemWide: false, type: "day_trip",
    date: at(2026, 9, 20), location: "Συνάντηση: Λόφος – Προορισμός: Φαράγγι Καρτερού",
    startsAt: at(2026, 9, 20, 8, 0), endsAt: at(2026, 9, 20, 14, 0),
    createdAt: now, updatedAt: now,
  },
]);

// Δράση Συστήματος: Αγιασμός (αντικαθιστά τις δράσεις τμημάτων στις 27/09)
const [agiasmos] = await db.insert(activities).values({
  programId: systemProgram!.id, isSystemWide: true, type: "other",
  date: at(2026, 9, 27), location: "Λόφος",
  startsAt: at(2026, 9, 27, 11, 0), endsAt: at(2026, 9, 27, 13, 0),
  createdAt: now, updatedAt: now,
}).returning();

await db.insert(activityCustomFields).values({
  activityId: agiasmos!.id,
  title: "Σημείωση",
  description: "Η δράση είναι ανοιχτή και για γονείς και φίλους.",
});

// Ομάδα Οκτωβρίου — draft, μία τυπική δράση την πρώτη Κυριακή
const octStart = at(2026, 10, 1);
const octEnd = at(2026, 10, 31, 23, 59);

const [omadaOctProgram] = await db.insert(programs).values({
  sectionId: omada!.id, periodStart: octStart, periodEnd: octEnd,
  status: "draft", createdAt: now,
}).returning();

await db.insert(activities).values({
  programId: omadaOctProgram!.id, isSystemWide: false, type: "typical",
  date: at(2026, 10, 4), location: "Λόφος",
  startsAt: at(2026, 10, 4, 11, 0), endsAt: at(2026, 10, 4, 13, 0),
  whatToBring: "παγούρι", createdAt: now, updatedAt: now,
});

console.log("Πρόγραμμα Σεπτεμβρίου 2026 (Αγέλη, Ομάδα, Κοινότητα, Σύστημα) + draft Ομάδα Οκτωβρίου: OK");
