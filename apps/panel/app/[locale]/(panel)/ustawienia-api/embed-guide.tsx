"use client";

/**
 * Osadzenie rezerwacji na dowolnej stronie (M3, ADR-120) — sekcja ekranu
 * /ustawienia-api, tuż pod instrukcją WordPressa.
 *
 * DLACZEGO OBOK WTYCZKI, a nie w osobnym ekranie: to są dwie odpowiedzi na to
 * samo pytanie operatora („jak wpiąć rezerwacje w moją stronę?"), różniące się
 * wyłącznie tym, na czym ta strona stoi. Rozdzielenie ekranów kazałoby mu
 * najpierw wiedzieć, którego narzędzia potrzebuje — a jeśli to wie, i tak
 * wybierze właściwą sekcję.
 *
 * ŚWIADOMIE BEZ POLA NA KLUCZ. W odróżnieniu od wtyczki, embed nie ma czego
 * skonfigurować sekretem — dlatego ta sekcja nie zależy od tego, czy najemca
 * ma aktywny klucz API. Instrukcja jest kompletna sama w sobie.
 */
import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";

function CopyableSnippet({ snippet }: { snippet: string }) {
  const t = useTranslations("apiSettings.embed");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {/* font-sans JAWNIE — kontrakt typografii nie pozwala `code` spaść na
          Preflightowy ui-monospace (ten sam wzorzec co shortcode wyżej). */}
      <code
        data-embed-snippet
        className="bg-muted rounded-md px-3 py-2 font-sans text-sm break-all select-all"
      >
        {snippet}
      </code>
      <div>
        <Button
          type="button"
          variant="secondary"
          data-copy-embed-snippet
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(snippet);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              // Schowek bywa niedostępny (brak uprawnień, http) — fragment
              // obok zostaje zaznaczalny, więc ścieżka ręczna działa dalej.
            }
          }}
        >
          {copied ? t("copied") : t("copyCta")}
        </Button>
      </div>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="bg-muted text-foreground mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
      >
        {number}
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-foreground font-medium">{title}</p>
        <div className="text-muted-foreground flex flex-col gap-2 text-sm">{children}</div>
      </div>
    </li>
  );
}

export function EmbedGuide({
  snippet,
  previewUrl,
}: {
  snippet: string;
  previewUrl: string | null;
}) {
  const t = useTranslations("apiSettings.embed");

  return (
    <ScreenSection data-embed-guide title={t("title")} description={t("intro")}>
      <ol className="flex flex-col gap-5">
        <Step number={1} title={t("step1Title")}>
          <p>{t("step1Body")}</p>
          <CopyableSnippet snippet={snippet} />
        </Step>

        <Step number={2} title={t("step2Title")}>
          <p>{t("step2Body")}</p>
          <p>{t("step2Hint")}</p>
        </Step>

        <Step number={3} title={t("step3Title")}>
          <p>{t("step3Body")}</p>
          {previewUrl !== null ? (
            <p>
              <Button asChild variant="secondary">
                <a href={previewUrl} target="_blank" rel="noreferrer" data-embed-preview>
                  {t("previewCta")}
                </a>
              </Button>
            </p>
          ) : null}
        </Step>
      </ol>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <p className="text-foreground font-medium">{t("optionsTitle")}</p>
        <dl className="text-muted-foreground flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground font-sans">data-avably-product</dt>
            <dd>{t("optionProduct")}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground font-sans">data-avably-lang</dt>
            <dd>{t("optionLang")}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground font-sans">data-avably-theme</dt>
            <dd>{t("optionTheme")}</dd>
          </div>
        </dl>
      </div>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <p className="text-foreground font-medium">{t("safetyTitle")}</p>
        <p className="text-muted-foreground text-sm">{t("safetyBody")}</p>
      </div>
    </ScreenSection>
  );
}
