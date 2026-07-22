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
/**
 * Sam link powrotu (`.secondary-back` z artefaktu Fazy 2).
 *
 * Ekrany, których tytuł niesie belka (ADR-060), nie mają czego dać
 * `ScreenHeader` — zostaje im wyłącznie nawigacja w górę hierarchii. Zanim to
 * powstało, każdy taki ekran pisał własną kotwicę z własnym stylem i własnym
 * wyrównaniem (raz do prawej, raz do lewej).
 */
export function ScreenBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground w-fit rounded-sm text-sm no-underline outline-none transition-[color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
    >
      {label}
    </Link>
  );
}

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
      {back ? <ScreenBackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Sekcja w obrębie ekranu — karta z obrysem, bez cienia (ADR-053 D5:
 * powierzchnie rozdziela obrys, nie uniesienie).
 *
 * P8 dokłada `status`: chip stanu stoi w JEDNYM wierszu z tytułem karty,
 * dokładnie jak `.secondary-card-title` w artefakcie Fazy 2. Wcześniej ekrany
 * drugorzędne pisały stan zdaniem w akapicie („Transport e-maili: dostępny."),
 * więc ten sam rodzaj faktu wyglądał na każdym ekranie inaczej i nie dawał się
 * odczytać jednym spojrzeniem.
 */
export function ScreenSection({
  title,
  status,
  description,
  children,
  className,
  ...rest
}: {
  title?: string;
  status?: React.ReactNode;
  description?: React.ReactNode;
  /* Opcjonalne: karta bywa samym stanem — tytuł, chip i zdanie wyjaśnienia,
     bez treści pod spodem (karta dostępności rejestracji, karta organizacji). */
  children?: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"section">, "title" | "children" | "className">) {
  return (
    <section
      className={`border-border bg-card flex flex-col gap-4 rounded-lg border p-5 ${className ?? ""}`}
      {...rest}
    >
      {title || status || description ? (
        <div className="flex flex-col gap-1.5">
          {/* Sam opis też jest pełnoprawną kartą (reguła dostępu, wariant
              pusty, ostrzeżenie o wysyłce). Warunek na samym tytule gubił jej
              treść i zostawiał na ekranie pustą ramkę. */}
          {title || status ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {title ? (
                <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{title}</h2>
              ) : null}
              {status}
            </div>
          ) : null}
          {description ? (
            <p className="text-muted-foreground text-[13px] leading-[18px]">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
