import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

// Stany sekcji 07 artefaktu: hover = podkreślenie (bez zmiany tła), focus =
// obrys 3px na limonce z nośnikiem foreground, active = translacja 1px,
// disabled = obrys kreskowany w kolorze tekstu + cursor not-allowed (bez
// zbijania opacity), loading = aria-busy + cursor progress. Przejścia na
// tokenach motion; zero cieni i ringów box-shadow.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-semibold outline-none transition-[color,background-color,border-color,text-decoration-color,outline-color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:hover:underline not-disabled:hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:border-dashed disabled:border-current aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border-input bg-background",
        secondary: "bg-secondary text-secondary-foreground",
        ghost: "",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /* Stan loading sekcji 07: aria-busy + cursor progress + wielokropek za
       etykietą (artefakt nie używa spinnera — zakaz nieskończonych pętli). */
    loading?: boolean;
  }) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      data-slot="button"
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && !asChild ? (
        <>
          {children}
          <span aria-hidden="true"> …</span>
        </>
      ) : (
        children
      )}
    </Component>
  );
}

export { Button, buttonVariants };
