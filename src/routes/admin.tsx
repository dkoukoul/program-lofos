import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  activities,
  activityCustomFields,
  activityParticipants,
  leaders,
  programs,
  sections,
  type Activity,
  type Leader,
  type Program,
} from "../db/schema";
import { requireAuth } from "../lib/auth";
import { canEditSection, requireProgramAccess } from "../lib/authorize";
import {
  checkOverlapPolicy,
  diffChangedFields,
  findOverlap,
  nextAvailableSundays,
  typeDefaults,
} from "../lib/activities";
import { sendProgramChangedEmail, sendProgramPublishedEmail } from "../lib/notify";
import { ProgramForm, ProgramsIndexPage } from "../views/admin/programs";
import {
  ActivityFields,
  ActivityFormPage,
  defaultFormValues,
  formValuesFromActivity,
  toDateInputValue,
  type CustomFieldValue,
} from "../views/admin/wizard/form";
import { OverlapWarning } from "../views/admin/wizard/overlap-warning";
import { ProgramScreen } from "../views/admin/wizard/program-screen";

const admin = new Hono();

admin.use("*", requireAuth);
admin.use("/programs/:id", requireProgramAccess);
admin.use("/programs/:id/*", requireProgramAccess);

function allowOverlapEnv(): boolean {
  return process.env.ALLOW_ACTIVITY_OVERLAP === "true";
}

function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function combineDateTime(dateStr: string, timeStr: string): Date | null {
  if (!timeStr) return null;
  const [hh, mm] = timeStr.split(":").map(Number);
  const date = parseDateOnly(dateStr);
  date.setHours(hh!, mm!, 0, 0);
  return date;
}

/** Δράσεις που "καταλαμβάνουν" μια ημέρα για τον σκοπό του overlap check (§6 architecture doc):
 * ίδιο πρόγραμμα, και — αν είναι πρόγραμμα τμήματος — και οι Δράσεις Συστήματος. */
async function getOverlapCandidates(program: Program): Promise<Activity[]> {
  const own = await db.select().from(activities).where(eq(activities.programId, program.id));
  if (program.sectionId !== null) {
    const systemPrograms = await db.select().from(programs).where(isNull(programs.sectionId));
    if (systemPrograms.length > 0) {
      const systemActivities = await db
        .select()
        .from(activities)
        .where(inArray(activities.programId, systemPrograms.map((p) => p.id)));
      return [...own, ...systemActivities];
    }
  }
  return own;
}

async function getAvailableParticipants(program: Program): Promise<Leader[]> {
  if (program.sectionId === null) {
    return db.select().from(leaders).where(eq(leaders.role, "system_staff"));
  }
  return db
    .select()
    .from(leaders)
    .where(or(eq(leaders.sectionId, program.sectionId), eq(leaders.role, "system_staff")));
}

async function getCustomFields(activityId: number): Promise<CustomFieldValue[]> {
  const rows = await db
    .select({ title: activityCustomFields.title, description: activityCustomFields.description })
    .from(activityCustomFields)
    .where(eq(activityCustomFields.activityId, activityId));
  return rows;
}

async function getParticipantIds(activityId: number): Promise<number[]> {
  const rows = await db
    .select({ leaderId: activityParticipants.leaderId })
    .from(activityParticipants)
    .where(eq(activityParticipants.activityId, activityId));
  return rows.map((r) => r.leaderId);
}

async function replaceCustomFields(activityId: number, fields: CustomFieldValue[]): Promise<void> {
  await db.delete(activityCustomFields).where(eq(activityCustomFields.activityId, activityId));
  const nonEmpty = fields
    .map((f) => ({ title: f.title.trim(), description: f.description.trim() }))
    .filter((f) => f.title !== "" || f.description !== "");
  if (nonEmpty.length > 0) {
    await db.insert(activityCustomFields).values(nonEmpty.map((f) => ({ activityId, ...f })));
  }
}

async function replaceParticipants(activityId: number, leaderIds: number[]): Promise<void> {
  await db.delete(activityParticipants).where(eq(activityParticipants.activityId, activityId));
  if (leaderIds.length > 0) {
    await db.insert(activityParticipants).values(leaderIds.map((leaderId) => ({ activityId, leaderId })));
  }
}

async function getNotificationRecipients(sectionId: number | null): Promise<Leader[]> {
  if (sectionId === null) {
    return db.select().from(leaders).where(eq(leaders.role, "system_staff"));
  }
  return db
    .select()
    .from(leaders)
    .where(or(eq(leaders.sectionId, sectionId), eq(leaders.role, "system_staff")));
}

type ParsedActivityForm = {
  date: string;
  type: Activity["type"];
  location: string;
  startTime: string;
  endTime: string;
  cost: string;
  whatToBring: string;
  customFields: CustomFieldValue[];
  participantIds: number[];
};

const controlFieldsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Δώσε μια έγκυρη ημερομηνία."),
  type: z.enum(["typical", "day_trip", "multi_day", "other", "no_activity"]),
});

function str(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function parseActivityForm(c: { req: { formData: () => Promise<FormData> } }): Promise<
  { success: true; data: ParsedActivityForm } | { success: false; error: string }
> {
  const formData = await c.req.formData();
  const parsed = controlFieldsSchema.safeParse({ date: str(formData, "date"), type: str(formData, "type") });
  if (!parsed.success) {
    return { success: false, error: "Δώσε έγκυρη ημερομηνία και τύπο δράσης." };
  }

  const customFields: CustomFieldValue[] = [0, 1, 2].map((i) => ({
    title: str(formData, `customFieldTitle${i}`).slice(0, 100),
    description: str(formData, `customFieldDescription${i}`).slice(0, 1000),
  }));

  const participantIds = formData
    .getAll("participantIds")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));

  return {
    success: true,
    data: {
      date: parsed.data.date,
      type: parsed.data.type,
      location: str(formData, "location").slice(0, 200),
      startTime: str(formData, "startTime"),
      endTime: str(formData, "endTime"),
      cost: str(formData, "cost").slice(0, 100),
      whatToBring: str(formData, "whatToBring").slice(0, 200),
      customFields,
      participantIds,
    },
  };
}

// ---- Πρόγραμμα (ελάχιστο — χωρίς wizard, μόνο οι Δράσεις έχουν wizard) ----

admin.get("/", (c) => c.redirect("/admin/programs"));

admin.get("/programs", async (c) => {
  const leader = c.get("leader");
  const programsList =
    leader.role === "system_staff"
      ? await db.select().from(programs)
      : await db.select().from(programs).where(eq(programs.sectionId, leader.sectionId!));

  const allSections = await db.select().from(sections);
  const sectionsById = new Map(allSections.map((s) => [s.id, s]));

  return c.html(<ProgramsIndexPage leader={leader} programsList={programsList} sectionsById={sectionsById} />);
});

admin.get("/programs/new", async (c) => {
  const leader = c.get("leader");
  const sectionsList = leader.role === "system_staff" ? await db.select().from(sections) : [];
  return c.html(<ProgramForm leader={leader} sectionsList={sectionsList} />);
});

const createProgramSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sectionId: z.string().optional(),
  })
  .refine((v) => parseDateOnly(v.periodStart) <= parseDateOnly(v.periodEnd), {
    message: "Η λήξη πρέπει να είναι μετά την έναρξη.",
  });

admin.post("/programs", async (c) => {
  const leader = c.get("leader");
  const formData = await c.req.formData();
  const parsed = createProgramSchema.safeParse({
    periodStart: str(formData, "periodStart"),
    periodEnd: str(formData, "periodEnd"),
    sectionId: str(formData, "sectionId"),
  });

  if (!parsed.success) {
    const sectionsList = leader.role === "system_staff" ? await db.select().from(sections) : [];
    return c.html(
      <ProgramForm leader={leader} sectionsList={sectionsList} error="Δώσε έγκυρες ημερομηνίες περιόδου." />,
      400,
    );
  }

  const sectionId =
    leader.role === "system_staff"
      ? parsed.data.sectionId
        ? Number(parsed.data.sectionId)
        : null
      : leader.sectionId;

  const [program] = await db
    .insert(programs)
    .values({
      sectionId,
      periodStart: parseDateOnly(parsed.data.periodStart),
      periodEnd: parseDateOnly(parsed.data.periodEnd),
      status: "draft",
      createdAt: new Date(),
    })
    .returning();

  return c.redirect(`/admin/programs/${program!.id}`);
});

admin.get("/programs/:id", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activitiesList = await db
    .select()
    .from(activities)
    .where(eq(activities.programId, program.id))
    .orderBy(activities.date);

  return c.html(<ProgramScreen leader={leader} program={program} activitiesList={activitiesList} />);
});

admin.post("/programs/:id/publish", async (c) => {
  const program = c.get("program");
  if (program.status === "draft") {
    await db
      .update(programs)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(programs.id, program.id));

    const recipients = await getNotificationRecipients(program.sectionId);
    void sendProgramPublishedEmail(recipients, program);
  }
  return c.redirect(`/admin/programs/${program.id}`);
});

// ---- Δράσεις (wizard) ----

admin.get("/programs/:id/activities/new", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const candidates = await getOverlapCandidates(program);
  const chips = nextAvailableSundays(
    candidates.map((a) => a.date),
    program.periodStart,
    program.periodEnd,
    3,
  );
  const date = chips[0] ?? program.periodStart;
  const values = defaultFormValues("typical", date);
  const existing = findOverlap(candidates, date);

  return c.html(
    <ActivityFormPage
      leader={leader}
      program={program}
      values={values}
      dateChips={chips}
      overlap={{ existing, blocked: checkOverlapPolicy(existing, allowOverlapEnv()) === "block" }}
      title="Νέα δράση"
      participantsAvailable={await getAvailableParticipants(program)}
    />,
  );
});

admin.get("/programs/:id/activities/check-date", async (c) => {
  const program = c.get("program");
  const dateParam = c.req.query("date");
  const editingActivityId = Number(c.req.query("editingActivityId"));

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return c.html(<OverlapWarning existing={null} blocked={false} />);
  }

  const date = parseDateOnly(dateParam);
  const candidates = (await getOverlapCandidates(program)).filter((a) => a.id !== editingActivityId);
  const existing = findOverlap(candidates, date);
  const blocked = checkOverlapPolicy(existing, allowOverlapEnv()) === "block";

  return c.html(
    <OverlapWarning existing={existing} blocked={blocked} editingActivityId={editingActivityId || undefined} />,
  );
});

admin.get("/programs/:id/activities/fields", async (c) => {
  const program = c.get("program");
  const type = c.req.query("type") as Activity["type"] | undefined;
  const dateParam = c.req.query("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? parseDateOnly(dateParam) : program.periodStart;
  const values = defaultFormValues(type ?? "typical", date);

  return c.html(<ActivityFields values={values} participantsAvailable={await getAvailableParticipants(program)} />);
});

admin.post("/programs/:id/activities", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const parsed = await parseActivityForm(c);

  if (!parsed.success) return c.text(parsed.error, 400);

  const { data } = parsed;
  const date = parseDateOnly(data.date);
  const candidates = await getOverlapCandidates(program);
  const existing = findOverlap(candidates, date);
  const decision = checkOverlapPolicy(existing, allowOverlapEnv());

  if (decision === "block") {
    return c.html(
      <ActivityFormPage
        leader={leader}
        program={program}
        values={{
          date,
          type: data.type,
          location: data.location,
          startTime: data.startTime,
          endTime: data.endTime,
          cost: data.cost,
          whatToBring: data.whatToBring,
          customFields: data.customFields,
          participantIds: data.participantIds,
        }}
        dateChips={[]}
        overlap={{ existing, blocked: true }}
        title="Νέα δράση"
        participantsAvailable={await getAvailableParticipants(program)}
      />,
      422,
    );
  }

  const [activity] = await db
    .insert(activities)
    .values({
      programId: program.id,
      isSystemWide: program.sectionId === null,
      type: data.type,
      date,
      location: data.type === "no_activity" ? null : data.location || null,
      startsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.startTime),
      endsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.endTime),
      cost: data.type === "no_activity" ? null : data.cost || null,
      whatToBring: data.type === "no_activity" ? null : data.whatToBring || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (data.type !== "no_activity") {
    await replaceCustomFields(activity!.id, data.customFields);
    await replaceParticipants(activity!.id, data.participantIds);
  }

  return c.redirect(`/admin/programs/${program.id}`);
});

admin.get("/programs/:id/activities/:activityId/edit", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));

  const [activity] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.programId, program.id)))
    .limit(1);
  if (!activity) return c.notFound();

  const customFields = await getCustomFields(activity.id);
  const participantIds = await getParticipantIds(activity.id);
  const values = formValuesFromActivity(activity, customFields, participantIds);

  const candidates = (await getOverlapCandidates(program)).filter((a) => a.id !== activity.id);
  const existing = findOverlap(candidates, activity.date);

  return c.html(
    <ActivityFormPage
      leader={leader}
      program={program}
      values={values}
      dateChips={[]}
      overlap={{ existing, blocked: checkOverlapPolicy(existing, allowOverlapEnv()) === "block" }}
      editingActivityId={activity.id}
      title="Επεξεργασία δράσης"
      participantsAvailable={await getAvailableParticipants(program)}
    />,
  );
});

admin.post("/programs/:id/activities/:activityId", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));

  const [before] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.programId, program.id)))
    .limit(1);
  if (!before) return c.notFound();

  const parsed = await parseActivityForm(c);
  if (!parsed.success) return c.text(parsed.error, 400);

  const { data } = parsed;
  const date = parseDateOnly(data.date);
  const candidates = (await getOverlapCandidates(program)).filter((a) => a.id !== activityId);
  const existing = findOverlap(candidates, date);
  const decision = checkOverlapPolicy(existing, allowOverlapEnv());

  if (decision === "block") {
    return c.html(
      <ActivityFormPage
        leader={leader}
        program={program}
        values={{
          date,
          type: data.type,
          location: data.location,
          startTime: data.startTime,
          endTime: data.endTime,
          cost: data.cost,
          whatToBring: data.whatToBring,
          customFields: data.customFields,
          participantIds: data.participantIds,
        }}
        dateChips={[]}
        overlap={{ existing, blocked: true }}
        editingActivityId={activityId}
        title="Επεξεργασία δράσης"
        participantsAvailable={await getAvailableParticipants(program)}
      />,
      422,
    );
  }

  const after = {
    date,
    location: data.type === "no_activity" ? null : data.location || null,
    startsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.startTime),
    endsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.endTime),
    cost: data.type === "no_activity" ? null : data.cost || null,
    whatToBring: data.type === "no_activity" ? null : data.whatToBring || null,
  };

  const changedFields =
    program.status === "published"
      ? diffChangedFields(before, after, before.changedAfterPublishFields ?? [])
      : (before.changedAfterPublishFields ?? []);

  await db
    .update(activities)
    .set({ type: data.type, ...after, changedAfterPublishFields: changedFields, updatedAt: new Date() })
    .where(eq(activities.id, activityId));

  if (data.type !== "no_activity") {
    await replaceCustomFields(activityId, data.customFields);
    await replaceParticipants(activityId, data.participantIds);
  } else {
    await replaceCustomFields(activityId, []);
    await replaceParticipants(activityId, []);
  }

  const beforeChangedCount = (before.changedAfterPublishFields ?? []).length;
  if (program.status === "published" && changedFields.length > beforeChangedCount) {
    const recipients = await getNotificationRecipients(program.sectionId);
    void sendProgramChangedEmail(recipients, program, { ...before, ...after, type: data.type } as Activity);
  }

  return c.redirect(`/admin/programs/${program.id}`);
});

admin.post("/programs/:id/activities/:activityId/delete", async (c) => {
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));

  await db.delete(activityCustomFields).where(eq(activityCustomFields.activityId, activityId));
  await db.delete(activityParticipants).where(eq(activityParticipants.activityId, activityId));
  await db.delete(activities).where(and(eq(activities.id, activityId), eq(activities.programId, program.id)));

  return c.redirect(`/admin/programs/${program.id}`);
});

admin.post("/programs/:id/activities/quick-typical", async (c) => {
  const program = c.get("program");
  const candidates = await getOverlapCandidates(program);
  const [date] = nextAvailableSundays(
    candidates.map((a) => a.date),
    program.periodStart,
    program.periodEnd,
    1,
  );

  if (!date) return c.redirect(`/admin/programs/${program.id}?error=no-available-sunday`);

  const defaults = typeDefaults("typical");
  const [activity] = await db
    .insert(activities)
    .values({
      programId: program.id,
      isSystemWide: program.sectionId === null,
      type: "typical",
      date,
      location: defaults.location ?? null,
      startsAt: defaults.startTime ? combineDateTime(toDateInputValue(date), defaults.startTime) : null,
      endsAt: defaults.endTime ? combineDateTime(toDateInputValue(date), defaults.endTime) : null,
      whatToBring: defaults.whatToBring ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return c.redirect(`/admin/programs/${program.id}/activities/${activity!.id}/edit`);
});

admin.post("/programs/:id/activities/quick-no-activity", async (c) => {
  const program = c.get("program");
  const candidates = await getOverlapCandidates(program);
  const [date] = nextAvailableSundays(
    candidates.map((a) => a.date),
    program.periodStart,
    program.periodEnd,
    1,
  );

  if (!date) return c.redirect(`/admin/programs/${program.id}?error=no-available-sunday`);

  await db.insert(activities).values({
    programId: program.id,
    isSystemWide: program.sectionId === null,
    type: "no_activity",
    date,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.redirect(`/admin/programs/${program.id}`);
});

export default admin;
