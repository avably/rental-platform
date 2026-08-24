import { Link } from "@/i18n/navigation";

/**
 * Kafelek huba organizacji (uwaga właściciela 2026-08-24) — link-karta do
 * podstrony organizacji albo do powiązanego ekranu ustawień.
 *
 * DLACZEGO KOMPONENT, a nie powtarzany markup: ekran `/organizacja` jest teraz
 * WYŁĄCZNIE punktem wejścia (hub), a nie ścianą ustawień. Kafelki są jedynym
 * powtarzalnym elementem huba, więc reguła stylu (obrys, hover, focus) mieszka
 * w JEDNYM miejscu — inaczej każdy wpis niósłby własną kopię klas i z czasem by
 * się rozjechały.
 *
 * Szerokości NIE dotyka (zakaz `max-w-*`/`w-[…]`, ADR-060): siatkę kafelków
 * układa rodzic, a karta wypełnia komórkę. Fokus idzie wspólnym wzorcem panelu
 * (outline `accent`, w ciemnym `ring`), a strzałka to element czysto
 * dekoracyjny (`aria-hidden`) — czytnik ekranu dostaje tytuł i opis, nie znak.
 */
export function HubTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      data-hub-tile
      className="group border-border bg-card flex flex-col gap-1 rounded-lg border p-4 no-underline outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:border-foreground focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
    >
      <span className="flex items-center justify-between gap-2 text-sm leading-5 font-semibold">
        {title}
        <span
          aria-hidden
          className="text-muted-foreground transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
      <span className="text-muted-foreground text-[13px] leading-[18px]">{description}</span>
    </Link>
  );
}
