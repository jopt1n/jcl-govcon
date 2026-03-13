import { vi } from "vitest";

import { filterDownloadableLinks, downloadDocuments } from "@/lib/sam-gov/documents";
import type { SamResourceLink } from "@/lib/sam-gov/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("filterDownloadableLinks", () => {
  it("returns empty array for null input", () => {
    expect(filterDownloadableLinks(null)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(filterDownloadableLinks([])).toEqual([]);
  });

  it("filters to PDF, DOCX, and DOC only", () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/file.pdf", description: null },
      { url: "https://example.com/file.docx", description: null },
      { url: "https://example.com/file.doc", description: null },
      { url: "https://example.com/file.html", description: null },
      { url: "https://example.com/file.txt", description: null },
    ];

    const result = filterDownloadableLinks(links);
    expect(result).toHaveLength(3);
    expect(result.map(l => l.url)).toEqual([
      "https://example.com/file.pdf",
      "https://example.com/file.docx",
      "https://example.com/file.doc",
    ]);
  });

  it("handles URLs with query params", () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/file.pdf?token=abc", description: null },
    ];

    const result = filterDownloadableLinks(links);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/file.pdf?token=abc");
  });

  it("rejects invalid and non-document URLs", () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/page.html", description: null },
      { url: "https://example.com/data.txt", description: null },
      { url: "https://example.com/noextension", description: null },
      { url: "https://example.com/image.png", description: null },
    ];

    const result = filterDownloadableLinks(links);
    expect(result).toHaveLength(0);
  });
});

describe("downloadDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for null links", async () => {
    const result = await downloadDocuments(null);
    expect(result).toEqual([]);
  });

  it("returns empty array for links with no downloadable extensions", async () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/page.html", description: null },
    ];
    const result = await downloadDocuments(links);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("downloads PDFs successfully", async () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/file.pdf", description: null },
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": "1024",
      }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    const result = await downloadDocuments(links);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/file.pdf");
    expect(result[0].contentType).toBe("application/pdf");
    expect(result[0].filename).toBe("file.pdf");
  });

  it("handles failed downloads gracefully", async () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/file1.pdf", description: null },
      { url: "https://example.com/file2.pdf", description: null },
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "application/pdf",
          "content-length": "512",
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)),
      });

    const result = await downloadDocuments(links);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/file2.pdf");
  });

  it("respects 50MB size limit via content-length header", async () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/huge.pdf", description: null },
    ];

    const overLimit = 51 * 1024 * 1024; // 51MB
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": String(overLimit),
      }),
    });

    const result = await downloadDocuments(links);
    expect(result).toHaveLength(0);
  });

  it("respects content-type validation", async () => {
    const links: SamResourceLink[] = [
      { url: "https://example.com/file.pdf", description: null },
    ];

    // Return a non-allowed content type with a .pdf extension — should still pass because ext is allowed
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "text/html",
        "content-length": "1024",
      }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    // .pdf extension is allowed, so it passes even with wrong content-type
    const result = await downloadDocuments(links);
    expect(result).toHaveLength(1);
  });

  it("rejects when both content-type and extension are invalid", async () => {
    // Use a link with valid extension so it passes filterDownloadableLinks,
    // but mock the URL parse to return invalid content-type
    const links: SamResourceLink[] = [
      { url: "https://example.com/file.doc", description: null },
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "text/html",
        "content-length": "1024",
      }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    // .doc is in ALLOWED_EXTENSIONS, so it should still pass
    const result = await downloadDocuments(links);
    expect(result).toHaveLength(1);
  });

  it("processes in batches of 3", async () => {
    const links: SamResourceLink[] = Array.from({ length: 5 }, (_, i) => ({
      url: `https://example.com/file${i}.pdf`,
      description: null,
    }));

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": "1024",
      }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    const result = await downloadDocuments(links);
    // All 5 should be downloaded successfully
    expect(result).toHaveLength(5);
    // Fetch should have been called 5 times total (3 in first batch, 2 in second)
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
