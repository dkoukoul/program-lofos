import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  activities,
  activityCustomFields,
  activityParticipants,
  leaders,
  programs,
  sections,
  systemNotes,
  type Activity,
  type Leader,
  type Program,
  type SystemNote,
} from "../db/schema";
import { requireAuth } from "../lib/auth";
import { canEditSection, requireProgramAccess, requireSystemStaff } from "../lib/authorize";
import {
  applyTimeTbd,
  changeGroupsOf,
  checkOverlapPolicy,
  diffChangedFields,
  findOverlap,
  newlyChangedFields,
  nextAvailableSundays,
  typeDefaults,
  unhideReChangedGroups,
} from "../lib/activities";
import { logActivityChange } from "../lib/audit";
import { attachActivityExtras, getProgramNotes } from "../lib/notes";
import { sendProgramChangedEmail, sendProgramPublishedEmail, sendSystemNoteChangedEmail } from "../lib/notify";
import {
  buildProgramTimeline,
  currentAndNextProgram,
  sundayCoverage,
  suggestMonthToCreate,
  upcomingMonths,
} from "../lib/program-overview";
import { getPreviewSectionSchedule } from "../lib/schedule";
import { AdminDashboardPage, type DashboardProgram, type DashboardScope } from "../views/admin/dashboard";
import { ActivityRow, ActivityRowEditForm, AllActivitiesPage, rowLabels, type HomeSortColumn, type SortDir } from "../views/admin/home";
import { PreviewBanner } from "../views/admin/preview-banner";
import { SCOPE_ORDER, programKind, type SectionKind } from "../views/admin/program-labels";
import { SECTION_ORDER } from "../views/public/layout";
import { AgeleSectionPage } from "../views/public/templates/agele";
import { KoinotitaSectionPage } from "../views/public/templates/koinotita";
import { OmadaSectionPage } from "../views/public/templates/omada";
import { ActivityChangeBadges } from "../views/admin/change-badges";
import { HelpPage } from "../views/admin/help";
import { NOTE_TEXT_MAX, SystemNoteFormPage, noteFormValues } from "../views/admin/notes";
import { ProgramForm, ProgramsIndexPage, type ProgramGroup } from "../views/admin/programs";
import {
  ActivityFields,
  ActivityFormPage,
  defaultFormValues,
  formValuesFromActivity,
  toDateInputValue,
  type ActivityFormValues,
  type CustomFieldValue,
} from "../views/admin/wizard/form";
import { OverlapWarning } from "../views/admin/wizard/overlap-warning";
import {
  AdminActivityCard,
  AdminActivityCardEditForm,
  ProgramScreen,
  activityCardId,
} from "../views/admin/wizard/program-screen";

type SectionType = (typeof SECTION_ORDER)[number];

const admin = new Hono();

admin.use("*", requireAuth);

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

/** Οι παλιές συντομεύσεις στέλνουν POST χωρίς σώμα — τότε `formData()` πετάει· το θεωρούμε κενή φόρμα. */
async function optionalFormData(c: Context): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    return new FormData();
  }
}

function parseDateParam(value: string | undefined | null): Date | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : null;
}

function isWithinPeriod(program: Program, date: Date): boolean {
  return date >= program.periodStart && date <= program.periodEnd;
}

/**
 * Ημερομηνία για τις συντομεύσεις "+ Τυπική" / "Χωρίς δράση". Με `date` (κενή θέση της λίστας)
 * ελέγχεται server-side ότι είναι μέσα στην περίοδο και ότι δεν υπάρχει ήδη δράση — πάντα
 * αποκλεισμός εδώ, ανεξάρτητα από το ALLOW_ACTIVITY_OVERLAP, αφού η συντόμευση δεν έχει οθόνη
 * προειδοποίησης. Χωρίς `date`: η επόμενη διαθέσιμη Κυριακή, όπως πριν.
 */
async function resolveQuickAddDate(
  program: Program,
  formData: FormData,
): Promise<{ date: Date; fromSlot: boolean } | { error: string }> {
  const candidates = await getOverlapCandidates(program);
  const raw = str(formData, "date");
  if (raw) {
    const date = parseDateParam(raw);
    if (!date || !isWithinPeriod(program, date)) return { error: "date-outside-period" };
    if (findOverlap(candidates, date)) return { error: "date-taken" };
    return { date, fromSlot: true };
  }
  const [date] = nextAvailableSundays(
    candidates.map((a) => a.date),
    program.periodStart,
    program.periodEnd,
    1,
  );
  return date ? { date, fromSlot: false } : { error: "no-available-sunday" };
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
    return db.select().from(leaders).where(and(eq(leaders.role, "system_staff"), eq(leaders.active, true)));
  }
  return db
    .select()
    .from(leaders)
    .where(
      and(
        or(eq(leaders.sectionId, program.sectionId), eq(leaders.role, "system_staff")),
        eq(leaders.active, true),
      ),
    );
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
    return db.select().from(leaders).where(and(eq(leaders.role, "system_staff"), eq(leaders.active, true)));
  }
  return db
    .select()
    .from(leaders)
    .where(
      and(or(eq(leaders.sectionId, sectionId), eq(leaders.role, "system_staff")), eq(leaders.active, true)),
    );
}

async function getSectionsById(): Promise<Map<number, typeof sections.$inferSelect>> {
  const all = await db.select().from(sections);
  return new Map(all.map((s) => [s.id, s]));
}

async function loadOwnActivity(program: Program, activityId: number): Promise<Activity | null> {
  const [activity] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.programId, program.id)))
    .limit(1);
  return activity ?? null;
}

type ParsedActivityForm = {
  date: string;
  type: Activity["type"];
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  timeTbd: boolean;
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

// Οι συντεταγμένες γεμίζουν από το map picker (hidden inputs, βλ. views/admin/wizard/form.tsx) —
// ένα από τα δύο κενό σημαίνει bug/παραποίηση στο client, όχι έγκυρη μερική επιλογή.
const coordsSchema = z
  .object({ locationLat: z.string(), locationLng: z.string() })
  .transform(({ locationLat, locationLng }) => ({
    locationLat: locationLat === "" ? null : Number(locationLat),
    locationLng: locationLng === "" ? null : Number(locationLng),
  }))
  .refine((v) => (v.locationLat === null) === (v.locationLng === null), {
    message: "Χρειάζονται και οι δύο συντεταγμένες τοποθεσίας (πλάτος & μήκος).",
  })
  .refine((v) => v.locationLat === null || (Number.isFinite(v.locationLat) && Math.abs(v.locationLat) <= 90), {
    message: "Μη έγκυρο γεωγραφικό πλάτος τοποθεσίας.",
  })
  .refine((v) => v.locationLng === null || (Number.isFinite(v.locationLng) && Math.abs(v.locationLng) <= 180), {
    message: "Μη έγκυρο γεωγραφικό μήκος τοποθεσίας.",
  });

function str(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function parseActivityForm(formData: FormData): Promise<
  { success: true; data: ParsedActivityForm } | { success: false; error: string }
> {
  const parsed = controlFieldsSchema.safeParse({ date: str(formData, "date"), type: str(formData, "type") });
  if (!parsed.success) {
    return { success: false, error: "Δώσε έγκυρη ημερομηνία και τύπο δράσης." };
  }

  const coordsParsed = coordsSchema.safeParse({
    locationLat: str(formData, "locationLat"),
    locationLng: str(formData, "locationLng"),
  });
  if (!coordsParsed.success) {
    return { success: false, error: coordsParsed.error.issues[0]?.message ?? "Μη έγκυρες συντεταγμένες τοποθεσίας." };
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
      locationLat: coordsParsed.data.locationLat,
      locationLng: coordsParsed.data.locationLng,
      ...applyTimeTbd(formData.get("timeTbd") === "on", str(formData, "startTime"), str(formData, "endTime")),
      cost: str(formData, "cost").slice(0, 100),
      whatToBring: str(formData, "whatToBring").slice(0, 200),
      customFields,
      participantIds,
    },
  };
}

const ACTIVITY_TYPES = ["typical", "day_trip", "multi_day", "other", "no_activity"] as const;

/**
 * Best-effort ξαναγέμισμα της φόρμας όταν το parseActivityForm αποτύχει (π.χ. tampered
 * request) — ώστε ο χρήστης να ξαναδεί τη φόρμα με ό,τι είχε γράψει αντί για μια λευκή
 * σελίδα με raw error text (§2.3 ux-ui-guidelines).
 */
function rawFormValues(formData: FormData, fallbackDate: Date): ActivityFormValues {
  const dateStr = str(formData, "date");
  const typeStr = str(formData, "type");
  const latStr = str(formData, "locationLat");
  const lngStr = str(formData, "locationLng");
  const lat = latStr === "" ? NaN : Number(latStr);
  const lng = lngStr === "" ? NaN : Number(lngStr);

  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? parseDateOnly(dateStr) : fallbackDate,
    type: (ACTIVITY_TYPES as readonly string[]).includes(typeStr) ? (typeStr as Activity["type"]) : "typical",
    location: str(formData, "location").slice(0, 200),
    locationLat: Number.isFinite(lat) ? lat : null,
    locationLng: Number.isFinite(lng) ? lng : null,
    ...applyTimeTbd(formData.get("timeTbd") === "on", str(formData, "startTime"), str(formData, "endTime")),
    cost: str(formData, "cost").slice(0, 100),
    whatToBring: str(formData, "whatToBring").slice(0, 200),
    customFields: [0, 1, 2].map((i) => ({
      title: str(formData, `customFieldTitle${i}`).slice(0, 100),
      description: str(formData, `customFieldDescription${i}`).slice(0, 1000),
    })),
    participantIds: formData
      .getAll("participantIds")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n)),
  };
}

// ---- Πρόγραμμα (ελάχιστο — χωρίς wizard, μόνο οι Δράσεις έχουν wizard) ----

const HOME_SORT_COLUMNS = ["date", "section", "type", "location", "status"] as const;

function isHomeSortColumn(value: string): value is HomeSortColumn {
  return (HOME_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Τα προγράμματα που βλέπει ο συνδεδεμένος: το επιτελείο όλα, ο βαθμοφόρος μόνο του τμήματός του (§6). */
async function visibleProgramsFor(leader: Leader): Promise<Program[]> {
  return leader.role === "system_staff"
    ? db.select().from(programs)
    : db.select().from(programs).where(eq(programs.sectionId, leader.sectionId!));
}

/** "Χώροι" (Σύστημα/τμήματα) που βλέπει ο συνδεδεμένος, με τη σειρά του SCOPE_ORDER. */
function visibleScopes(
  leader: Leader,
  allSections: (typeof sections.$inferSelect)[],
): { kind: SectionKind; sectionId: number | null }[] {
  return SCOPE_ORDER.flatMap((kind): { kind: SectionKind; sectionId: number | null }[] => {
    if (kind === "system") return leader.role === "system_staff" ? [{ kind, sectionId: null }] : [];
    const section = allSections.find((s) => s.type === kind);
    if (!section || !canEditSection(leader, section.id)) return [];
    return [{ kind, sectionId: section.id }];
  });
}

admin.get("/", async (c) => {
  const leader = c.get("leader");
  const now = new Date();
  const allSections = await db.select().from(sections);
  const visiblePrograms = await visibleProgramsFor(leader);

  // Οι Δράσεις Συστήματος "πιάνουν" Κυριακές και στα τμήματα (overlap/κάλυψη) — φορτώνονται
  // και για τον βαθμοφόρο τμήματος, μόνο για μέτρηση, χωρίς να του δίνουν πρόσβαση στο πρόγραμμα.
  const systemProgramIds = (await db.select({ id: programs.id }).from(programs).where(isNull(programs.sectionId))).map(
    (row) => row.id,
  );
  const programIds = [...new Set([...visiblePrograms.map((p) => p.id), ...systemProgramIds])];
  const relevantActivities =
    programIds.length > 0
      ? await db
          .select({ programId: activities.programId, date: activities.date })
          .from(activities)
          .where(inArray(activities.programId, programIds))
      : [];
  const systemActivities = relevantActivities.filter((a) => systemProgramIds.includes(a.programId));

  function summarize(program: Program | null): DashboardProgram | null {
    if (!program) return null;
    const own = relevantActivities.filter((a) => a.programId === program.id);
    return {
      program,
      activityCount: own.length,
      coverage: program.sectionId === null ? null : sundayCoverage([...own, ...systemActivities], program, now),
    };
  }

  const scopes: DashboardScope[] = visibleScopes(leader, allSections).map(({ kind, sectionId }) => {
    const scopePrograms = visiblePrograms.filter((p) => p.sectionId === sectionId);
    const { current, next } = currentAndNextProgram(scopePrograms, now);
    return {
      kind,
      sectionId,
      current: summarize(current),
      next: summarize(next),
      suggestion: suggestMonthToCreate(scopePrograms, now),
    };
  });

  return c.html(<AdminDashboardPage leader={leader} scopes={scopes} />);
});

admin.get("/activities", async (c) => {
  const leader = c.get("leader");
  const sectionFilter = c.req.query("section") ?? "all";
  const monthFilter = c.req.query("month") ?? "all";
  const typeFilter = c.req.query("type") ?? "all";
  const statusFilter = c.req.query("status") ?? "all";
  const sortParam = c.req.query("sort") ?? "date";
  const sort: HomeSortColumn = isHomeSortColumn(sortParam) ? sortParam : "date";
  const dir: SortDir = c.req.query("dir") === "desc" ? "desc" : "asc";

  const sectionsById = await getSectionsById();
  const visiblePrograms = await visibleProgramsFor(leader);
  const programsById = new Map(visiblePrograms.map((p) => [p.id, p]));
  const programIds = visiblePrograms.map((p) => p.id);

  const visibleActivities =
    programIds.length > 0
      ? await db.select().from(activities).where(inArray(activities.programId, programIds))
      : [];

  const rows = visibleActivities.map((activity) => ({
    activity,
    program: programsById.get(activity.programId)!,
  }));

  return c.html(
    <AllActivitiesPage
      leader={leader}
      rows={rows}
      sectionsById={sectionsById}
      sectionFilter={sectionFilter}
      monthFilter={monthFilter}
      typeFilter={typeFilter}
      statusFilter={statusFilter}
      sort={sort}
      dir={dir}
    />,
  );
});

admin.get("/help", async (c) => {
  const leader = c.get("leader");
  return c.html(<HelpPage leader={leader} />);
});

const PREVIEW_PAGES = {
  agele: AgeleSectionPage,
  omada: OmadaSectionPage,
  koinotita: KoinotitaSectionPage,
} as const;

function isSectionType(value: string): value is SectionType {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

/**
 * Προεπισκόπηση της δημόσιας σελίδας τμήματος με τα πρόχειρα (ux-ui-guidelines §2.5).
 * Server-side authorization (§6): ο βαθμοφόρος βλέπει μόνο το δικό του τμήμα· το `?program=`
 * περνάει από τον ίδιο έλεγχο με το requireProgramAccess. Πρόγραμμα άλλου τμήματος από αυτό του
 * URL → redirect στη σωστή προεπισκόπηση (αντί να δείξουμε κάτι που δεν ζητήθηκε).
 */
admin.get("/preview/:section", async (c) => {
  const leader = c.get("leader");
  const type = c.req.param("section");
  if (!isSectionType(type)) return c.notFound();

  const allSections = await db.select().from(sections);
  const section = allSections.find((s) => s.type === type);
  if (!section) return c.notFound();
  if (!canEditSection(leader, section.id)) return c.text("Δεν έχεις δικαίωμα πρόσβασης σε αυτό το τμήμα.", 403);

  let focus: Program | null = null;
  const programParam = c.req.query("program");
  if (programParam) {
    const [found] = await db.select().from(programs).where(eq(programs.id, Number(programParam))).limit(1);
    if (!found) return c.notFound();
    if (!canEditSection(leader, found.sectionId)) {
      return c.text("Δεν έχεις δικαίωμα πρόσβασης σε αυτό το πρόγραμμα.", 403);
    }
    if (found.sectionId !== null && found.sectionId !== section.id) {
      const ownType = allSections.find((s) => s.id === found.sectionId)!.type;
      return c.redirect(`/admin/preview/${ownType}?program=${found.id}`);
    }
    focus = found;
  }

  const schedule = await getPreviewSectionSchedule(section.id, focus);
  const shownProgram = schedule.program && "id" in schedule.program ? (schedule.program as Program) : null;
  // Αλλαγή τμήματος έχει νόημα μόνο όταν δεν "κοιτάμε" συγκεκριμένο πρόγραμμα τμήματος.
  const switchableSections =
    focus === null || focus.sectionId === null
      ? SECTION_ORDER.filter((t) => {
          const s = allSections.find((row) => row.type === t);
          return s !== undefined && canEditSection(leader, s.id);
        })
      : [];
  const SectionPage = PREVIEW_PAGES[type];

  return c.html(
    <SectionPage
      section={section}
      program={schedule.program}
      scheduleActivities={schedule.activities}
      isLoggedIn
      previewBanner={
        <PreviewBanner
          sectionType={type}
          focusProgram={focus}
          shownProgram={shownProgram}
          switchableSections={switchableSections}
        />
      }
    />,
  );
});

admin.get("/programs", async (c) => {
  const leader = c.get("leader");
  const now = new Date();
  const allSections = await db.select().from(sections);
  const visiblePrograms = await visibleProgramsFor(leader);
  const programIds = visiblePrograms.map((p) => p.id);
  const counts =
    programIds.length > 0
      ? await db
          .select({ programId: activities.programId })
          .from(activities)
          .where(inArray(activities.programId, programIds))
      : [];

  const groups: ProgramGroup[] = visibleScopes(leader, allSections).map(({ kind, sectionId }) => {
    const scopePrograms = visiblePrograms.filter((p) => p.sectionId === sectionId);
    const { current } = currentAndNextProgram(scopePrograms, now);
    return {
      kind,
      entries: scopePrograms
        .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())
        .map((program) => ({
          program,
          activityCount: counts.filter((row) => row.programId === program.id).length,
          isCurrent: program.id === current?.id,
        })),
    };
  });

  return c.html(<ProgramsIndexPage leader={leader} groups={groups} />);
});

async function programFormResponse(
  c: Context,
  options: { selectedSection?: string; values?: { periodStart: string; periodEnd: string }; error?: string } = {},
  status?: 400,
) {
  const leader = c.get("leader");
  const sectionsList = leader.role === "system_staff" ? await db.select().from(sections) : [];
  return c.html(
    <ProgramForm
      leader={leader}
      sectionsList={sectionsList}
      monthChoices={upcomingMonths(new Date(), 3)}
      {...options}
    />,
    status,
  );
}

admin.get("/programs/new", async (c) => {
  // ?section=system|agele|omada|koinotita: προεπιλογή τμήματος όταν ερχόμαστε από τη λίστα ενός τμήματος.
  const sectionParam = c.req.query("section");
  let selectedSection: string | undefined;
  if (sectionParam === "system") selectedSection = "system";
  else if (sectionParam) {
    const [section] = await db.select().from(sections).where(eq(sections.type, sectionParam as SectionType)).limit(1);
    selectedSection = section ? String(section.id) : undefined;
  }
  return programFormResponse(c, { selectedSection });
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
    return programFormResponse(
      c,
      {
        selectedSection: str(formData, "sectionId") || "system",
        values: { periodStart: str(formData, "periodStart"), periodEnd: str(formData, "periodEnd") },
        error: "Δώσε έγκυρες ημερομηνίες περιόδου (η λήξη όχι πριν την έναρξη).",
      },
      400,
    );
  }

  const sectionId =
    leader.role === "system_staff"
      ? parsed.data.sectionId
        ? Number(parsed.data.sectionId)
        : null
      : leader.sectionId;
  const periodStart = parseDateOnly(parsed.data.periodStart);
  const periodEnd = parseDateOnly(parsed.data.periodEnd);

  // Ίδιο τμήμα + ακριβώς ίδια περίοδος υπάρχει ήδη (π.χ. διπλό κλικ στο "+ Δημιουργία <μήνα>"
  // της αρχικής): ανοίγουμε το υπάρχον αντί να φτιάξουμε διπλότυπο.
  const [duplicate] = await db
    .select()
    .from(programs)
    .where(
      and(
        sectionId === null ? isNull(programs.sectionId) : eq(programs.sectionId, sectionId!),
        eq(programs.periodStart, periodStart),
        eq(programs.periodEnd, periodEnd),
      ),
    )
    .limit(1);
  if (duplicate) return c.redirect(`/admin/programs/${duplicate.id}`);

  const [program] = await db
    .insert(programs)
    .values({ sectionId, periodStart, periodEnd, status: "draft", createdAt: new Date() })
    .returning();

  return c.redirect(`/admin/programs/${program!.id}`);
});

// Σημείωση route-ordering: το requireProgramAccess middleware πρέπει να δηλωθεί
// ΜΕΤΑ τα στατικά "/programs", "/programs/new" routes παραπάνω — το Hono συνθέτει
// middleware+handlers με τη σειρά δήλωσης, όχι με βάση ειδικότητα pattern, άρα ένα
// use("/programs/:id", ...) δηλωμένο νωρίτερα θα "έπιανε" και το "/programs/new"
// (id="new") πριν προλάβει να τρέξει ο δικός του handler.
admin.use("/programs/:id", requireProgramAccess);
admin.use("/programs/:id/*", requireProgramAccess);

const PROGRAM_SCREEN_ERRORS: Record<string, string> = {
  "no-available-sunday": "Δεν υπάρχει άλλη διαθέσιμη Κυριακή σε αυτή την περίοδο — χρησιμοποίησε «+ Νέα δράση».",
};

const PROGRAM_SCREEN_ERRORS_EXTRA: Record<string, string> = {
  "date-taken": "Εκείνη τη μέρα υπάρχει ήδη δράση — άνοιξέ τη για να την αλλάξεις.",
  "date-outside-period": "Η ημερομηνία είναι εκτός της περιόδου του προγράμματος.",
};

/** Δράσεις Συστήματος μέσα στην περίοδο ενός προγράμματος τμήματος (πρόχειρες και δημοσιευμένες). */
async function systemActivitiesInPeriod(program: Program): Promise<Activity[]> {
  if (program.sectionId === null) return [];
  const systemProgramIds = (
    await db.select({ id: programs.id }).from(programs).where(isNull(programs.sectionId))
  ).map((row) => row.id);
  if (systemProgramIds.length === 0) return [];
  return db
    .select()
    .from(activities)
    .where(
      and(
        inArray(activities.programId, systemProgramIds),
        gte(activities.date, program.periodStart),
        lte(activities.date, program.periodEnd),
      ),
    );
}

/**
 * Η οθόνη προγράμματος (ux-ui-guidelines §2.2): χρονολόγιο με τις δράσεις του προγράμματος,
 * τις Δράσεις Συστήματος της περιόδου (μόνο ανάγνωση) και τις κενές Κυριακές. Δυναμικά πεδία και
 * Σημειώσεις Συστήματος γεμίζονται με `publishedOnly: false` — στο διαχειριστικό φαίνεται και ό,τι
 * είναι ακόμα πρόχειρο, ώστε ο βαθμοφόρος να βλέπει ό,τι θα δει ο επισκέπτης.
 */
async function programScreenResponse(c: Context, error?: string, status?: 400 | 422) {
  const leader = c.get("leader");
  const program = c.get("program");
  const [own, system] = await Promise.all([
    db.select().from(activities).where(eq(activities.programId, program.id)).orderBy(activities.date),
    systemActivitiesInPeriod(program),
  ]);
  const detailed = await attachActivityExtras([...own, ...system], { publishedOnly: false });
  const ownDetailed = detailed.filter((a) => a.programId === program.id);
  const systemDetailed = detailed.filter((a) => a.programId !== program.id);
  const isSectionProgram = program.sectionId !== null;
  const notes = isSectionProgram ? [] : await getProgramNotes(program.id);

  return c.html(
    <ProgramScreen
      leader={leader}
      program={program}
      kind={programKind(program, await getSectionsById())}
      timeline={buildProgramTimeline(ownDetailed, systemDetailed, program, { emptySundays: isSectionProgram })}
      coverage={isSectionProgram ? sundayCoverage([...own, ...system], program) : null}
      notes={notes}
      error={error}
    />,
    status,
  );
}

admin.get("/programs/:id", async (c) => {
  const errorParam = c.req.query("error");
  return programScreenResponse(
    c,
    errorParam ? (PROGRAM_SCREEN_ERRORS[errorParam] ?? PROGRAM_SCREEN_ERRORS_EXTRA[errorParam]) : undefined,
  );
});

admin.post("/programs/:id/delete", async (c) => {
  const program = c.get("program");
  const programActivityIds = (
    await db.select({ id: activities.id }).from(activities).where(eq(activities.programId, program.id))
  ).map((row) => row.id);

  if (programActivityIds.length > 0) {
    await db.delete(activityCustomFields).where(inArray(activityCustomFields.activityId, programActivityIds));
    await db.delete(activityParticipants).where(inArray(activityParticipants.activityId, programActivityIds));
    await db.delete(activities).where(eq(activities.programId, program.id));
  }
  await db.delete(systemNotes).where(eq(systemNotes.programId, program.id));
  await db.delete(programs).where(eq(programs.id, program.id));

  return c.redirect("/admin/programs");
});

admin.post("/programs/:id/publish", async (c) => {
  const program = c.get("program");
  if (program.status === "draft") {
    await db
      .update(programs)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(programs.id, program.id));

    const recipients = await getNotificationRecipients(program.sectionId);
    await sendProgramPublishedEmail(recipients, program);
  }
  return c.redirect(`/admin/programs/${program.id}`);
});

// ---- Σημειώσεις Συστήματος ----

/**
 * Server-side authorization για κάθε write σε Σημείωση Συστήματος (§6 architecture doc):
 * μόνο το επιτελείο, και μόνο πάνω στο πρόγραμμα Συστήματος (`sectionId = null`) — το
 * `requireProgramAccess` από μόνο του θα άφηνε το επιτελείο να γράψει σημείωση και σε
 * πρόγραμμα τμήματος, όπου η έννοια δεν υπάρχει.
 */
function denyUnlessSystemNotesAllowed(c: Context): Response | null {
  const leader = c.get("leader");
  const program = c.get("program");
  if (leader.role !== "system_staff" || program.sectionId !== null) {
    return c.text("Οι Σημειώσεις Συστήματος ορίζονται μόνο από το επιτελείο, στο πρόγραμμα Συστήματος.", 403);
  }
  return null;
}

const systemNoteSchema = z
  .object({
    text: z.string().min(1).max(NOTE_TEXT_MAX),
    dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => parseDateOnly(v.dateStart) <= parseDateOnly(v.dateEnd), {
    message: "Η ημερομηνία «Έως» δεν μπορεί να είναι πριν από την «Από».",
  });

const SYSTEM_NOTE_ERROR = "Γράψε κείμενο σημείωσης και έγκυρο εύρος ημερομηνιών (η «Έως» όχι πριν την «Από»).";

function parseSystemNoteForm(formData: FormData) {
  return systemNoteSchema.safeParse({
    text: str(formData, "text").slice(0, NOTE_TEXT_MAX),
    dateStart: str(formData, "dateStart"),
    dateEnd: str(formData, "dateEnd"),
  });
}

async function loadProgramNote(programId: number, noteId: number): Promise<SystemNote | null> {
  const [note] = await db
    .select()
    .from(systemNotes)
    .where(and(eq(systemNotes.id, noteId), eq(systemNotes.programId, programId)))
    .limit(1);
  return note ?? null;
}

admin.post("/programs/:id/notes", async (c) => {
  const denied = denyUnlessSystemNotesAllowed(c);
  if (denied) return denied;

  const program = c.get("program");
  const parsed = parseSystemNoteForm(await c.req.formData());
  if (!parsed.success) return programScreenResponse(c, SYSTEM_NOTE_ERROR, 400);

  await db.insert(systemNotes).values({
    programId: program.id,
    text: parsed.data.text,
    dateStart: parseDateOnly(parsed.data.dateStart),
    dateEnd: parseDateOnly(parsed.data.dateEnd),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.redirect(`/admin/programs/${program.id}`);
});

admin.get("/programs/:id/notes/:noteId/edit", async (c) => {
  const denied = denyUnlessSystemNotesAllowed(c);
  if (denied) return denied;

  const leader = c.get("leader");
  const program = c.get("program");
  const note = await loadProgramNote(program.id, Number(c.req.param("noteId")));
  if (!note) return c.notFound();

  return c.html(
    <SystemNoteFormPage leader={leader} program={program} noteId={note.id} values={noteFormValues(note)} />,
  );
});

admin.post("/programs/:id/notes/:noteId", async (c) => {
  const denied = denyUnlessSystemNotesAllowed(c);
  if (denied) return denied;

  const leader = c.get("leader");
  const program = c.get("program");
  const noteId = Number(c.req.param("noteId"));
  const before = await loadProgramNote(program.id, noteId);
  if (!before) return c.notFound();

  const formData = await c.req.formData();
  const parsed = parseSystemNoteForm(formData);
  if (!parsed.success) {
    return c.html(
      <SystemNoteFormPage
        leader={leader}
        program={program}
        noteId={noteId}
        values={{
          text: str(formData, "text").slice(0, NOTE_TEXT_MAX),
          dateStart: str(formData, "dateStart"),
          dateEnd: str(formData, "dateEnd"),
        }}
        error={SYSTEM_NOTE_ERROR}
      />,
      400,
    );
  }

  const after = {
    text: parsed.data.text,
    dateStart: parseDateOnly(parsed.data.dateStart),
    dateEnd: parseDateOnly(parsed.data.dateEnd),
  };
  const changed =
    after.text !== before.text ||
    after.dateStart.getTime() !== before.dateStart.getTime() ||
    after.dateEnd.getTime() !== before.dateEnd.getTime();
  // Μόλις το πρόγραμμα Συστήματος έχει δημοσιευτεί, κάθε αλλαγή σημειώνεται μόνιμα και
  // ειδοποιεί (purpose doc §5.4/§5.5) — δεν καθαρίζεται ποτέ αυτόματα.
  const changedAfterPublish = before.changedAfterPublish || (program.status === "published" && changed);

  await db
    .update(systemNotes)
    .set({ ...after, changedAfterPublish, updatedAt: new Date() })
    .where(eq(systemNotes.id, noteId));

  if (program.status === "published" && changed) {
    const recipients = await getNotificationRecipients(program.sectionId);
    await sendSystemNoteChangedEmail(recipients, { ...before, ...after, changedAfterPublish });
  }

  return c.redirect(`/admin/programs/${program.id}`);
});

admin.post("/programs/:id/notes/:noteId/delete", async (c) => {
  const denied = denyUnlessSystemNotesAllowed(c);
  if (denied) return denied;

  const program = c.get("program");
  const noteId = Number(c.req.param("noteId"));
  await db
    .delete(systemNotes)
    .where(and(eq(systemNotes.id, noteId), eq(systemNotes.programId, program.id)));

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
  // ?date=: ήρθαμε από το "Άλλη…" μιας κενής Κυριακής — προεπιλέγουμε εκείνη τη μέρα (αν είναι στην περίοδο).
  const requested = parseDateParam(c.req.query("date"));
  const date = requested && isWithinPeriod(program, requested) ? requested : (chips[0] ?? program.periodStart);
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
  const defaults = defaultFormValues(type ?? "typical", date);

  // Το <select> τύπου στέλνει όλη τη φόρμα (hx-include="closest form") ώστε ό,τι έχει ήδη
  // γραφτεί χειροκίνητα να μη σβήνεται — τα defaults του νέου τύπου γεμίζουν μόνο τα κενά πεδία.
  const locationLatParam = c.req.query("locationLat");
  const locationLngParam = c.req.query("locationLng");
  const customFields: CustomFieldValue[] = [0, 1, 2].map((i) => ({
    title: c.req.query(`customFieldTitle${i}`) ?? "",
    description: c.req.query(`customFieldDescription${i}`) ?? "",
  }));
  const participantIds = (c.req.queries("participantIds") ?? [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));

  const values = {
    ...defaults,
    location: c.req.query("location") || defaults.location,
    locationLat: locationLatParam ? Number(locationLatParam) : null,
    locationLng: locationLngParam ? Number(locationLngParam) : null,
    // "Δεν έχει οριστεί ώρα" επιλέχθηκε ρητά — η αλλαγή τύπου δεν το ακυρώνει με τα defaults ώρας.
    ...(c.req.query("timeTbd") === "on"
      ? { timeTbd: true, startTime: "", endTime: "" }
      : {
          timeTbd: false,
          startTime: c.req.query("startTime") || defaults.startTime,
          endTime: c.req.query("endTime") || defaults.endTime,
        }),
    cost: c.req.query("cost") ?? defaults.cost,
    whatToBring: c.req.query("whatToBring") || defaults.whatToBring,
    customFields: customFields.some((f) => f.title || f.description) ? customFields : defaults.customFields,
    participantIds: participantIds.length > 0 ? participantIds : defaults.participantIds,
  };

  return c.html(<ActivityFields values={values} participantsAvailable={await getAvailableParticipants(program)} />);
});

admin.post("/programs/:id/activities", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const formData = await c.req.formData();
  const parsed = await parseActivityForm(formData);

  if (!parsed.success) {
    return c.html(
      <ActivityFormPage
        leader={leader}
        program={program}
        values={rawFormValues(formData, program.periodStart)}
        dateChips={[]}
        overlap={{ existing: null, blocked: false }}
        title="Νέα δράση"
        participantsAvailable={await getAvailableParticipants(program)}
        error={parsed.error}
      />,
      400,
    );
  }

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
          locationLat: data.locationLat,
          locationLng: data.locationLng,
          startTime: data.startTime,
          endTime: data.endTime,
          timeTbd: data.timeTbd,
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
      locationLat: data.type === "no_activity" ? null : data.locationLat,
      locationLng: data.type === "no_activity" ? null : data.locationLng,
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
  logActivityChange({ action: "create", leader, program, activity: activity! });

  return c.redirect(`/admin/programs/${program.id}`);
});

// Σημείωση route-ordering: τα quick-add endpoints (static path segment "quick-typical"/
// "quick-no-activity") πρέπει να δηλωθούν πριν το γενικό "/activities/:activityId",
// αλλιώς το Hono θα ταιριάξει πρώτα το :activityId param (θα πιάσει "quick-typical" ως id).
admin.post("/programs/:id/activities/quick-typical", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const target = await resolveQuickAddDate(program, await optionalFormData(c));
  if ("error" in target) return c.redirect(`/admin/programs/${program.id}?error=${target.error}`);
  const { date, fromSlot } = target;

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
  logActivityChange({ action: "quick_typical", leader, program, activity: activity! });

  // Από κενή θέση της λίστας: μένουμε στη λίστα (στη νέα κάρτα) ώστε να συνεχίσει με την επόμενη
  // Κυριακή — τόπος/ώρα αλλάζουν από την ίδια την κάρτα. Χωρίς ημερομηνία (παλιά συντόμευση):
  // ανοίγει κατευθείαν σε επεξεργασία όπως πριν.
  return c.redirect(
    fromSlot
      ? `/admin/programs/${program.id}#${activityCardId(activity!.id)}`
      : `/admin/programs/${program.id}/activities/${activity!.id}/edit`,
  );
});

admin.post("/programs/:id/activities/quick-no-activity", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const target = await resolveQuickAddDate(program, await optionalFormData(c));
  if ("error" in target) return c.redirect(`/admin/programs/${program.id}?error=${target.error}`);
  const { date } = target;

  const [activity] = await db
    .insert(activities)
    .values({
      programId: program.id,
      isSystemWide: program.sectionId === null,
      type: "no_activity",
      date,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  logActivityChange({ action: "quick_no_activity", leader, program, activity: activity! });

  return c.redirect(`/admin/programs/${program.id}#${activityCardId(activity!.id)}`);
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

  const formData = await c.req.formData();
  const parsed = await parseActivityForm(formData);
  if (!parsed.success) {
    return c.html(
      <ActivityFormPage
        leader={leader}
        program={program}
        values={rawFormValues(formData, before.date)}
        dateChips={[]}
        overlap={{ existing: null, blocked: false }}
        editingActivityId={activityId}
        title="Επεξεργασία δράσης"
        participantsAvailable={await getAvailableParticipants(program)}
        error={parsed.error}
      />,
      400,
    );
  }

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
          locationLat: data.locationLat,
          locationLng: data.locationLng,
          startTime: data.startTime,
          endTime: data.endTime,
          timeTbd: data.timeTbd,
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
    locationLat: data.type === "no_activity" ? null : data.locationLat,
    locationLng: data.type === "no_activity" ? null : data.locationLng,
    startsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.startTime),
    endsAt: data.type === "no_activity" ? null : combineDateTime(data.date, data.endTime),
    cost: data.type === "no_activity" ? null : data.cost || null,
    whatToBring: data.type === "no_activity" ? null : data.whatToBring || null,
  };

  const changedFields =
    program.status === "published"
      ? diffChangedFields(before, after, before.changedAfterPublishFields ?? [])
      : (before.changedAfterPublishFields ?? []);
  const hiddenChangeGroups =
    program.status === "published"
      ? unhideReChangedGroups(before, after, before.hiddenChangeGroups ?? [])
      : (before.hiddenChangeGroups ?? []);

  await db
    .update(activities)
    .set({
      type: data.type,
      ...after,
      changedAfterPublishFields: changedFields,
      hiddenChangeGroups,
      updatedAt: new Date(),
    })
    .where(eq(activities.id, activityId));

  if (data.type !== "no_activity") {
    await replaceCustomFields(activityId, data.customFields);
    await replaceParticipants(activityId, data.participantIds);
  } else {
    await replaceCustomFields(activityId, []);
    await replaceParticipants(activityId, []);
  }
  logActivityChange({
    action: "update",
    leader,
    program,
    activity: { id: activityId, date, type: data.type },
    changedFields: [
      ...(before.type !== data.type ? ["type"] : []),
      ...newlyChangedFields(before, after),
    ],
  });

  const beforeChangedCount = (before.changedAfterPublishFields ?? []).length;
  if (program.status === "published" && changedFields.length > beforeChangedCount) {
    const recipients = await getNotificationRecipients(program.sectionId);
    await sendProgramChangedEmail(recipients, program, { ...before, ...after, type: data.type } as Activity);
  }

  return c.redirect(`/admin/programs/${program.id}`);
});

// ---- Γρήγορη επεξεργασία (inline, μόνο τοποθεσία/ώρα) από την αρχική σελίδα (/admin) ----

/**
 * Η γρήγορη επεξεργασία ζει σε δύο οθόνες με διαφορετικό markup: γραμμή πίνακα στο «Όλες οι
 * δράσεις» (default) και κάρτα στην οθόνη προγράμματος (`?view=card`). Ίδια λογική αποθήκευσης.
 */
function isCardView(c: Context): boolean {
  return c.req.query("view") === "card";
}

async function renderActivityCard(c: Context, activity: Activity, editing = false) {
  const [detailed] = await attachActivityExtras([activity], { publishedOnly: false });
  return c.html(
    editing && activity.type !== "no_activity" ? (
      <AdminActivityCardEditForm activity={detailed!} />
    ) : (
      <AdminActivityCard activity={detailed!} leader={c.get("leader")} />
    ),
  );
}

admin.get("/programs/:id/activities/:activityId/card", async (c) => {
  const activity = await loadOwnActivity(c.get("program"), Number(c.req.param("activityId")));
  if (!activity) return c.notFound();
  return renderActivityCard(c, activity);
});

admin.get("/programs/:id/activities/:activityId/row", async (c) => {
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));
  const activity = await loadOwnActivity(program, activityId);
  if (!activity) return c.notFound();

  const sectionsById = await getSectionsById();
  const row = { activity, program };
  return c.html(<ActivityRow row={row} {...rowLabels(row, sectionsById)} />);
});

admin.get("/programs/:id/activities/:activityId/quick-edit", async (c) => {
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));
  const activity = await loadOwnActivity(program, activityId);
  if (!activity) return c.notFound();
  if (isCardView(c)) return renderActivityCard(c, activity, true);

  const sectionsById = await getSectionsById();
  const row = { activity, program };
  if (activity.type === "no_activity") {
    return c.html(<ActivityRow row={row} {...rowLabels(row, sectionsById)} />);
  }
  return c.html(<ActivityRowEditForm row={row} {...rowLabels(row, sectionsById)} />);
});

admin.post("/programs/:id/activities/:activityId/quick-edit", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));
  const before = await loadOwnActivity(program, activityId);
  if (!before) return c.notFound();

  const sectionsById = await getSectionsById();

  if (before.type !== "no_activity") {
    const formData = await c.req.formData();
    const location = str(formData, "location").slice(0, 200);
    const startTime = str(formData, "startTime");
    const endTime = str(formData, "endTime");
    const dateStr = toDateInputValue(before.date);
    // Η γρήγορη επεξεργασία δεν έχει map picker (μόνο πεδίο κειμένου) — αν αλλάξει το κείμενο
    // τοποθεσίας εδώ, οι συντεταγμένες του προηγούμενου σημείου δεν αντιστοιχούν πια σε αυτό
    // και καθαρίζονται· ο βαθμοφόρος μπορεί να ξαναδιαλέξει σημείο μέσω του πλήρους wizard.
    const locationChanged = (location || null) !== before.location;

    const after = {
      date: before.date,
      location: location || null,
      locationLat: locationChanged ? null : before.locationLat,
      locationLng: locationChanged ? null : before.locationLng,
      startsAt: combineDateTime(dateStr, startTime),
      endsAt: combineDateTime(dateStr, endTime),
      cost: before.cost,
      whatToBring: before.whatToBring,
    };

    const changedFields =
      program.status === "published"
        ? diffChangedFields(before, after, before.changedAfterPublishFields ?? [])
        : (before.changedAfterPublishFields ?? []);
    const hiddenChangeGroups =
      program.status === "published"
        ? unhideReChangedGroups(before, after, before.hiddenChangeGroups ?? [])
        : (before.hiddenChangeGroups ?? []);

    await db
      .update(activities)
      .set({
        location: after.location,
        locationLat: after.locationLat,
        locationLng: after.locationLng,
        startsAt: after.startsAt,
        endsAt: after.endsAt,
        changedAfterPublishFields: changedFields,
        hiddenChangeGroups,
        updatedAt: new Date(),
      })
      .where(eq(activities.id, activityId));
    logActivityChange({
      action: "quick_edit",
      leader,
      program,
      activity: before,
      changedFields: newlyChangedFields(before, after),
    });

    const beforeChangedCount = (before.changedAfterPublishFields ?? []).length;
    if (program.status === "published" && changedFields.length > beforeChangedCount) {
      const recipients = await getNotificationRecipients(program.sectionId);
      await sendProgramChangedEmail(recipients, program, { ...before, ...after } as Activity);
    }
  }

  const updated = (await loadOwnActivity(program, activityId))!;
  if (isCardView(c)) return renderActivityCard(c, updated);
  const row = { activity: updated, program };
  return c.html(<ActivityRow row={row} {...rowLabels(row, sectionsById)} />);
});

/**
 * Απόκρυψη/επαναφορά μιας ετικέτας αλλαγής από το δημόσιο πρόγραμμα (purpose doc §5.4).
 * Μόνο επιτελείο: το `requireSystemStaff` είναι ο πραγματικός έλεγχος — τα κουμπιά που
 * δεν δείχνουμε στον βαθμοφόρο τμήματος είναι απλώς UI (§6 architecture doc).
 */
admin.post("/programs/:id/activities/:activityId/changes/:group/toggle", requireSystemStaff, async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));
  const group = c.req.param("group") ?? "";

  const activity = await loadOwnActivity(program, activityId);
  if (!activity) return c.notFound();

  // Μόνο ομάδα που όντως αντιστοιχεί σε καταγεγραμμένη αλλαγή — αλλιώς ένα χειροποίητο
  // request θα γέμιζε το `hiddenChangeGroups` με άσχετα κλειδιά.
  if (!changeGroupsOf(activity.changedAfterPublishFields ?? []).includes(group)) {
    return c.text("Άγνωστη ετικέτα αλλαγής.", 404);
  }

  const hidden = activity.hiddenChangeGroups ?? [];
  const hiddenChangeGroups = hidden.includes(group)
    ? hidden.filter((g) => g !== group)
    : [...hidden, group];

  await db
    .update(activities)
    .set({ hiddenChangeGroups, updatedAt: new Date() })
    .where(eq(activities.id, activityId));
  logActivityChange({
    action: "toggle_change_badge",
    leader,
    program,
    activity,
    detail: `${hidden.includes(group) ? "show" : "hide"}:${group}`,
  });

  return c.html(<ActivityChangeBadges activity={{ ...activity, hiddenChangeGroups }} leader={leader} />);
});

admin.post("/programs/:id/activities/:activityId/delete", async (c) => {
  const leader = c.get("leader");
  const program = c.get("program");
  const activityId = Number(c.req.param("activityId"));

  // Ownership check ΠΡΙΝ από οποιοδήποτε delete: αλλιώς ένα request με το δικό μου
  // program id και activity id άλλου τμήματος έσβηνε τα πεδία/συμμετέχοντες εκείνης.
  const activity = await loadOwnActivity(program, activityId);
  if (!activity) return c.notFound();

  await db.delete(activityCustomFields).where(eq(activityCustomFields.activityId, activity.id));
  await db.delete(activityParticipants).where(eq(activityParticipants.activityId, activity.id));
  await db.delete(activities).where(eq(activities.id, activity.id));
  logActivityChange({ action: "delete", leader, program, activity });

  return c.redirect(`/admin/programs/${program.id}`);
});

export default admin;
