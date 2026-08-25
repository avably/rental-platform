"use client";

/**
 * Formularz checkoutu storefrontu (Zadanie 2.4b; przebudowa prezentacji F8,
 * spec 2026-08-25). Zbiera dane klienta, metodę dostawy (+ punkt odbioru przy
 * 'pickup'), akceptację regulaminu, honeypot i token Turnstile, a pozycje/termin
 * bierze z koszyka (localStorage). Woła submitCheckout (rdzeń 2.4a — NIE
 * edytowany) i mapuje KAŻDY status wyniku na komunikat (lib/checkout-form-ui.ts).
 *
 * ==================== UKŁAD (F8) ====================
 *
 * Desktop: dwie kolumny `minmax(0,1fr) + 22rem` — sekcje formularza jako karty
 * `.site-card` z nagłówkiem i 1-zdaniowym opisem (rytm: 16 px w polu, 28 px
 * między sekcjami; pola `max-w-lg`), po prawej PRZYKLEJONA karta podsumowania
 * (`top-24`). Mobile: u góry strony zwijany pasek „Podsumowanie · kwota"
 * (natywny <details>), pełne podsumowanie z przyciskiem stoi POD sekcjami —
 * czyli nad przyciskiem nie ma już nic do przewinięcia w ciemno.
 *
 * KOLUMNA PODSUMOWANIA MA 22 REM, nie 20: iframe antybotowy dostawcy ma
 * SZTYWNE 300 px, a 20 rem − padding karty zostawiało 278 px — i to właśnie
 * ono rozdymało niejawny tor siatki (patrz niżej).
 *
 * ==================== NAPRAWA S-15 (kwoty za ramką) ====================
 *
 * Zmierzona przyczyna: karta podsumowania była `display: grid` BEZ szablonu
 * kolumn, a niejawny tor `auto` przyjmuje szerokość NAJWIĘKSZEGO dziecka —
 * iframe antybotowy (300 px) rozdymał tor ponad pudełko treści (278 px),
 * KAŻDE dziecko rozciągało się do toru i kwoty dociśnięte do prawej lądowały
 * 22 px za paddingiem, 1 px ZA ramką (`gridTemplateColumns: 300px`; przy
 * kwotach 4-cyfrowych ucinało „zł"). Naprawa u źródła: wszystkie tory siatek
 * na tej ścieżce to `minmax(0, 1fr)` (`grid-cols-1` Tailwinda), więc szerokość
 * toru liczy KONTENER, nie dziecko; wiersz kwoty to grid `[etykieta][wartość]`
 * (SummaryList); a widget antybotowy na slotach węższych niż 300 px renderuje
 * się w rozmiarze `compact` zamiast wystawać z karty (to samo rozdymało CAŁĄ
 * kolumnę formularza na telefonach — overflow 373 px przy oknie 360 px).
 *
 * ==================== KARTY WYBORU (odbiór/płatność) ====================
 *
 * Radio jest ukryte (`sr-only`), kartą jest etykieta. Stan zaznaczenia rysuje
 * OSOBNA warstwa (`data-checkout-choice-indicator`): obrys akcentu 2 px +
 * delikatne tło akcentu 8 % — świadomie NIE pełny akcent `.site-cta` (S-55):
 * wybrana opcja nie może wyglądać jak przycisk akcji. Warstwa jest osobnym
 * elementem, bo `.site-card` stoi POZA warstwą utilities i wygrywa z klasami
 * `bg-*`/`border-*` na tym samym elemencie (kontrakt site.css).
 *
 * KWOTY: podsumowanie na żywo to PODGLĄD (previewTotals). Po sukcesie ekran
 * potwierdzenia pokazuje kwoty WYŁĄCZNIE z order serwera (orderSummaryTotals) —
 * podgląd lokalny nie ma na nie wpływu (ADR-042).
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092). Kasa jest ostatnim ekranem przed
 * zapłatą, więc rozjazd wizualny kosztuje tu najwięcej zaufania — nosi zatem
 * WYŁĄCZNIE role (`site-card`, `site-field`, `site-label`, `site-cta`,
 * `site-error`, `site-error-panel`), a wartości bierze ze zmiennych motywu
 * z korzenia strony.
 *
 * POLA SĄ ZWYKŁYM HTML-em, nie komponentami `@avably/ui`. Tamte wnoszą własne
 * tokeny panelu (obrys pola, wypełnienie przycisku, kolor fokusu) w warstwie
 * utilities — czyli paleta panelu wjeżdżałaby tu przez zależność, której skan
 * ŹRÓDEŁ tego pliku nie widzi, a gwarancja „bez palety panelu" byłaby pozorna.
 * Zamiana kosztuje kilka klas układu; nic z dostępności (etykiety, `aria-*`,
 * natywny `<select>`, natywny checkbox) nie znika.
 */
import { formatMoney, formatRentalRange, type CurrencyCode, type CustomFieldDefinition } from "@avably/core";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { submitCheckout } from "@/lib/actions/checkout";
import { isCheckoutReady, toCheckoutItems } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { previewTotals } from "@/lib/catalog/preview";
import type {
  CheckoutDeliveryMethod,
  CheckoutField,
  CheckoutInput,
  CheckoutPaymentMethod,
  PublicCatalogProduct,
  PublicDeliveryMethod,
  PublicPickupLocation,
} from "@/lib/checkout/contract";
import {
  getCheckoutMessageKey,
  mapCheckoutResult,
  orderSummaryTotals,
  shouldResetCaptcha,
  type CheckoutViewState,
} from "@/lib/checkout-form-ui";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";
import { CheckoutCustomFields } from "@/components/storefront/checkout-custom-fields";
import { checkoutCustomFieldKey } from "@/lib/checkout/custom-fields";
import { SummaryList, type SummaryRow } from "@/components/storefront/summary-list";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useStoreTerm } from "@/components/storefront/store-term";
import { SITE_HEADING } from "@/components/storefront/store-chrome";

/**
 * OPUBLIKOWANY REGULAMIN — z serwera, nie ze stałej w przeglądarce (B4, R18).
 *
 * `versionLabel` nadała BAZA przy publikacji. Wysyłamy ją z powrotem jako
 * DEKLARACJĘ, na którą wersję patrzył klient; baza konfrontuje ją z rejestrem
 * i sama rozstrzyga, który wiersz przypiąć do zamówienia. Podmiana tej
 * wartości w przeglądarce nie przypnie ani cudzej, ani nieistniejącej wersji.
 *
 * `href` to PERMALINK KONKRETNEJ WERSJI (/regulamin/w/{n}), nie żywy adres
 * (ADR-191): najemca może jutro opublikować nową wersję i /regulamin pokaże
 * wtedy inny tekst — a dowód zgody musi wskazywać dokładnie ten, który klient
 * widział przy akceptacji.
 *
 * `undefined` = najemca nie ma KOMPLETU opublikowanych dokumentów (regulamin
 * ORAZ polityka prywatności). Od ADR-191 (H-COMP-01) checkout jest wtedy
 * ZABLOKOWANY: zamiast checkboxa stoi komunikat, przycisk jest niedostępny,
 * a wysyłka ma twardą bramkę — martwa zgoda na dokument, którego nie ma,
 * była zapisem bez wartości dowodowej.
 */
export interface CheckoutTerms {
  href: string;
  versionLabel: string;
}

interface CheckoutFormProps {
  products: PublicCatalogProduct[];
  deliveryMethods: PublicDeliveryMethod[];
  pickupLocations: PublicPickupLocation[];
  currency: CurrencyCode;
  locale: StorefrontLocale;
  copy: StorefrontCopy;
  turnstileSiteKey?: string | undefined;
  terms?: CheckoutTerms | undefined;
  /**
   * Metody płatności policzone NA SERWERZE (ADR-066) — z odczytu stanu konta
   * najemcy u dostawcy, nie z kolumny w bazie. Tor offline jest w tej liście
   * zawsze; brak `online` znaczy „ten sklep dziś nie przyjmuje płatności
   * online", a nie „coś się zepsuło".
   *
   * Lista jest tu WSKAZÓWKĄ DLA UI, nie bramką: prawdziwa bramka stoi
   * w rdzeniu akcji, po stronie serwera, i pyta o stan konta jeszcze raz.
   */
  paymentMethods: CheckoutPaymentMethod[];
  /**
   * Pola własne DO WYPEŁNIENIA w zamawianiu (C6-A3, ADR-121) — już zawężone
   * na SERWERZE (`checkoutCustomFields`: flaga „zamawianie" ORAZ encja
   * klient/zamówienie). Filtr w komponencie dawałby pole niewidoczne, ale
   * zapisywalne — a serwer i tak liczy ten sam zbiór jeszcze raz przy zapisie.
   */
  customFields: CustomFieldDefinition[];
}

/* ==================== stałe prezentacji F8 ==================== */

/**
 * Sekcja formularza jako karta. `grid-cols-1` = `minmax(0, 1fr)` — patrz
 * nagłówek pliku (naprawa S-15): tor siatki nie może dziedziczyć szerokości
 * po najszerszym dziecku.
 */
const SECTION_CARD = "site-card grid grid-cols-1 gap-4 p-5 sm:p-6";

/**
 * Nagłówek sekcji-karty (17 px, waga nagłówka motywu). `float-left w-full`
 * zdejmuje z <legend> specjalne renderowanie „w szczelinie ramki" i czyni go
 * zwykłym pierwszym elementem karty.
 */
const SECTION_LEGEND = `float-left w-full text-[17px] ${SITE_HEADING}`;

/** 1-zdaniowy opis pod nagłówkiem sekcji (spec F8). */
const SECTION_DESCRIPTION = "site-text-muted text-sm";

/** Pola nie rozciągają się na całą szerokość karty (spec: max-w-lg). */
const SECTION_FIELDS = "grid max-w-lg grid-cols-1 gap-4";

/**
 * KARTA WYBORU (radio ukryte). Wybrany stan rysuje warstwa-wskaźnik niżej —
 * na tym elemencie nie da się nadpisać tła/ramki `.site-card` (site.css stoi
 * poza warstwą utilities i wygrywa z klasami `bg-…` i `border-…`).
 */
const CHOICE_CARD =
  "site-card relative flex min-h-11 cursor-pointer gap-3 p-4 " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 " +
  "has-[:focus-visible]:outline-[color:var(--site-accent)]";

/**
 * Warstwa zaznaczenia karty wyboru: obrys akcentu 2 px + tło akcentu 8 %
 * (ta sama alfa, co `.site-shape-accent`). ŚWIADOMIE nie `.site-cta` (S-55) —
 * wybór to stan, nie akcja; pierścień fokusu rysuje etykieta (`:has` wyżej),
 * bo warstwa przy opacity-0 nie pokazałaby outline'u klawiaturze.
 */
const CHOICE_INDICATOR =
  "pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-[color:var(--site-accent)] " +
  "bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)] opacity-0 transition-opacity " +
  "peer-checked:opacity-100";

function deliveryLabel(copy: StorefrontCopy, method: CheckoutDeliveryMethod): string {
  switch (method) {
    case "pickup":
      return copy.checkout.methodPickup;
    case "courier":
      return copy.checkout.methodCourier;
    case "parcel_locker":
      return copy.checkout.methodParcelLocker;
    case "own_delivery":
      return copy.checkout.methodOwnDelivery;
  }
}

function paymentLabel(copy: StorefrontCopy, method: CheckoutPaymentMethod): string {
  switch (method) {
    case "online":
      return copy.checkout.paymentOnline;
    case "transfer":
      return copy.checkout.paymentTransfer;
    case "cod":
      return copy.checkout.paymentCod;
  }
}

/**
 * TREŚĆ ZGODY — z linkiem, gdy jest dokąd linkować (B4).
 *
 * Do B4 etykieta była gołym tekstem: klient przyjmował regulamin, którego nie
 * mógł przeczytać, bo sklep nie miał trasy /regulamin. Gdy dokument jest
 * opublikowany, etykieta niesie link i numer wersji — czyli dokładnie to, co
 * zapisze się na zamówieniu.
 *
 * Link wstawiamy przez PODZIAŁ SZABLONU na `{link}`, a nie przez sklejanie
 * zdania z kawałków: tłumacz musi mieć wpływ na to, gdzie w zdaniu stoi
 * odnośnik, bo w angielskim i polskim stoi gdzie indziej.
 */
function TermsConsentText({
  copy,
  terms,
}: {
  copy: StorefrontCopy;
  /**
   * Wymagany, nie opcjonalny (ADR-191): przy braku dokumentów ten komponent
   * w ogóle nie powstaje — formularz pokazuje blokadę zamiast checkboxa.
   * Dawny cichy fallback na nielinkowaną etykietę sugerował, że jest co
   * akceptować, gdy nie było niczego.
   */
  terms: CheckoutTerms;
}) {
  const [before, after = ""] = copy.checkout.termsLabelLinked.split("{link}");
  return (
    <>
      {before}
      <a
        className="underline underline-offset-4"
        href={terms.href}
        target="_blank"
        rel="noreferrer"
        data-checkout-terms-link="true"
      >
        {copy.checkout.termsLinkText}
      </a>
      {after}{" "}
      <span className="opacity-70" data-checkout-terms-version="true">
        ({terms.versionLabel})
      </span>
    </>
  );
}

function paymentHint(copy: StorefrontCopy, method: CheckoutPaymentMethod): string {
  switch (method) {
    case "online":
      return copy.checkout.paymentOnlineHint;
    case "transfer":
      return copy.checkout.paymentTransferHint;
    case "cod":
      return copy.checkout.paymentCodHint;
  }
}

interface Values {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  nip: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  notes: string;
  deliveryMethod: CheckoutDeliveryMethod;
  pickupLocationId: string;
  paymentMethod: CheckoutPaymentMethod;
  terms: boolean;
  honeypot: string;
  /**
   * Wartości pól własnych, kluczowane ID DEFINICJI i trzymane STRINGAMI —
   * dokładnie tak, jak wychodzą z kontrolek HTML. Typowanie robi serwer.
   */
  custom: Record<string, string>;
}

const EMPTY_VALUES: Omit<Values, "paymentMethod"> = {
  fullName: "",
  email: "",
  phone: "",
  companyName: "",
  nip: "",
  addressStreet: "",
  addressZip: "",
  addressCity: "",
  notes: "",
  deliveryMethod: "pickup",
  pickupLocationId: "",
  terms: false,
  honeypot: "",
  custom: {},
};

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p className="site-error min-h-5 text-sm" id={id}>
      {message}
    </p>
  );
}

/**
 * ZWIJANY PASEK PODSUMOWANIA (mobile, spec F8): u góry strony, natywny
 * <details> — dostępny z konstrukcji (Enter/Spacja, stan w drzewie a11y).
 * Zwinnięty niesie etykietę i KWOTĘ RAZEM; rozwinięty — pełne wiersze.
 * Na ≥lg znika: tam podsumowanie stoi obok formularza przez cały czas.
 */
function SummaryBar({
  heading,
  totalText,
  children,
}: {
  heading: string;
  totalText: string;
  children: ReactNode;
}) {
  return (
    <details className="site-card group lg:hidden" data-checkout-summary-bar>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{heading}</span>
        <span className="inline-flex items-center gap-2">
          <span className="site-numeric font-semibold whitespace-nowrap" data-checkout-summary-bar-total>
            {totalText}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 transition-transform group-open:rotate-180"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function CheckoutForm({
  products,
  deliveryMethods,
  pickupLocations,
  currency,
  locale,
  copy,
  turnstileSiteKey,
  paymentMethods,
  customFields,
  terms,
}: CheckoutFormProps) {
  const router = useRouter();
  const { cart, hydrated, clear } = useCart();
  // Werdykt konfliktu terminu z POWŁOKI (ADR-179) — ten sam, który widzi pasek
  // terminu i koszyk. Kasa jest ostatnim miejscem, w którym da się zatrzymać
  // zamówienie, zanim padnie na serwerze przy przypisaniu egzemplarza.
  const term = useStoreTerm();
  // Pierwsza metoda z listy serwera jest zaznaczona: gdy online jest
  // dostępne, klient chcący zapłacić od razu nie musi nic klikać, a reszta
  // ma wybór o jedno kliknięcie dalej.
  const [values, setValues] = useState<Values>({
    ...EMPTY_VALUES,
    paymentMethod: paymentMethods[0] ?? "transfer",
  });
  const [view, setView] = useState<CheckoutViewState>({ kind: "idle" });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  /**
   * ROZMIAR WIDGETU ANTYBOTOWEGO Z POMIARU SLOTU (F8). Iframe dostawcy ma
   * sztywne 300 px; slot węższy (karta podsumowania przy kontenerze 300 px ma
   * ~258 px treści) dostaje wariant `compact` (150×140) zamiast iframe'u
   * wystającego z karty. Pomiar RAZ, po montażu — zmiana rozmiaru w locie
   * przeładowałaby widget i skasowała rozwiązane wyzwanie klienta.
   */
  const captchaSlotRef = useRef<HTMLDivElement>(null);
  const [captchaSize, setCaptchaSize] = useState<"normal" | "compact" | null>(null);
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const width = captchaSlotRef.current?.clientWidth ?? 0;
    setCaptchaSize(width > 0 && width < 300 ? "compact" : "normal");
  }, [turnstileSiteKey]);

  // Po sukcesie czyścimy koszyk raz (zamówienie utrwalone po stronie serwera) —
  // efekt synchronizuje zewnętrzny store (localStorage), nie stan Reacta.
  useEffect(() => {
    if (view.kind === "success") clear();
  }, [view.kind, clear]);

  // Zamówienie opłacane online idzie na krok płatności. Nawigacja siedzi
  // w efekcie, nie w handlerze: koszyk musi zostać wyczyszczony niezależnie
  // od tego, czy przejście się powiedzie, a router w handlerze potrafiłby
  // odmontować komponent przed efektem czyszczącym.
  useEffect(() => {
    if (view.kind === "success" && view.nextStep === "payment") {
      router.push("/checkout/platnosc");
    }
  }, [view, router]);

  const fields = view.kind === "validation" ? view.fields : {};
  const messageKey = getCheckoutMessageKey(view);
  const submitting = view.kind === "submitting";

  /**
   * FOKUS NA PIERWSZY BŁĄD (M-A11Y-03). Po nieudanej walidacji fokus przenosi
   * się do PIERWSZEGO pola z błędem W KOLEJNOŚCI DOKUMENTU — nie w kolejności
   * kluczy mapy z serwera, bo tej kolejności nikt nie obiecuje, a użytkownik
   * klawiatury i czytnika porusza się po dokumencie. Selektor po
   * `aria-invalid="true"` czyta tę samą prawdę, którą widzi czytnik ekranu:
   * pole bez tego atrybutu nie jest oznaczone jako błędne, więc nie ma prawa
   * dostać fokusu.
   *
   * Gdy błąd nie ma kontrolki (startDate/endDate/items przychodzą z koszyka,
   * nie z pola), fokus ląduje na regionie podsumowania (`tabIndex={-1}`) —
   * czytnik i tak ogłasza treść regionu, a klawiatura nie zostaje na
   * przycisku, jakby nic się nie stało.
   *
   * Efekt zależy od `view`: każdy nieudany submit tworzy NOWY obiekt stanu,
   * więc fokus wraca przy każdej kolejnej nieudanej próbie; edycja pola
   * przełącza stan na `idle` i efekt nie kradnie fokusu podczas pisania.
   * Bramka regulaminu (ADR-191) jest wcześniej: bez kompletu dokumentów
   * submit w ogóle nie wychodzi, stan walidacji nie powstaje i ten efekt
   * nie ma czego fokusować.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (view.kind !== "validation") return;
    // Radia NIE niosą `aria-invalid` (ARIA nie wspiera go na roli radio —
    // jsx-a11y/role-supports-aria-props); błędną grupę oznacza
    // `data-checkout-invalid`, a czytnik dostaje komunikat przez
    // `aria-describedby`, które jest globalne.
    const firstInvalid = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-checkout-invalid="true"]',
    );
    (firstInvalid ?? summaryRef.current)?.focus();
  }, [view]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (view.kind === "validation") setView({ kind: "idle" });
  }

  /** Komunikat pod polem własnym — klucz kontraktu to `cf_<id>`. */
  function customFieldMessage(definitionId: string): string | undefined {
    const error = fields[checkoutCustomFieldKey(definitionId)];
    if (!error) return undefined;
    const messages = copy.checkout.errors.customField;
    switch (error) {
      case "required":
        return messages.required;
      case "too_long":
        return messages.tooLong;
      case "not_allowed":
        return messages.notAllowed;
      default:
        return messages.invalid;
    }
  }

  function setCustomField(definitionId: string, value: string) {
    setValues((current) => ({ ...current, custom: { ...current.custom, [definitionId]: value } }));
    if (view.kind === "validation") setView({ kind: "idle" });
  }

  function fieldMessage(field: CheckoutField): string | undefined {
    if (!fields[field]) return undefined;
    const errors = copy.checkout.errors;
    switch (field) {
      case "fullName":
        return errors.fullName;
      case "email":
        return errors.email;
      case "phone":
        return errors.phone;
      case "startDate":
        return errors.startDate;
      case "endDate":
        return errors.endDate;
      case "deliveryMethod":
        return errors.deliveryMethod;
      case "pickupLocationId":
        return errors.pickupLocationId;
      case "paymentMethod":
        return errors.paymentMethod;
      case "items":
        return errors.items;
      default:
        return errors.generic;
    }
  }

  /**
   * `aria-describedby` WYŁĄCZNIE gdy pole faktycznie ma komunikat (WCAG 3.3.1).
   * Kontener błędu istnieje zawsze (rezerwuje wysokość, żeby układ nie skakał),
   * więc stałe wiązanie kazałoby czytnikowi ogłaszać pusty węzeł przy każdym
   * wejściu w pole.
   */
  function describedBy(field: CheckoutField, errorId: string): string | undefined {
    return fields[field] ? errorId : undefined;
  }

  // --- Zamówienie online: przejście na krok płatności --------------------
  //
  // Świadomie NIE pokazujemy tu ekranu potwierdzenia: mówi on „płatność
  // rozliczysz z wypożyczalnią", co dla klienta płacącego kartą byłoby
  // nieprawdą, a mignąłby mu na ułamek sekundy przed przekierowaniem.
  if (view.kind === "success" && view.nextStep === "payment") {
    return (
      <div className="site-card p-6" role="status">
        <p className="site-text-muted">{copy.payment.loading}</p>
      </div>
    );
  }

  // --- Ekran potwierdzenia (sukces) -------------------------------------
  if (view.kind === "success") {
    const order = view.order;
    const totals = orderSummaryTotals(order);
    const methodLabel = deliveryLabel(copy, order.deliveryMethod);
    return (
      // h2, nie h1: strona checkoutu ma już własny h1, a ekran potwierdzenia
      // renderuje się W NIEJ. Dwa h1 na jednej stronie łamią hierarchię
      // nagłówków (WCAG 1.3.1) i psują nawigację czytnika po nagłówkach.
      <div className="site-card grid max-w-2xl grid-cols-1 gap-4 p-6" role="status">
        <h2 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.confirmation.title}</h2>
        <p className="text-lg">
          {copy.confirmation.orderNumber}:{" "}
          <strong className="site-numeric">{order.orderNumber}</strong>
        </p>
        <p className="site-text-muted leading-7">{copy.confirmation.paymentNote}</p>

        <div className="site-rule-top grid grid-cols-1 gap-2 pt-4 text-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
            <span className="site-text-muted">{copy.confirmation.rentalPeriod}</span>
            {/* Termin PO LUDZKU (F8/S-10) — ta sama fraza, co pasek terminu. */}
            <span className="text-right">
              {formatRentalRange(order.startDate, order.endDate, locale)}
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
            <span className="site-text-muted">{copy.confirmation.deliveryMethod}</span>
            <span className="text-right">{methodLabel}</span>
          </div>
        </div>

        <SummaryList
          rows={[
            {
              label: copy.confirmation.summaryRental,
              value: formatMoney(totals.rentalGrosze, currency, locale),
            },
            {
              label: copy.confirmation.summaryDeposit,
              value: formatMoney(totals.depositGrosze, currency, locale),
            },
            {
              label: copy.confirmation.summaryDelivery,
              value: formatMoney(totals.deliveryGrosze, currency, locale),
            },
          ]}
          total={{
            label: copy.confirmation.summaryTotal,
            value: formatMoney(totals.totalGrosze, currency, locale),
          }}
        />

        <p className="site-text-muted text-sm">
          {view.emailIssues.length > 0 ? copy.confirmation.emailIssue : copy.confirmation.emailSent}
        </p>
        <Link href="/store" className="site-link justify-self-start font-medium">
          {copy.confirmation.backToStore}
        </Link>
      </div>
    );
  }

  // --- Koszyk pusty / bez terminu → nie ma czego zamawiać ----------------
  if (hydrated && !isCheckoutReady(cart)) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="site-text-muted">{copy.checkout.cartEmpty}</p>
        <Link href="/store" className="site-link font-medium">
          {copy.cart.emptyCta}
        </Link>
      </div>
    );
  }

  // Podgląd kwot (szacunek) — zależny od metody dostawy i terminu z koszyka.
  const totals = previewTotals({
    items: cart.items,
    products,
    startDate: cart.startDate ?? "",
    endDate: cart.endDate ?? "",
    deliveryMethod: values.deliveryMethod,
    deliveryMethods,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCheckoutReady(cart)) return;
    // KONFLIKT TERMINU ZATRZYMUJE ZAPIS (R4, ADR-179). Bramka jest tu, w
    // ścieżce wysyłki, a nie tylko na przycisku: sam `disabled` znika przy
    // pierwszym `requestSubmit` z klawiatury albo ze skryptu, a wtedy
    // zamówienie idzie na serwer wyłącznie po to, żeby tam paść.
    if (term.blocked) return;
    // BRAK KOMPLETU DOKUMENTÓW ZATRZYMUJE WYSYŁKĘ (ADR-191) — ta sama zasada
    // co przy konflikcie terminu: `disabled` na przycisku znika przy pierwszym
    // `requestSubmit` ze skryptu, a bramka w ścieżce wysyłki nie.
    if (!terms) return;

    const input: CheckoutInput = {
      email: values.email,
      fullName: values.fullName,
      startDate: cart.startDate!,
      endDate: cart.endDate!,
      deliveryMethod: values.deliveryMethod,
      paymentMethod: values.paymentMethod,
      pickupLocationId:
        values.deliveryMethod === "pickup" ? values.pickupLocationId || undefined : undefined,
      items: toCheckoutItems(cart),
      termsAccepted: values.terms,
      // WYŁĄCZNIE etykieta z opublikowanego dokumentu (B4/R18, ADR-191).
      // Fallback na stałą „1.0" zniknął razem ze stałą: utrwalał na
      // zamówieniu zgodę wskazującą dokument, którego nie ma. Bez dokumentów
      // wysyłka nie startuje (bramka wyżej), a serwer i baza odmawiają same.
      termsVersion: terms.versionLabel,
      phone: values.phone || undefined,
      companyName: values.companyName || undefined,
      nip: values.nip || undefined,
      addressStreet: values.addressStreet || undefined,
      addressZip: values.addressZip || undefined,
      addressCity: values.addressCity || undefined,
      locale,
      notes: values.notes || undefined,
      // Mapa idzie ZAWSZE, także pusta: to serwer rozstrzyga, czy najemca ma
      // pole wymagane, którego klient nie wypełnił. Pominięcie klucza przy
      // pustym formularzu zamieniałoby „nic nie wpisałem" w „nie ma o co
      // pytać" — a to są dwa różne zdania.
      customFields: values.custom,
      captchaToken: captchaToken ?? undefined,
      honeypot: values.honeypot,
    };

    setView({ kind: "submitting" });
    try {
      const mapped = mapCheckoutResult(await submitCheckout(input));
      setView(mapped);
      if (turnstileSiteKey && shouldResetCaptcha(mapped)) {
        setCaptchaToken(null);
        setCaptchaEpoch((epoch) => epoch + 1);
      }
    } catch {
      setView({ kind: "connection_error" });
      if (turnstileSiteKey) {
        setCaptchaToken(null);
        setCaptchaEpoch((epoch) => epoch + 1);
      }
    }
  }

  const showPickup = values.deliveryMethod === "pickup";

  /** Wiersze podsumowania — jedna definicja dla paska mobile i karty. */
  const summaryRows: SummaryRow[] = [
    {
      label: copy.checkout.summaryRental,
      value: formatMoney(totals.rentalGrosze, currency, locale),
    },
    {
      label: copy.checkout.summaryDeposit,
      value: formatMoney(totals.depositGrosze, currency, locale),
    },
    {
      label: copy.checkout.summaryDelivery,
      value: formatMoney(totals.deliveryGrosze, currency, locale),
    },
  ];
  const summaryTotal: SummaryRow = {
    label: copy.checkout.summaryTotal,
    value: formatMoney(totals.totalGrosze, currency, locale),
  };

  return (
    <form
      ref={formRef}
      className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-1 gap-7">
        {/*
          REGION OGŁOSZEŃ WALIDACJI (M-A11Y-03). Węzeł z `role="alert"` istnieje
          OD MONTAŻU (czytniki rejestrują regiony live przy pierwszym renderze —
          region wstawiony razem z treścią bywa przemilczany), a treść pojawia
          się dopiero po nieudanej walidacji: zdanie z LICZBĄ pól do poprawienia.
          `tabIndex={-1}` pozwala przenieść tu fokus, gdy żaden błąd nie ma
          swojej kontrolki (błędy koszyka). Poza stanem walidacji region jest
          wizualnie schowany (`sr-only`), żeby nie rezerwować pustego panelu.
        */}
        <p
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          data-checkout-error-summary
          className={
            view.kind === "validation" ? "site-error-panel p-4 text-sm" : "sr-only"
          }
        >
          {view.kind === "validation"
            ? format(copy.checkout.errors.summary, {
                count: Object.keys(view.fields).length,
              })
            : null}
        </p>

        {/* Alert błędu (nie-walidacyjny) */}
        {messageKey ? (
          <div className="site-error-panel p-4 text-sm" role="alert">
            {messageKey === "unavailable" ? copy.checkout.errors.unavailable : null}
            {messageKey === "rejected" ? copy.checkout.errors.rejected : null}
            {messageKey === "rate_limited" ? copy.checkout.errors.rateLimited : null}
            {messageKey === "captcha" ? copy.checkout.errors.captcha : null}
            {messageKey === "connection" ? copy.checkout.errors.connection : null}
            {messageKey === "payment_unavailable" ? copy.checkout.errors.paymentUnavailable : null}
            {messageKey === "legal_documents_missing"
              ? copy.checkout.errors.legalDocumentsMissing
              : null}
            {/* [0089/ADR-202] Zdanie z LICZBĄ minimum z odmowy bazy — jedyne
                miejsce, w którym klient dowiaduje się o minimum (etykieta
                proaktywna przy terminie to faza 2). Naprawą jest TERMIN,
                nie dane — formularz zostaje wypełniony. */}
            {view.kind === "min_rental_days"
              ? format(copy.checkout.errors.minRentalDays, { count: view.minDays })
              : null}
            {messageKey === "server" ? copy.checkout.errors.server : null}
          </div>
        ) : null}

        {/* Zwijany pasek podsumowania — mobile, U GÓRY strony (spec F8). */}
        <SummaryBar
          heading={copy.checkout.summaryHeading}
          totalText={formatMoney(totals.totalGrosze, currency, locale)}
        >
          <SummaryList rows={summaryRows} total={summaryTotal} />
        </SummaryBar>

        {/* Dane kontaktowe */}
        <fieldset className={SECTION_CARD} disabled={submitting}>
          <legend className={SECTION_LEGEND}>{copy.checkout.contactHeading}</legend>
          <p className={SECTION_DESCRIPTION}>{copy.checkout.contactDescription}</p>
          <div className={SECTION_FIELDS}>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-fullname">
                {copy.checkout.fullName}{" "}
                <span className="site-text-muted">({copy.common.required})</span>
              </label>
              <input
                className="site-field h-10 w-full px-3 text-sm"
                id="co-fullname"
                autoComplete="name"
                aria-invalid={Boolean(fields.fullName)}
                aria-describedby={describedBy("fullName", "co-fullname-error")}
                value={values.fullName}
                onChange={(event) => set("fullName", event.target.value)}
                maxLength={200}
              />
              <FieldError id="co-fullname-error" message={fieldMessage("fullName")} />
            </div>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-email">
                {copy.checkout.email} <span className="site-text-muted">({copy.common.required})</span>
              </label>
              <input
                className="site-field h-10 w-full px-3 text-sm"
                id="co-email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(fields.email)}
                aria-describedby={describedBy("email", "co-email-error")}
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
                maxLength={320}
              />
              <FieldError id="co-email-error" message={fieldMessage("email")} />
            </div>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-phone">
                {copy.checkout.phone} <span className="site-text-muted">({copy.common.optional})</span>
              </label>
              <input
                className="site-field h-10 w-full px-3 text-sm"
                id="co-phone"
                type="tel"
                autoComplete="tel"
                aria-invalid={Boolean(fields.phone)}
                aria-describedby={describedBy("phone", "co-phone-error")}
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                maxLength={32}
              />
              <FieldError id="co-phone-error" message={fieldMessage("phone")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="site-label text-sm" htmlFor="co-company">
                  {copy.checkout.companyName}{" "}
                  <span className="site-text-muted">({copy.common.optional})</span>
                </label>
                {/*
                  Pola opcjonalne TEŻ walidują się na serwerze (długość, format) —
                  do M-A11Y-03 ich błędy nie miały ani znacznika, ani komunikatu,
                  ani miejsca w kolejce fokusu: mapa z serwera wskazywała pole,
                  a na ekranie nie działo się nic.
                */}
                <input
                  className="site-field h-10 w-full px-3 text-sm"
                  id="co-company"
                  autoComplete="organization"
                  aria-invalid={Boolean(fields.companyName)}
                  aria-describedby={describedBy("companyName", "co-company-error")}
                  value={values.companyName}
                  onChange={(event) => set("companyName", event.target.value)}
                  maxLength={200}
                />
                <FieldError id="co-company-error" message={fieldMessage("companyName")} />
              </div>
              <div className="grid gap-1">
                <label className="site-label text-sm" htmlFor="co-nip">
                  {copy.checkout.nip} <span className="site-text-muted">({copy.common.optional})</span>
                </label>
                {/* inputMode=numeric (S-12): klawiatura numeryczna na telefonie. */}
                <input
                  className="site-field h-10 w-full px-3 text-sm"
                  id="co-nip"
                  inputMode="numeric"
                  aria-invalid={Boolean(fields.nip)}
                  aria-describedby={describedBy("nip", "co-nip-error")}
                  value={values.nip}
                  onChange={(event) => set("nip", event.target.value)}
                  maxLength={32}
                />
                <FieldError id="co-nip-error" message={fieldMessage("nip")} />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Adres (opcjonalny) */}
        <fieldset className={SECTION_CARD} disabled={submitting}>
          <legend className={SECTION_LEGEND}>
            {copy.checkout.addressHeading}{" "}
            <span className="site-text-muted text-sm font-normal">({copy.common.optional})</span>
          </legend>
          <p className={SECTION_DESCRIPTION}>{copy.checkout.addressDescription}</p>
          <div className={SECTION_FIELDS}>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-street">
                {copy.checkout.addressStreet}
              </label>
              <input
                className="site-field h-10 w-full px-3 text-sm"
                id="co-street"
                autoComplete="street-address"
                aria-invalid={Boolean(fields.addressStreet)}
                aria-describedby={describedBy("addressStreet", "co-street-error")}
                value={values.addressStreet}
                onChange={(event) => set("addressStreet", event.target.value)}
                maxLength={200}
              />
              <FieldError id="co-street-error" message={fieldMessage("addressStreet")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="site-label text-sm" htmlFor="co-zip">
                  {copy.checkout.addressZip}
                </label>
                {/* inputMode=numeric (S-12) — kod pocztowy to cyfry i kreska. */}
                <input
                  className="site-field h-10 w-full px-3 text-sm"
                  id="co-zip"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  aria-invalid={Boolean(fields.addressZip)}
                  aria-describedby={describedBy("addressZip", "co-zip-error")}
                  value={values.addressZip}
                  onChange={(event) => set("addressZip", event.target.value)}
                  maxLength={20}
                />
                <FieldError id="co-zip-error" message={fieldMessage("addressZip")} />
              </div>
              <div className="grid gap-1">
                <label className="site-label text-sm" htmlFor="co-city">
                  {copy.checkout.addressCity}
                </label>
                <input
                  className="site-field h-10 w-full px-3 text-sm"
                  id="co-city"
                  autoComplete="address-level2"
                  aria-invalid={Boolean(fields.addressCity)}
                  aria-describedby={describedBy("addressCity", "co-city-error")}
                  value={values.addressCity}
                  onChange={(event) => set("addressCity", event.target.value)}
                  maxLength={120}
                />
                <FieldError id="co-city-error" message={fieldMessage("addressCity")} />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Sposób odbioru — KARTY WYBORU (spec F8) */}
        <fieldset className={SECTION_CARD} disabled={submitting}>
          <legend className={SECTION_LEGEND}>{copy.checkout.deliveryHeading}</legend>
          <p className={SECTION_DESCRIPTION}>{copy.checkout.deliveryDescription}</p>
          <div className={SECTION_FIELDS}>
            <div className="grid grid-cols-1 gap-2">
              {deliveryMethods.map((method) => {
                const free = method.method === "pickup" || method.price_grosze === 0;
                return (
                  <label
                    key={method.method}
                    className={`${CHOICE_CARD} items-center justify-between`}
                    data-checkout-choice="delivery"
                  >
                    <input
                      type="radio"
                      className="peer sr-only"
                      name="deliveryMethod"
                      value={method.method}
                      data-checkout-invalid={fields.deliveryMethod ? "true" : undefined}
                      aria-describedby={describedBy("deliveryMethod", "co-delivery-error")}
                      checked={values.deliveryMethod === method.method}
                      onChange={() => set("deliveryMethod", method.method)}
                    />
                    <span aria-hidden="true" className={CHOICE_INDICATOR} data-checkout-choice-indicator />
                    <span className="relative font-medium">{deliveryLabel(copy, method.method)}</span>
                    <span className="site-text-muted site-numeric relative text-sm whitespace-nowrap">
                      {free
                        ? copy.checkout.deliveryFree
                        : formatMoney(method.price_grosze, currency, locale)}
                    </span>
                  </label>
                );
              })}
              <FieldError id="co-delivery-error" message={fieldMessage("deliveryMethod")} />
            </div>

            {showPickup ? (
              <div className="grid gap-1">
                <label className="site-label text-sm" htmlFor="co-pickup">
                  {copy.checkout.pickupLocation}
                </label>
                {/*
                  Natywny <select> zostaje (dostępność, klawiatura, natywna lista
                  na telefonie), ale systemowa strzałka znika: `appearance-none`
                  zdejmuje ją razem z systemowym tłem, a własna wraca jako
                  warstwa pod spodem. Bez tego pole było jedynym elementem
                  formularza rysowanym przez system operacyjny — obcym wśród
                  pozostałych i innym na każdej platformie.

                  Strzałka jest `pointer-events-none`, więc kliknięcie w nią
                  nadal otwiera listę; `pr-9` rezerwuje jej miejsce, żeby długa
                  nazwa punktu nie wjeżdżała pod ikonę.
                */}
                <div className="relative">
                  <select
                    id="co-pickup"
                    className="site-field h-10 w-full appearance-none px-3 pr-9 text-sm"
                    aria-invalid={Boolean(fields.pickupLocationId)}
                    aria-describedby={describedBy("pickupLocationId", "co-pickup-error")}
                    value={values.pickupLocationId}
                    onChange={(event) => set("pickupLocationId", event.target.value)}
                  >
                    <option value="">{copy.checkout.choosePickup}</option>
                    {pickupLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                        {location.address_city ? ` - ${location.address_city}` : ""}
                      </option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    className="site-text-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </div>
                <FieldError id="co-pickup-error" message={fieldMessage("pickupLocationId")} />
              </div>
            ) : null}
          </div>
        </fieldset>

        {/* Sposób płatności — KARTY WYBORU (spec F8) */}
        <fieldset className={SECTION_CARD} disabled={submitting}>
          <legend className={SECTION_LEGEND}>{copy.checkout.paymentHeading}</legend>
          <p className={SECTION_DESCRIPTION}>{copy.checkout.paymentDescription}</p>
          <div className={SECTION_FIELDS}>
            <div className="grid grid-cols-1 gap-2">
              {paymentMethods.map((method) => (
                <label
                  key={method}
                  className={`${CHOICE_CARD} items-start`}
                  data-checkout-choice="payment"
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    className="peer sr-only"
                    value={method}
                    data-checkout-invalid={fields.paymentMethod ? "true" : undefined}
                    aria-describedby={describedBy("paymentMethod", "co-payment-error")}
                    checked={values.paymentMethod === method}
                    onChange={() => set("paymentMethod", method)}
                  />
                  <span aria-hidden="true" className={CHOICE_INDICATOR} data-checkout-choice-indicator />
                  <span className="relative grid gap-0.5">
                    <span className="font-medium">{paymentLabel(copy, method)}</span>
                    <span className="site-text-muted text-sm">{paymentHint(copy, method)}</span>
                  </span>
                </label>
              ))}
              <FieldError id="co-payment-error" message={fieldMessage("paymentMethod")} />
            </div>

            {/*
              Sklep bez płatności online nie dostaje komunikatu o awarii ani
              wyszarzonej opcji „niedostępne" — dostaje zdanie opisujące, jak
              ta wypożyczalnia się rozlicza (ADR-066). Dla klienta to nie jest
              brak funkcji, tylko informacja o sprzedawcy.
            */}
            {paymentMethods.includes("online") ? null : (
              <p className="site-text-muted text-sm">{copy.checkout.paymentOfflineNote}</p>
            )}
          </div>
        </fieldset>

        {/* Pola własne najemcy (C6-A3) — sekcja znika, gdy najemca ich nie ma. */}
        <CheckoutCustomFields
          definitions={customFields}
          values={values.custom}
          onChange={setCustomField}
          errors={Object.fromEntries(
            customFields.map((definition) => [definition.id, customFieldMessage(definition.id)]),
          )}
          heading={copy.checkout.customFieldsHeading}
          description={copy.checkout.customFieldsDescription}
          requiredLabel={copy.common.required}
          optionalLabel={copy.common.optional}
          choosePlaceholder={copy.checkout.customFieldChoose}
          disabled={submitting}
        />

        {/* Uwagi */}
        <fieldset className={SECTION_CARD} disabled={submitting}>
          <label className={SECTION_LEGEND} htmlFor="co-notes">
            {copy.checkout.notes}{" "}
            <span className="site-text-muted text-sm font-normal">({copy.common.optional})</span>
          </label>
          <textarea
            id="co-notes"
            className="site-field w-full max-w-lg px-3 py-2 text-sm"
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
            maxLength={2000}
            rows={3}
          />
        </fieldset>

        {/* Honeypot — ukryte pole-pułapka na boty (musi zostać puste; S-13:
            aria-hidden + tabIndex=-1 chowają je też przed czytnikiem ekranu). */}
        <div aria-hidden="true" className="sr-only">
          <label htmlFor="co-website">Website</label>
          <input
            id="co-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.honeypot}
            onChange={(event) => set("honeypot", event.target.value)}
          />
        </div>
      </div>

      {/* Podsumowanie + akcje (sticky na desktopie; pełne NAD przyciskiem na mobile) */}
      <aside
        className="site-card grid h-fit grid-cols-1 gap-4 p-5 lg:sticky lg:top-24"
        data-checkout-summary
      >
        <h2 className={`text-[17px] ${SITE_HEADING}`}>{copy.checkout.summaryHeading}</h2>
        <SummaryList rows={summaryRows} total={summaryTotal} />
        {/* Klauzule POD sumą (spec F8): kaucja + kwota szacunkowa, 13 px muted. */}
        <div className="grid gap-1">
          <p className="site-text-muted text-[13px]">{copy.checkout.depositNote}</p>
          <p className="site-text-muted text-[13px]">{copy.common.estimateNote}</p>
        </div>

        {/* Regulamin */}
        {terms ? (
          <>
            <div className="site-rule-top flex items-start gap-3 pt-4">
              {/*
                Natywny checkbox zamiast komponentu panelu: znacznik akceptacji ma
                być w AKCENCIE najemcy (`accent-color`), a nie w kolorze aplikacji.
                24 px (spec F8) — cel dotykowy zgody rośnie do rozmiaru, który da
                się trafić kciukiem.
              */}
              <input
                id="co-terms"
                type="checkbox"
                className="mt-0.5 size-6 shrink-0 accent-[color:var(--site-accent)]"
                aria-invalid={Boolean(fields.terms)}
                aria-describedby={describedBy("terms", "co-terms-error")}
                checked={values.terms}
                onChange={(event) => set("terms", event.target.checked)}
                disabled={submitting}
              />
              {/* Zgoda to tekst ciągły, nie etykieta pola — stąd bez `site-label`. */}
              <label htmlFor="co-terms" className="text-sm leading-6">
                <TermsConsentText copy={copy} terms={terms} />
              </label>
            </div>
            <FieldError id="co-terms-error" message={fields.terms ? copy.checkout.errors.terms : undefined} />
          </>
        ) : (
          /*
            BEZ CHECKBOXA (ADR-191): martwy checkbox sugerowałby, że jest co
            zaakceptować. Zamiast niego zdanie mówiące wprost, dlaczego nie da
            się złożyć zamówienia — wzorzec „powód blokady mówimy wprost"
            (ADR-171/172), ten sam co przy konflikcie terminu niżej.
          */
          <p
            className="site-error-panel site-rule-top mt-4 p-3 text-sm"
            role="alert"
            data-checkout-terms-missing
          >
            {copy.checkout.termsMissingNotice}
          </p>
        )}

        {/*
          SLOT WIDGETU ANTYBOTOWEGO. `min-h` rezerwuje wysokość ZANIM ramka
          dostawcy się wczyta — przycisk pod spodem nie skacze (audyt: pusty
          kontener nie rezerwował miejsca). Rozmiar widgetu z pomiaru slotu —
          patrz `captchaSize` wyżej.
        */}
        {turnstileSiteKey ? (
          <div
            ref={captchaSlotRef}
            data-checkout-captcha
            className={captchaSize === "compact" ? "min-h-[140px]" : "min-h-[65px]"}
          >
            {captchaSize ? (
              <TurnstileWidget
                key={`${captchaEpoch}-${captchaSize}`}
                locale={locale}
                onToken={setCaptchaToken}
                siteKey={turnstileSiteKey}
                size={captchaSize}
              />
            ) : null}
          </div>
        ) : null}

        {/* Pełna szerokość karty podsumowania (spec F8). */}
        <button
          type="submit"
          className="site-cta w-full cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting || term.blocked || !terms}
        >
          {submitting ? copy.checkout.submitting : copy.checkout.submit}
        </button>

        {/*
          POWÓD BLOKADY MÓWIMY WPROST I POD PRZYCISKIEM (ADR-171/172 + spec F8).
          Wyłączony przycisk bez zdania obok jest interfejsem, który odmawia
          i nie tłumaczy — klient widzi, że „nie działa", i nie ma jak się
          dowiedzieć, że rozstrzygnięcie czeka na niego w pasku terminu.
        */}
        {term.blocked ? (
          <p className="site-error-panel p-3 text-sm" role="alert" data-checkout-conflict-blocked>
            {copy.checkout.conflictBlocked}
          </p>
        ) : null}
      </aside>
    </form>
  );
}
