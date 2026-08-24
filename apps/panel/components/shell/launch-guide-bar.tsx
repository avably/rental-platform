"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import type { LaunchGuideState } from "@/lib/onboarding/launch";
import {
  LAUNCH_GUIDE_COOKIE,
  LAUNCH_GUIDE_MAX_AGE_SECONDS,
} from "@/lib/shell/launch-guide-collapse";

/**
 * CIĄGŁY PRZEWODNIK URUCHOMIENIA — sticky pasek pod topbarem, obecny na KAŻDEJ
 * stronie panelu, prowadzący aż do publikacji (hybryda A, ADR-229).
 *
 * DANE (jedno źródło prawdy): `state` przychodzi z JEDNEGO odczytu layoutu
 * (`readLaunchGuideState`) — tego samego, którym żyje badge nawigacji. Pasek
 * nie robi ŻADNEGO własnego zapytania: postęp, następny krok i braki są już
 * policzone. Overlay „Zobacz wszystko" pokazuje `blockers`, które MA W RĘKU
 * (bez fetch-on-expand).
 *
 * KOLOR: czarny + limonka (traktowanie 2) — ciemny zielono-czarny pasek,
 * akcenty limonką marki (pierścień, „następny krok", CTA). Świadomie INNY od
 * limonkowego TINTU aktywnej nawigacji (`bg-accent`), żeby „gdzie stoję" się
 * nie rozmyło. Cała paleta paska mieszka w nazwanych tokenach `--launch-bar-*`
 * (globals.css, ADR-257): strukturalne tło/obrys mają wariant jasny i ciemny
 * na `.dark`, akcent i tekst są między motywami niezmienne (jak dotąd) —
 * dlatego komponent nie potrzebuje już wariantów `dark:`. Zero literałów hex:
 * pilnuje tego `panel-visual-direction-contract`.
 *
 * ZASIĘG: wszędzie, GDZIE layout liczy badge, Z WYJĄTKIEM ROOT PULPITU `/` —
 * tam mocniejsza KARTA solid-limonka (`DashboardLaunchBanner`) przejmuje rolę,
 * więc pasek się NIE renderuje (bez dubla karta+pasek). Layout jest serwerowy
 * i nie zna ścieżki, więc decyzję podejmuje komponent (`usePathname`).
 *
 * ZWIJANIE (bez snooze): „–" zwija do HAIRLINE (cienki pasek postępu z „1/7"),
 * klik w hairline rozwija. Stan trzyma CIASTECZKO (SSR-spójne, `initialCollapsed`
 * z layoutu) — zero flash-a rozwiniętego paska. Trwałe zniknięcie WYŁĄCZNIE po
 * komplecie wymaganych kroków: wtedy `state` z layoutu jest `null` i layout
 * paska w ogóle nie montuje (parytet z badge/banerem — `isLaunchComplete`).
 *
 * FAIL-SILENT: brak danych → layout nie renderuje; na `/` → `null`. Nigdy nie
 * blokuje treści.
 */
export function LaunchGuideBar({
  state,
  initialCollapsed,
}: {
  state: LaunchGuideState;
  initialCollapsed: boolean;
}) {
  const t = useTranslations("launch");
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(!initialCollapsed);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const overlayId = useId();

  // ROOT PULPIT: kartę solid-limonka przejmuje `DashboardLaunchBanner`, pasek
  // się nie dubluje (decyzja właściciela). `usePathname` z next-intl zwraca
  // ścieżkę BEZ prefiksu locale, więc porównanie jest wprost.
  if (pathname === "/") return null;

  const { progress, nextStep, blockers } = state;
  const progressText = t("hub.progress", { done: progress.done, total: progress.total });

  function collapse(next: boolean) {
    setExpanded(!next);
    if (next) setOverlayOpen(false);
    // Ciasteczko zamiast localStorage: layout czyta je przy renderze serwera,
    // więc następna nawigacja oddaje od razu poprawny wariant (zero flash-a).
    document.cookie = `${LAUNCH_GUIDE_COOKIE}=${
      next ? "collapsed" : "expanded"
    }; path=/; max-age=${LAUNCH_GUIDE_MAX_AGE_SECONDS}; samesite=lax`;
  }

  const nextStepLabel = nextStep ? t(`steps.${nextStep.key}.title`) : null;

  return (
    <section
      data-launch-guide-bar
      data-launch-guide-collapsed={expanded ? "false" : "true"}
      aria-label={t("guide.regionLabel")}
      className="sticky top-0 z-30 border-b border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] text-[var(--launch-bar-fg)]"
    >
      {/* ===== DESKTOP / TABLET (rail obecny) ===== */}
      <div className="relative hidden sm:block">
        {expanded ? (
          <div className="flex items-center gap-3 px-4 py-2 md:px-6">
            <ProgressRing done={progress.done} total={progress.total} />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-sm font-semibold tracking-[-0.01em]">
                {t("banner.title")}
              </span>
              {/* Tekstowy odpowiednik pierścienia (pierścień jest aria-hidden). */}
              <span className="sr-only" data-launch-guide-progress={`${progress.done}/${progress.total}`}>
                {progressText}
              </span>
              {nextStepLabel ? (
                <span className="text-[13px] text-[var(--launch-bar-muted)]">
                  {t("guide.nextStep")}{" "}
                  <span className="font-semibold text-[var(--launch-bar-accent)]">{nextStepLabel}</span>
                </span>
              ) : null}
            </div>
            {nextStep ? (
              <Link
                href={nextStep.href}
                data-launch-guide-cta
                className="inline-flex shrink-0 cursor-pointer items-center rounded-md bg-[var(--launch-bar-accent)] px-3.5 py-1.5 text-[13px] leading-none font-semibold text-[var(--launch-bar-accent-foreground)] transition-[background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--launch-bar-accent-hover)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]"
              >
                {t("guide.finishStep")}
              </Link>
            ) : null}
            <button
              type="button"
              data-launch-guide-see-all
              aria-expanded={overlayOpen}
              aria-controls={overlayId}
              onClick={() => setOverlayOpen((open) => !open)}
              className={secondaryButtonClass}
            >
              {t("guide.seeAll")}
              <Chevron direction={overlayOpen ? "up" : "down"} />
            </button>
            <button
              type="button"
              data-launch-guide-collapse
              aria-label={t("guide.collapse")}
              onClick={() => collapse(true)}
              className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-[var(--launch-bar-muted)] outline-none transition-[background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-white/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]"
            >
              <MinusGlyph />
            </button>
          </div>
        ) : (
          <HairlineButton
            done={progress.done}
            total={progress.total}
            label={t("guide.expand")}
            onExpand={() => collapse(false)}
          />
        )}

        {/* OVERLAY „Zobacz wszystko" — dropdown NAD treścią (absolute, bez
            push-down). Cały pasek to jedna paczka malowania (`z-30` na sekcji
            ustanawia kontekst układania), więc overlay wygrywa z treścią. */}
        {expanded && overlayOpen ? (
          <div
            id={overlayId}
            data-launch-guide-overlay
            className="absolute inset-x-0 top-full border-b border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] px-4 py-3 shadow-lg md:px-6"
          >
            <p className="text-xs font-medium text-[var(--launch-bar-muted)]">
              {blockers.length > 0 ? t("hub.blockersLabel") : t("hub.sellable")}
            </p>
            {blockers.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {blockers.map((blocker) => (
                  <span
                    key={blocker}
                    data-launch-guide-blocker={blocker}
                    className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-[var(--launch-bar-fg)]"
                  >
                    {t(`publish.blocker.${blocker}`)}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <Link
                href="/uruchomienie"
                data-launch-guide-hub
                className="text-[13px] font-medium text-[var(--launch-bar-accent)] underline underline-offset-[3px] outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]"
              >
                {t("guide.openHub")}
              </Link>
              <button
                type="button"
                data-launch-guide-overlay-collapse
                onClick={() => setOverlayOpen(false)}
                className={secondaryButtonClass}
              >
                {t("guide.collapse")}
                <Chevron direction="up" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ===== MOBILE (<sm, brak railu): hairline → bottom-sheet ===== */}
      <div className="sm:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            data-launch-guide-mobile-trigger
            aria-label={t("guide.expand")}
            className="flex w-full cursor-pointer flex-col gap-1 px-4 py-1.5 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--launch-bar-accent)]"
          >
            <span className="flex items-center justify-between text-[11px] font-medium text-[var(--launch-bar-muted)]">
              <span className="truncate">{t("banner.title")}</span>
              <span className="shrink-0 tabular-nums" data-launch-guide-progress={`${progress.done}/${progress.total}`}>
                {progress.done}/{progress.total}
              </span>
            </span>
            <HairlineTrack done={progress.done} total={progress.total} />
          </SheetTrigger>
          <SheetContent
            side="bottom"
            data-launch-guide-sheet
            className="gap-3 border-t border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-[var(--launch-bar-fg)]"
          >
            <SheetTitle className="text-[var(--launch-bar-fg)]">{t("banner.title")}</SheetTitle>
            <SheetDescription className="text-[var(--launch-bar-muted)]">{progressText}</SheetDescription>
            <div className="flex items-center gap-3">
              <ProgressRing done={progress.done} total={progress.total} />
              {nextStepLabel ? (
                <span className="text-sm text-[var(--launch-bar-muted)]">
                  {t("guide.nextStep")}{" "}
                  <span className="font-semibold text-[var(--launch-bar-accent)]">{nextStepLabel}</span>
                </span>
              ) : null}
            </div>
            {blockers.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {blockers.map((blocker) => (
                  <span
                    key={blocker}
                    data-launch-guide-blocker={blocker}
                    className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-[var(--launch-bar-fg)]"
                  >
                    {t(`publish.blocker.${blocker}`)}
                  </span>
                ))}
              </div>
            ) : null}
            {nextStep ? (
              <Link
                href={nextStep.href}
                data-launch-guide-cta
                onClick={() => setSheetOpen(false)}
                className="inline-flex w-full cursor-pointer items-center justify-center rounded-md bg-[var(--launch-bar-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--launch-bar-accent-foreground)] transition-[background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--launch-bar-accent-hover)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]"
              >
                {t("guide.finishStep")}
              </Link>
            ) : null}
            <Link
              href="/uruchomienie"
              data-launch-guide-hub
              onClick={() => setSheetOpen(false)}
              className="text-center text-[13px] font-medium text-[var(--launch-bar-accent)] underline underline-offset-[3px] outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]"
            >
              {t("guide.openHub")}
            </Link>
          </SheetContent>
        </Sheet>
      </div>
    </section>
  );
}

const secondaryButtonClass =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[13px] font-medium text-[var(--launch-bar-fg)] outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-white/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--launch-bar-accent)]";

/** Hairline zwiniętego paska (desktop): cienki pasek postępu z „N/M". Klikalny. */
function HairlineButton({
  done,
  total,
  label,
  onExpand,
}: {
  done: number;
  total: number;
  label: string;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      data-launch-guide-hairline
      aria-label={label}
      onClick={onExpand}
      className="flex w-full cursor-pointer items-center gap-2 px-4 py-1 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--launch-bar-accent)] md:px-6"
    >
      <HairlineTrack done={done} total={total} />
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--launch-bar-muted)]">
        {done}/{total}
      </span>
    </button>
  );
}

/** Sam pasek wypełnienia postępu — „hairline" ~6px, wypełnienie limonką. */
function HairlineTrack({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? done / total : 0;
  return (
    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/12">
      <span
        className="block h-full rounded-full bg-[var(--launch-bar-accent)]"
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </span>
  );
}

/**
 * Pierścień postępu WYMAGANYCH kroków. `aria-hidden` — dana (ułamek), nie treść;
 * `strokeDashoffset` (nie szerokość) niesie wypełnienie. Wzorzec `MiniRing`
 * z karty pulpitu, przemalowany na limonkę marki na ciemnym pasku.
 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? done / total : 0;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="size-8 shrink-0"
      data-launch-guide-ring={done}
    >
      <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="3.5" stroke="rgba(255,255,255,0.16)" />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        transform="rotate(-90 16 16)"
        style={{
          stroke: "var(--launch-bar-accent)",
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - ratio),
        }}
      />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[10px] font-semibold tabular-nums"
        style={{ fill: "var(--launch-bar-fg)" }}
      >
        {done}/{total}
      </text>
    </svg>
  );
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={direction === "up" ? "M4 10L8 6L12 10" : "M4 6L8 10L12 6"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MinusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8H12.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
