import * as React from "react";

import { cn } from "../lib/cn";
import type { StatusTone } from "../lib/status-semantics";

// Chip statusu wg artefaktu Fazy 2 (sekcja 04/07): wysokość 28px, promień
// 10px, obrys 1px, tekst 500 13/1. Kolory wyłącznie tokenami --status-*
// (kopia .chip-* artefaktu, kontrakt w status-contract.test.ts).
const toneClasses: Record<StatusTone, string> = {
  neutral:
    "bg-status-neutral-bg text-status-neutral-fg border-status-neutral-border",
  attention:
    "bg-status-attention-bg text-status-attention-fg border-status-attention-border",
  positive:
    "bg-status-positive-bg text-status-positive-fg border-status-positive-border",
  problem:
    "bg-status-problem-bg text-status-problem-fg border-status-problem-border",
};

interface StatusBadgeProps
  extends Omit<React.ComponentProps<"span">, "children"> {
  tone: StatusTone;
  /* Twardy zakaz artefaktu (color-only-status): status zawsze zawiera tekst
     konkretnej wartości — dlatego children to wymagany string, nie ReactNode. */
  children: string;
}

function StatusBadge({ tone, className, children, ...props }: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex h-7 items-center rounded-sm border px-2.5 text-[13px] leading-none font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export { StatusBadge, type StatusBadgeProps };
