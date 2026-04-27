import { vi } from "vitest";

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import ChosenRedirectPage from "@/app/chosen/page";

describe("/chosen redirect", () => {
  beforeEach(() => {
    mockRedirect.mockReset();
  });

  it("redirects to /pursuits instead of maintaining a second UI", () => {
    ChosenRedirectPage();
    expect(mockRedirect).toHaveBeenCalledWith("/pursuits");
  });
});
