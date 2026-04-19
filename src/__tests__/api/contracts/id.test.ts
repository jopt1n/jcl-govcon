import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: vi.fn((_strings, ..._values) => ({ __sql: true })),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id",
    title: "title",
    agency: "agency",
    classification: "classification",
    noticeId: "notice_id",
    solicitationNumber: "sol_num",
    awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline",
    noticeType: "notice_type",
    aiReasoning: "ai_reasoning",
    status: "status",
    postedDate: "posted_date",
    userOverride: "user_override",
    pscCode: "psc_code",
    naicsCode: "naics_code",
    setAsideType: "set_aside_type",
    descriptionText: "description_text",
    resourceLinks: "resource_links",
    samUrl: "sam_url",
    notes: "notes",
    active: "active",
    rawJson: "raw_json",
    documentsAnalyzed: "documents_analyzed",
    reviewedAt: "reviewed_at",
    promoted: "promoted",
    promotedAt: "promoted_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  auditLog: {
    id: "id",
    contractId: "contract_id",
    action: "action",
    metadata: "metadata",
    createdAt: "created_at",
  },
}));

let mockSelectResult: unknown[] = [];
let mockUpdateResult: unknown[] = [];
// Audit-log transaction instrumentation (Commit 2 / CHOSEN tier).
// Tracks the values-payload handed to `tx.insert(auditLog).values(...)` inside
// the PATCH handler's transaction. Flip `mockAuditInsertShouldFail = true` to
// simulate a failing audit insert and verify the transaction rolls back.
let mockAuditInsertCalls: Array<Record<string, unknown>> = [];
let mockAuditInsertShouldFail = false;
let mockTxUpdateCalled = false;
// Captures the argument passed to `tx.update(contracts).set(updates)` inside
// the PATCH handler's transaction callback. Used by tests that assert the
// exact shape of the updates object (e.g., that reviewedAt is a Date vs a
// COALESCE SQL fragment, when the client sent an explicit reviewedAt).
let mockTxUpdateSetArg: Record<string, unknown> | null = null;

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  // Concrete (non-proxy) chain for tx.update so tests can inspect the exact
  // value passed to .set(). Shape mirrors Drizzle's update().set().where()
  // .returning() flow. Kept local to the transaction path — db.update still
  // uses the generic createChain proxy.
  const buildUpdateChainWithSetCapture = () => ({
    set: vi.fn((args: Record<string, unknown>) => {
      mockTxUpdateSetArg = args;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(mockUpdateResult)),
        })),
      };
    }),
  });

  const transactionImpl = async (
    cb: (tx: {
      update: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
    }) => unknown,
  ) => {
    const tx = {
      update: vi.fn().mockImplementation(() => {
        mockTxUpdateCalled = true;
        return buildUpdateChainWithSetCapture();
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(async (data) => {
          if (mockAuditInsertShouldFail) {
            throw new Error("audit_log insert failed");
          }
          mockAuditInsertCalls.push(data as Record<string, unknown>);
        }),
      })),
    };
    return cb(tx);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => createChain(mockSelectResult)),
      insert: vi.fn().mockImplementation(() => createChain([])),
      update: vi.fn().mockImplementation(() => createChain(mockUpdateResult)),
      delete: vi.fn().mockImplementation(() => createChain([])),
      transaction: vi.fn().mockImplementation(transactionImpl),
    },
  };
});

import { GET, PATCH } from "@/app/api/contracts/[id]/route";

beforeEach(() => {
  mockSelectResult = [];
  mockUpdateResult = [];
  mockAuditInsertCalls = [];
  mockAuditInsertShouldFail = false;
  mockTxUpdateCalled = false;
  mockTxUpdateSetArg = null;
});

describe("GET /api/contracts/[id]", () => {
  it("returns contract when found", async () => {
    const contract = { id: "test-uuid", title: "Test Contract", agency: "DoD" };
    mockSelectResult = [contract];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid");
    const res = await GET(req, { params: { id: "test-uuid" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.id).toBe("test-uuid");
    expect(data.title).toBe("Test Contract");
  });

  it("returns 404 when contract not found", async () => {
    mockSelectResult = [];

    const req = new NextRequest("http://localhost/api/contracts/nonexistent");
    const res = await GET(req, { params: { id: "nonexistent" } });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Contract not found");
  });
});

describe("PATCH /api/contracts/[id]", () => {
  it("returns 400 for invalid classification", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ classification: "INVALID" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid classification");
  });

  it("returns 400 for invalid status", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ status: "BOGUS" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid status");
  });

  it("returns 400 when no valid fields provided", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ unknownField: "value" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("No valid fields to update");
  });

  it("returns 404 when contract not found for update", async () => {
    mockUpdateResult = [];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ classification: "GOOD" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Contract not found");
  });

  it("updates contract and sets updatedAt", async () => {
    const updated = {
      id: "test-uuid",
      classification: "GOOD",
      updatedAt: new Date().toISOString(),
    };
    mockUpdateResult = [updated];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({
        classification: "GOOD",
        notes: "Looks promising",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("test-uuid");
  });

  it("accepts valid status values", async () => {
    // PATCH now pre-selects the existing row when status is in the body so
    // it can diff against the old status and decide whether to bump
    // statusChangedAt. The select must return a row for the update to run.
    mockSelectResult = [{ id: "test-uuid", status: "IDENTIFIED" }];
    mockUpdateResult = [{ id: "test-uuid", status: "PURSUING" }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ status: "PURSUING" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
  });

  it("accepts userOverride field", async () => {
    mockUpdateResult = [{ id: "test-uuid", userOverride: true }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ userOverride: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
  });

  // ── CHOSEN tier: promoted field ─────────────────────────────────────
  //
  // PATCH { promoted: true|false } is the user-driven promotion action.
  // When promoted is in the body, the handler wraps the UPDATE and the
  // audit_log INSERT in db.transaction(...) so either both persist or
  // both fail. All tx.update and tx.insert calls must go through the
  // tx argument — never the outer db — or atomicity silently breaks.

  it("returns 400 when promoted is not a boolean", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: "yes" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid promoted");
  });

  it("promoted:true writes an audit_log row with action=promote", async () => {
    mockUpdateResult = [
      { id: "test-uuid", promoted: true, promotedAt: new Date().toISOString() },
    ];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    expect(mockAuditInsertCalls).toHaveLength(1);
    expect(mockAuditInsertCalls[0]).toMatchObject({
      contractId: "test-uuid",
      action: "promote",
    });
    // Transaction path was exercised: tx.update was called, not the outer db.update.
    expect(mockTxUpdateCalled).toBe(true);
  });

  it("promoted:false writes an audit_log row with action=demote", async () => {
    mockUpdateResult = [{ id: "test-uuid", promoted: false, promotedAt: null }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    expect(mockAuditInsertCalls).toHaveLength(1);
    expect(mockAuditInsertCalls[0]).toMatchObject({
      contractId: "test-uuid",
      action: "demote",
    });
  });

  it("PATCH on nonexistent contract with promoted:true does not write audit_log", async () => {
    // Transaction runs, but tx.update returns [] (no row). Handler skips
    // the audit insert and returns 404.
    mockUpdateResult = [];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(404);
    expect(mockAuditInsertCalls).toHaveLength(0);
  });

  it("promoted:true with failing audit insert surfaces as 500 (atomicity)", async () => {
    // Simulate the audit insert throwing inside the transaction callback.
    // The throw propagates out of db.transaction, the outer try/catch in
    // the handler catches it, and the user sees 500. In real Postgres
    // the UPDATE would roll back; the unit test asserts the handler does
    // not swallow the failure and return 200 with stale data.
    mockUpdateResult = [
      { id: "test-uuid", promoted: true, promotedAt: new Date().toISOString() },
    ];
    mockAuditInsertShouldFail = true;

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(500);
    expect(mockAuditInsertCalls).toHaveLength(0);
  });

  it("PATCH without promoted in body does NOT use the transaction path", async () => {
    // A notes-only PATCH must take the existing single-statement path.
    // The transaction path is reserved for promoted-touching writes.
    mockUpdateResult = [{ id: "test-uuid", notes: "foo" }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ notes: "foo" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    expect(mockTxUpdateCalled).toBe(false);
    expect(mockAuditInsertCalls).toHaveLength(0);
  });

  it("promoted:true + explicit reviewedAt:null — explicit value wins, COALESCE skipped", async () => {
    // Regression guard for the block-ordering bug caught in /review:
    // the promoted block runs AFTER the reviewedAt block, and the COALESCE
    // is ONLY applied when the client did not explicitly send a reviewedAt
    // value. So { promoted: true, reviewedAt: null } must leave reviewedAt
    // as null — the client's explicit intent wins.
    mockUpdateResult = [
      {
        id: "test-uuid",
        promoted: true,
        promotedAt: new Date().toISOString(),
        reviewedAt: null,
      },
    ];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: true, reviewedAt: null }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    // Audit row still written — the contract WAS promoted.
    expect(mockAuditInsertCalls).toHaveLength(1);
    expect(mockAuditInsertCalls[0]).toMatchObject({ action: "promote" });
    // Explicit null reached the UPDATE — COALESCE fragment was NOT substituted.
    // Drizzle's sql`` tag produces an object (SQL instance), not null. If the
    // COALESCE leaked through, this assertion would see an SQL object.
    expect(mockTxUpdateSetArg).not.toBeNull();
    expect(mockTxUpdateSetArg!.reviewedAt).toBeNull();
  });

  it("promoted:true + explicit reviewedAt ISO string — explicit Date wins, COALESCE skipped", async () => {
    // Positive-case companion to the reviewedAt:null regression above.
    // The client can also override the promote-implies-reviewed default
    // with an explicit timestamp (backfill tool, dev override). The
    // parsed Date MUST reach the UPDATE — not the COALESCE SQL fragment.
    const explicitIso = "2025-01-01T00:00:00.000Z";
    mockUpdateResult = [
      {
        id: "test-uuid",
        promoted: true,
        promotedAt: new Date().toISOString(),
        reviewedAt: explicitIso,
      },
    ];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ promoted: true, reviewedAt: explicitIso }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    expect(mockAuditInsertCalls).toHaveLength(1);
    expect(mockAuditInsertCalls[0]).toMatchObject({ action: "promote" });

    // The captured .set() argument must contain the parsed Date, NOT the
    // COALESCE SQL fragment. A Date instance is a plain JS Date; the
    // COALESCE fragment would be a Drizzle SQL object (not a Date).
    expect(mockTxUpdateSetArg).not.toBeNull();
    expect(mockTxUpdateSetArg!.reviewedAt).toBeInstanceOf(Date);
    expect((mockTxUpdateSetArg!.reviewedAt as Date).toISOString()).toBe(
      explicitIso,
    );
  });

  it("promote → demote → promote writes three audit_log rows in order", async () => {
    // Closes the "firstPromotedAt preservation" finding. The `promotedAt`
    // column only tracks the MOST RECENT promotion, but the `audit_log`
    // table is the durable source of truth for promotion history. Any
    // query like "when was this contract first promoted?" answers via:
    //   SELECT action, created_at FROM audit_log
    //    WHERE contract_id = $1 ORDER BY created_at ASC
    //
    // This test simulates three lifecycle events on the same contract and
    // asserts the audit_log mock accumulated three rows with correct
    // actions. The mock uses vi-generated timestamps, so we assert order
    // via insertion order (which mirrors real audit_log.created_at order).

    // Promote
    mockUpdateResult = [{ id: "test-uuid", promoted: true }];
    await PATCH(
      new NextRequest("http://localhost/api/contracts/test-uuid", {
        method: "PATCH",
        body: JSON.stringify({ promoted: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "test-uuid" } },
    );

    // Demote
    mockUpdateResult = [{ id: "test-uuid", promoted: false }];
    await PATCH(
      new NextRequest("http://localhost/api/contracts/test-uuid", {
        method: "PATCH",
        body: JSON.stringify({ promoted: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "test-uuid" } },
    );

    // Promote again
    mockUpdateResult = [{ id: "test-uuid", promoted: true }];
    await PATCH(
      new NextRequest("http://localhost/api/contracts/test-uuid", {
        method: "PATCH",
        body: JSON.stringify({ promoted: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "test-uuid" } },
    );

    expect(mockAuditInsertCalls).toHaveLength(3);
    expect(mockAuditInsertCalls.map((r) => r.action)).toEqual([
      "promote",
      "demote",
      "promote",
    ]);
    expect(
      mockAuditInsertCalls.every((r) => r.contractId === "test-uuid"),
    ).toBe(true);
  });
});
