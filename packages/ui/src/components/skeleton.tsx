import * as React from "react";

import { cn } from "../lib/cn";

// Wzorzec loading z sekcji 07 artefaktu Fazy 2: pasek 14px na powierzchni
// secondary z promieniem 6px. ŚWIADOMIE statyczny — twardy zakaz artefaktu
// (extra-loops): poza rail LP i reklamą nie ma nieskończonych animacji,
// więc bez animate-pulse. Poza drzewem dostępności (aria-hidden).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("h-3.5 rounded-[6px] bg-secondary", className)}
      {...props}
    />
  );
}

export { Skeleton };
