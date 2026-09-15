import nodemailer from "nodemailer";

export function isMailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_FROM,
  );
}

export async function sendCompletedPdf({ to, title, filename, content }) {
  if (!isMailConfigured()) {
    return { sent: false, reason: "not_configured" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: `Document complété : ${title}`,
    text: `Le document « ${title} » a été rempli et signé. Il est joint à cet email.`,
    attachments: [{ filename, content, contentType: "application/pdf" }],
  });

  return { sent: true };
}
