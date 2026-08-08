"use client";

/**
 * Instrukcja podłączenia WordPressa (M2, ADR-110) — sekcja ekranu
 * /ustawienia-api tuż pod listą kluczy.
 *
 * DLACZEGO TUTAJ, a nie w osobnym ekranie: instrukcja jest bezwartościowa bez
 * klucza, a klucz powstaje NA TYM ekranie i widać go DOKŁADNIE RAZ. Operator
 * ma przed sobą jedną ścieżkę: wygeneruj → zainstaluj → wklej → wstaw
 * shortcode; rozbicie na dwa ekrany kazałoby mu wracać po sekret, którego
 * już nie zobaczy.
 *
 * Kopiowanie shortcode'u wzorcem CopyButton z karty klienta (schowek bywa
 * niedostępny na http — brak wyjątku do UI, tekst zostaje zaznaczalny).
 */
import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";

const SHORTCODE = "[avably_booking]";

function CopyShortcode() {
  const t = useTranslations("apiSettings.wordpress");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* font-sans JAWNIE: kontrakt typografii nie pozwala `code` bez klasy
          spaść na Preflightowy ui-monospace (wzorzec bloku klucza wyżej). */}
      <code
        data-wordpress-shortcode
        className="bg-muted rounded-md px-3 py-2 font-sans text-sm break-all select-all"
      >
        {SHORTCODE}
      </code>
      <Button
        type="button"
        variant="secondary"
        data-copy-shortcode
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(SHORTCODE);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // Schowek bywa niedostępny (brak uprawnień, http) — kod obok
            // pozostaje zaznaczalny, więc ścieżka ręczna działa dalej.
          }
        }}
      >
        {copied ? t("copied") : t("copyCta")}
      </Button>
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

export function WordPressGuide({
  hasActiveKey,
  pluginDownloadHref,
  pluginFilename,
  pluginVersion,
}: {
  hasActiveKey: boolean;
  /** Adres trasy pobierania (z prefiksem locale — składa go strona serwerowa). */
  pluginDownloadHref: string;
  pluginFilename: string;
  pluginVersion: string;
}) {
  const t = useTranslations("apiSettings.wordpress");

  return (
    <ScreenSection data-wordpress-guide title={t("title")} description={t("intro")}>
      <ol className="flex flex-col gap-5">
        <Step number={1} title={t("step1Title")}>
          <p>{hasActiveKey ? t("step1DoneBody") : t("step1Body")}</p>
        </Step>

        <Step number={2} title={t("step2Title")}>
          <p>{t("step2Body")}</p>
          {/* Pobranie idzie ZWYKŁYM linkiem (a nie fetchem): przeglądarka
              sama obsłuży Content-Disposition, a operator może ponowić je
              z historii. `download` podpowiada nazwę pliku także wtedy, gdy
              przeglądarka zignoruje nagłówek. */}
          <p>
            <Button asChild variant="secondary">
              <a href={pluginDownloadHref} download={pluginFilename} data-plugin-download>
                {t("downloadCta", { version: pluginVersion })}
              </a>
            </Button>
          </p>
          <p>{t("step2Activate")}</p>
        </Step>

        <Step number={3} title={t("step3Title")}>
          <p>{t("step3Body")}</p>
          <CopyShortcode />
          <p>{t("step3Hint")}</p>
        </Step>
      </ol>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <p className="text-foreground font-medium">{t("troubleTitle")}</p>
        <dl className="text-muted-foreground flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground">{t("troubleKeyTitle")}</dt>
            <dd>{t("troubleKeyBody")}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground">{t("troubleSuspendedTitle")}</dt>
            <dd>{t("troubleSuspendedBody")}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground">{t("troubleCacheTitle")}</dt>
            <dd>{t("troubleCacheBody")}</dd>
          </div>
        </dl>
      </div>
    </ScreenSection>
  );
}
