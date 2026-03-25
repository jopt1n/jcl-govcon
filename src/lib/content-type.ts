/**
 * Magic-byte content sniffing for binary files.
 * SAM.gov often serves files with UUID filenames and no extension,
 * returning generic Content-Type headers like "application/octet-stream".
 * This detects the real format from the file's binary header.
 */
export function sniffContentType(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // PDF: starts with %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }

  // ZIP-based formats (docx, xlsx, pptx are all ZIP archives)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const str = buffer.toString("utf8", 0, Math.min(buffer.length, 4000));
    if (str.includes("xl/") || str.includes("xl\\")) {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (str.includes("word/") || str.includes("word\\")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (str.includes("ppt/") || str.includes("ppt\\")) {
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    return "application/zip";
  }

  // OLE2 Compound Document (legacy .doc, .xls, .ppt)
  if (
    buffer[0] === 0xd0 && buffer[1] === 0xcf &&
    buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 &&
    buffer[6] === 0x1a && buffer[7] === 0xe1
  ) {
    return "application/vnd.ms-excel";
  }

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }

  return null;
}
