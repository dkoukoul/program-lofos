import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { sections } from "../db/schema";
import { getOptionalLeader } from "../lib/auth";
import { getPublishedSectionActivities, getSectionSchedule, limitChangeBadges, selectFeaturedActivity } from "../lib/schedule";
import { HomePage } from "../views/public/home";
import { AgeleSectionPage } from "../views/public/templates/agele";
import { KoinotitaSectionPage } from "../views/public/templates/koinotita";
import { OmadaSectionPage } from "../views/public/templates/omada";
import { SECTION_ORDER } from "../views/public/layout";

const SECTION_PAGES = {
  agele: AgeleSectionPage,
  omada: OmadaSectionPage,
  koinotita: KoinotitaSectionPage,
} as const;

const publicRoutes = new Hono();

function loginQuery(c: { req: { query: (name: string) => string | undefined } }) {
  return {
    loginStatus: c.req.query("loginStatus"),
    loginError: c.req.query("loginError"),
  };
}

publicRoutes.get("/", async (c) => {
  const [allSections, leader] = await Promise.all([db.select().from(sections), getOptionalLeader(c)]);
  const blocks = await Promise.all(
    allSections.map(async (section) => {
      // Η "επόμενη δράση" αναζητείται σε όλα τα δημοσιευμένα προγράμματα, όχι μόνο στο
      // ενεργό: αν οι δράσεις της τρέχουσας περιόδου έχουν περάσει, προβάλλεται η πρώτη
      // του επόμενου προγράμματος — ποτέ δράση του παρελθόντος.
      const [{ program, activities }, allPublished] = await Promise.all([
        getSectionSchedule(section.id),
        getPublishedSectionActivities(section.id),
      ]);
      return {
        section,
        program,
        scheduleActivities: activities,
        featuredActivity: selectFeaturedActivity(limitChangeBadges(allPublished)),
      };
    }),
  );

  return c.html(<HomePage blocks={blocks} isLoggedIn={leader !== null} {...loginQuery(c)} />);
});

for (const type of SECTION_ORDER) {
  publicRoutes.get(`/${type}`, async (c) => {
    const [section] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
    if (!section) return c.notFound();

    const { program, activities } = await getSectionSchedule(section.id);
    const leader = await getOptionalLeader(c);
    const SectionPage = SECTION_PAGES[type];

    return c.html(
      <SectionPage
        section={section}
        program={program}
        scheduleActivities={activities}
        isLoggedIn={leader !== null}
        {...loginQuery(c)}
      />,
    );
  });
}

export default publicRoutes;
