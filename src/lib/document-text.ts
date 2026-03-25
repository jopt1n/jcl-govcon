/**
 * Shared document text extraction.
 * Handles PDF (pdf-parse), DOCX/DOC (mammoth), XLSX/XLS (SheetJS).
 * Content type should already be sniffed by downloadDocuments().
 */

import type { DownloadedDocument } from "@/lib/sam-gov/types";

/**
 * Extract plain text from a downloaded document.
 * Returns null if the document can't be parsed or is empty (e.g., scanned image).
 */
export async function extractDocumentText(doc: DownloadedDocument): Promise<string | null> {
  const ct = doc.contentType;

  try {
    if (ct.includes("pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
      const result = await parser.getText();
      await parser.destroy();
      return result.text?.trim() || null;
    }

    if (ct.includes("spreadsheet") || ct.includes("ms-excel")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(doc.buffer), { type: "array" });
      const text = wb.SheetNames.map((name) => XLSX.utils.sheet_to_txt(wb.Sheets[name])).join("\n").trim();
      return text || null;
    }

    if (ct.includes("wordprocessing") || ct.includes("msword")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer: doc.buffer });
      const text = result.value ? result.value.replace(/<[^>]+>/g, " ").trim() : "";
      return text || null;
    }

    // Unknown type — try pdf-parse first (throws cleanly on non-PDFs), then mammoth
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
      const result = await parser.getText();
      await parser.destroy();
      if (result.text?.trim()) return result.text.trim();
    } catch { /* not a PDF */ }

    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer: doc.buffer });
      if (result.value) return result.value.replace(/<[^>]+>/g, " ").trim() || null;
    } catch { /* not a DOCX */ }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract text from all downloaded documents.
 * Convenience wrapper that filters out nulls.
 */
export async function extractAllDocumentTexts(docs: DownloadedDocument[]): Promise<string[]> {
  const texts: string[] = [];
  for (const doc of docs) {
    const text = await extractDocumentText(doc);
    if (text) texts.push(text);
  }
  return texts;
}
