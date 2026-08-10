import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { logoutAction } from "@/lib/actions/logout";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Ekran cofniętego dostępu (R12b/H-01, ADR-127) — cel przekierowania
 * `membership_revoked` z requireMemberPage/requireSuperadminPage. Stoi POZA
 * grupą `(panel)` (wzorzec /organizacja-zawieszona i /zaproszenie): shell z
 * nawigacją nie ma tu czego pokazać, a każdy jego link i tak trafiłby na
 * kolejny guard z tym samym cofniętym claimem.
 *
 * DLACZEGO OSOBNY EKRAN, A NIE GOŁY REDIRECT NA /login. Sesja usera niesie w
 * claimie stary tenant_id/superadmin, żywy do wygaśnięcia tokenu. Samo odesłanie
 * na /login zostawiłoby ważny (choć nieaktualny) token w ciasteczku i pokazywało
 * formularz logowania komuś „zalogowanemu". Ten ekran WYLOGOWUJE (POST przez
 * server action — logout zmienia stan, nie robimy go linkiem GET, wzorzec z
 * (superadmin)/layout) i dopiero wtedy odsyła na /login, gdzie ponowne logowanie
 * każe hookowi przeliczyć claim na inną, wciąż ważną organizację (user
 * wielotenantowy) albo skończyć na czystym /login (user bez żadnej org).
 *
 * FAŁSZYWE WYLOGOWANIE — ZABEZPIECZENIE. Trasa jest osiągalna wyłącznie z
 * guardów przy cofniętym dostępie, ale gdyby ktoś z WAŻNĄ sesją wpisał ją
 * ręcznie, nie wolno go automatem wylogować. Dlatego przed pokazaniem ekranu
 * re-weryfikujemy dostęp NA ŻYWO: kto nadal jest członkiem swojego tenanta albo
 * superadminem, wraca do panelu („/"). Wylogowanie widzi tylko sesja, której
 * dostęp faktycznie cofnięto.
 */
export default async function AccessRevokedPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);

  // Brak sesji → już wylogowany; na logowanie (z powrotem do panelu po zalogowaniu).
  if (!ctx) redirect(await localePath("/login", { next: "/" }));

  // Re-weryfikacja na żywo: czy dostęp NAPRAWDĘ cofnięto? Chroni ważną sesję,
  // która trafiła tu ręcznie, przed automatycznym wylogowaniem.
  let stillMember = false;
  if (ctx.tenantId) {
    const { data } = await supabase
      .from("members")
      .select("user_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    stillMember = data != null;
  }
  let stillSuperadmin = false;
  if (ctx.superadmin) {
    const { data } = await supabase
      .schema("app")
      .from("superadmins")
      .select("user_id")
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    stillSuperadmin = data != null;
  }
  // Dostęp nadal działa → nie ma tu czego pokazać, wracamy do panelu.
  if (stillMember || stillSuperadmin) redirect(await localePath("/"));

  const t = await getTranslations("accessRevoked");

  // Nonce żądania (ADR-012) — bez niego CSP strict-dynamic odmówi wykonania
  // skryptu automatycznego wylogowania. Sam skrypt to progresywne ulepszenie:
  // bez JS użytkownik klika przycisk (form działa natywnym POST-em, tak samo
  // jak server action logoutAction).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      <form id="access-revoked-logout" action={logoutAction}>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          {t("logout")}
        </button>
      </form>
      {/*
        Automatyczne wylogowanie: żądanie natychmiastowego POST-a formularza
        (requestSubmit, nie submit — odpala walidację i działa też przed
        hydracją, bo server action jest progresywnie ulepszony). Fallback bez
        JS to przycisk powyżej.
      */}
      <script
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html:
            'document.getElementById("access-revoked-logout")?.requestSubmit();',
        }}
      />
    </main>
  );
}
