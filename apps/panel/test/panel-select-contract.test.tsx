import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const adapterPath = resolve(process.cwd(), "components/fields/panel-select.tsx");
const adapterExists = existsSync(adapterPath);
const adapterSource = adapterExists ? readFileSync(adapterPath, "utf8") : "";
const adapter = adapterExists ? await import("@/components/fields/panel-select") : null;

describe("kontrakt panelowego Selecta — ADR-060", () => {
  it("adapter istnieje i składa wyłącznie prymitywy @avably/ui", () => {
    expect(adapterExists, "brak components/fields/panel-select.tsx").toBe(true);
    expect(adapterSource).toContain('from "@avably/ui"');
    expect(adapterSource).toContain("SelectTrigger");
    expect(adapterSource).toContain("SelectContent");
    expect(adapterSource).toContain("SelectItem");
    expect(adapterSource).not.toMatch(/<select\b/);
  });

  it("pusta opcja zachowuje pusty string w nazwanym polu formularza", () => {
    expect(adapter?.PanelSelect).toBeTypeOf("function");
    if (!adapter) return;

    const html = renderToStaticMarkup(
      <form>
        <adapter.PanelSelect
          id="filter-klient"
          name="klient"
          defaultValue=""
          options={[
            { value: "", label: "Wszyscy" },
            { value: "customer-a", label: "Anna" },
          ]}
        />
      </form>,
    );

    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="klient"[^>]*value=""/);
    expect(html).not.toContain('value="__panel_empty__"');
  });

  it("zwykła wartość pozostawia name na bridge Radix Select", () => {
    expect(adapter?.PanelSelect).toBeTypeOf("function");
    if (!adapter) return;

    const html = renderToStaticMarkup(
      <form>
        <adapter.PanelSelect
          id="invite-role"
          name="role"
          defaultValue="staff"
          options={[
            { value: "staff", label: "staff" },
            { value: "owner", label: "owner" },
          ]}
        />
      </form>,
    );

    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toMatch(/<select[^>]*aria-hidden="true"[^>]*name="role"/);
    expect(html).not.toMatch(/<input[^>]*name="role"/);
  });
});
