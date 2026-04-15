"use client";

import { useState, useEffect } from "react";
import SpreadsheetViewer from "./SpreadsheetViewer";

// ─── Types ───────────────────────────────────────────────────────
type DocType = "pdf" | "word" | "image" | "text" | "html" | "spreadsheet" | "presentation" | "unknown";

interface DocumentViewerProps {
  url: string;
  title?: string;
  height?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────
function classifyContentType(contentType: string): DocType {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("spreadsheet") || ct.includes("ms-excel") || ct.includes("csv")) return "spreadsheet";
  if (ct.includes("wordprocessing") || ct.includes("msword")) return "word";
  if (ct.includes("presentation") || ct.includes("ms-powerpoint")) return "presentation";
  if (ct.startsWith("image/")) return "image";
  if (ct.includes("html")) return "html";
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml")) return "text";
  return "unknown";
}

function classifyFromUrl(url: string): DocType {
  const path = url.toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx?|csv)$/i.test(path)) return "spreadsheet";
  if (/\.(docx?)$/i.test(path)) return "word";
  if (/\.(pptx?)$/i.test(path)) return "presentation";
  if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(path)) return "image";
  if (/\.(html?)$/i.test(path)) return "html";
  if (/\.(txt|json|xml|log|md)$/i.test(path)) return "text";
  return "unknown";
}

function getProxyUrl(url: string): string {
  return `/api/proxy-document?url=${encodeURIComponent(url)}`;
}

function extractFilename(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/");
    const last = parts[parts.length - 1];
    if (last) return decodeURIComponent(last);
  } catch {}
  return "document";
}

// ─── Sub-renderers ───────────────────────────────────────────────

function PdfViewer({ proxyUrl, height }: { proxyUrl: string; height: string }) {
  return (
    <iframe
      src={proxyUrl}
      style={{ width: "100%", height, border: "none", borderRadius: "8px" }}
      title="PDF Document"
    />
  );
}

function WordViewer({ proxyUrl }: { proxyUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function convert() {
      try {
        const mammoth = await import("mammoth");
        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) { setHtml(result.value); setLoading(false); }
      } catch (err: unknown) {
        if (!cancelled) { setError(err instanceof Error ? err.message : "Unknown error"); setLoading(false); }
      }
    }
    convert();
    return () => { cancelled = true; };
  }, [proxyUrl]);

  if (loading) return <LoadingState message="Converting Word document…" />;
  if (error) return <div className="doc-viewer-error">Word conversion failed: {error}</div>;
  return <div className="doc-viewer-word-content" dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function ImageViewer({ proxyUrl, title }: { proxyUrl: string; title?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <img
        src={proxyUrl}
        alt={title || "Document image"}
        style={{
          maxWidth: "100%",
          maxHeight: "80vh",
          objectFit: "contain",
          borderRadius: "8px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        }}
      />
    </div>
  );
}

function TextViewer({ proxyUrl }: { proxyUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(proxyUrl)
      .then((r) => r.text())
      .then((t) => { setText(t); setLoading(false); })
      .catch(() => { setText("Failed to load text."); setLoading(false); });
  }, [proxyUrl]);

  if (loading) return <LoadingState message="Loading text…" />;
  return <pre className="doc-viewer-text-content">{text}</pre>;
}

function DownloadFallback({ proxyUrl, filename, docType }: { proxyUrl: string; filename: string; docType: DocType }) {
  const labels: Record<string, string> = {
    presentation: "PowerPoint Presentation",
    unknown: "Document",
  };
  return (
    <div className="doc-viewer-fallback">
      <div className="doc-viewer-fallback-icon">📄</div>
      <h3>{filename}</h3>
      <p>This {labels[docType] || "file"} cannot be previewed inline.</p>
      <a href={proxyUrl} download={filename} className="doc-viewer-download-btn">Download File</a>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="doc-viewer-loading">
      <div className="doc-viewer-spinner" />
      <p>{message}</p>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export default function DocumentViewer({ url, title, height = "85vh", onLoad, onError }: DocumentViewerProps) {
  const [docType, setDocType] = useState<DocType | null>(null);
  const [detectedFilename, setDetectedFilename] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const proxyUrl = getProxyUrl(url);
  const rawFilename = extractFilename(url);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      // Try URL extension first
      const fromUrl = classifyFromUrl(url);
      if (fromUrl !== "unknown") {
        if (!cancelled) { setDocType(fromUrl); setDetectedFilename(rawFilename); setLoading(false); }
        return;
      }

      // UUID filename — need to ask the proxy for content-type via magic bytes
      try {
        const resp = await fetch(proxyUrl);
        const ct = resp.headers.get("x-detected-type") || resp.headers.get("content-type") || "";
        const cd = resp.headers.get("content-disposition") || "";

        let fname = rawFilename;
        const fnameMatch = cd.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
        if (fnameMatch) fname = decodeURIComponent(fnameMatch[1].replace(/"/g, ""));

        if (!cancelled) {
          setDocType(classifyContentType(ct));
          setDetectedFilename(fname);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Unknown error"); setLoading(false); }
      }
    }
    detect();
    return () => { cancelled = true; };
  }, [url, proxyUrl, rawFilename]);

  useEffect(() => {
    if (!loading && !error) onLoad?.();
    if (error) onError?.(error);
  }, [loading, error, onLoad, onError]);

  const filename = detectedFilename || rawFilename;

  return (
    <div className="doc-viewer-root">
      {/* Toolbar */}
      <div className="doc-viewer-toolbar">
        <div className="doc-viewer-toolbar-left">
          {title && <span className="doc-viewer-title">{title}</span>}
          <span className="doc-viewer-filename">{filename}</span>
          {docType && <span className="doc-viewer-badge">{docType.toUpperCase()}</span>}
        </div>
        <div className="doc-viewer-toolbar-right">
          <a href={proxyUrl} download={filename} className="doc-viewer-toolbar-btn" title="Download">⬇ Download</a>
          <a href={url} target="_blank" rel="noopener noreferrer" className="doc-viewer-toolbar-btn" title="Open original">↗ Original</a>
        </div>
      </div>

      {/* Content */}
      <div className="doc-viewer-content" style={{ minHeight: loading ? "300px" : undefined }}>
        {loading && <LoadingState message="Detecting document type…" />}
        {error && <div className="doc-viewer-error">Error: {error}</div>}
        {!loading && !error && docType === "pdf" && <PdfViewer proxyUrl={proxyUrl} height={height} />}
        {!loading && !error && docType === "spreadsheet" && <SpreadsheetViewer proxyUrl={proxyUrl} />}
        {!loading && !error && docType === "word" && <WordViewer proxyUrl={proxyUrl} />}
        {!loading && !error && docType === "image" && <ImageViewer proxyUrl={proxyUrl} title={title} />}
        {!loading && !error && (docType === "text" || docType === "html") && <TextViewer proxyUrl={proxyUrl} />}
        {!loading && !error && (docType === "presentation" || docType === "unknown") && <DownloadFallback proxyUrl={proxyUrl} filename={filename} docType={docType} />}
      </div>
    </div>
  );
}
