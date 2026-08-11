import { stripeBillingAvailability } from "@avably/core";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SaasCheckoutCta } from "@/app/[locale]/(panel)/organizacja/checkout-cta";
import { logoutAction } from "@/lib/actions/logout";
import { AuthError } from "@/lib/auth";
import { requireBillingOwner } from "@/lib/billing-guard";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

/**
 * Ekran zamkniętej organizacji (L3, ADR-107) — cel przekierowania
 * `tenant_suspended` z requireMemberPage. Stoi POZA grupą `(panel)` (wzorzec
 * /zaproszenie): shell z nawigacją nie ma tu czego pokazać, każdy jego link
 * i tak wróciłby na ten ekran.
 *
 * Strona NIE jest publiczna i NIE utrzymuje własnej listy statusów: pyta ten
 * sam guard co każda trasa tenancka i renderuje komunikat WYŁĄCZNIE dla kodu
 * `tenant_suspended`. Anonim idzie na logowanie (bramka 1.5.7 w
 * protected-routes.test.ts), a sesja, której guard nie zamyka — z powrotem do
 * panelu: na tym ekranie nie da się „obozować" po odwieszeniu organizacji.
 *
 * Komunikat celowo nie niesie szczegółów rozliczeniowych ani rozróżnienia
 * suspended/cancelled/superadmin_locked — to rozmowa ze wsparciem, nie z
 * ekranem (ton readOnly z /organizacja).
 */
export default async function SuspendedOrganizationPage() {
  let suspended = false;
  try {
    await requireMember();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.code === "unauthenticated") {
      redirect(await localePath("/login", { next: "/organizacja-zawieszona" }));
    }
    if (
      error.code !== "tenant_suspended" &&
      error.code !== "tenant_locked" &&
      error.code !== "tenant_cancelled"
    ) {
      // Brak organizacji, superadmin bez organizacji, OKNO DOMYKANIA
      // (`tenant_suspended_closing` — panel częściowo otwarty, nie ma tu
      // czego „obozować") itd. — strona główna pokieruje właściwie.
      redirect(await localePath("/"));
    }
    suspended = true;
  }
  // Guard przepuścił = organizacja działa. Wracamy do panelu.
  if (!suspended) redirect(await localePath("/"));

  // ŚCIEŻKA ZAPŁATY DLA ZAWIESZONEGO OWNERA (K1/ADR-136). Ten sam guard,
  // który bramkuje akcję checkoutu (requireBillingOwner), decyduje też
  // o widoczności CTA: przepuszcza `suspended` (właśnie po to istnieje),
  // odrzuca `cancelled`/`superadmin_locked` i rolę staff — więc CTA widzi
  // dokładnie ten, komu akcja odpowie. Zapłata wraca do `active`
  // NATYCHMIAST, ze zdarzenia dostawcy (zasada 5 okna dunningowego).
  let canPay = false;
  try {
    const billingCtx = await requireBillingOwner();
    canPay = billingCtx.tenantStatus === "suspended" && stripeBillingAvailability().available;
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
  }

  const t = await getTranslations("suspendedOrganization");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      {canPay ? (
        <div className="border-border rounded-md border p-4 text-left" data-suspended-billing>
          <p className="mb-3 text-sm font-medium">{t("payHeading")}</p>
          <SaasCheckoutCta />
        </div>
      ) : null}
      <form action={logoutAction}>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          {t("logout")}
        </button>
      </form>
    </main>
  );
}
