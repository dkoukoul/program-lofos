import { Resend } from "resend";
import { magicLinkEmail } from "../emails/magic-link";

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

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const { subject, html } = magicLinkEmail(verifyUrl);

  if (!apiKey) {
    console.log(`[dev] Magic link για ${email}: ${verifyUrl}`);
    return;
  }

  const resend = new Resend(apiKey);
  await sendWithRetry(() =>
    resend.emails.send({ from: FROM_ADDRESS, to: email, subject, html }),
  );
}
