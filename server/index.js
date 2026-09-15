import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

import {
  deleteCompletion,
  deleteTemplate,
  getCompletion,
  getTemplate,
  insertCompletion,
  insertTemplate,
  listTemplateFiles,
  listTemplates,
  updateCompletionEmailStatus,
  updateTemplateFields,
} from "./db.js";
import { isMailConfigured, sendCompletedPdf } from "./mail.js";
import { fillPdf, inspectPdf } from "./pdf.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(serverDirectory, "..");
const templateDirectory = path.join(rootDirectory, "data/templates");
const completionDirectory = path.join(rootDirectory, "data/completed");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

await Promise.all([
  fs.mkdir(templateDirectory, { recursive: true }),
  fs.mkdir(completionDirectory, { recursive: true }),
]);

const app = express();
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 },
});
const uploadSignature = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_500_000, files: 1, fields: 8 },
});

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isProduction) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  next();
});
app.use(express.json({ limit: "256kb" }));

function validId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function safeName(value) {
  return String(value || "document.pdf")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function pdfMagic(buffer) {
  return buffer?.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function pngMagic(buffer) {
  const expected = [137, 80, 78, 71, 13, 10, 26, 10];
  return buffer?.length >= 8 && expected.every((value, index) => buffer[index] === value);
}

function parseFields(value, pageCount) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Zones invalides");
  const ids = new Set();
  const fields = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Zone invalide");
    const field = {
      id: String(candidate.id || ""),
      type: candidate.type,
      label: String(candidate.label || "").trim(),
      page: Number(candidate.page),
      x: Number(candidate.x),
      y: Number(candidate.y),
      width: Number(candidate.width),
      height: Number(candidate.height),
      required: Boolean(candidate.required),
    };
    const dimensions = [field.x, field.y, field.width, field.height];
    if (
      !validId(field.id) ||
      ids.has(field.id) ||
      !["text", "signature"].includes(field.type) ||
      !field.label ||
      field.label.length > 80 ||
      !Number.isInteger(field.page) ||
      field.page < 0 ||
      field.page >= pageCount ||
      !dimensions.every(Number.isFinite) ||
      field.x < 0 ||
      field.y < 0 ||
      field.width < 0.04 ||
      field.height < 0.025 ||
      field.x + field.width > 1.001 ||
      field.y + field.height > 1.001
    ) {
      throw new Error("Zone invalide");
    }
    ids.add(field.id);
    return field;
  });
  if (!fields.some((field) => field.type === "signature")) {
    throw new Error("Ajoutez au moins une zone de signature.");
  }
  return fields;
}

function publicTemplate(row) {
  if (!row) return null;
  let fields = [];
  try {
    fields = JSON.parse(row.fields_json);
  } catch {
    fields = [];
  }
  return {
    id: row.id,
    title: row.title,
    filename: row.original_name,
    recipientEmail: row.recipient_email,
    pageCount: row.page_count,
    status: row.status,
    fields,
    createdAt: row.created_at,
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, emailConfigured: isMailConfigured() });
});

app.get("/api/templates", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ ok: true, templates: listTemplates(), emailConfigured: isMailConfigured() });
});

app.post("/api/templates", uploadPdf.single("file"), async (request, response) => {
  let filePath;
  try {
    const title = String(request.body.title || "").trim();
    const recipientEmail = String(request.body.recipientEmail || "").trim();
    if (!request.file || !title || title.length > 120 || !validEmail(recipientEmail)) {
      return response.status(400).json({ ok: false, message: "Vérifiez le titre, le PDF et l’adresse email." });
    }
    if (!pdfMagic(request.file.buffer)) {
      return response.status(415).json({ ok: false, message: "Ce fichier n’est pas un PDF valide." });
    }
    const information = await inspectPdf(request.file.buffer);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    filePath = path.join(templateDirectory, `${id}.pdf`);
    await fs.writeFile(filePath, request.file.buffer, { flag: "wx" });
    const template = insertTemplate({
      id,
      title,
      originalName: safeName(request.file.originalname),
      filePath,
      recipientEmail,
      pageCount: information.pageCount,
      createdAt,
    });
    return response.status(201).json({ ok: true, template });
  } catch (error) {
    if (filePath) await fs.unlink(filePath).catch(() => undefined);
    const message = error instanceof Error && /encrypted|password/i.test(error.message)
      ? "Ce PDF est protégé par un mot de passe."
      : "Le PDF n’a pas pu être enregistré.";
    return response.status(422).json({ ok: false, message });
  }
});

app.get("/api/templates/:id/file", (request, response) => {
  if (!validId(request.params.id)) return response.status(404).end();
  const template = getTemplate(request.params.id);
  if (!template) return response.status(404).end();
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${safeName(template.original_name)}"`);
  return response.sendFile(template.file_path);
});

app.put("/api/templates/:id/fields", (request, response) => {
  if (!validId(request.params.id)) return response.status(404).json({ ok: false, message: "Document introuvable." });
  const template = getTemplate(request.params.id);
  if (!template) return response.status(404).json({ ok: false, message: "Document introuvable." });
  try {
    const fields = parseFields(request.body.fields, template.page_count);
    const updated = updateTemplateFields(template.id, fields);
    return response.json({ ok: true, template: updated });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Les zones sont invalides.",
    });
  }
});

app.post(
  "/api/templates/:id/preview",
  uploadSignature.single("signature"),
  async (request, response) => {
    let completedPath;
    try {
      if (!validId(request.params.id)) return response.status(404).json({ ok: false, message: "Document introuvable." });
      const template = getTemplate(request.params.id);
      if (!template) return response.status(404).json({ ok: false, message: "Document introuvable." });
      const fields = parseFields(JSON.parse(template.fields_json), template.page_count);
      const values = JSON.parse(String(request.body.values || "{}"));
      if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 100) {
        return response.status(400).json({ ok: false, message: "Les réponses sont invalides." });
      }
      for (const field of fields) {
        if (field.type !== "text") continue;
        const value = values[field.id];
        if (typeof value !== "string" || value.length > 2000 || (field.required && !value.trim())) {
          return response.status(400).json({ ok: false, message: `Complétez le champ « ${field.label} ».` });
        }
      }
      if (!request.file || !pngMagic(request.file.buffer)) {
        return response.status(400).json({ ok: false, message: "Dessinez votre signature avant de créer l’aperçu." });
      }

      const source = await fs.readFile(template.file_path);
      const completedPdf = await fillPdf(source, fields, values, request.file.buffer);
      const completionId = crypto.randomUUID();
      completedPath = path.join(completionDirectory, `${completionId}.pdf`);
      await fs.writeFile(completedPath, completedPdf, { flag: "wx" });

      insertCompletion({
        id: completionId,
        templateId: template.id,
        filePath: completedPath,
        recipientEmail: template.recipient_email,
        emailStatus: "pending",
        createdAt: new Date().toISOString(),
      });

      return response.status(201).json({
        ok: true,
        completionId,
        emailSent: false,
        recipientEmail: template.recipient_email,
        previewUrl: `/api/completed/${completionId}/preview`,
        downloadUrl: `/api/completed/${completionId}/file`,
        message: "Vérifiez le PDF final avant de confirmer son envoi.",
      });
    } catch (error) {
      console.error("Échec de création de l’aperçu :", error);
      if (completedPath) await fs.unlink(completedPath).catch(() => undefined);
      return response.status(500).json({ ok: false, message: "L’aperçu du document n’a pas pu être créé." });
    }
  },
);

app.post("/api/completed/:id/send", async (request, response) => {
  if (!validId(request.params.id)) return response.status(404).json({ ok: false, message: "Document introuvable." });
  const completion = getCompletion(request.params.id);
  if (!completion) return response.status(404).json({ ok: false, message: "Document introuvable." });
  const template = getTemplate(completion.template_id);
  if (!template) return response.status(404).json({ ok: false, message: "Modèle introuvable." });

  const downloadUrl = `/api/completed/${completion.id}/file`;
  if (completion.email_status === "sent") {
    return response.json({
      ok: true,
      emailSent: true,
      message: `Le PDF signé a déjà été envoyé à ${completion.recipient_email}.`,
      downloadUrl,
    });
  }
  if (!isMailConfigured()) {
    return response.status(503).json({
      ok: false,
      message: "L’envoi email n’est pas encore configuré. Le PDF reste disponible au téléchargement.",
      downloadUrl,
    });
  }

  try {
    const content = await fs.readFile(completion.file_path);
    const filename = `${template.original_name.replace(/\.pdf$/i, "")}-signe.pdf`;
    await sendCompletedPdf({
      to: completion.recipient_email,
      title: template.title,
      filename,
      content,
    });
    updateCompletionEmailStatus(completion.id, "sent");
    return response.json({
      ok: true,
      emailSent: true,
      message: `Le PDF signé a été envoyé à ${completion.recipient_email}.`,
      downloadUrl,
    });
  } catch (error) {
    updateCompletionEmailStatus(completion.id, "failed");
    console.error("Échec de l’envoi email :", error instanceof Error ? error.message : error);
    return response.status(502).json({
      ok: false,
      message: "Le serveur email a refusé l’envoi. Vérifiez ses identifiants, puis réessayez.",
      downloadUrl,
    });
  }
});

app.get("/api/completed/:id/preview", (request, response) => {
  if (!validId(request.params.id)) return response.status(404).end();
  const completion = getCompletion(request.params.id);
  if (!completion) return response.status(404).end();
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "inline; filename=\"document-a-verifier.pdf\"");
  return response.sendFile(completion.file_path);
});

app.get("/api/completed/:id/file", (request, response) => {
  if (!validId(request.params.id)) return response.status(404).end();
  const completion = getCompletion(request.params.id);
  if (!completion) return response.status(404).end();
  response.setHeader("Cache-Control", "private, no-store");
  return response.download(completion.file_path, "document-signe.pdf");
});

app.delete("/api/completed/:id", async (request, response) => {
  if (!validId(request.params.id)) return response.status(404).json({ ok: false, message: "Document introuvable." });
  const completion = getCompletion(request.params.id);
  if (!completion) return response.status(404).json({ ok: false, message: "Document introuvable." });
  if (completion.email_status === "sent") {
    return response.status(409).json({ ok: false, message: "Un document déjà envoyé ne peut pas être supprimé ici." });
  }
  deleteCompletion(completion.id);
  await fs.unlink(completion.file_path).catch(() => undefined);
  return response.json({ ok: true });
});

app.delete("/api/templates/:id", async (request, response) => {
  if (!validId(request.params.id)) return response.status(404).json({ ok: false, message: "Document introuvable." });
  const files = listTemplateFiles(request.params.id);
  if (!files.length) return response.status(404).json({ ok: false, message: "Document introuvable." });
  deleteTemplate(request.params.id);
  await Promise.all(files.map((file) => fs.unlink(file).catch(() => undefined)));
  return response.json({ ok: true });
});

app.use((error, _request, response, next) => {
  if (!(error instanceof multer.MulterError)) return next(error);
  const message = error.code === "LIMIT_FILE_SIZE"
    ? "Le fichier dépasse la taille autorisée."
    : "Le fichier n’a pas pu être reçu.";
  return response.status(400).json({ ok: false, message });
});

if (isProduction) {
  app.use(express.static(path.join(rootDirectory, "dist"), { index: false }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(rootDirectory, "dist/index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: rootDirectory,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.use((_request, response) => {
  response.status(404).json({ ok: false, message: "Ressource introuvable." });
});

app.listen(port, host, () => {
  console.log(`Paraphe est disponible sur http://${host}:${port}`);
  if (host === "0.0.0.0") console.log("Ouvrez l’adresse IP locale de ce Mac depuis votre téléphone.");
});
