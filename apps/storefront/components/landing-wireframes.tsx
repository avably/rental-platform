interface LandingWireframeProps {
  ariaLabel: string;
  items: readonly string[];
  label: string;
}

export function LandingWireframe({ ariaLabel, items, label }: LandingWireframeProps) {
  const [title, subject, ...details] = items;

  return (
    <div
      aria-label={ariaLabel}
      className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-md"
      role="img"
    >
      <div className="border-b border-border bg-muted px-4 py-3 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          {subject ? <p className="font-semibold">{subject}</p> : null}
        </div>
        <div className="grid gap-2">
          {details.map((detail, index) => (
            <div
              className="flex min-h-11 items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2 text-sm"
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
