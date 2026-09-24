import { describe, test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../db/client";
import { activities, activityCustomFields, programs, sections, systemNotes, type SystemNote } from "../db/schema";
import { attachActivityExtras, formatNoteRange, noteCoversDate, notesForActivity } from "./notes";

beforeAll(() => {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

function note(overrides: Partial<SystemNote> = {}): SystemNote {
  return {
    id: 1,
    programId: 1,
    text: "Αγιασμός",
    dateStart: new Date(2026, 9, 18),
    dateEnd: new Date(2026, 9, 18),
    changedAfterPublish: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("noteCoversDate", () => {
  test("καλύπτει και τα δύο άκρα του εύρους (inclusive)", () => {
    const weekNote = note({ dateStart: new Date(2026, 10, 10), dateEnd: new Date(2026, 10, 17) });
    expect(noteCoversDate(weekNote, new Date(2026, 10, 10))).toBe(true);
    expect(noteCoversDate(weekNote, new Date(2026, 10, 17))).toBe(true);
    expect(noteCoversDate(weekNote, new Date(2026, 10, 9))).toBe(false);
    expect(noteCoversDate(weekNote, new Date(2026, 10, 18))).toBe(false);
  });

  test("συγκρίνει σε ακρίβεια ημέρας — η ώρα της δράσης δεν μετράει", () => {
    const oneDay = note();
    expect(noteCoversDate(oneDay, new Date(2026, 9, 18, 23, 59))).toBe(true);
    expect(noteCoversDate(oneDay, new Date(2026, 9, 19, 0, 1))).toBe(false);
  });
});

describe("notesForActivity", () => {
  const sameDay = note({ id: 1 });
  const otherDay = note({ id: 2, text: "Εκδρομή", dateStart: new Date(2026, 9, 25), dateEnd: new Date(2026, 9, 25) });
  const range = note({ id: 3, text: "Εβδομάδα Προσφοράς", dateStart: new Date(2026, 9, 12), dateEnd: new Date(2026, 9, 20) });

  test("επιστρέφει μόνο τις σημειώσεις που καλύπτουν την ημέρα της δράσης", () => {
    const result = notesForActivity([sameDay, otherDay, range], {
      date: new Date(2026, 9, 18),
      type: "typical",
    });
    expect(result.map((n) => n.id)).toEqual([3, 1]);
  });

  test("καμία σημείωση σε δράση τύπου «Χωρίς δράση»", () => {
    const result = notesForActivity([sameDay, range], { date: new Date(2026, 9, 18), type: "no_activity" });
    expect(result).toEqual([]);
  });
});

describe("formatNoteRange", () => {
  test("μία ημερομηνία όταν έναρξη = λήξη", () => {
    expect(formatNoteRange(note())).toBe("18/10/2026");
  });

  test("εύρος ηη/μμ/εεεε – ηη/μμ/εεεε όταν διαφέρουν", () => {
    expect(formatNoteRange(note({ dateStart: new Date(2026, 10, 10), dateEnd: new Date(2026, 10, 17) }))).toBe(
      "10/11/2026 – 17/11/2026",
    );
  });
});

async function section(type: "agele" | "omada" | "koinotita") {
  const [existing] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(sections)
    .values({ type, name: type, icalPublicToken: crypto.randomUUID() })
    .returning();
  return created!;
}

async function makeProgram(sectionId: number | null, status: "draft" | "published") {
  const [program] = await db
    .insert(programs)
    .values({
      sectionId,
      periodStart: new Date(2091, 9, 1),
      periodEnd: new Date(2091, 9, 31),
      status,
      createdAt: new Date(),
    })
    .returning();
  return program!;
}

async function makeActivity(programId: number, date: Date, type: "typical" | "no_activity" = "typical") {
  const [activity] = await db
    .insert(activities)
    .values({ programId, type, date, createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return activity!;
}

describe("attachActivityExtras", () => {
  test("γεμίζει δυναμικά πεδία και μόνο δημοσιευμένες σημειώσεις όταν publishedOnly", async () => {
    const agele = await section("agele");
    const sectionProgram = await makeProgram(agele.id, "published");
    const activity = await makeActivity(sectionProgram.id, new Date(2091, 9, 18));
    await db
      .insert(activityCustomFields)
      .values({ activityId: activity.id, title: "Στολή", description: "Πλήρης" });

    const publishedSystemProgram = await makeProgram(null, "published");
    const draftSystemProgram = await makeProgram(null, "draft");
    await db.insert(systemNotes).values([
      {
        programId: publishedSystemProgram.id,
        text: "Αγιασμός",
        dateStart: new Date(2091, 9, 18),
        dateEnd: new Date(2091, 9, 18),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        programId: draftSystemProgram.id,
        text: "Ακόμα πρόχειρο",
        dateStart: new Date(2091, 9, 18),
        dateEnd: new Date(2091, 9, 18),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const [published] = await attachActivityExtras([activity], { publishedOnly: true });
    expect(published!.customFields).toEqual([{ title: "Στολή", description: "Πλήρης" }]);
    expect(published!.notes.map((n) => n.text)).toEqual(["Αγιασμός"]);

    const [everything] = await attachActivityExtras([activity], { publishedOnly: false });
    expect(everything!.notes.map((n) => n.text).sort()).toEqual(["Ακόμα πρόχειρο", "Αγιασμός"].sort());
  });

  test("δράση «Χωρίς δράση» δεν παίρνει σημείωση ούτε μέσα από τη βάση", async () => {
    const omada = await section("omada");
    const sectionProgram = await makeProgram(omada.id, "published");
    const activity = await makeActivity(sectionProgram.id, new Date(2092, 9, 18), "no_activity");

    const systemProgram = await makeProgram(null, "published");
    await db.insert(systemNotes).values({
      programId: systemProgram.id,
      text: "Αγιασμός",
      dateStart: new Date(2092, 9, 18),
      dateEnd: new Date(2092, 9, 18),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [attached] = await attachActivityExtras([activity], { publishedOnly: true });
    expect(attached!.notes).toEqual([]);
  });
});
