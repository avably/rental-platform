interface LandingWireframeProps {
  ariaLabel: string;
  items: readonly string[];
  label: string;
  variant?: "default" | "hero";
}

export function LandingWireframe({ ariaLabel, items, label, variant = "default" }: LandingWireframeProps) {
  const [title, subject, ...details] = items;
  const hero = variant === "hero";

  return (
    <div
      aria-label={ariaLabel}
      className={`overflow-hidden border border-border bg-card text-card-foreground shadow-md ${
        hero ? "rounded-[2rem]" : "rounded-xl"
      }`}
      data-wireframe-variant={variant}
      role="img"
    >
      <div
        className={`border-b border-border bg-muted px-4 py-3 text-xs font-medium text-muted-foreground ${
          hero ? "sr-only" : ""
        }`}
      >
        {label}
      </div>
      <div className={`grid gap-4 ${hero ? "p-8 sm:p-12" : "p-5 sm:p-6"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          {subject ? <p className="font-semibold">{subject}</p> : null}
        </div>
        <div className={hero ? "grid grid-cols-2 gap-3 md:grid-cols-3" : "grid gap-2"}>
          {details.map((detail, index) => (
            <div
              className={`flex items-center justify-between gap-4 border border-border bg-background px-3 py-2 text-sm ${
                hero ? "min-h-20 rounded-xl" : "min-h-11 rounded-md"
              }`}
              key={detail}
            >
              <span>{detail}</span>
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${index === details.length - 1 ? "bg-foreground" : "bg-muted-foreground/40"}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
