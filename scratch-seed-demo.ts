import { db } from "./src/db/client";
import { sections, programs, activities } from "./src/db/schema";
import { eq } from "drizzle-orm";

const [agele] = await db.select().from(sections).where(eq(sections.type, "agele")).limit(1);
const [omada] = await db.select().from(sections).where(eq(sections.type, "omada")).limit(1);

const now = new Date();
const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

const [ageleProgram] = await db.insert(programs).values({
  sectionId: agele!.id,
  periodStart, periodEnd,
  status: "published",
  themeTitle: "Ο Μόγλης",
  publishedAt: now,
  createdAt: now,
}).returning();

const [omadaProgram] = await db.insert(programs).values({
  sectionId: omada!.id,
  periodStart, periodEnd,
  status: "published",
  publishedAt: now,
  createdAt: now,
}).returning();

const [systemProgram] = await db.insert(programs).values({
  sectionId: null,
  periodStart, periodEnd,
  status: "published",
  publishedAt: now,
  createdAt: now,
}).returning();

function sunday(n: number) {
  const d = new Date(periodStart);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + n * 7);
  return d;
}

await db.insert(activities).values([
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "typical",
    date: sunday(0), location: "Λόφος",
    startsAt: new Date(sunday(0).setHours(11, 0)), endsAt: new Date(sunday(0).setHours(13, 0)),
    whatToBring: "παγούρι", createdAt: now, updatedAt: now,
  },
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "no_activity",
    date: sunday(1), createdAt: now, updatedAt: now,
  },
  {
    programId: ageleProgram!.id, isSystemWide: false, type: "day_trip",
    date: sunday(2), location: "Ζωολογικός Κήπος",
    startsAt: new Date(sunday(2).setHours(9, 30)), endsAt: new Date(sunday(2).setHours(15, 0)),
    cost: "5€", whatToBring: "παγούρι, καπέλο",
    changedAfterPublishFields: ["startsAt"],
    createdAt: now, updatedAt: now,
  },
]);

await db.insert(activities).values([
  {
    programId: omadaProgram!.id, isSystemWide: false, type: "typical",
    date: sunday(0), location: "Λόφος",
    startsAt: new Date(sunday(0).setHours(11, 0)), endsAt: new Date(sunday(0).setHours(13, 0)),
    whatToBring: "παγούρι", createdAt: now, updatedAt: now,
  },
]);

await db.insert(activities).values([
  {
    programId: systemProgram!.id, isSystemWide: true, type: "other",
    date: sunday(3), location: "Πλατεία Ελευθερίας",
    startsAt: new Date(sunday(3).setHours(10, 0)), endsAt: new Date(sunday(3).setHours(12, 0)),
    createdAt: now, updatedAt: now,
  },
]);

console.log("Demo data inserted.");
