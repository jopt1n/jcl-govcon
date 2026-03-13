import { vi } from "vitest";

// Chainable mock builder that returns itself for .from(), .where(), .limit(), etc.
function createChainableMock() {
  const mock: Record<string, unknown> = {};
  const chainMethods = [
    "from",
    "where",
    "limit",
    "offset",
    "orderBy",
    "groupBy",
    "returning",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "set",
    "values",
  ];

  for (const method of chainMethods) {
    mock[method] = vi.fn().mockReturnValue(mock);
  }

  // Terminal method - returns empty array by default
  (mock as { then: unknown }).then = undefined;
  // Make it thenable (awaitable) - resolves to empty array by default
  Object.defineProperty(mock, "then", {
    value: (resolve: (v: unknown[]) => void) => resolve([]),
    writable: true,
    configurable: true,
  });

  return mock;
}

export const mockSelect = createChainableMock();
export const mockInsert = createChainableMock();
export const mockUpdate = createChainableMock();
export const mockDelete = createChainableMock();

export const db = {
  select: vi.fn().mockReturnValue(mockSelect),
  insert: vi.fn().mockReturnValue(mockInsert),
  update: vi.fn().mockReturnValue(mockUpdate),
  delete: vi.fn().mockReturnValue(mockDelete),
  query: {},
};
