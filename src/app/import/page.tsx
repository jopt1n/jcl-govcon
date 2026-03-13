import { CsvImport } from "@/components/csv-import";

export default function ImportPage() {
  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Import Contracts</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Upload a CSV file exported from SAM.gov to import contracts.
        </p>
      </div>
      <CsvImport />
    </div>
  );
}
