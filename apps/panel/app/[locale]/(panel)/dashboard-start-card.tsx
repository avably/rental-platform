import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { StartStep, StartStepKey } from "@/lib/dashboard/start-card";

/**
 * Karta „Zacznij tutaj" (UX1, ADR-140) — KOMPONENT PREZENTACYJNY.
 *
 * Stany kroków przychodzą policzone z danych (`lib/dashboard/start-card.ts`)
 * — tu wyłącznie malowanie: postęp jawny („N z 6 zrobione"), krok spełniony
 * ze znacznikiem i bez wyróżnionego linku, PIERWSZY niespełniony krok jako
 * jedyny wyróżniony przycisk (czarny — jeden następny krok naraz), pozostałe
 * niespełnione jako zwykłe linki. Karta w ogóle nie renderuje się po
 * komplecie — o tym decyduje warstwa I/O (`isStartComplete`), nie ten plik.
 *
 * Każdy krok mówi SKUTEK, nie ustawienie (copy zbiera zdania z ekranów
 * docelowych — zalecenie audytu W1). Kolejność: fundament (produkt → sklep)
 * → konfiguracja sprzedaży (umowy → e-maile → płatności) → pierwsze
 * zamówienie, które zamyka listę (korekta właściciela: testowe zamówienie
 * na końcu przechodzi PEŁNY, skonfigurowany cykl najmu).
 */

const STEP_HREFS: Record<StartStepKey, string> = {
  product: "/katalog/nowy",
  store: "/strona",
  contract: "/ustawienia-umow",
  emails: "/ustawienia-emaili",
  payments: "/ustawienia-platnosci",
  firstOrder: "/zamowienia/nowe",
};

const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function DashboardStartCard({
  steps,
  productDetail,
}: {
  steps: readonly StartStep[];
  /** Opcjonalny opis zrobionego kroku 1 (nazwa produktu + egzemplarze). */
  productDetail?: string;
}) {
  const t = useTranslations("home.dashboard.start");
  const doneCount = steps.filter((step) => step.done).length;
  const firstOpenKey = steps.find((step) => !step.done)?.key;

  return (
    <section
      data-dashboard-section="start"
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold tracking-[-0.01em]">{t("title")}</h3>
        <span className="text-muted-foreground text-xs">{t("caption")}</span>
      </div>

      {/* Postęp jawny: pasek + „N z 6 zrobione". Wypełnienie paska to DANA
          (ułamek kroków), nie szerokość layoutu — stąd scaleX na pełnym pasku
          (kontrakt spójności ekranów ADR-060 zakazuje width w inline style). */}
      <div className="flex items-center gap-3">
        <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
          <div
            data-start-progress={doneCount}
            className="bg-primary h-full w-full origin-left rounded-full"
            style={{ transform: `scaleX(${doneCount / steps.length})` }}
          />
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {t("progress", { done: doneCount, total: steps.length })}
        </span>
      </div>

      <ol className="divide-border flex flex-col divide-y">
        {steps.map((step, index) => (
          <StartStepRow
            key={step.key}
            step={step}
            index={index + 1}
            highlighted={step.key === firstOpenKey}
            detail={step.key === "product" && step.done ? productDetail : undefined}
          />
        ))}
      </ol>
    </section>
  );
}

function StartStepRow({
  step,
  index,
  highlighted,
  detail,
}: {
  step: StartStep;
  index: number;
  highlighted: boolean;
  detail?: string;
}) {
  const t = useTranslations("home.dashboard.start");

  return (
    <li
      data-start-step={step.key}
      data-start-done={step.done ? "true" : "false"}
      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          step.done
            ? "bg-primary text-primary-foreground"
            : "border-border text-muted-foreground border",
        )}
      >
        {step.done ? <CheckGlyph /> : index}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {t(`steps.${step.key}.title`)}
          {detail ? (
            <span className="text-muted-foreground font-normal"> · {detail}</span>
          ) : null}
        </span>
        {step.done ? null : (
          <span className="text-muted-foreground block text-xs">
            {t(`steps.${step.key}.body`)}
          </span>
        )}
      </span>

      <span className="shrink-0">
        {step.done ? (
          <span data-start-step-done className="text-status-positive-fg text-xs font-semibold">
            {t("done")}
          </span>
        ) : highlighted ? (
          <Link
            href={STEP_HREFS[step.key]}
            data-start-step-cta={step.key}
            className={cn(
              "bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-3.5 py-2 text-[13px] leading-none font-semibold transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px]",
              focusRing,
            )}
          >
            {t(`steps.${step.key}.cta`)}
          </Link>
        ) : (
          <Link
            href={STEP_HREFS[step.key]}
            data-start-step-link={step.key}
            className={cn(
              "text-sm font-medium underline underline-offset-[3px]",
              focusRing,
            )}
          >
            {t(`steps.${step.key}.link`)}
          </Link>
        )}
      </span>
    </li>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
