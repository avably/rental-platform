import { Link } from "@/i18n/navigation";

/**
 * Nagłówek ekranu panelu (ADR-058).
 *
 * Jedno miejsce zamiast powtarzanego w każdym pliku bloku „powrót + tytuł +
 * akcje". Ekrany sprzed shella (P3) opakowywały się we WŁASNY
 * `<main class="min-h-screen … p-6">` — po ADR-056 `<main>` daje layout
 * shella, więc zagnieżdżony drugi był i niepoprawny (dwa `main` w drzewie),
 * i dokładał drugi komplet marginesów. Ten komponent zostawia samą treść.
 *
 * Link powrotu jest OSOBNY od tytułu i stoi NAD nim: to nawigacja w górę
 * hierarchii, a nie akcja ekranu.
 */
export function ScreenHeader({
  back,
  title,
  actions,
}: {
  back?: { href: string; label: string };
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-2 flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground w-fit rounded-sm text-sm no-underline outline-none transition-[color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Sekcja w obrębie ekranu — karta z obrysem, bez cienia (ADR-053 D5:
 * powierzchnie rozdziela obrys, nie uniesienie).
 */
export function ScreenSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-border bg-card flex flex-col gap-4 rounded-lg border p-5 ${className ?? ""}`}
    >
      {title ? (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-[13px] leading-[18px]">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
