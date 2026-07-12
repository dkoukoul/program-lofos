import { readFileSync } from "fs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { leaders, magicLinks, sections, sessions } from "./schema";

const leaderConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(["system_staff", "section_leader"]),
    section: z.enum(["agele", "omada", "koinotita"]).optional(),
  })
  .refine((leader) => (leader.role === "section_leader" ? !!leader.section : !leader.section), {
    message: "'section_leader' χρειάζεται 'section'· 'system_staff' δεν πρέπει να έχει 'section'.",
  });

const leadersConfigSchema = z.object({ leaders: z.array(leaderConfigSchema) });

function loadConfig(path: string) {
  const raw = readFileSync(path, "utf-8");
  const parsed = leadersConfigSchema.parse(JSON.parse(raw));

  const emails = parsed.leaders.map((leader) => leader.email);
  const duplicate = emails.find((email, index) => emails.indexOf(email) !== index);
  if (duplicate) throw new Error(`Διπλότυπο email στο leaders config: ${duplicate}`);

  return parsed;
}

/**
 * Συγχρονίζει τους επιτρεπόμενους χρήστες από το JSON config (§6 architecture doc)
 * στο `leaders` table: το config είναι η πηγή αλήθειας για ΠΟΙΟΙ έχουν πρόσβαση.
 * Αφαίρεση ενός leader από το config τον απενεργοποιεί (`active = false`) και
 * ανακαλεί αμέσως τις υπάρχουσες sessions/magic links του — η εγγραφή δεν διαγράφεται
 * γιατί άλλοι πίνακες (sessions, magic_links, activity_participants) την αναφέρουν με FK.
 */
export async function syncLeadersFromConfig(
  path = process.env.LEADERS_CONFIG_PATH ?? "./config/leaders.json",
) {
  const config = loadConfig(path);

  const allSections = await db.select().from(sections);
  const sectionIdByType = new Map(allSections.map((section) => [section.type, section.id]));

  let created = 0;
  let updated = 0;

  for (const entry of config.leaders) {
    const sectionId = entry.section ? (sectionIdByType.get(entry.section) ?? null) : null;
    const [existing] = await db.select().from(leaders).where(eq(leaders.email, entry.email)).limit(1);

    if (!existing) {
      await db.insert(leaders).values({
        name: entry.name,
        email: entry.email,
        role: entry.role,
        sectionId,
        active: true,
        createdAt: new Date(),
      });
      created++;
    } else {
      await db
        .update(leaders)
        .set({ name: entry.name, role: entry.role, sectionId, active: true })
        .where(eq(leaders.id, existing.id));
      updated++;
    }
  }

  const configEmails = new Set(config.leaders.map((leader) => leader.email));
  const activeLeaders = await db.select().from(leaders).where(eq(leaders.active, true));
  const toDeactivate = activeLeaders.filter((leader) => !configEmails.has(leader.email));

  for (const leader of toDeactivate) {
    await db.update(leaders).set({ active: false }).where(eq(leaders.id, leader.id));
    await db.delete(sessions).where(eq(sessions.leaderId, leader.id));
    await db.delete(magicLinks).where(eq(magicLinks.leaderId, leader.id));
  }

  console.log(
    `Leaders config sync: ${created} νέοι, ${updated} ενημερώθηκαν, ${toDeactivate.length} ανακλήθηκαν.`,
  );

  return { created, updated, deactivated: toDeactivate.length };
}
