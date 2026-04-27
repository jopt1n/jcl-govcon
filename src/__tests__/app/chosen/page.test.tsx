import { vi } from "vitest";

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import ChosenRedirectPage from "@/app/chosen/page";
import nextConfig from "../../../../next.config.mjs";

describe("/chosen redirect", () => {
  beforeEach(() => {
    mockRedirect.mockReset();
  });

  it("is handled by Next config before app routing for clean HTTP redirects", async () => {
    expect(nextConfig.redirects).toBeDefined();
    const redirects = await nextConfig.redirects!();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/chosen",
          destination: "/pursuits",
          permanent: false,
        },
        {
          source: "/chosen/",
          destination: "/pursuits",
          permanent: false,
        },
      ]),
    );
  });

  it("redirects to /pursuits instead of maintaining a second UI", () => {
    ChosenRedirectPage();
    expect(mockRedirect).toHaveBeenCalledWith("/pursuits");
  });
});
