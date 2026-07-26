import { describe, test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { db } from "../db/client";
import { activities, programs, sections } from "../db/schema";
import ical from "./ical";

beforeAll(() => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

const app = new Hono();
app.route("/ical", ical);

async function section(type: "agele" | "omada" | "koinotita") {
  const [existing] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(sections)
    .values({ type, name: type, icalPublicToken: crypto.randomUUID() })
    .returning();
  return created!;
}

describe("GET /ical/:sectionId/:tokenFile", () => {
  test("404s when the token in the URL doesn't match the section", async () => {
    const koinotita = await section("koinotita");
    const res = await app.request(`/ical/${koinotita.id}/not-the-real-token.ics`);
    expect(res.status).toBe(404);
  });

  test("404s for an unknown section id", async () => {
    const res = await app.request("/ical/999999/whatever.ics");
    expect(res.status).toBe(404);
  });

  test("404s when the filename is missing the .ics suffix", async () => {
    const koinotita = await section("koinotita");
    const res = await app.request(`/ical/${koinotita.id}/${koinotita.icalPublicToken}`);
    expect(res.status).toBe(404);
  });

  test("serves a .ics feed with published activities only, excluding drafts", async () => {
    const koinotita = await section("koinotita");

    const [publishedProgram] = await db
      .insert(programs)
      .values({
        sectionId: koinotita.id,
        periodStart: new Date(2096, 0, 1),
        periodEnd: new Date(2096, 0, 31),
        status: "published",
        createdAt: new Date(),
      })
      .returning();
    const [draftProgram] = await db
      .insert(programs)
      .values({
        sectionId: koinotita.id,
        periodStart: new Date(2096, 1, 1),
        periodEnd: new Date(2096, 1, 28),
        status: "draft",
        createdAt: new Date(),
      })
      .returning();

    const [timedActivity] = await db
      .insert(activities)
      .values({
        programId: publishedProgram!.id,
        isSystemWide: false,
        type: "typical",
        date: new Date(2096, 0, 5),
        location: "Λόφος",
        startsAt: new Date(2096, 0, 5, 11, 0),
        endsAt: new Date(2096, 0, 5, 13, 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const [noActivity] = await db
      .insert(activities)
      .values({
        programId: publishedProgram!.id,
        isSystemWide: false,
        type: "no_activity",
        date: new Date(2096, 0, 19),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const [draftActivity] = await db
      .insert(activities)
      .values({
        programId: draftProgram!.id,
        isSystemWide: false,
        type: "typical",
        date: new Date(2096, 1, 5),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const res = await app.request(`/ical/${koinotita.id}/${koinotita.icalPublicToken}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");

    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain(`UID:activity-${timedActivity!.id}@program.lofos.gr`);
    expect(body).toContain(`UID:activity-${noActivity!.id}@program.lofos.gr`);
    expect(body).not.toContain(`UID:activity-${draftActivity!.id}@program.lofos.gr`);
    expect(body).toContain("SUMMARY:Τυπική συγκέντρωση — Λόφος");
  });
});
