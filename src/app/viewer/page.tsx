"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import DocumentViewer from "@/components/DocumentViewer";
import "@/styles/document-viewer.css";

function ViewerContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url");
  const title = searchParams.get("title") || undefined;

  if (!url) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#0f1117",
          color: "#8b8fa3",
          fontFamily: "'JetBrains Mono', monospace",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ color: "#e4e6ed", fontSize: "18px", marginBottom: "12px" }}>
          SAM.gov Document Viewer
        </h2>
        <p style={{ fontSize: "13px", maxWidth: "500px", lineHeight: 1.6 }}>
          Pass a SAM.gov document URL as a query parameter to view it here.
        </p>
        <code
          style={{
            marginTop: "16px",
            padding: "10px 20px",
            background: "#1a1d27",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#4a9eff",
          }}
        >
          /viewer?url=https://sam.gov/...&title=My+Document
        </code>

        {/* Quick paste input */}
        <div style={{ marginTop: "2rem", width: "100%", maxWidth: "600px" }}>
          <input
            type="text"
            placeholder="Paste a SAM.gov document URL and press Enter…"
            style={{
              width: "100%",
              padding: "12px 16px",
              background: "#1a1d27",
              border: "1px solid #2a2d3a",
              borderRadius: "6px",
              color: "#e4e6ed",
              fontFamily: "inherit",
              fontSize: "13px",
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) {
                  window.location.href = `/viewer?url=${encodeURIComponent(val)}`;
                }
              }
            }}
            onFocus={(e) => {
              (e.target as HTMLInputElement).style.borderColor = "#4a9eff";
            }}
            onBlur={(e) => {
              (e.target as HTMLInputElement).style.borderColor = "#2a2d3a";
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f1117",
        padding: "16px",
      }}
    >
      <DocumentViewer url={url} title={title} height="calc(100vh - 100px)" />
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "#0f1117",
            color: "#8b8fa3",
          }}
        >
          Loading…
        </div>
      }
    >
      <ViewerContent />
    </Suspense>
  );
}
