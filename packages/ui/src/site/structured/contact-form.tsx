"use client";

import {
  parseContactMessage,
  type ContactMessageField,
  type ContactMessageFieldErrors,
  type ContactStructuredContent,
  type ContactSubmitResult,
} from "@avably/core/site";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import type { ContactFormBinding, ContactFormLabels, SiteRenderLabels } from "../types";

/**
 * FORMULARZ KONTAKTU (E4, ADR-095) — JEDEN dla sklepu i dla płótna kreatora.
 *
 * ==================== DLACZEGO TU, A NIE W STOREFRONCIE ====================
 *
 * Kusiło napisać formularz w apce (tam jest akcja, tam jest CAPTCHA) i zostawić
 * w rendererze tylko dane kontaktowe. Wtedy jednak płótno kreatora rysowałoby
 * sekcję BEZ formularza, przełącznik „pokaż formularz" nie robiłby na podglądzie
 * nic, a operator dowiadywałby się, jak wygląda jego strona, dopiero po
 * publikacji. Alternatywa — druga, „poglądowa" kopia formularza w pakiecie UI —
 * jest tą samą wadą co fork renderera (ADR-083): dwie definicje tego samego
 * ekranu rozjeżdżają się przy pierwszej poprawce.
 *
 * Formularz stoi więc TUTAJ, a wszystko, czego pakiet UI nie ma prawa mieć,
 * przychodzi WIĄZANIEM (`ContactFormBinding`): akcja serwerowa, bilet z chwili
 * renderu i gotowe drzewo widgetu CAPTCHY. Bez wiązania to samo drzewo renderuje
 * się jako PODGLĄD (`inert`) — identyczne co do piksela, wyjęte z interakcji.
 *
 * ==================== WALIDACJA JEST JEDNA ====================
 *
 * `parseContactMessage` z rdzenia stoi po obu stronach: tutaj (żeby nie płacić
 * przelotem do serwera za literówkę w adresie) i w akcji (bo przeglądarce nie
 * wolno ufać). Druga, „prawie taka sama" reguła w kliencie byłaby gorsza niż
 * brak walidacji klienckiej — przepuszczałaby wejście, które serwer odrzuca.
 *
 * ==================== CZTERY WARSTWY ANTYSPAMU ====================
 *
 * Z formularza widać dwie: PUŁAPKĘ (pole poza ekranem, którego człowiek nie
 * wypełni) i BILET (podpisany znacznik czasu). Pozostałe dwie — CAPTCHA i limit
 * zgłoszeń — stoją po stronie serwera. Pułapka NIE jest tu sprawdzana: gdyby
 * przeglądarka odmawiała wysyłki, bot poznałby regułę po pierwszym odbiciu.
 * Wysyłamy zawsze; rozstrzyga serwer, a odpowiedź jest nieodróżnialna od
 * sukcesu.
 */

/** Klucz komunikatu ogólnego dla statusu, albo `null` gdy status ma inną drogę. */
function generalErrorKey(status: ContactSubmitResult["status"]): keyof ContactFormLabels["errors"] | null {
  switch (status) {
    case "rate_limited":
      return "rateLimited";
    case "captcha_failed":
      return "captcha";
    case "expired":
      return "expired";
    case "unavailable":
      return "unavailable";
    case "server_error":
      return "server";
    case "sent":
    case "validation_error":
      return null;
  }
}

/** Komunikat błędu pola — rodzaj błędu wybiera zdanie, treść daje język strony. */
function fieldErrorText(
  error: ContactMessageFieldErrors[ContactMessageField],
  labels: ContactFormLabels,
): string | null {
  switch (error) {
    case "required":
      return labels.errors.required;
    case "invalid":
      return labels.errors.invalid;
    case "too_long":
      return labels.errors.tooLong;
    default:
      return null;
  }
}

export function StructuredContactForm({
  content,
  sectionId,
  labels,
  binding,
}: {
  content: ContactStructuredContent;
  /** Identyfikator sekcji — serwer wyprowadza z niego adresata. */
  sectionId: string;
  labels: SiteRenderLabels;
  binding?: ContactFormBinding;
}) {
  const id = useId();
  const copy = labels.contactForm;
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<ContactMessageFieldErrors>({});
  const [result, setResult] = useState<ContactSubmitResult | null>(null);
  /*
   * Licznik prób. Zmiana klucza owijki REMONTUJE widget CAPTCHY — token jest
   * jednorazowy, więc po odmowie stary nie ma prawa pojechać drugi raz.
   */
  const [attempt, setAttempt] = useState(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!binding || pending) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => String(data.get(key) ?? "");

    const message = {
      name: text("name"),
      email: text("email"),
      message: text("message"),
      ...(content.askPhone ? { phone: text("phone") } : {}),
    };

    const parsed = parseContactMessage(message, content.askPhone);
    if (!parsed.ok) {
      setFields(parsed.fields);
      setResult(null);
      return;
    }

    setFields({});
    setPending(true);
    try {
      const outcome = await binding.submit({
        ...message,
        sectionId,
        ticket: binding.ticket,
        trap: text("trap"),
        ...(data.get("captchaToken") ? { captchaToken: text("captchaToken") } : {}),
      });
      setResult(outcome);
      if (outcome.status === "validation_error") setFields(outcome.fields);
      // Świeże wyzwanie po KAŻDYM nieudanym podejściu — patrz `attempt`.
      if (outcome.status !== "sent") setAttempt((value) => value + 1);
    } catch {
      // Zerwane połączenie wygląda dla odwiedzającego tak samo jak awaria
      // serwera i ma dostać ten sam, uczciwy komunikat — nigdy cichy sukces.
      setResult({ status: "server_error" });
      setAttempt((value) => value + 1);
    } finally {
      setPending(false);
    }
  }

  if (result?.status === "sent") {
    return (
      <p data-contact-sent role="status" className="site-card site-label m-0 px-4 py-3">
        {copy.success}
      </p>
    );
  }

  const generalKey = result ? generalErrorKey(result.status) : null;

  return (
    <form
      data-contact-form={binding ? "live" : "preview"}
      /*
       * PODGLĄD JEST INERTNY, nie wyłączony polami: `disabled` na każdym polu
       * przemalowałoby formularz na szaro i płótno przestałoby pokazywać to,
       * co zobaczy klient. `inert` zabiera interakcję, zostawiając wygląd.
       */
      inert={binding ? undefined : true}
      /*
       * Walidację robimy sami (`noValidate`): natywne dymki przeglądarki nie
       * biorą koloru z motywu, nie mówią językiem strony i zatrzymują wysyłkę
       * PRZED naszą regułą — czyli przed jedyną, która jest wspólna z serwerem.
       */
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4"
    >
      <h3 id={`${id}-title`} className="site-label m-0 text-lg">
        {copy.title}
      </h3>

      <Field id={`${id}-name`} name="name" label={copy.name} error={fieldErrorText(fields.name, copy)} />
      <Field
        id={`${id}-email`}
        name="email"
        type="email"
        label={copy.email}
        error={fieldErrorText(fields.email, copy)}
      />
      {content.askPhone ? (
        <Field
          id={`${id}-phone`}
          name="phone"
          type="tel"
          label={copy.phone}
          error={fieldErrorText(fields.phone, copy)}
        />
      ) : null}
      <Field
        id={`${id}-message`}
        name="message"
        multiline
        label={copy.message}
        error={fieldErrorText(fields.message, copy)}
      />

      <Honeypot id={`${id}-trap`} />

      {binding?.captcha ? <div key={`captcha-${attempt}`}>{binding.captcha}</div> : null}

      {generalKey ? (
        <p data-contact-error role="alert" className="site-error m-0 text-sm">
          {copy.errors[generalKey]}
        </p>
      ) : null}

      <div>
        <button type="submit" data-contact-submit className="site-cta cursor-pointer" disabled={pending}>
          {pending ? copy.sending : copy.submit}
        </button>
      </div>

      <p className="site-text-muted m-0 text-sm">
        {copy.privacyNote}
        {content.privacyHref ? (
          <>
            {" "}
            <a data-contact-privacy className="site-link" href={content.privacyHref}>
              {copy.privacyLink}
            </a>
          </>
        ) : null}
      </p>
    </form>
  );
}

/**
 * Pole formularza. Etykieta jest POWIĄZANA (`htmlFor`), a nie postawiona obok —
 * bez tego kliknięcie w napis nie ustawia fokusu, a czytnik ekranu czyta pole
 * jako bezimienne. Komunikat błędu wchodzi do `aria-describedby`, więc jest
 * słyszalny w chwili wejścia w pole, a nie tylko widoczny obok niego.
 */
function Field({
  id,
  name,
  label,
  error,
  type = "text",
  multiline = false,
}: {
  id: string;
  name: string;
  label: string;
  error: string | null;
  type?: string;
  multiline?: boolean;
}): ReactNode {
  const describedBy = error ? `${id}-error` : undefined;
  const shared = {
    id,
    name,
    "data-contact-field": name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: "site-field w-full px-3 py-2",
  } as const;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="site-label text-sm">
        {label}
      </label>
      {multiline ? <textarea {...shared} rows={5} /> : <input {...shared} type={type} />}
      {error ? (
        <p id={describedBy} data-contact-field-error={name} className="site-error m-0 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * PUŁAPKA. Pole realne dla przeglądarki, niewidoczne dla człowieka i wyjęte
 * z nawigacji klawiaturą (`tabIndex={-1}`) oraz z drzewa dostępności
 * (`aria-hidden`), żeby nie trafiło do czytnika ekranu jako pole do wypełnienia.
 *
 * ODSUNIĘTE POZA EKRAN, a nie `display:none`: ukrycie właściwością, którą łatwo
 * sprawdzić, jest dla bota pierwszą podpowiedzią, czego nie wypełniać. Nazwa
 * pola też nie mówi „honeypot" — jest nią zwykły, spodziewany w formularzach
 * `trap` wypełniany wyłącznie przez to, co wypełnia wszystko.
 *
 * `autoComplete="off"`: bez tego menedżer haseł potrafi wstawić tu wartość
 * i zamienić człowieka w bota.
 */
function Honeypot({ id }: { id: string }) {
  return (
    <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
      <label htmlFor={id}>Nie wypełniaj tego pola</label>
      <input id={id} name="trap" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
