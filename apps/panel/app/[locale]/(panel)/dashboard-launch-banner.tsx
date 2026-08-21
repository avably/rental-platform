import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { PublishBlocker } from "@/lib/onboarding/launch";

/**
 * Karta „Dokończ uruchomienie" na pulpicie (wariant C, ADR-228; podniesiona do
 * mocniejszej KARTY solid-limonka w ADR-229).
 *
 * Na ROOT pulpicie karta PRZEJMUJE rolę ciągłego paska przewodnika (ten się tam
 * nie renderuje — bez dubla): mocniejszy akcent, pierścień postępu WYMAGANYCH
 * kroków, chipy braków minimum sprzedażowego i jedno CTA do huba. O widoczności
 * decyduje warstwa I/O (`isLaunchComplete`) — po komplecie karta znika, jak
 * dawniej. `blockers` to te same braki, którymi żyje overlay paska: JEDNO
 * ŹRÓDŁO PRAWDY, policzone z tego samego odczytu sygnałów (zero nowych zapytań).
 *
 * `h2` pod jedynym `h1` belki (ADR-060/M-A11Y-01). Pierścień jest `aria-hidden`
 * — jego odpowiednik niesie tekst „N z M kroków gotowych".
 */

const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground";

export function DashboardLaunchBanner({
  done,
  total,
  blockers = [],
}: {
  done: number;
  total: number;
  /** Braki minimum sprzedażowego (regulamin/produkt/dostawa) — chipy karty. */
  blockers?: readonly PublishBlocker[];
}) {
  const t = useTranslations("launch");

  return (
    <section
      data-dashboard-section="launch"
      data-launch-banner
      className="bg-primary text-primary-foreground flex flex-wrap items-center gap-4 rounded-lg p-4"
    >
      <MiniRing done={done} total={total} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{t("banner.title")}</h2>
        <p className="text-primary-foreground/80 text-sm">
          {t("banner.progress", { done, total })}
        </p>
        {blockers.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-primary-foreground/80 text-xs font-medium">
              {t("hub.blockersLabel")}
            </span>
            {blockers.map((blocker) => (
              <span
                key={blocker}
                data-launch-banner-blocker={blocker}
                className="border-primary-foreground/25 bg-primary-foreground/5 text-primary-foreground inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
              >
                {t(`publish.blocker.${blocker}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Link
        href="/uruchomienie"
        data-launch-banner-cta
        className={cn(
          "bg-primary-foreground text-primary inline-flex shrink-0 cursor-pointer items-center rounded-md border border-transparent px-3.5 py-2 text-[13px] leading-none font-semibold transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px]",
          focusRing,
        )}
      >
        {t("banner.cta")}
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
      className="text-primary-foreground size-10 shrink-0"
      data-launch-banner-ring={done}
    >
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        strokeWidth="4"
        className="stroke-current opacity-20"
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
        className="fill-current text-[11px] font-semibold tabular-nums"
      >
        {done}/{total}
      </text>
    </svg>
  );
}
