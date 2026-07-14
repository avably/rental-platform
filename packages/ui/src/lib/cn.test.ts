import { expect, it } from "vitest";

it("scala klasy warunkowe i rozwiązuje konflikty Tailwind", async () => {
  const { cn } = await import("./cn");

  expect(cn("px-2", undefined, "px-4")).toBe("px-4");
});
