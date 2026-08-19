import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * 404 POZIOMU APLIKACJI (L-UX-01, ADR-197) — adresy, których panel w ogóle nie
 * zna. Trafia tu `notFound()` z catch-alla `[...rest]` (jedyna trasa, która
 * łapie niedopasowane ścieżki pod ważnym locale), więc język ekranu jest
 * językiem TRASY, nie przeglądarki.
 *
 * Renderuje się w ROOT layoucie `[locale]` — POZA shellem panelu, czyli bez
 * belki z jej `h1` (ADR-060). Dlatego, w odróżnieniu od kontekstowych 404
 * podstron (`NotFoundScreen`, h2 pod belką), ten ekran niesie WŁASNY `h1` —
 * i jest on jedynym na stronie. Układ: wzorzec ekranów samodzielnych
 * (`/dostep-cofniety`): wycentrowana kolumna, bez nawigacji, której guardy
 * i tak by odmówiły.
 *
 * Kod i tytuł WSPÓŁDZIELONE z kontekstowymi 404 (`orders.notFound.*`,
 * kontrakt artefaktu P4) — jeden wzorzec treści, trzy wyjścia: pulpit tu,
 * katalog i zamówienia na ekranach kontekstowych.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("orders.notFound");
  const notFound = await getTranslations("notFound");

  return (
    <main
      data-screen="not-found"
      className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-muted-foreground text-2xl font-semibold tabular-nums">{t("code")}</p>
      <h1 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <Button asChild>
        <Link href="/">{notFound("backToDashboard")}</Link>
      </Button>
    </main>
  );
}
