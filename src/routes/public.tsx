import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { sections } from "../db/schema";
import { getSectionSchedule } from "../lib/schedule";
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
  const allSections = await db.select().from(sections);
  const blocks = await Promise.all(
    allSections.map(async (section) => {
      const { program, activities } = await getSectionSchedule(section.id);
      return { section, program, scheduleActivities: activities };
    }),
  );

  return c.html(<HomePage blocks={blocks} {...loginQuery(c)} />);
});

for (const type of SECTION_ORDER) {
  publicRoutes.get(`/${type}`, async (c) => {
    const [section] = await db.select().from(sections).where(eq(sections.type, type)).limit(1);
    if (!section) return c.notFound();

    const { program, activities } = await getSectionSchedule(section.id);
    const SectionPage = SECTION_PAGES[type];

    return c.html(<SectionPage section={section} program={program} scheduleActivities={activities} {...loginQuery(c)} />);
  });
}

export default publicRoutes;
