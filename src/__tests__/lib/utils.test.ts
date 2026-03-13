import { cn, delay } from "@/lib/utils";

describe("cn", () => {
  it("merges classes correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("resolves Tailwind conflicts by keeping the last class", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("handles conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn("base", isActive && "active", isDisabled && "disabled")).toBe(
      "base active"
    );
  });
});

describe("delay", () => {
  it("resolves after specified ms", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const promise = delay(1000).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1000);
    await promise;

    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
