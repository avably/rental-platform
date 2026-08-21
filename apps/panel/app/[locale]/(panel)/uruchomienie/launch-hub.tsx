import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  firstOpenRequiredKey,
  launchProgress,
  launchSteps,
  publishGateBlockers,
  publishGateSignals,
  type LaunchPhaseId,
  type LaunchSignals,
  type LaunchStep,
  type LaunchStepKey,
  type PublishBlocker,
} from "@/lib/onboarding/launch";

/**
 * Config-first hub „Uruchomienie" (wariant C, ADR-228) — KOMPONENT
 * PREZENTACYJNY. Stany kroków i bramka publikacji liczą się z sygnałów
 * (`lib/onboarding/launch.ts`); tu wyłącznie malowanie.
 *
 * Konspekt pod jedynym `h1` belki (ADR-060): nagłówek huba to `h2`, tytuły
 * faz `h3`, kroki są listą pozycji (nie nagłówkami). Pierścień postępu jest
 * `aria-hidden` — jego odpowiednik niesie tekst „N z M kroków gotowych".
 */

const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

const PHASE_ORDER: readonly LaunchPhaseId[] = [1, 2, 3, 4];

export function LaunchHub({ signals }: { signals: LaunchSignals }) {
  const steps = launchSteps(signals);
  const progress = launchProgress(steps);
  const firstOpen = firstOpenRequiredKey(steps);
  const blockers = publishGateBlockers(publishGateSignals(signals));
  const gateOpen = blockers.length === 0;

  return (
    <div data-launch-hub className="flex flex-col gap-4">
      <HubHeader progress={progress} blockers={blockers} />

      {PHASE_ORDER.map((phase) => (
        <PhaseCard
          key={phase}
          phase={phase}
          steps={steps.filter((step) => step.phase === phase)}
          firstOpen={firstOpen}
        />
      ))}

      <PublishBar gateOpen={gateOpen} blockers={blockers} />
    </div>
  );
}

function HubHeader({
  progress,
  blockers,
}: {
  progress: { done: number; total: number };
  blockers: readonly PublishBlocker[];
}) {
  const t = useTranslations("launch");

  return (
    <section
      data-launch-header
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center"
    >
      <ProgressRing done={progress.done} total={progress.total} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">{t("hub.title")}</h2>
        {/* Odpowiednik tekstowy pierścienia (pierścień jest aria-hidden). */}
        <p data-launch-progress-text className="text-muted-foreground text-sm">
          {t("hub.progress", { done: progress.done, total: progress.total })}
        </p>
        {blockers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              {t("hub.blockersLabel")}
            </span>
            {blockers.map((blocker) => (
              <span
                key={blocker}
                data-launch-blocker={blocker}
                className="border-border text-foreground inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
              >
                {t(`publish.blocker.${blocker}`)}
              </span>
            ))}
          </div>
        ) : (
          <p data-launch-sellable className="text-status-positive-fg text-sm font-medium">
            {t("hub.sellable")}
          </p>
        )}
        <Link
          href="/strona"
          data-launch-preview
          className={cn(
            "text-foreground w-fit text-sm font-medium underline underline-offset-[3px]",
            focusRing,
          )}
        >
          {t("hub.previewLink")}
        </Link>
      </div>
    </section>
  );
}

/**
 * Pierścień postępu WYMAGANYCH kroków. `aria-hidden` — dana (ułamek), nie
 * treść; `strokeDashoffset` (nie szerokość) niesie wypełnienie, więc kontrakt
 * spójności ekranów (zakaz szerokości poza `max-w`) nie ma tu czego złapać.
 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? done / total : 0;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      className="text-primary size-16 shrink-0"
      data-launch-ring={done}
    >
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="6"
        className="text-border stroke-current"
      />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className="stroke-current"
        transform="rotate(-90 32 32)"
        style={{
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - ratio),
        }}
      />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[15px] font-semibold tabular-nums"
      >
        {done}/{total}
      </text>
    </svg>
  );
}

function PhaseCard({
  phase,
  steps,
  firstOpen,
}: {
  phase: LaunchPhaseId;
  steps: readonly LaunchStep[];
  firstOpen: LaunchStepKey | undefined;
}) {
  const t = useTranslations("launch");

  return (
    <section
      data-launch-phase={phase}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <h3 className="text-base font-semibold tracking-[-0.01em]">
        {t(`phases.${phase}.title`)}
      </h3>
      <ol className="divide-border flex flex-col divide-y">
        {steps.map((step) => (
          <StepRow key={step.key} step={step} highlighted={step.key === firstOpen} />
        ))}
      </ol>
    </section>
  );
}

function StepRow({ step, highlighted }: { step: LaunchStep; highlighted: boolean }) {
  const t = useTranslations("launch");

  const stateLabel = step.done
    ? t("state.done")
    : step.gate
      ? t("state.gate")
      : step.optional
        ? t("state.optional")
        : t("state.todo");

  return (
    <li
      data-launch-step={step.key}
      data-launch-done={step.done ? "true" : "false"}
      data-launch-optional={step.optional ? "true" : undefined}
      data-launch-gate={step.gate ? "true" : undefined}
      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
    >
      <StepIcon step={step} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t(`steps.${step.key}.title`)}</span>
          {/* Stan czytany przez czytnik — ikona jest dekoracją (aria-hidden). */}
          <span className="sr-only">{stateLabel}</span>
          {step.gate && !step.done ? (
            <span
              data-launch-tag="gate"
              className="bg-status-attention-bg text-status-attention-fg inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
            >
              {t("state.gate")}
            </span>
          ) : null}
          {step.optional ? (
            <span
              data-launch-tag="optional"
              className="border-border text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
            >
              {t("state.optional")}
            </span>
          ) : null}
        </span>
        {step.done ? null : (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {t(`steps.${step.key}.why`)}
          </span>
        )}
      </span>

      <span className="shrink-0">
        <StepCta step={step} highlighted={highlighted} />
      </span>
    </li>
  );
}

function StepIcon({ step }: { step: LaunchStep }) {
  const base =
    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold";

  if (step.done) {
    return (
      <span aria-hidden="true" className={cn(base, "bg-primary text-primary-foreground")}>
        <CheckGlyph />
      </span>
    );
  }
  if (step.gate) {
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-status-attention-bg text-status-attention-fg")}
      >
        !
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        base,
        step.optional
          ? "border-border text-muted-foreground border border-dashed"
          : "border-border text-muted-foreground border",
      )}
    >
      <span className="bg-current size-1.5 rounded-full" />
    </span>
  );
}

function StepCta({ step, highlighted }: { step: LaunchStep; highlighted: boolean }) {
  const t = useTranslations("launch");

  if (step.done) {
    return (
      <Link
        href={step.href}
        data-launch-step-edit={step.key}
        className={cn("text-sm font-medium underline underline-offset-[3px]", focusRing)}
      >
        {t("cta.edit")}
      </Link>
    );
  }

  if (highlighted) {
    return (
      <Link
        href={step.href}
        data-launch-step-cta={step.key}
        className={cn(
          "bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-3.5 py-2 text-[13px] leading-none font-semibold transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px]",
          focusRing,
        )}
      >
        {t(`steps.${step.key}.cta`)}
      </Link>
    );
  }

  return (
    <Link
      href={step.href}
      data-launch-step-link={step.key}
      className={cn("text-sm font-medium underline underline-offset-[3px]", focusRing)}
    >
      {t("cta.configure")}
    </Link>
  );
}

/**
 * Pasek publikacji (SOFT-GATE, ADR-228). „Opublikuj sklep" jest aktywne
 * DOPIERO, gdy minimum sprzedażowe spełnione — inaczej `disabled` z
 * `aria-describedby` na listę braków. Gdy otwarte: deep-link do `/strona`
 * (tam żyje `PublishDialog`/`publishSite`); publikacji NIE reimplementujemy.
 */
function PublishBar({
  gateOpen,
  blockers,
}: {
  gateOpen: boolean;
  blockers: readonly PublishBlocker[];
}) {
  const t = useTranslations("launch");
  const missingId = "launch-publish-missing";

  return (
    <section
      data-launch-publish
      data-launch-publish-open={gateOpen ? "true" : "false"}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold">{t("publish.title")}</p>
        <p className="text-muted-foreground text-xs">{t("publish.why")}</p>
        {gateOpen ? null : (
          <div id={missingId} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground text-xs font-medium">
              {t("publish.missingLabel")}
            </span>
            {blockers.map((blocker) => (
              <span
                key={blocker}
                data-launch-missing={blocker}
                className="text-foreground text-xs font-medium"
              >
                {t(`publish.blocker.${blocker}`)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0">
        {gateOpen ? (
          <Link
            href="/strona"
            data-launch-publish-cta
            className={cn(
              "bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px]",
              focusRing,
            )}
          >
            {t("publish.cta")}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            data-launch-publish-disabled
            aria-describedby={missingId}
            className="bg-muted text-muted-foreground inline-flex cursor-not-allowed items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold"
          >
            {t("publish.cta")}
          </button>
        )}
      </div>
    </section>
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
