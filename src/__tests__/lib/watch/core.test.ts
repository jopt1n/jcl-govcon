import { describe, expect, it } from "vitest";
import {
  diffWatchSnapshots,
  fingerprintWatchEvent,
  matchWatchTarget,
  summarizeWatchEvent,
  watchSnapshotFromContract,
  watchSnapshotFromTarget,
  type MatchCandidate,
} from "@/lib/watch/core";

function makeSource(overrides: Record<string, unknown> = {}) {
  return watchSnapshotFromTarget({
    sourceContractId: "source-1",
    sourceNoticeId: "notice-source",
    sourceSolicitationNumber: "SOL-001",
    sourceTitle: "Cloud migration support",
    sourceAgency: "Department of Defense",
    sourceNoticeType: "Sources Sought",
    sourceResponseDeadline: "2026-04-30T12:00:00Z",
    sourceSetAsideCode: "SBA",
    sourceResourceUrls: ["https://example.com/source.pdf"],
    ...overrides,
  });
}

function makeCandidate(
  id: string,
  overrides: Record<string, unknown> = {},
): MatchCandidate {
  return watchSnapshotFromContract({
    id,
    noticeId: `notice-${id}`,
    solicitationNumber: "SOL-001",
    title: "Cloud migration support",
    agency: "Department of Defense",
    noticeType: "Presolicitation",
    responseDeadline: "2026-05-10T12:00:00Z",
    setAsideCode: "SBA",
    resourceLinks: ["https://example.com/source.pdf"],
    ...overrides,
  }) as MatchCandidate;
}

describe("watch/core matching", () => {
  it("matches on exact solicitation number when present", () => {
    const source = makeSource();
    const result = matchWatchTarget(source, [
      makeCandidate("c1"),
      makeCandidate("c2", { solicitationNumber: "OTHER-123" }),
    ]);

    expect(result.matched.map((candidate) => candidate.contractId)).toEqual([
      "c1",
    ]);
    expect(result.resolved?.contractId).toBe("c1");
    expect(result.requiresReview).toBe(false);
  });

  it("falls back to exact normalized title + agency only when solicitation number is missing", () => {
    const source = makeSource({ sourceSolicitationNumber: null });
    const result = matchWatchTarget(source, [
      makeCandidate("c1", {
        solicitationNumber: "DIFFERENT",
        title: " Cloud Migration Support ",
        agency: "department of defense",
      }),
      makeCandidate("c2", {
        solicitationNumber: "DIFFERENT",
        title: "Different title",
      }),
    ]);

    expect(result.matched.map((candidate) => candidate.contractId)).toEqual([
      "c1",
    ]);
    expect(result.resolved?.contractId).toBe("c1");
  });

  it("marks multiple plausible candidates as NEEDS_REVIEW when no safe winner exists", () => {
    const source = makeSource();
    const result = matchWatchTarget(source, [
      makeCandidate("c1", { noticeType: "Presolicitation" }),
      makeCandidate("c2", { noticeType: "Presolicitation" }),
    ]);

    expect(result.requiresReview).toBe(true);
    expect(result.resolved).toBeNull();
  });

  it("treats source + one higher-rank successor as a clear match", () => {
    const source = makeSource();
    const result = matchWatchTarget(source, [
      makeCandidate("source-1", {
        id: "source-1",
        noticeId: "notice-source",
        noticeType: "Sources Sought",
      }),
      makeCandidate("successor-1", {
        noticeType: "Solicitation",
      }),
    ]);

    expect(result.requiresReview).toBe(false);
    expect(result.resolved?.contractId).toBe("successor-1");
  });
});

describe("watch/core diffs", () => {
  it("detects all notifyable material changes", () => {
    const before = makeSource();
    const after = makeCandidate("c1", {
      noticeType: "Solicitation",
      responseDeadline: "2026-05-15T12:00:00Z",
      setAsideCode: "SBP",
      title: "Cloud migration and operations support",
      agency: "Department of the Air Force",
      resourceLinks: [
        "https://example.com/source.pdf",
        "https://example.com/new.pdf",
      ],
    });

    const changes = diffWatchSnapshots(before, after);
    expect(changes.map((change) => change.eventType)).toEqual([
      "notice_progression",
      "deadline_changed",
      "set_aside_changed",
      "title_changed",
      "agency_changed",
      "docs_added",
    ]);
  });

  it("distinguishes deadline added from deadline changed", () => {
    const before = makeSource({ sourceResponseDeadline: null });
    const after = makeCandidate("c1", {
      responseDeadline: "2026-05-15T12:00:00Z",
    });

    const changes = diffWatchSnapshots(before, after);
    expect(changes.map((change) => change.eventType)).toContain(
      "deadline_added",
    );
    expect(changes.map((change) => change.eventType)).not.toContain(
      "deadline_changed",
    );
  });

  it("produces stable fingerprints for the same event payload", () => {
    const beforeJson = { noticeType: "Sources Sought", rank: 1 };
    const afterJson = { noticeType: "Presolicitation", rank: 2 };

    expect(
      fingerprintWatchEvent("watch-1", "notice_progression", beforeJson, afterJson),
    ).toBe(
      fingerprintWatchEvent("watch-1", "notice_progression", beforeJson, afterJson),
    );
  });

  it("summarizes docs-added events for UI and Telegram", () => {
    expect(
      summarizeWatchEvent({
        eventType: "docs_added",
        beforeJson: { resourceUrls: ["a"] },
        afterJson: { resourceUrls: ["a", "b"], addedUrls: ["b"] },
      }),
    ).toBe("1 new document added");
  });
});
