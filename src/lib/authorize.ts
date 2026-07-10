import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { programs, type Leader, type Program } from "../db/schema";

export function canEditSection(leader: Leader, sectionId: number | null): boolean {
  if (leader.role === "system_staff") return true;
  return leader.role === "section_leader" && leader.sectionId === sectionId;
}

export async function requireSystemStaff(c: Context, next: Next) {
  const leader = c.get("leader");
  if (leader.role !== "system_staff") {
    return c.text("Δεν έχεις δικαίωμα πρόσβασης.", 403);
  }
  await next();
}

declare module "hono" {
  interface ContextVariableMap {
    program: Program;
  }
}

/** Φορτώνει το πρόγραμμα από το `:id` param και επιβάλλει server-side ownership (§6 architecture doc). */
export async function requireProgramAccess(c: Context, next: Next) {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.notFound();

  const [program] = await db.select().from(programs).where(eq(programs.id, id)).limit(1);
  if (!program) return c.notFound();

  const leader = c.get("leader");
  if (!canEditSection(leader, program.sectionId)) {
    return c.text("Δεν έχεις δικαίωμα πρόσβασης σε αυτό το πρόγραμμα.", 403);
  }

  c.set("program", program);
  await next();
}
