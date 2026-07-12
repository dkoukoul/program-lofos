import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { leaders, magicLinks, sections, sessions } from "./schema";
import { createMagicLink, createSession } from "../lib/auth";
import { syncLeadersFromConfig } from "./syncLeaders";

beforeAll(async () => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const existing = await db.select().from(sections);
  if (existing.length === 0) {
    await db.insert(sections).values([
      { type: "agele", name: "Αγέλη", icalPublicToken: crypto.randomUUID() },
      { type: "omada", name: "Ομάδα", icalPublicToken: crypto.randomUUID() },
      { type: "koinotita", name: "Κοινότητα", icalPublicToken: crypto.randomUUID() },
    ]);
  }
});

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "leaders-config-"));
});

function writeConfig(content: unknown): string {
  const path = join(configDir, "leaders.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

async function leaderByEmail(email: string) {
  const [leader] = await db.select().from(leaders).where(eq(leaders.email, email)).limit(1);
  return leader ?? null;
}

/** Reconstructs config entries for every currently-active leader except `excludeId`, so
 * tests that shrink the config only ever drop the one leader under test — the shared
 * in-memory DB in this test run is reused across test files, and syncing with a config
 * that omits everyone would deactivate leaders created by unrelated test files too. */
async function otherActiveLeaderEntries(excludeId: number) {
  const sectionRows = await db.select().from(sections);
  const sectionTypeById = new Map(sectionRows.map((section) => [section.id, section.type]));
  const activeLeaders = await db.select().from(leaders).where(eq(leaders.active, true));

  return activeLeaders
    .filter((leader) => leader.id !== excludeId)
    .map((leader) => ({
      name: leader.name,
      email: leader.email,
      role: leader.role,
      ...(leader.sectionId ? { section: sectionTypeById.get(leader.sectionId) } : {}),
    }));
}

describe("syncLeadersFromConfig", () => {
  test("creates a new leader from config", async () => {
    const email = `new-${crypto.randomUUID()}@example.com`;
    const path = writeConfig({ leaders: [{ name: "Νέος", email, role: "system_staff" }] });

    const result = await syncLeadersFromConfig(path);

    expect(result.created).toBe(1);
    const leader = await leaderByEmail(email);
    expect(leader?.role).toBe("system_staff");
    expect(leader?.active).toBe(true);
  });

  test("resolves section_leader's section to the matching sectionId", async () => {
    const email = `section-${crypto.randomUUID()}@example.com`;
    const path = writeConfig({
      leaders: [{ name: "Βαθμοφόρος", email, role: "section_leader", section: "omada" }],
    });

    await syncLeadersFromConfig(path);

    const leader = await leaderByEmail(email);
    const [omada] = await db.select().from(sections).where(eq(sections.type, "omada")).limit(1);
    expect(leader?.sectionId).toBe(omada!.id);
  });

  test("rejects section_leader entries without a section", async () => {
    const path = writeConfig({
      leaders: [{ name: "Χωρίς τμήμα", email: "bad@example.com", role: "section_leader" }],
    });

    await expect(syncLeadersFromConfig(path)).rejects.toThrow();
  });

  test("rejects duplicate emails in the same config", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    const path = writeConfig({
      leaders: [
        { name: "Α", email, role: "system_staff" },
        { name: "Β", email, role: "system_staff" },
      ],
    });

    await expect(syncLeadersFromConfig(path)).rejects.toThrow(/Διπλότυπο/);
  });

  test("updates an existing leader's role/section on re-sync", async () => {
    const email = `update-${crypto.randomUUID()}@example.com`;
    await syncLeadersFromConfig(writeConfig({ leaders: [{ name: "Πριν", email, role: "system_staff" }] }));

    await syncLeadersFromConfig(
      writeConfig({ leaders: [{ name: "Μετά", email, role: "section_leader", section: "agele" }] }),
    );

    const leader = await leaderByEmail(email);
    expect(leader?.name).toBe("Μετά");
    expect(leader?.role).toBe("section_leader");
  });

  test("deactivates a leader removed from config and revokes sessions/magic links", async () => {
    const email = `revoked-${crypto.randomUUID()}@example.com`;
    await syncLeadersFromConfig(writeConfig({ leaders: [{ name: "Θα φύγει", email, role: "system_staff" }] }));
    const leader = await leaderByEmail(email);
    await createSession(leader!.id, null);
    await createMagicLink(leader!.id);

    const remainingEntries = await otherActiveLeaderEntries(leader!.id);
    const result = await syncLeadersFromConfig(writeConfig({ leaders: remainingEntries }));

    expect(result.deactivated).toBe(1);
    const updated = await leaderByEmail(email);
    expect(updated?.active).toBe(false);

    const remainingSessions = await db.select().from(sessions).where(eq(sessions.leaderId, leader!.id));
    const remainingMagicLinks = await db.select().from(magicLinks).where(eq(magicLinks.leaderId, leader!.id));
    expect(remainingSessions.length).toBe(0);
    expect(remainingMagicLinks.length).toBe(0);
  });

  test("re-adding a deactivated leader to config reactivates them", async () => {
    const email = `reactivate-${crypto.randomUUID()}@example.com`;
    await syncLeadersFromConfig(writeConfig({ leaders: [{ name: "Α", email, role: "system_staff" }] }));
    const leader = await leaderByEmail(email);

    const remainingEntries = await otherActiveLeaderEntries(leader!.id);
    await syncLeadersFromConfig(writeConfig({ leaders: remainingEntries }));
    await syncLeadersFromConfig(
      writeConfig({ leaders: [...remainingEntries, { name: "Α", email, role: "system_staff" }] }),
    );

    const reactivated = await leaderByEmail(email);
    expect(reactivated?.active).toBe(true);
  });
});
