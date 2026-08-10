"use client";

/**
 * Widget rezerwacji w ramce (M3, ADR-120).
 *
 * Żyje na NASZYM origin, więc ma zwykły dostęp do własnego DOM-u i wysyła
 * `fetch` same-origin. Strona gospodarza nie widzi ani tego, co klient wpisuje,
 * ani odpowiedzi serwera — to jest cała różnica względem wariantu ze skryptem
 * renderującym w cudzym DOM (patrz ADR-120, rozważone alternatywy).
 *
 * KALENDARZ KOSZTUJE JEDNO ŻĄDANIE NA MIESIĄC. Rozstrzyganie dni siedzi na
 * serwerze (lib/embed/month.ts) — przeglądarka pyta raz o `?month=YYYY-MM`
 * i dostaje gotową mapę. Klient dodatkowo pamięta pobrane miesiące, więc
 * wędrówka tam i z powrotem po kalendarzu nie generuje ruchu. To jest
 * grzeczność klienta, NIE zapora — zaporą jest dławienie po stronie API.
 *
 * DZIEŃ NIEROZSTRZYGNIĘTY MALUJE SIĘ INACZEJ NIŻ ZAJĘTY (ADR-114, decyzja 2b):
 * `days[d] === 0` to „API powiedziało: zajęty", a dzień z listy `unresolved`
 * dostaje wygląd neutralny i jest nieklikalny. Kalendarz nie zgaduje.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CUSTOM_FIELD_LIMITS, type CustomFieldDefinition } from "@avably/core";

import { EMBED_MONTH_PATH, EMBED_RESERVATION_PATH, type EmbedMonthPayload, type EmbedTheme } from "@/lib/embed/contract";
import { EMBED_RESIZE_MESSAGE } from "@/lib/embed/loader";
import { format } from "@/lib/storefront/copy";
import type { StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";
import { STOREFRONT_TERMS_VERSION } from "@/lib/storefront/constants";
import type {
  PublicCatalogProduct,
  PublicDeliveryMethod,
  PublicPickupLocation,
} from "@/lib/checkout/contract";

type DayState = "free" | "busy" | "unknown" | "past";

/**
 * Pole własne najemcy w ramce embedu (C6-A3, ADR-121).
 *
 * Kontrolka NIEKONTROLOWANA (bez stanu Reacta): cały formularz embedu czyta
 * się `new FormData(form)` przy wysyłce, więc pole własne wpina się tą samą
 * drogą co `notes` czy `phone` — bez dokładania stanu, którego reszta
 * formularza nie ma.
 *
 * `required` jest tu WYŁĄCZNIE wygodą przeglądarki. Wymagalność rozstrzyga
 * serwer po definicjach najemcy (atrybut w cudzej ramce da się usunąć
 * inspektorem), a jego odmowa wraca kluczem `cf_<id>` i ląduje pod polem.
 */
export function EmbedCustomField({
  definition,
  error,
  invalidLabel,
  chooseLabel,
}: {
  definition: CustomFieldDefinition;
  error: string | undefined;
  invalidLabel: string;
  chooseLabel: string;
}) {
  const name = `cf_${definition.id}`;
  const message = error ? <em>{invalidLabel}</em> : null;

  if (definition.type === "checkbox") {
    return (
      <label className="avably-embed__terms">
        <input type="checkbox" name={name} required={definition.required} />
        <span>{definition.label}</span>
        {message}
      </label>
    );
  }

  return (
    <label className="avably-embed__field">
      <span>{definition.label}</span>
      {definition.type === "textarea" ? (
        <textarea name={name} required={definition.required} maxLength={CUSTOM_FIELD_LIMITS.textareaMax} rows={2} />
      ) : definition.type === "select" ? (
        <select name={name} required={definition.required} defaultValue="">
          <option value="">{chooseLabel}</option>
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          required={definition.required}
          // `number` jedzie tekstem z klawiaturą numeryczną: type="number"
          // odrzuca przecinek dziesiętny po cichu, a parser rdzenia go zna.
          type={definition.type === "date" ? "date" : definition.type === "phone" ? "tel" : "text"}
          {...(definition.type === "number" ? { inputMode: "decimal" as const } : {})}
          {...(definition.type === "text" ? { maxLength: CUSTOM_FIELD_LIMITS.textMax } : {})}
          {...(definition.type === "phone" ? { maxLength: 30 } : {})}
        />
      )}
      {definition.helpText ? <small>{definition.helpText}</small> : null}
      {message}
    </label>
  );
}

interface Props {
  copy: StorefrontCopy;
  locale: StorefrontLocale;
  currency: string;
  products: PublicCatalogProduct[];
  pickupLocations: PublicPickupLocation[];
  deliveryMethods: PublicDeliveryMethod[];
  initialProductId: string | null;
  theme: EmbedTheme;
  /**
   * Opublikowany regulamin najemcy (B4/R18) — etykieta wersji z BAZY
   * i adres do jego przeczytania. `undefined` = najemca nie opublikował
   * regulaminu; wtedy widget zachowuje się dokładnie jak przed B4.
   */
  terms?: { href: string; versionLabel: string } | undefined;
  /**
   * Pola własne DO WYPEŁNIENIA (C6-A3, ADR-121), zawężone na SERWERZE tą samą
   * funkcją, którą stosuje zapis. Embed jest trzecią powierzchnią na tym samym
   * rdzeniu, więc musi je renderować — inaczej najemca z polem WYMAGANYM
   * miałby w ramce formularz, który serwer zawsze odrzuca.
   */
  customFields: CustomFieldDefinition[];
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysOfMonth(month: string): string[] {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const days: string[] = [];
  const cursor = new Date(Date.UTC(year, index - 1, 1));
  while (cursor.getUTCMonth() === index - 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Poniedziałek = 0. Siatka zaczyna tydzień od poniedziałku w obu locale. */
function weekdayIndex(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Dyskretny podpis „Powered by Avably" (M3, ADR-120).
 *
 * Logo bierzemy z JEDYNEGO miejsca, w którym znak marki żyje w repo —
 * `/forerunner/images/avably-logo-{dark,light}.svg`, tych samych plików, co
 * nawigacja i stopka stron marketingowych. Świadomie `<img>` do pliku, a nie
 * wklejone inline ścieżki SVG: wklejenie zrobiłoby DRUGĄ kopię znaku, która
 * po zmianie brandingu cicho by się rozjechała.
 *
 * Wariant wybiera MOTYW, nie preferencja systemu: znak z ciemnym tuszem na
 * jasnym tle i odwrotnie (to samo przyporządkowanie, co w nawigacji LP).
 *
 * Ścieżka bez prefiksu tenanta i z kropką w nazwie — więc omija proxy, a tym
 * samym bramkę hasła; inaczej na cudzej stronie logo wracałoby jako 401.
 */
function Stopka({ theme, label }: { theme: EmbedTheme; label: string }) {
  return (
    <p className="avably-embed__footer" data-embed-footer>
      <img
        src={`/forerunner/images/avably-logo-${theme === "dark" ? "light" : "dark"}.svg`}
        alt={label}
        width={348}
        height={93}
        loading="lazy"
        decoding="async"
        data-embed-logo
      />
    </p>
  );
}

export function EmbedWidget(props: Props) {
  const { copy, locale, products, pickupLocations, deliveryMethods, theme, customFields, terms } =
    props;
  const t = copy.embed;

  const [productId, setProductId] = useState<string | null>(props.initialProductId);
  const [month, setMonth] = useState<string>(() => monthOf(isoToday()));
  const [months, setMonths] = useState<Record<string, EmbedMonthPayload>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Klucze już pobierane — chroni przed drugim żądaniem na ten sam miesiąc. */
  const requested = useRef<Set<string>>(new Set());
  const today = isoToday();

  const supportsPickup = deliveryMethods.some((method) => method.method === "pickup");
  const [deliveryMethod, setDeliveryMethod] = useState<string>(
    supportsPickup ? "pickup" : (deliveryMethods[0]?.method ?? "pickup"),
  );

  /** Wysokość do gospodarza. ResizeObserver, bo treść rośnie po wyborze terminu. */
  useEffect(() => {
    const node = rootRef.current;
    if (node === null || window.parent === window) return;
    const report = () => {
      window.parent.postMessage(
        { type: EMBED_RESIZE_MESSAGE, height: node.getBoundingClientRect().height + 8 },
        // Cel wiadomości to origin RODZICA, którego nie znamy i nie wolno nam
        // zgadywać z document.referrer. "*" jest tu bezpieczne, bo ładunkiem
        // jest wyłącznie liczba pikseli — żadnej treści, żadnych danych klienta.
        "*",
      );
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const monthKey = productId === null ? null : `${productId}:${month}`;

  /**
   * JEDNO żądanie na miesiąc. Serwer oddaje gotową mapę dni, więc front nie ma
   * po co pytać o pojedyncze dni — a `requested` pilnuje, żeby powrót do już
   * odwiedzonego miesiąca nie generował ruchu w ogóle.
   *
   * Bez `setState` synchronicznie w ciele efektu (react-hooks/set-state-in-effect):
   * stan „ładuję" jest WYPROWADZONY z braku mapy dla bieżącego klucza, a nie
   * trzymany osobno — jedno źródło prawdy zamiast dwóch, które mogą się rozjechać.
   */
  const loadMonth = useCallback(async (targetProduct: string, targetMonth: string) => {
    const key = `${targetProduct}:${targetMonth}`;
    try {
      const params = new URLSearchParams({ product: targetProduct, month: targetMonth });
      const response = await fetch(`${EMBED_MONTH_PATH}?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        requested.current.delete(key);
        return;
      }
      const loaded = (await response.json()) as EmbedMonthPayload;
      setMonths((current) => ({ ...current, [key]: loaded }));
    } catch {
      // Cisza jest tu celowa: kalendarz zostaje bez mapy, więc dni wychodzą
      // jako „sprawdzanie dostępności", a nie jako wolne albo zajęte.
      requested.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (productId === null || monthKey === null) return;
    if (requested.current.has(monthKey)) return;
    requested.current.add(monthKey);
    void loadMonth(productId, month);
  }, [productId, month, monthKey, loadMonth]);

  const payload = monthKey === null ? undefined : months[monthKey];
  const unresolvedSet = useMemo(
    () => new Set(payload?.unresolved ?? []),
    [payload],
  );

  const dayState = useCallback(
    (iso: string): DayState => {
      if (iso < today) return "past";
      if (payload === undefined) return "unknown";
      if (unresolvedSet.has(iso)) return "unknown";
      const units = payload.days[iso];
      if (units === undefined) return "unknown";
      return units > 0 ? "free" : "busy";
    },
    [payload, today, unresolvedSet],
  );

  const onDayClick = (iso: string) => {
    if (dayState(iso) !== "free") return;
    if (from === null || to !== null) {
      setFrom(iso);
      setTo(null);
      return;
    }
    if (iso < from) {
      setFrom(iso);
      return;
    }
    setTo(iso);
  };

  const inRange = (iso: string): boolean => {
    if (from === null) return false;
    if (to === null) return iso === from;
    return iso >= from && iso <= to;
  };

  const selectedProduct = products.find((product) => product.id === productId) ?? null;
  const rentalDays = from !== null && to !== null ? daysBetweenInclusive(from, to) : 0;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (productId === null || from === null || to === null || submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      email: String(data.get("email") ?? ""),
      fullName: String(data.get("fullName") ?? ""),
      phone: String(data.get("phone") ?? ""),
      startDate: from,
      endDate: to,
      deliveryMethod,
      paymentMethod: String(data.get("paymentMethod") ?? "transfer"),
      items: [{ productId, quantity: 1 }],
      termsAccepted: data.get("termsAccepted") === "on",
      // Etykieta z opublikowanego dokumentu; stała TYLKO gdy najemca
      // żadnego nie opublikował (B4/R18).
      termsVersion: terms?.versionLabel ?? STOREFRONT_TERMS_VERSION,
      locale,
      notes: String(data.get("notes") ?? ""),
      // Wartości trzymamy STRINGAMI, jak wychodzą z kontrolek — typowanie robi
      // serwer tym samym parserem, którym czyta je sklep i wtyczka WordPress.
      customFields: Object.fromEntries(
        customFields.map((definition) => [
          definition.id,
          String(data.get(`cf_${definition.id}`) ?? ""),
        ]),
      ),
    };
    if (deliveryMethod === "pickup") {
      body.pickupLocationId = String(data.get("pickupLocationId") ?? "");
    } else {
      body.addressStreet = String(data.get("addressStreet") ?? "");
      body.addressZip = String(data.get("addressZip") ?? "");
      body.addressCity = String(data.get("addressCity") ?? "");
    }

    try {
      const response = await fetch(EMBED_RESERVATION_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as
        | { status: "success"; order: { orderNumber: string } }
        | { error: { code: string; fields?: Record<string, string> } };

      if (response.status === 201 && "status" in result) {
        setOrderNumber(result.order.orderNumber);
        // Mapa miesiąca się zdezaktualizowała — kolejny klient nie ma widzieć
        // właśnie zajętego terminu jako wolnego.
        setMonths({});
        requested.current.clear();
        setFrom(null);
        setTo(null);
        return;
      }

      const code = "error" in result ? result.error.code : "server_error";
      if ("error" in result && result.error.fields) setFieldErrors(result.error.fields);
      setFormError(
        code === "conflict"
          ? t.errorConflict
          : code === "rate_limited"
            ? t.errorRateLimited
            : code === "validation_failed"
              ? t.errorValidation
              : code === "store_unavailable" || code === "forbidden_origin"
                ? t.errorUnavailable
                : t.errorGeneric,
      );
    } catch {
      setFormError(t.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  // Nagłówki dni tygodnia. Bez nich kolumny trzeba liczyć palcem, a wybór
  // terminu jest w tym widgecie JEDYNĄ czynnością. Kolejność od poniedziałku —
  // zgodna z `weekdayIndex` wyżej, w obu językach.
  const weekdayLabels = [
    t.weekdayMon, t.weekdayTue, t.weekdayWed,
    t.weekdayThu, t.weekdayFri, t.weekdaySat, t.weekdaySun,
  ];

  const grid = daysOfMonth(month);
  const leadingBlanks = grid.length > 0 ? weekdayIndex(grid[0]!) : 0;
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

  if (orderNumber !== null) {
    return (
      <div ref={rootRef} data-embed-root data-embed-theme={theme} className="avably-embed">
        <div className="avably-embed__done" data-embed-confirmed>
          <h2>{t.confirmedHeading}</h2>
          <p data-embed-order-number>{format(t.confirmedNumber, { number: orderNumber })}</p>
          <p>{t.confirmedBody}</p>
          <button type="button" onClick={() => setOrderNumber(null)}>
            {t.newReservation}
          </button>
        </div>
        <Stopka theme={theme} label={t.poweredBy} />
      </div>
    );
  }

  return (
    <div ref={rootRef} data-embed-root data-embed-theme={theme} className="avably-embed">
      <h2 className="avably-embed__title">{t.heading}</h2>

      {products.length > 1 ? (
        <label className="avably-embed__field">
          <span>{t.productLabel}</span>
          <select
            data-embed-product
            value={productId ?? ""}
            onChange={(event) => {
              setProductId(event.target.value);
              setFrom(null);
              setTo(null);
            }}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      ) : selectedProduct !== null ? (
        <p className="avably-embed__product" data-embed-product>
          {selectedProduct.name}
        </p>
      ) : null}

      <div className="avably-embed__layout">
      <section className="avably-embed__calendar" data-embed-calendar>
        <header>
          <button type="button" aria-label={t.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <strong data-embed-month={month}>{monthLabel}</strong>
          <button type="button" aria-label={t.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </header>

        <div className="avably-embed__weekdays" aria-hidden>
          {weekdayLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>

        <div className="avably-embed__grid" role="grid">
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <span key={`blank-${index}`} className="avably-embed__blank" />
          ))}
          {grid.map((iso) => {
            const state = dayState(iso);
            return (
              <button
                key={iso}
                type="button"
                data-embed-day={iso}
                data-embed-day-state={state}
                data-embed-selected={inRange(iso) ? "true" : undefined}
                disabled={state !== "free"}
                onClick={() => onDayClick(iso)}
              >
                {Number(iso.slice(8, 10))}
              </button>
            );
          })}
        </div>

        {payload === undefined ? <p className="avably-embed__note">{t.loadingMonth}</p> : null}
        {payload?.partial ? (
          <p className="avably-embed__note" data-embed-partial>
            {t.partialNote}
          </p>
        ) : null}

        <p className="avably-embed__hint">
          {from !== null && to !== null
            ? `${format(t.selectedRange, { from, to })} · ${format(t.daysLabel, { days: rentalDays })}`
            : t.rangeHint}
        </p>
        {from !== null ? (
          <button
            type="button"
            className="avably-embed__link"
            onClick={() => {
              setFrom(null);
              setTo(null);
            }}
          >
            {t.clearRange}
          </button>
        ) : null}
      </section>

      {from !== null && to !== null ? (
        <form onSubmit={onSubmit} data-embed-form className="avably-embed__form">
          <h3>{t.contactHeading}</h3>

          <label className="avably-embed__field">
            <span>{t.fullName}</span>
            <input name="fullName" required maxLength={200} autoComplete="name" />
            {fieldErrors.fullName ? <em>{t.invalidField}</em> : null}
          </label>

          <label className="avably-embed__field">
            <span>{t.email}</span>
            <input name="email" type="email" required maxLength={320} autoComplete="email" />
            {fieldErrors.email ? <em>{t.invalidField}</em> : null}
          </label>

          <label className="avably-embed__field">
            <span>{t.phone}</span>
            <input name="phone" type="tel" maxLength={32} autoComplete="tel" />
            {fieldErrors.phone ? <em>{t.invalidField}</em> : null}
          </label>

          <h3>{t.deliveryHeading}</h3>
          <div className="avably-embed__choices">
            {deliveryMethods.map((method) => (
              <label key={method.method}>
                <input
                  type="radio"
                  name="deliveryMethodChoice"
                  value={method.method}
                  checked={deliveryMethod === method.method}
                  onChange={() => setDeliveryMethod(method.method)}
                />
                <span>{method.method === "pickup" ? t.methodPickup : t.methodCourier}</span>
              </label>
            ))}
          </div>

          {deliveryMethod === "pickup" ? (
            <label className="avably-embed__field">
              <span>{t.pickupLocation}</span>
              <select name="pickupLocationId" required defaultValue="">
                <option value="" disabled>
                  {t.choosePickup}
                </option>
                {pickupLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="avably-embed__field">
                <span>{t.addressStreet}</span>
                <input name="addressStreet" required maxLength={200} autoComplete="street-address" />
              </label>
              <label className="avably-embed__field">
                <span>{t.addressZip}</span>
                <input name="addressZip" required maxLength={20} autoComplete="postal-code" />
              </label>
              <label className="avably-embed__field">
                <span>{t.addressCity}</span>
                <input name="addressCity" required maxLength={120} autoComplete="address-level2" />
              </label>
            </>
          )}

          <h3>{t.paymentHeading}</h3>
          <div className="avably-embed__choices">
            {/*
              Płatność online (M4) świadomie NIEREPREZENTOWALNA w tym formularzu —
              tor online wymaga przekierowania do dostawcy, a przekierowanie
              wewnątrz cudzej ramki jest wektorem, którego nie chcemy tu otwierać.
            */}
            <label>
              <input type="radio" name="paymentMethod" value="transfer" defaultChecked />
              <span>{t.paymentTransfer}</span>
            </label>
            <label>
              <input type="radio" name="paymentMethod" value="cod" />
              <span>{t.paymentCod}</span>
            </label>
          </div>

          {customFields.length > 0 ? (
            <>
              <h3>{t.customFieldsHeading}</h3>
              {customFields.map((definition) => (
                <EmbedCustomField
                  key={definition.id}
                  definition={definition}
                  error={fieldErrors[`cf_${definition.id}`]}
                  invalidLabel={t.invalidField}
                  chooseLabel={t.customFieldChoose}
                />
              ))}
            </>
          ) : null}

          <label className="avably-embed__field">
            <span>{t.notes}</span>
            <textarea name="notes" maxLength={2000} rows={2} />
          </label>

          <label className="avably-embed__terms">
            <input type="checkbox" name="termsAccepted" required />
            {/*
              Link otwiera się w NOWEJ karcie i celowo bez `opener`: ramka stoi
              na cudzej stronie, więc nawigacja w miejscu zabrałaby klientowi
              wypełniony formularz, a `noreferrer` odcina uchwyt do okna.
            */}
            <span>
              {t.termsLabel}
              {terms ? (
                <>
                  {" "}
                  <a href={terms.href} target="_blank" rel="noreferrer" data-embed-terms-link>
                    {copy.checkout.termsLinkText}
                  </a>{" "}
                  ({terms.versionLabel})
                </>
              ) : null}
            </span>
          </label>

          {formError !== null ? (
            <p className="avably-embed__error" data-embed-error role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" disabled={submitting} data-embed-submit>
            {submitting ? t.submitting : t.submit}
          </button>
        </form>
      ) : null}
      </div>

      <Stopka theme={theme} label={t.poweredBy} />
    </div>
  );
}
