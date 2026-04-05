import { sendPasswordResetCodeEmail } from "../../utils/send_password_reset_email.ts";
import type { SendEmailPayload } from "../types.ts";

export async function handleSendEmail(jobId: string, payload: SendEmailPayload): Promise<void> {
  console.log(`[EMAIL WORKER] Job ${jobId}: Sending ${payload.emailType} to ${payload.to}`);

  if (payload.emailType === "PASSWORD_RESET") {
    await sendPasswordResetCodeEmail({
      to: payload.to,
      username: payload.username,
      code: payload.code,
    });
    console.log(`[EMAIL WORKER] Job ${jobId}: Password reset email sent successfully.`);
  } else {
    throw new Error(`Unknown email type: ${payload.emailType}`);
  }
}
