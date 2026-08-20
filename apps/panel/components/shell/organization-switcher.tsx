"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avably/ui";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { switchOrganizationAction, type SwitchOrganizationState } from "@/lib/actions/organization";
import type { PanelOrganization } from "@/lib/organizations";

import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";

const initialState: SwitchOrganizationState = {};

/**
 * Przełącznik organizacji w górnej belce (L7, ADR-224).
 *
 * Renderowany WYŁĄCZNIE, gdy użytkownik ma >1 żywe członkostwo (decyzja
 * należy do belki — patrz panel-topbar.tsx). Bieżąca organizacja pochodzi
 * z claimu JWT (`currentTenantId`) i jest zaznaczona ptaszkiem oraz wyłączona
 * (klik w nią nic nie robi). Wybór innej org to POST server-action
 * `switchOrganizationAction`: bramka członkostwa siedzi w bazie
 * (`app.set_active_tenant`), po sukcesie akcja odświeża token i przeładowuje
 * na pulpit nowej org.
 *
 * Każda pozycja to przycisk `type="submit"` w JEDNYM formularzu — atrybut
 * `name="tenantId" value={org}` niesie wybór (ta sama mechanika co formularz
 * wylogowania w account-menu). Odmowa (org nieczłonkowska — ścieżka obronna,
 * z interfejsu nieosiągalna, bo listujemy tylko członkostwa) pokazuje się
 * jako `role="alert"`.
 */
export function OrganizationSwitcher({
  organizations,
  currentTenantId,
}: {
  organizations: PanelOrganization[];
  currentTenantId: string | null;
}) {
  const t = useTranslations("orgSwitcher");
  const [state, formAction] = useActionState(switchOrganizationAction, initialState);

  const current = organizations.find((org) => org.tenantId === currentTenantId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        data-org-switcher-trigger
        className="border-border text-foreground flex h-9 max-w-[13rem] shrink cursor-pointer items-center gap-2 rounded-md border px-2.5 outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <Building2Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
        <span className="min-w-0 truncate text-sm font-medium">{current?.name ?? t("label")}</span>
        <ChevronsUpDownIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-org-switcher>
        <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-normal">
          {t("heading")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border -mx-1 my-1 h-px" />
        <form action={formAction}>
          {organizations.map((org) => {
            const isCurrent = org.tenantId === currentTenantId;
            return (
              <DropdownMenuItem key={org.tenantId} asChild disabled={isCurrent}>
                <button
                  type="submit"
                  name="tenantId"
                  value={org.tenantId}
                  disabled={isCurrent}
                  data-org-switcher-item
                  data-current={isCurrent ? "true" : undefined}
                  className="flex w-full cursor-pointer items-center gap-2 text-left disabled:cursor-default"
                >
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {isCurrent ? (
                    <CheckIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
                  ) : null}
                </button>
              </DropdownMenuItem>
            );
          })}
        </form>
        {state.error ? (
          <p role="alert" className="text-destructive px-2 py-1.5 text-xs">
            {state.error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
