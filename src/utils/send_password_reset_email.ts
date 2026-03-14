import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "587");
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
  throw new Error("Missing SMTP configuration.");
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

console.log(`[INFO] Mail transporter initialized on port ${SMTP_PORT}`);

export async function sendPasswordResetCodeEmail(params: {
  to: string;
  username?: string | null;
  code: string;
}): Promise<void> {
  const displayName = params.username?.trim() || "there";

  await transporter.sendMail({
    from: SMTP_FROM,
    to: params.to,
    subject: "Your password reset code",
    text: [
      `Hi ${displayName},`,
      "",
      `Your password reset code is: ${params.code}`,
      "",
      "This code will expire in 10 minutes.",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <p>Hi ${displayName},</p>
      <p>Your password reset code is:</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${params.code}</p>
      <p>This code will expire in 5 minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}
