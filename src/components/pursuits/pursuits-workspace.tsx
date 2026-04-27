"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, SearchCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PursuitFilterRail,
  type PursuitFilters,
} from "./pursuit-filter-rail";
import { PursuitList, type PursuitListItem } from "./pursuit-list";
import {
  PursuitDetailDrawer,
  type PursuitDetail,
} from "./pursuit-detail-drawer";

const DEFAULT_FILTERS: PursuitFilters = {
  stage: "",
  outcome: "",
  includeHistory: false,
  cashBurden: "",
  deadline: "",
  contractType: "",
  contactStatus: "",
  search: "",
};

export function PursuitsWorkspace() {
  const [filters, setFilters] = useState<PursuitFilters>(DEFAULT_FILTERS);
  const [rows, setRows] = useState<PursuitListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PursuitDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "100", page: "1" });
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.outcome) params.set("outcome", filters.outcome);
    if (filters.includeHistory) params.set("includeHistory", "1");
    if (filters.cashBurden) params.set("cashBurden", filters.cashBurden);
    if (filters.deadline) params.set("deadline", filters.deadline);
    if (filters.contractType.trim()) {
      params.set("contractType", filters.contractType.trim());
    }
    if (filters.contactStatus.trim()) {
      params.set("contactStatus", filters.contactStatus.trim());
    }
    if (filters.search.trim()) params.set("search", filters.search.trim());
    return params.toString();
  }, [filters]);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    setError(null);
    try {
      const res = await fetch(`/api/pursuits?${query}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch pursuits");
      const data = json.data ?? [];
      setRows(data);
      setTotal(json.pagination?.total ?? data.length);
      setSelectedId((current) =>
        current && data.some((row: PursuitListItem) => row.id === current)
          ? current
          : data[0]?.id ?? null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pursuits");
      setRows([]);
      setTotal(0);
    } finally {
      setLoadingRows(false);
    }
  }, [query]);

  const fetchDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/pursuits/${id}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch pursuit");
      setDetail(json);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  async function patchSelected(body: Record<string, unknown>) {
    if (!selectedId) return;
    const res = await fetch(`/api/pursuits/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to update pursuit");
    setDetail(json);
    await fetchRows();
  }

  async function createContact(body: Record<string, unknown>) {
    if (!selectedId) return;
    const res = await fetch(`/api/pursuits/${selectedId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to create contact");
    await fetchDetail(selectedId);
  }

  async function updateContact(id: string, body: Record<string, unknown>) {
    if (!selectedId) return;
    const res = await fetch(`/api/pursuits/${selectedId}/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to update contact");
    await fetchDetail(selectedId);
  }

  async function deleteContact(id: string) {
    if (!selectedId) return;
    const res = await fetch(`/api/pursuits/${selectedId}/contacts/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete contact");
    await fetchDetail(selectedId);
  }

  async function addNote(body: string) {
    if (!selectedId) return;
    const res = await fetch(`/api/pursuits/${selectedId}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "NOTE", body }),
    });
    if (!res.ok) throw new Error("Failed to add note");
    await fetchDetail(selectedId);
  }

  return (
    <div className="p-4 pt-14 md:p-6 md:pt-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <SearchCheck className="h-6 w-6 text-[var(--pursuit-brass)]" />
            Pursuits
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Internal CRM workspace for promoted opportunities. {total} visible.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchRows}
          disabled={loadingRows}
          className="inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loadingRows && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 border border-[var(--urgent)] bg-red-500/10 p-3 text-sm text-[var(--urgent)]">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <PursuitFilterRail filters={filters} onChange={setFilters} />
        <main className="min-w-0 flex-1">
          <PursuitList
            pursuits={rows}
            selectedId={selectedId}
            loading={loadingRows}
            onSelect={setSelectedId}
          />
        </main>
        <PursuitDetailDrawer
          detail={detail}
          loading={loadingDetail}
          onClose={() => setSelectedId(null)}
          onPatch={patchSelected}
          onCreateContact={createContact}
          onUpdateContact={updateContact}
          onDeleteContact={deleteContact}
          onAddNote={addNote}
        />
      </div>
    </div>
  );
}
