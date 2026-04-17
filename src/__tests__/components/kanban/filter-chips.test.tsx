// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  KanbanFilterChips,
  type PostedWindow,
} from "@/components/kanban/filter-chips";

function setup(
  overrides: Partial<React.ComponentProps<typeof KanbanFilterChips>> = {},
) {
  const onToggleNoticeType = vi.fn();
  const onPostedWindow = vi.fn();
  const onToggleQualifying = vi.fn();
  render(
    <KanbanFilterChips
      noticeTypes={[]}
      onToggleNoticeType={onToggleNoticeType}
      postedWindow={"all" as PostedWindow}
      onPostedWindow={onPostedWindow}
      qualifyingOnly={false}
      onToggleQualifying={onToggleQualifying}
      {...overrides}
    />,
  );
  return { onToggleNoticeType, onPostedWindow, onToggleQualifying };
}

describe("KanbanFilterChips", () => {
  it("renders all notice type options", () => {
    setup();
    expect(screen.getByRole("button", { name: "Solicitation" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Combined Synopsis/Solicitation" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Presolicitation" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Sources Sought" }),
    ).toBeDefined();
  });

  it("renders posted window options", () => {
    setup();
    expect(screen.getByRole("button", { name: "All time" })).toBeDefined();
    expect(screen.getByRole("button", { name: "This week" })).toBeDefined();
    expect(screen.getByRole("button", { name: "This month" })).toBeDefined();
  });

  it("marks the active notice type chip with aria-pressed=true", () => {
    setup({ noticeTypes: ["Solicitation"] });
    expect(
      screen
        .getByRole("button", { name: "Solicitation" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Presolicitation" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("marks the active posted window with aria-pressed=true", () => {
    setup({ postedWindow: "week" });
    expect(
      screen
        .getByRole("button", { name: "This week" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "All time" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("click on an inactive notice type chip fires toggle with that type", async () => {
    const { onToggleNoticeType } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Solicitation" }));
    expect(onToggleNoticeType).toHaveBeenCalledWith("Solicitation");
  });

  it("click on an active notice type chip still fires toggle (caller handles removal)", async () => {
    const { onToggleNoticeType } = setup({ noticeTypes: ["Solicitation"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Solicitation" }));
    expect(onToggleNoticeType).toHaveBeenCalledWith("Solicitation");
  });

  it("clicking a posted window button calls onPostedWindow with that value", async () => {
    const { onPostedWindow } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "This week" }));
    expect(onPostedWindow).toHaveBeenCalledWith("week");
  });

  it("qualifying-only chip reflects active state and fires toggle", async () => {
    const { onToggleQualifying } = setup({ qualifyingOnly: true });
    const chip = screen.getByRole("button", { name: "Qualifying only" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const user = userEvent.setup();
    await user.click(chip);
    expect(onToggleQualifying).toHaveBeenCalled();
  });
});
