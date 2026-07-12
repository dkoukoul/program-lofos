import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { sections, type Activity, type Leader, type Program } from "../db/schema";
import { magicLinkEmail } from "../emails/magic-link";
import { programChangedEmail } from "../emails/program-changed";
import { programPublishedEmail } from "../emails/program-published";
import { CHANGED_FIELD_LABELS, SECTION_LABELS, formatActivityDate, formatPeriod } from "../views/public/layout";

const FROM_ADDRESS = "program.lofos.gr <no-reply@program.lofos.gr>";

async function sendWithRetry(send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (err) {
    console.error("Αποτυχία αποστολής email, retry...", err);
    try {
      await send();
    } catch (retryErr) {
      console.error("Αποτυχία αποστολής email και στο retry.", retryErr);
    }
  }
}

/**
 * Best-effort αποστολή (§7 architecture doc) — δεν πετάει exception, ποτέ δεν
 * μπλοκάρει τη λειτουργία (login/δημοσίευση/αλλαγή) που την προκάλεσε. Χωρίς
 * `RESEND_API_KEY` (τοπικό dev) τυπώνει στο console αντί να στείλει πραγματικό email.
 */
async function sendEmail(params: { to: string | string[]; subject: string; html: string; devLogLabel: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[dev] ${params.devLogLabel} -> ${JSON.stringify(params.to)}: ${params.subject}`);
    return;
  }

  const resend = new Resend(apiKey);
  await sendWithRetry(() =>
    resend.emails.send({ from: FROM_ADDRESS, to: params.to, subject: params.subject, html: params.html }),
  );
}

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  const { subject, html } = magicLinkEmail(verifyUrl);
  await sendEmail({ to: email, subject, html, devLogLabel: `Magic link για ${email}: ${verifyUrl}` });
}

async function sectionContext(sectionId: number | null): Promise<{ label: string; path: string }> {
  if (sectionId === null) return { label: "Σύστημα", path: "/" };
  const [section] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1);
  if (!section) return { label: "Τμήμα", path: "/" };
  return { label: SECTION_LABELS[section.type], path: `/${section.type}` };
}

/** Ειδοποίηση δημοσίευσης προγράμματος (purpose doc §5.5) στους βαθμοφόρους του τμήματος + επιτελείο. */
export async function sendProgramPublishedEmail(recipients: Leader[], program: Program): Promise<void> {
  if (recipients.length === 0) return;

  const { label, path } = await sectionContext(program.sectionId);
  const { subject, html } = programPublishedEmail({
    sectionLabel: label,
    period: formatPeriod(program.periodStart, program.periodEnd),
    url: `${process.env.BASE_URL ?? ""}${path}`,
  });

  await sendEmail({
    to: recipients.map((r) => r.email),
    subject,
    html,
    devLogLabel: `Δημοσίευση προγράμματος ${label}`,
  });
}

/** Ειδοποίηση αλλαγής σε ήδη δημοσιευμένο πρόγραμμα (purpose doc §5.4/§5.5). */
export async function sendProgramChangedEmail(
  recipients: Leader[],
  program: Program,
  activity: Activity,
): Promise<void> {
  if (recipients.length === 0) return;

  const { label, path } = await sectionContext(program.sectionId);
  const changedLabels = (activity.changedAfterPublishFields ?? []).map(
    (field) => CHANGED_FIELD_LABELS[field] ?? "Άλλαξε κάτι",
  );

  const { subject, html } = programChangedEmail({
    sectionLabel: label,
    activityDate: formatActivityDate(activity.date),
    changedLabels,
    url: `${process.env.BASE_URL ?? ""}${path}`,
  });

  await sendEmail({
    to: recipients.map((r) => r.email),
    subject,
    html,
    devLogLabel: `Αλλαγή δράσης στο πρόγραμμα ${label}`,
  });
}
