// @vitest-environment jsdom

/**
 * PRZEŁĄCZNIK ORGANIZACJI W BELCE (L7, ADR-224).
 *
 * Kontrakt pilnuje trzech rzeczy naraz:
 *  1. Picker pojawia się WYŁĄCZNIE przy >1 członkostwie — jedna org = brak
 *     szumu (asercja negatywna + kontrola pozytywna, żeby „nie ma go" nie było
 *     zielone także wtedy, gdy zniknął całkiem).
 *  2. Bieżąca org (z claimu) jest zaznaczona i wyłączona — klik w nią nic nie
 *     robi.
 *  3. Wybór org to submit formularza niosący `tenantId` (server action
 *     `switchOrganizationAction`), nigdy link GET. Bramka członkostwa siedzi
 *     w bazie; UI listuje wyłącznie org zwrócone przez members-gated RPC.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  useRouter: () => ({ refresh: () => {} }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/logout", () => ({ logoutAction: "/logout" }));
// Server action w teście jednostkowym to tożsamość stanu — sprawdzamy
// STRUKTURĘ formularza (name/value/current), nie przebieg akcji.
vi.mock("@/lib/actions/organization", () => ({
  switchOrganizationAction: async (prev: unknown) => prev,
}));

const { PanelTopbar } = await import("@/components/shell/panel-topbar");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

function renderTopbar(props: {
  organizations?: { tenantId: string; name: string; slug: string; role: "owner" | "staff" }[];
  currentTenantId?: string | null;
}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <PanelTopbar
        userEmail="operator@wypozyczalnia.test"
        organizations={props.organizations ?? []}
        currentTenantId={props.currentTenantId ?? null}
      />
    </NextIntlClientProvider>,
  );
}

function openSwitcher(container: HTMLElement): void {
  fireEvent.pointerDown(container.querySelector("[data-org-switcher-trigger]")!, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

afterEach(cleanup);

describe("przełącznik organizacji", () => {
  it("jedno członkostwo → brak pickera (bez szumu)", () => {
    const { container } = renderTopbar({
      organizations: [{ tenantId: ORG_A, name: "Moja wypożyczalnia", slug: "moja", role: "owner" }],
      currentTenantId: ORG_A,
    });
    // Kontrola pozytywna: belka JEST wyrenderowana (menu konta obecne), więc
    // brak triggera to decyzja, nie pusty render.
    expect(container.querySelector("[data-account-menu-trigger]")).not.toBeNull();
    expect(container.querySelector("[data-org-switcher-trigger]")).toBeNull();
  });

  it("dwa członkostwa → picker z bieżącą org na triggerze", () => {
    const { container } = renderTopbar({
      organizations: [
        { tenantId: ORG_B, name: "Nowa firma", slug: "nowa", role: "owner" },
        { tenantId: ORG_A, name: "Stara firma", slug: "stara", role: "staff" },
      ],
      currentTenantId: ORG_A,
    });
    const trigger = container.querySelector("[data-org-switcher-trigger]");
    expect(trigger).not.toBeNull();
    // Trigger pokazuje NAZWĘ bieżącej org (z claimu), nie pierwszej z listy.
    expect(trigger?.textContent).toContain("Stara firma");
  });

  it("pozycje niosą tenantId; bieżąca jest zaznaczona i wyłączona, pozostałe to submit", () => {
    const { container } = renderTopbar({
      organizations: [
        { tenantId: ORG_B, name: "Nowa firma", slug: "nowa", role: "owner" },
        { tenantId: ORG_A, name: "Stara firma", slug: "stara", role: "staff" },
      ],
      currentTenantId: ORG_A,
    });
    openSwitcher(container);

    const items = [...document.querySelectorAll("[data-org-switcher-item]")] as HTMLButtonElement[];
    expect(items, "obie org w menu").toHaveLength(2);

    const current = items.find((b) => b.value === ORG_A)!;
    const other = items.find((b) => b.value === ORG_B)!;

    // Bieżąca: zaznaczona + wyłączona (klik nic nie robi).
    expect(current.getAttribute("data-current")).toBe("true");
    expect(current.disabled).toBe(true);

    // Inna org: aktywny submit niosący tenantId w JEDNYM formularzu.
    expect(other.disabled).toBe(false);
    expect(other.getAttribute("type")).toBe("submit");
    expect(other.getAttribute("name")).toBe("tenantId");
    expect(other.closest("form"), "wybór idzie przez formularz (POST), nie link GET").not.toBeNull();
  });
});
