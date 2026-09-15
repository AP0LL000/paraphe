import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function inspectPdf(buffer) {
  const document = await PDFDocument.load(buffer, { ignoreEncryption: false });
  return { pageCount: document.getPageCount() };
}

function wrapText(text, font, size, maxWidth) {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fitText(text, font, width, height) {
  for (let size = Math.min(14, height * 0.55); size >= 6; size -= 0.5) {
    const lines = wrapText(text, font, size, width);
    const lineHeight = size * 1.18;
    if (lines.length * lineHeight <= height) return { lines, size, lineHeight };
  }
  const size = 6;
  return {
    lines: wrapText(text, font, size, width).slice(0, Math.max(1, Math.floor(height / 7))),
    size,
    lineHeight: 7,
  };
}

export async function fillPdf(sourceBuffer, fields, values, signatureBuffer) {
  const document = await PDFDocument.load(sourceBuffer, { ignoreEncryption: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const signature = await document.embedPng(signatureBuffer);
  const pages = document.getPages();

  for (const field of fields) {
    const page = pages[field.page];
    if (!page) continue;
    const pageSize = page.getSize();
    const x = field.x * pageSize.width;
    const y = pageSize.height - (field.y + field.height) * pageSize.height;
    const width = field.width * pageSize.width;
    const height = field.height * pageSize.height;

    if (field.type === "signature") {
      const scale = Math.min(width / signature.width, height / signature.height);
      const signatureWidth = signature.width * scale;
      const signatureHeight = signature.height * scale;
      page.drawImage(signature, {
        x: x + (width - signatureWidth) / 2,
        y: y + (height - signatureHeight) / 2,
        width: signatureWidth,
        height: signatureHeight,
      });
      continue;
    }

    const text = String(values[field.id] ?? "").trim();
    if (!text) continue;
    const padding = Math.max(2, Math.min(5, height * 0.12));
    const fitted = fitText(text, font, width - padding * 2, height - padding * 2);
    fitted.lines.forEach((line, index) => {
      page.drawText(line, {
        x: x + padding,
        y: y + height - padding - fitted.size - index * fitted.lineHeight,
        size: fitted.size,
        font,
        color: rgb(0.075, 0.145, 0.137),
      });
    });
  }

  document.setProducer("Paraphe");
  document.setModificationDate(new Date());
  return Buffer.from(await document.save());
}
