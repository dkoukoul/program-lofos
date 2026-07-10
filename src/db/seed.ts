import { eq } from "drizzle-orm";
import { db } from "./client";
import { leaders } from "./schema";

const [name, email] = process.argv.slice(2);

if (!name || !email) {
  console.error('Χρήση: bun run db:seed -- "Όνομα Επώνυμο" email@example.com');
  process.exit(1);
}

const normalizedEmail = email.toLowerCase();

const [existing] = await db.select().from(leaders).where(eq(leaders.email, normalizedEmail)).limit(1);

if (existing) {
  console.log(`Ο leader με email ${normalizedEmail} υπάρχει ήδη (id=${existing.id}).`);
  process.exit(0);
}

const [created] = await db
  .insert(leaders)
  .values({ name, email: normalizedEmail, role: "system_staff", sectionId: null, createdAt: new Date() })
  .returning();

console.log(`Δημιουργήθηκε system_staff leader: ${created?.name} <${created?.email}> (id=${created?.id})`);
