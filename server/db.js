import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(serverDirectory, "../data");
const database = new Database(path.join(dataDirectory, "paraphe.sqlite"));

database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

database.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    recipient_email TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS completions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    recipient_email TEXT NOT NULL,
    email_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
  );
`);

function parseFields(raw) {
  try {
    const fields = JSON.parse(raw);
    return Array.isArray(fields) ? fields : [];
  } catch {
    return [];
  }
}

function presentTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    filename: row.original_name,
    recipientEmail: row.recipient_email,
    pageCount: row.page_count,
    fields: parseFields(row.fields_json),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function listTemplates() {
  return database
    .prepare("SELECT * FROM templates ORDER BY created_at DESC LIMIT 100")
    .all()
    .map(presentTemplate);
}

export function getTemplate(id) {
  return database.prepare("SELECT * FROM templates WHERE id = ?").get(id) ?? null;
}

export function insertTemplate(template) {
  database
    .prepare(`
      INSERT INTO templates (
        id, title, original_name, file_path, recipient_email, page_count,
        fields_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 'draft', ?, ?)
    `)
    .run(
      template.id,
      template.title,
      template.originalName,
      template.filePath,
      template.recipientEmail,
      template.pageCount,
      template.createdAt,
      template.createdAt,
    );
  return presentTemplate(getTemplate(template.id));
}

export function updateTemplateFields(id, fields) {
  const result = database
    .prepare(
      "UPDATE templates SET fields_json = ?, status = 'ready', updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(fields), new Date().toISOString(), id);
  return result.changes ? presentTemplate(getTemplate(id)) : null;
}

export function insertCompletion(completion) {
  database
    .prepare(`
      INSERT INTO completions (
        id, template_id, file_path, recipient_email, email_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      completion.id,
      completion.templateId,
      completion.filePath,
      completion.recipientEmail,
      completion.emailStatus,
      completion.createdAt,
    );
}

export function getCompletion(id) {
  return database.prepare("SELECT * FROM completions WHERE id = ?").get(id) ?? null;
}

export function listTemplateFiles(id) {
  const template = getTemplate(id);
  if (!template) return [];
  const completions = database
    .prepare("SELECT file_path FROM completions WHERE template_id = ?")
    .all(id);
  return [template.file_path, ...completions.map((item) => item.file_path)];
}

export function deleteTemplate(id) {
  return database.prepare("DELETE FROM templates WHERE id = ?").run(id).changes > 0;
}
