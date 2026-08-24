import { cn } from "@avably/ui";

import { BRAND_COLORS, BrandWordmark } from "./brand-mark";

export type BrandLoaderProps = {
  label: string;
  variant?: "full" | "compact";
  showLabel?: boolean;
  className?: string;
};

/** Kontekstowy wskaźnik oczekiwania; nie jest wariantem statycznego logo. */
export function BrandLoader({
  label,
  variant = "full",
  showLabel = false,
  className,
}: BrandLoaderProps) {
  return (
    <div
      role="status"
      data-brand-loader
      data-brand-loader-variant={variant}
      className={cn("flex flex-col items-center justify-center gap-3", className)}
    >
      {variant === "full" ? <FullLoaderGraphic /> : <CompactLoaderGraphic />}
      <span
        data-brand-loader-label
        className={showLabel ? "text-muted-foreground text-center text-sm" : "sr-only"}
      >
        {label}
      </span>
    </div>
  );
}

function FullLoaderGraphic() {
  return (
    <svg
      viewBox="0 0 348 93"
      aria-hidden="true"
      focusable="false"
      data-brand-loader-graphic
      className="h-auto w-[174px] max-w-full"
    >
      <rect
        data-brand-loader-capsule
        x="0"
        y="0"
        width="348"
        height="93"
        rx="46.5"
        fill={BRAND_COLORS.capsule}
      />
      <g data-brand-loader-dot-position>
        <circle
          data-brand-loader-dot
          cx="57.5"
          cy="46.5"
          r="15"
          fill={BRAND_COLORS.dot}
        />
      </g>
      <BrandWordmark
        className="brand-loader-wordmark"
        pathClassName="brand-loader-letter"
      />
    </svg>
  );
}

function CompactLoaderGraphic() {
  return (
    <svg
      viewBox="0 0 93 93"
      aria-hidden="true"
      focusable="false"
      data-brand-loader-graphic
      className="size-7"
    >
      <circle
        data-brand-loader-compact-circle
        cx="46.5"
        cy="46.5"
        r="46.5"
        fill={BRAND_COLORS.capsule}
      />
      <circle
        data-brand-loader-dot
        cx="46.5"
        cy="46.5"
        r="15"
        fill={BRAND_COLORS.dot}
      />
    </svg>
  );
}
