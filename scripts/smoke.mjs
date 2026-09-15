import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const port = 43_000 + crypto.randomInt(1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    MAIL_FROM: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let templateId;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Le serveur de test n’a pas démarré.");
}

async function json(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `Erreur HTTP ${response.status}`);
  return payload;
}

async function createPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Formulaire de validation Paraphe", {
    x: 56,
    y: 760,
    size: 18,
    font,
    color: rgb(0.08, 0.16, 0.15),
  });
  return document.save();
}

async function run() {
  await waitForServer();

  const upload = new FormData();
  upload.set("title", "Test automatique");
  upload.set("recipientEmail", "test@example.com");
  upload.set("file", new Blob([await createPdf()], { type: "application/pdf" }), "test.pdf");
  const created = await json(await fetch(`${baseUrl}/api/templates`, { method: "POST", body: upload }));
  templateId = created.template.id;

  const textId = crypto.randomUUID();
  const signatureId = crypto.randomUUID();
  const configured = await json(await fetch(`${baseUrl}/api/templates/${templateId}/fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: [
        { id: textId, type: "text", label: "Nom complet", page: 0, x: 0.1, y: 0.2, width: 0.55, height: 0.07, required: true },
        { id: signatureId, type: "signature", label: "Signature", page: 0, x: 0.1, y: 0.5, width: 0.55, height: 0.16, required: true },
      ],
    }),
  }));
  if (configured.template.status !== "ready") throw new Error("Le modèle n’est pas prêt.");

  // Pixel PNG technique utilisé uniquement pour tester le transport d’une image.
  // Il ne contient ni écriture manuscrite, ni donnée biométrique.
  const signature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
    0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0,
    1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]);
  const completion = new FormData();
  completion.set("values", JSON.stringify({ [textId]: "Valeur de test" }));
  completion.set("signature", new Blob([signature], { type: "image/png" }), "signature.png");
  const completed = await json(await fetch(`${baseUrl}/api/templates/${templateId}/preview`, {
    method: "POST",
    body: completion,
  }));

  const previewed = await fetch(`${baseUrl}${completed.previewUrl}`);
  const previewBytes = Buffer.from(await previewed.arrayBuffer());
  if (!previewed.ok || previewBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("L’aperçu final n’est pas consultable.");
  }

  const blockedSend = await fetch(`${baseUrl}/api/completed/${completed.completionId}/send`, { method: "POST" });
  if (blockedSend.status !== 503) throw new Error("L’envoi sans configuration SMTP aurait dû être bloqué.");

  const downloaded = await fetch(`${baseUrl}${completed.downloadUrl}`);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (!downloaded.ok || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Le PDF final n’est pas téléchargeable.");
  }

  await json(await fetch(`${baseUrl}/api/templates/${templateId}`, { method: "DELETE" }));
  templateId = undefined;
  console.log(`Parcours validé : dépôt, zones, signature, aperçu et PDF final (${bytes.length} octets).`);
}

try {
  await run();
} catch (error) {
  const details = [];
  server.stderr.on("data", (chunk) => details.push(chunk.toString()));
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.error(error instanceof Error ? error.message : error);
  if (details.length) console.error(details.join(""));
  process.exitCode = 1;
} finally {
  if (templateId) {
    await fetch(`${baseUrl}/api/templates/${templateId}`, { method: "DELETE" }).catch(() => undefined);
  }
  server.kill("SIGTERM");
}
