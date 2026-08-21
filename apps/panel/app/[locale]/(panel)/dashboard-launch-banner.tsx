import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Kompaktowy baner „Dokończ uruchomienie" na pulpicie (wariant C, ADR-228).
 *
 * Zastępuje pełną kartę checklisty (UX1, ADR-140): pełny przepływ konfiguracji
 * przeniósł się do dedykowanego huba `/uruchomienie`, a pulpit niesie tylko
 * zaproszenie z małym pierścieniem postępu WYMAGANYCH kroków i jednym CTA.
 * O widoczności decyduje warstwa I/O (`isLaunchComplete`) — po komplecie
 * baner znika, jak dawniej karta.
 *
 * `h2` pod jedynym `h1` belki (ADR-060/M-A11Y-01). Pierścień jest `aria-hidden`
 * — jego odpowiednik niesie tekst „N z M kroków gotowych".
 */

const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function DashboardLaunchBanner({ done, total }: { done: number; total: number }) {
  const t = useTranslations("launch.banner");

  return (
    <section
      data-dashboard-section="launch"
      data-launch-banner
      className="border-border bg-card flex flex-wrap items-center gap-4 rounded-lg border p-4"
    >
      <MiniRing done={done} total={total} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("progress", { done, total })}
        </p>
      </div>
      <Link
        href="/uruchomienie"
        data-launch-banner-cta
        className={cn(
          "bg-primary text-primary-foreground inline-flex shrink-0 cursor-pointer items-center rounded-md border border-transparent px-3.5 py-2 text-[13px] leading-none font-semibold transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px]",
          focusRing,
        )}
      >
        {t("cta")}
      </Link>
    </section>
  );
}

/** Mały pierścień postępu — `strokeDashoffset` niesie wypełnienie (nie szerokość). */
function MiniRing({ done, total }: { done: number; total: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? done / total : 0;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 40"
      className="text-primary size-10 shrink-0"
      data-launch-banner-ring={done}
    >
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        strokeWidth="4"
        className="text-border stroke-current"
      />
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-current"
        transform="rotate(-90 20 20)"
        style={{
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - ratio),
        }}
      />
      <text
        x="20"
        y="20"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[11px] font-semibold tabular-nums"
      >
        {done}/{total}
      </text>
    </svg>
  );
}
