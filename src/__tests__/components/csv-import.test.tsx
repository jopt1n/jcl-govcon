// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => {
  const icon = ({ className }: any) => <span className={className} />;
  return {
    Building2: icon,
    DollarSign: icon,
    Clock: icon,
    Brain: icon,
    Search: icon,
    Filter: icon,
    X: icon,
    ArrowLeft: icon,
    Calendar: icon,
    ExternalLink: icon,
    FileText: icon,
    Tag: icon,
    Hash: icon,
    Loader2: icon,
    RefreshCw: icon,
  };
});

import { CsvImport } from "@/components/csv-import";

function makeCsvFile(content: string, name = "contracts.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("CsvImport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders upload zone", () => {
    render(<CsvImport />);
    expect(screen.getByText("Drop a SAM.gov CSV file here")).toBeDefined();
    expect(screen.getByText("or click to browse")).toBeDefined();
  });

  it("shows file info after selection", async () => {
    render(<CsvImport />);
    const user = userEvent.setup();
    const csvContent = "title,agency\nTest Contract,DOD\n";
    const file = makeCsvFile(csvContent);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("contracts.csv")).toBeDefined();
    });
  });

  it("shows preview after CSV parsing", async () => {
    render(<CsvImport />);
    const user = userEvent.setup();
    const csvContent = "title,agency,value\nAlpha,DOD,100\nBeta,DOE,200\n";
    const file = makeCsvFile(csvContent);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      // Check header columns rendered
      expect(screen.getByText("title")).toBeDefined();
      expect(screen.getByText("agency")).toBeDefined();
      expect(screen.getByText("value")).toBeDefined();
      // Check data rows
      expect(screen.getByText("Alpha")).toBeDefined();
      expect(screen.getByText("DOD")).toBeDefined();
      // Check row count info
      expect(
        screen.getByText(/2 rows total, showing first 2/)
      ).toBeDefined();
    });
  });

  it("shows error for empty file", async () => {
    render(<CsvImport />);
    const user = userEvent.setup();
    const file = makeCsvFile("");

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(
        screen.getByText("File appears empty or has no headers.")
      ).toBeDefined();
    });
  });

  it("shows import results after successful import", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          total: 10,
          imported: 8,
          skipped: 2,
          importedIds: ["id1", "id2"],
          queued_for_classification: 8,
        }),
    });

    render(<CsvImport />);
    const user = userEvent.setup();
    const csvContent = "title,agency\nTest,DOD\n";
    const file = makeCsvFile(csvContent);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Import 1 Contracts/)).toBeDefined();
    });

    const importBtn = screen.getByText(/Import 1 Contracts/);
    await user.click(importBtn);

    await waitFor(() => {
      expect(screen.getByText("Import Complete")).toBeDefined();
      expect(screen.getByText("10")).toBeDefined(); // total
      expect(screen.getByText("8")).toBeDefined(); // imported
      expect(screen.getByText("2")).toBeDefined(); // skipped
    });
  });
});
