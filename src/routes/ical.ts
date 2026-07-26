import { eq } from "drizzle-orm";
import { Hono } from "hono";
import ical, { ICalEventBusyStatus } from "ical-generator";
import { db } from "../db/client";
import { sections } from "../db/schema";
import { getPublishedSectionActivities } from "../lib/schedule";
import { ACTIVITY_TYPE_INFO, SECTION_LABELS } from "../views/public/layout";

const ICS_SUFFIX = ".ics";
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

const ical404 = () => new Response("Not found", { status: 404 });

const icalRoutes = new Hono();

icalRoutes.get("/:sectionId/:tokenFile", async (c) => {
  const sectionId = Number(c.req.param("sectionId"));
  const tokenFile = c.req.param("tokenFile");

  if (!Number.isInteger(sectionId) || !tokenFile.endsWith(ICS_SUFFIX)) return ical404();
  const token = tokenFile.slice(0, -ICS_SUFFIX.length);

  const [section] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1);
  if (!section || section.icalPublicToken !== token) return ical404();

  const sectionActivities = await getPublishedSectionActivities(sectionId);
  const label = SECTION_LABELS[section.type];
  const baseUrl = process.env.BASE_URL ?? "";

  const calendar = ical({
    name: `${label} — 4ο Σύστημα Αεροπροσκόπων Ηρακλείου`,
    timezone: "Europe/Athens",
    url: baseUrl ? `${baseUrl}/${section.type}` : undefined,
  });

  for (const activity of sectionActivities) {
    const typeInfo = ACTIVITY_TYPE_INFO[activity.type];

    if (activity.type === "no_activity") {
      calendar.createEvent({
        id: `activity-${activity.id}@program.lofos.gr`,
        start: activity.date,
        allDay: true,
        summary: `${typeInfo.icon} ${typeInfo.label}`,
        description: "Δεν θα γίνει συγκέντρωση αυτή την ημέρα.",
        busystatus: ICalEventBusyStatus.FREE,
        lastModified: activity.updatedAt,
      });
      continue;
    }

    const allDay = !activity.startsAt;
    const start = activity.startsAt ?? activity.date;
    const end = activity.startsAt
      ? (activity.endsAt ?? new Date(activity.startsAt.getTime() + DEFAULT_DURATION_MS))
      : undefined;

    const descriptionLines = [typeInfo.label];
    if (activity.isSystemWide) descriptionLines.push("Δράση Συστήματος (αφορά όλα τα τμήματα).");
    if (activity.cost) descriptionLines.push(`Κόστος: ${activity.cost}`);
    if (activity.whatToBring) descriptionLines.push(`Τι να φέρετε: ${activity.whatToBring}`);

    calendar.createEvent({
      id: `activity-${activity.id}@program.lofos.gr`,
      start,
      end,
      allDay,
      summary: activity.location ? `${typeInfo.label} — ${activity.location}` : typeInfo.label,
      description: descriptionLines.join("\n"),
      location:
        activity.location && activity.locationLat != null && activity.locationLng != null
          ? { title: activity.location, geo: { lat: activity.locationLat, lon: activity.locationLng } }
          : (activity.location ?? undefined),
      lastModified: activity.updatedAt,
    });
  }

  c.header("Content-Type", "text/calendar; charset=utf-8");
  return c.body(calendar.toString());
});

export default icalRoutes;
