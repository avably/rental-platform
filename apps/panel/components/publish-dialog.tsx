"use client";

/**
 * POTWIERDZENIE PUBLIKACJI STRONY (0048, ADR-093) — jeden dialog na obie
 * powierzchnie: listę stron (`site-pages.tsx`) i kreator (`site-builder.tsx`).
 *
 * Wydzielony z listy przy L6 (audyt E2E 2026-08-07): kreator publikował BEZ
 * potwierdzenia, a z listy szło pełne. Dialog jest JEDEN, żeby treść nie mogła
 * się rozjechać między dwiema drogami do tej samej operacji.
 *
 * ================ CO PUBLIKACJA ROBI PO FAZIE 2 (ADR-165) ================
 *
 * Do 0073 wiersz `sites` był WERSJĄ jednej strony, więc publikacja PRZEŁĄCZAŁA
 * sklep i gasiła dotychczasową żywą wersję — i dokładnie to zdanie stało tutaj.
 * Od 0074 publikacja NIE GASI NIKOGO (ADR-158 D5): strony współistnieją, każda
 * pod własnym adresem. Ostrzeżenie przed wygaszeniem opisywało więc skutek,
 * który nie następuje, a wraz z nim zniknął props `liveName` — „którą stronę
 * zgasi ta publikacja" jest pytaniem bez odpowiedzi i nie ma prawa wrócić jako
 * pole, które ktoś kiedyś wypełni.
 *
 * Zostają DWA zdania, bo zostały dwa różne skutki:
 *   • strona ŻYWA — klienci ją już widzą, publikacja wypuszcza do nich zmiany;
 *   • strona ROBOCZA — pojawi się pod SWOIM adresem.
 *
 * ============ ZASIĘG: PUBLIKACJA STRONY WYPUSZCZA TEŻ WYGLĄD (ADR-171) ============
 *
 * Do tej poprawki `switchBodyNew` kończył się zdaniem „Pozostałe strony sklepu
 * zostają bez zmian." — nieprawdą za każdym razem, gdy operator ruszył motyw,
 * akcent albo krój, bo `publishSite` po opublikowaniu TREŚCI woła bezargumentowe
 * `app.publish_tenant_appearance()` i przenosi na żywo wygląd CAŁEGO sklepu
 * (ADR-161). Zdanie zostało rozdzielone od zdania o adresie i jest odtąd
 * WARUNKOWE — w obie strony:
 *
 *   • `appearancePending === true`  → okno mówi, że wyjdzie też nowy wygląd
 *     i że dotyczy on wszystkich stron;
 *   • `appearancePending === false` → okno uspokaja, że reszta sklepu zostaje
 *     bez zmian; dopiero TERAZ to zdanie jest prawdziwe;
 *   • `undefined` → okno NIE MÓWI NIC o zasięgu.
 *
 * Trzeci wariant nie jest luką, tylko jedynym uczciwym zachowaniem powierzchni,
 * która stanu wyglądu nie zna (dziś: kreator). Zdanie o stanie sklepu ma
 * pochodzić z odczytu, a nie z domysłu — a domyślne „bez zmian" jest właśnie
 * tym domysłem, który wprowadził tę nieprawdę.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function PublishDialog({
  disabled,
  live,
  name,
  address,
  productTemplate = false,
  appearancePending,
  onConfirm,
  trigger,
}: {
  disabled: boolean;
  /** Czy TĘ stronę klienci już widzą — wtedy publikacja jest odświeżeniem. */
  live: boolean;
  name: string;
  /**
   * ADRES, pod którym strona stanie w sklepie — gotowa ścieżka z
   * `pagePathFromSlug` (`/` dla strony głównej). To jedyna rzecz, która po
   * fazie 2 odróżnia jedną publikację od drugiej, więc operator musi ją
   * zobaczyć ZANIM kliknie: w kreatorze adresu nie widać nigdzie indziej.
   */
  address: string;
  /**
   * CZY TA STRONA JEST SZABLONEM STRONY PRODUKTU (faza 5, ADR-178).
   *
   * Zdanie o zasięgu publikacji jest wtedy INNE, a nie ozdobnie inne: szablon
   * nie staje w sklepie „pod adresem", tylko zaczyna obowiązywać na stronie
   * KAŻDEGO sprzętu naraz. Podanie mu `address` byłoby podaniem `/` — czyli
   * adresu strony głównej, pod którym szablonu nie ma i nie będzie. Operator
   * ma usłyszeć prawdziwy zasięg PRZED kliknięciem, bo po nim zmieni się
   * tyle stron, ile najemca ma pozycji w katalogu.
   */
  productTemplate?: boolean;
  /**
   * CZY SZKIC WYGLĄDU RÓŻNI SIĘ OD OPUBLIKOWANEGO (ADR-171).
   *
   * `undefined` = powierzchnia tego nie wie i okno o zasięgu MILCZY. Wartość
   * liczy `appearancePending` na ekranie stron, z tego samego odczytu, z
   * którego liczy się karta „Wygląd sklepu" — dwa wyliczenia znaczyłyby dwie
   * odpowiedzi na to samo pytanie w odległości jednego kliknięcia.
   */
  appearancePending?: boolean | null;
  onConfirm: () => void;
  /**
   * Własny przycisk otwierający (asChild) — kreator podaje swój primary z
   * `data-builder-publish` i stanem oczekiwania, lista zostaje przy domyślnym.
   * Parametryzowany jest WYŁĄCZNIE wygląd wejścia; treść ostrzeżenia i droga
   * potwierdzenia są wspólne z konstrukcji.
   */
  trigger?: ReactNode;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" size="sm" variant="secondary" disabled={disabled} data-publish-site>
            {t("publish.publish")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.switchTitle", { name })}</DialogTitle>
          <DialogDescription {...(productTemplate ? { "data-publish-template-scope": "" } : {})}>
            {productTemplate
              ? live
                ? t("pages.switchBodyTemplateLive")
                : t("pages.switchBodyTemplateNew")
              : live
                ? t("pages.switchBodySelf")
                : t("pages.switchBodyNew", { address })}
          </DialogDescription>
        </DialogHeader>
        {appearancePending === null || appearancePending === undefined ? null : (
          <p
            data-publish-appearance-scope={appearancePending ? "changes" : "unchanged"}
            className={
              appearancePending
                ? "text-foreground text-[13px] leading-[18px]"
                : "text-muted-foreground text-[13px] leading-[18px]"
            }
          >
            {appearancePending
              ? t("pages.switchAppearanceChanges")
              : t("pages.switchAppearanceUnchanged")}
          </p>
        )}
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pages.switchDraftNote")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" data-publish-site-confirm onClick={onConfirm}>
              {t("publish.publish")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
