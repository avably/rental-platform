import { describe, expect, it } from "vitest";

import * as ui from "./index";

const requiredExports = [
  "Button",
  "Input",
  "Card",
  "Dialog",
  "Table",
  "Select",
  "Badge",
  "Checkbox",
  "Label",
  "Textarea",
  "DropdownMenu",
  "Popover",
  "Tooltip",
  "Separator",
  "Calendar",
] as const;

describe("publiczny kontrakt @avably/ui", () => {
  it.each(requiredExports)("eksportuje %s", (name) => {
    expect(ui).toHaveProperty(name);
  });

  it("eksportuje warianty przycisku i badge", () => {
    expect(ui).toHaveProperty("buttonVariants");
    expect(ui).toHaveProperty("badgeVariants");
  });
});
