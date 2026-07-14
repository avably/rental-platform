import * as React from "react";

import { cn } from "../lib/cn";

function Separator({ className, ...props }: React.ComponentProps<"hr">) {
  return (
    <hr
      data-slot="separator"
      role="separator"
      aria-orientation="horizontal"
      className={cn("border-0 border-t border-border", className)}
      {...props}
    />
  );
}

export { Separator };
