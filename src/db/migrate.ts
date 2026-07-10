import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./client";
import { sections } from "./schema";

migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("Migrations applied.");

// Τα 3 τμήματα είναι σταθερά δεδομένα αναφοράς (§4 architecture doc) — καμία
// self-registration τα δημιουργεί, άρα τα bootstrap-άρουμε εδώ, idempotent.
const DEFAULT_SECTIONS: { type: "agele" | "omada" | "koinotita"; name: string; themeColor: string }[] = [
  { type: "agele", name: "Αγέλη", themeColor: "#f59e0b" },
  { type: "omada", name: "Ομάδα", themeColor: "#6b7d4f" },
  { type: "koinotita", name: "Κοινότητα", themeColor: "#334155" },
];

for (const section of DEFAULT_SECTIONS) {
  const [existing] = await db.select().from(sections).where(eq(sections.type, section.type)).limit(1);
  if (!existing) {
    await db.insert(sections).values({ ...section, icalPublicToken: crypto.randomUUID() });
    console.log(`Δημιουργήθηκε section: ${section.name}`);
  }
}
