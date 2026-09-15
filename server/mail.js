import nodemailer from "nodemailer";

export function isMailConfigured() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT);
  const user = String(process.env.SMTP_USER || "").trim();
  const password = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.MAIL_FROM || "").trim();
  const placeholders = [
    host === "smtp.example.com",
    user === "utilisateur",
    password === "mot-de-passe-application",
    from.includes("documents@example.com"),
  ];

  return Boolean(
    host &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65_535 &&
      user &&
      password &&
      from.includes("@") &&
      !placeholders.some(Boolean),
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
