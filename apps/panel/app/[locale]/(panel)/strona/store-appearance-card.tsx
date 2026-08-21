/**
 * KARTA „WYGLĄD SKLEPU" na ekranie stron (ADR-171, wada W1 z audytu kreatora).
 *
 * DLACZEGO TU, OBOK KARTY ZNAKU. Wygląd jest — jak znak firmy — własnością
 * NAJEMCY (ADR-161), a nie żadnej ze stron. Kontrolki wyboru motywu, akcentu
 * i krojów mieszkają dziś w kreatorze KONKRETNEJ strony i to jest osobna sprawa
 * (S6/S7 audytu); tutaj stoi wyłącznie STAN — jedyne miejsce w panelu, które
 * odpowiada na pytanie „czy klienci już to widzą".
 *
 * WZORZEC JEST TEN SAM, CO PRZY ZNAKU (`store-logo-card.tsx`), i to nie jest
 * kosmetyka: karta znaku miała stan oczekujący od ADR-160, a wygląd nie miał
 * go wcale, więc dwie własności tego samego najemcy, publikowane tym samym
 * kliknięciem, opowiadały o sobie w panelu zupełnie inaczej.
 *
 * CZEGO TA KARTA NIE MA — świadomie. Nie ma własnego przycisku publikacji.
 * Wygląd wychodzi na żywo przy publikacji DOWOLNEJ strony
 * (`publishSite` → `app.publish_tenant_appearance`) i dokładnie to zdanie
 * karta wypowiada. Osobny czasownik „opublikuj wygląd" byłby drugą drogą do
 * tej samej operacji — i pierwszą okazją, żeby oba miejsca zaczęły mówić
 * o zasięgu co innego.
 */
import { useTranslations } from "next-intl";

export function StoreAppearanceCard({ pending }: { pending: boolean }) {
  const t = useTranslations("site.appearance");

  return (
    <section
      data-store-appearance
      data-store-appearance-state={pending ? "pending" : "live"}
      className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("scope")}</p>
      {pending ? (
        <p data-store-appearance-pending className="text-foreground mt-2 text-[13px] leading-[18px]">
          {t("pending")}
        </p>
      ) : (
        <p data-store-appearance-live className="text-muted-foreground mt-2 text-[13px] leading-[18px]">
          {t("live")}
        </p>
      )}
    </section>
  );
}
