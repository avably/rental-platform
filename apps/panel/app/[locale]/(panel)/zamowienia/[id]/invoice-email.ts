/**
 * Faktura DORĘCZANA klientowi — walidacja pliku i złożenie wiadomości
 * (D3, ADR-076).
 *
 * ============== CO TEN MODUŁ ROBI, A CZEGO NIE ROBI ==============
 *
 * Bierze PDF, który operator wskazał ze swojego dysku, i składa z niego
 * wiadomość z załącznikiem. FAKTURY NIE WYSTAWIA i nie ma tu ani jednej
 * linii, która by ją liczyła: numeracji, stawek VAT, rozbicia kwot ani
 * danych stron. To granica ŚWIADOMA — wystawienie faktury niesie wymagania
 * (ciągła numeracja per sprzedawca, komplet danych nabywcy i sprzedawcy,
 * poprawna stawka i rozbicie podatku, tryb korekt), których nie wolno
 * zgadywać, a błąd w nich jest problemem księgowym właściciela, nie usterką
 * ekranu. Fakturę wystawia jego księgowość; my ją doręczamy i zostawiamy
 * ślad, że doręczyliśmy.
 *
 * ============== DLACZEGO SZABLON JEST TUTAJ, A NIE W @avably/emails ==============
 *
 * Szablony e-mail to pas GPT (`packages/emails`), a to zadanie nie ma prawa
 * w niego wejść. Treść jest więc złożona na miejscu, ze STAŁYCH SKOPIOWANYCH
 * z `packages/emails/src/styles.ts` — kopia jest jawna i opisana, żeby przy
 * przenosinach do `@avably/emails` (odnotowane jako dług w dokumentacji) było
 * widać, co z czym zestroić. Ramka odwzorowuje `RentalEmailLayout`, bo klient
 * dostaje tę wiadomość obok potwierdzeń i umowy, a wiadomość wyglądająca
 * inaczej niż reszta korespondencji wypożyczalni czyta się jak phishing.
 *
 * ============== JĘZYK ==============
 *
 * Locale ODBIORCY (ADR-037), nie operatora — dlatego katalog treści jest
 * `Record<Locale, …>` w tym pliku, a nie `getTranslations` z next-intl:
 * tamto renderuje w języku zalogowanego operatora i wysłałoby polską
 * wiadomość klientowi z Berlina.
 */
import { platformFromAddress, type Locale, type OutgoingEmail } from "@avably/core";

/* ── Walidacja pliku ──────────────────────────────────────────────────── */

/**
 * Górny limit rozmiaru faktury.
 *
 * NIE BIERZE SIĘ Z LIMITU DOSTAWCY, tylko z najniższego sufitu na drodze
 * pliku — i to jest cała trudność tej liczby. Sufity są trzy:
 *
 *   1. dostawca poczty: ~40 MB na CAŁĄ wiadomość, liczone PO zakodowaniu
 *      base64 (+33%), więc realnie ~30 MB pliku;
 *   2. akcje serwerowe Next: domyślnie 1 MB, podniesione w `next.config.ts`
 *      do 12 MB (tam uzasadnienie);
 *   3. KLON CIAŁA ŻĄDANIA DLA WARSTWY POŚREDNICZĄCEJ (`proxy.ts`):
 *      `middlewareClientMaxBodySize`, domyślnie 10 MB — i to jest sufit
 *      NAJNIŻSZY. Powyżej niego ciało jest OBCINANE, zanim akcja je
 *      zobaczy, a operator dostaje 500 „Unexpected end of form" zamiast
 *      zdania o limicie (zmierzone, nie wywnioskowane).
 *
 * 8 MB stoi wyraźnie pod najniższym z nich, z zapasem na obwiednie
 * multipart — więc odmową rusza ZAWSZE nasza bramka, z powodem, a nie
 * framework bez powodu. Limit ogłoszony musi być limitem osiągalnym:
 * gdyby interfejs obiecywał 10 MB, plik 9,5 MB kończyłby się błędem
 * serwera przy komunikacie mówiącym, że jest w normie.
 *
 * Dla faktur to nadal ogromny zapas — wystawiona z systemu księgowego waży
 * dziesiątki kilobajtów, skan papierowej rzadko przekracza 3 MB. Liczba
 * jest POKAZANA w interfejsie: limit, którego operator nie zna, objawia
 * się jako odmowa bez powodu.
 */
export const INVOICE_MAX_BYTES = 8 * 1024 * 1024;

/** Ta sama liczba do komunikatów — bez dzielenia w trzech miejscach. */
export const INVOICE_MAX_MB = INVOICE_MAX_BYTES / (1024 * 1024);

export const INVOICE_MIME_TYPE = "application/pdf";

/**
 * Powód odmowy. KOD, nie zdanie: komunikat składa warstwa widoku w języku
 * operatora (parytet EN↔PL), a moduł domenowy nie ma prawa decydować o tym,
 * w jakim języku mówi panel.
 */
export type InvoiceFileProblem = "missing" | "empty" | "type" | "size";

/** Nagłówek pliku PDF — pierwsze pięć bajtów każdego poprawnego dokumentu. */
const PDF_MAGIC = "%PDF-";

/**
 * Sprawdza plik i zwraca POWÓD odmowy albo null.
 *
 * DWIE BRAMKI NA TYP, NIE JEDNA. `File.type` w przeglądarce bierze się
 * z ROZSZERZENIA, więc dowolny plik przemianowany na `.pdf` zadeklaruje się
 * jako `application/pdf`. Sam nagłówek też nie wystarczy (plik może nie mieć
 * rozszerzenia, a wtedy typ bywa pusty), więc sprawdzamy oba: deklarację
 * i pierwsze bajty. Kosztuje to jeden odczyt pięciu bajtów, a broni przed
 * wysłaniem klientowi „faktury", której nie da się otworzyć — czyli przed
 * błędem, o którym dowiedzielibyśmy się od niego, nie od siebie.
 *
 * KOLEJNOŚĆ BRAMEK JEST CELOWA: rozmiar przed treścią, bo odczyt bajtów
 * z pliku ponadwymiarowego byłby pracą wykonaną po to, żeby go i tak odrzucić.
 */
export function checkInvoiceFile(
  file: { size: number; type: string } | null | undefined,
  headBytes?: Uint8Array,
): InvoiceFileProblem | null {
  if (!file) return "missing";
  if (file.size <= 0) return "empty";
  if (file.size > INVOICE_MAX_BYTES) return "size";
  if (file.type !== INVOICE_MIME_TYPE) return "type";
  if (headBytes && !startsWithPdfMagic(headBytes)) return "type";
  return null;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let index = 0; index < PDF_MAGIC.length; index += 1) {
    if (bytes[index] !== PDF_MAGIC.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Nazwa załącznika = nazwa OPERATORA, oczyszczona.
 *
 * Nie zastępujemy jej własną (`faktura-AV-2026-001.pdf`), choć byłoby to
 * prostsze: plik z księgowości nazywa się zwykle numerem faktury, a to
 * jedyne miejsce, w którym ten numer w ogóle u nas występuje — my go nie
 * znamy i znać nie chcemy (ADR-076). Zastąpienie nazwy wyrzucałoby tę
 * informację klientowi z rąk.
 *
 * Czyszczenie jest konieczne, bo nazwa idzie do nagłówka wiadomości:
 * separatory ścieżek, cudzysłowy i znaki sterujące potrafią ten nagłówek
 * rozbić. Gdy po oczyszczeniu nie zostaje nic sensownego, wracamy do nazwy
 * własnej — załącznik bez nazwy jest gorszy niż załącznik nazwany zamówieniem.
 */
export function invoiceAttachmentFilename(original: string, orderNumber: string): string {
  const base = original
    // Separatory ścieżek, cudzysłowy, średnik i znaki sterujące (w tym CR/LF,
    // którymi da się dopisać własny nagłówek) — wszystko poza wiadomością.
    // eslint-disable-next-line no-control-regex -- o znaki sterujące właśnie chodzi
    .replace(/[\u0000-\u001f\u007f\\/"'`;]/g, "")
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 120)
    .trim();
  const fallback = `faktura-${orderNumber}`.replace(/[\\/\s]/g, "-");
  return `${base.length > 0 ? base : fallback}.pdf`;
}

/* ── Treść wiadomości ─────────────────────────────────────────────────── */

interface InvoiceEmailMessages {
  subject: (orderNumber: string) => string;
  preview: (orderNumber: string) => string;
  heading: string;
  greeting: (customerName: string) => string;
  body: string;
  orderNumberLabel: string;
  attachmentHint: string;
  footer: string;
}

/**
 * Katalog treści per język odbiorcy. `Record<Locale, …>` z rozmysłem —
 * brakujące tłumaczenie ma być błędem kompilacji, nie pustym miejscem
 * w wiadomości u klienta (ta sama zasada co w `@avably/emails`).
 *
 * Treść mówi „przesyłamy fakturę", a NIE „wystawiliśmy fakturę": drugie
 * zdanie byłoby nieprawdą o tym, co się stało (ADR-076).
 */
const INVOICE_EMAIL_MESSAGES: Record<Locale, InvoiceEmailMessages> = {
  pl: {
    subject: (orderNumber) => `Faktura do zamówienia ${orderNumber}`,
    preview: (orderNumber) => `Faktura do zamówienia ${orderNumber} w załączniku.`,
    heading: "Faktura",
    greeting: (customerName) => `Cześć, ${customerName}!`,
    body: "Przesyłamy fakturę dotyczącą Twojego zamówienia.",
    orderNumberLabel: "Numer zamówienia",
    attachmentHint: "Faktura (PDF) znajduje się w załączniku tej wiadomości.",
    footer: "To wiadomość automatyczna dotycząca Twojego zamówienia.",
  },
  en: {
    subject: (orderNumber) => `Invoice for order ${orderNumber}`,
    preview: (orderNumber) => `The invoice for order ${orderNumber} is attached.`,
    heading: "Invoice",
    greeting: (customerName) => `Hi ${customerName}!`,
    body: "Please find the invoice for your order attached.",
    orderNumberLabel: "Order number",
    attachmentHint: "The invoice (PDF) is attached to this message.",
    footer: "This is an automated message about your order.",
  },
};

/**
 * Stałe wyglądu SKOPIOWANE z `packages/emails/src/styles.ts` (pas GPT —
 * patrz nagłówek pliku). Zestrojenie z tamtym plikiem jest ręczne i to jest
 * cena zostania we własnym pasie; dług odnotowany w dokumentacji.
 */
const COLORS = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  muted: "#f7f7f7",
  mutedForeground: "#555555",
  border: "#e8e8e8",
} as const;
/**
 * APOSTROFY WOKÓŁ „Segoe UI", NIE CUDZYSŁOWY — i to nie jest kosmetyka.
 * `packages/emails` trzyma tę listę dla Reacta, który sam koduje wartość
 * atrybutu; tutaj sklejamy HTML jako tekst, więc cudzysłów wewnątrz
 * `style="…"` ZAMYKA ATRYBUT: reszta deklaracji (marginesy, kolor tła)
 * wypada ze stylu, a przeglądarka poczty widzi w tym miejscu przypadkowe
 * atrybuty. Złapane na przechwyconym żądaniu do dostawcy, nie w kodzie —
 * w HTML-u wyglądało to jak poprawny styl.
 */
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

/**
 * Escapowanie WSZYSTKIEGO, co pochodzi z danych.
 *
 * Nazwa tenanta, nazwisko klienta i numer zamówienia wchodzą do HTML-a,
 * a ten HTML trafia potem do `email_logs.body` i jest pokazywany operatorowi
 * w podglądzie historii (ADR-073). Ramka podglądu jest wprawdzie odizolowana
 * (`sandbox=""`), ale obrona przed wstrzyknięciem należy do miejsca, które
 * skleja tekst — nie do czytelnika sklejonego wyniku.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BuildInvoiceEmailInput {
  locale: Locale;
  tenantName: string;
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  bytes: Uint8Array;
  filename: string;
  replyTo?: string;
  fromEmail?: string;
}

/** Czyste złożenie wiadomości — bez sieci, bez bazy, bez `process.env`. */
export function buildInvoiceEmail(input: BuildInvoiceEmailInput): OutgoingEmail {
  const t = INVOICE_EMAIL_MESSAGES[input.locale];
  const lang = input.locale === "pl" ? "pl-PL" : "en-US";
  const tenantName = escapeHtml(input.tenantName);
  const orderNumber = escapeHtml(input.orderNumber);

  const html = `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(t.heading)}</title></head>
<body style="background-color:${COLORS.muted};color:${COLORS.foreground};font-family:${FONT_FAMILY};margin:0;padding:0">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(t.preview(input.orderNumber))}</div>
<div style="margin:0 auto;max-width:600px;padding:40px 20px 24px;width:100%">
<div style="background-color:${COLORS.background};border:1px solid ${COLORS.border};border-radius:10px;padding:32px">
<p style="color:${COLORS.foreground};font-size:18px;font-weight:700;letter-spacing:-0.01em;margin:0 0 28px">${tenantName}</p>
<h1 style="color:${COLORS.foreground};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.3;margin:0 0 20px">${escapeHtml(t.heading)}</h1>
<p style="color:${COLORS.foreground};font-size:15px;line-height:1.65;margin:0 0 16px">${escapeHtml(t.greeting(input.customerName))}</p>
<p style="color:${COLORS.foreground};font-size:15px;line-height:1.65;margin:0 0 16px">${escapeHtml(t.body)}</p>
<div style="background-color:${COLORS.muted};border-radius:8px;padding:8px 16px">
<p style="color:${COLORS.foreground};font-size:15px;line-height:1.65;margin:0;padding:10px 0"><strong>${escapeHtml(t.orderNumberLabel)}:</strong> ${orderNumber}</p>
</div>
<p style="color:${COLORS.foreground};font-size:15px;line-height:1.65;margin:16px 0 0">${escapeHtml(t.attachmentHint)}</p>
<hr style="border:none;border-top:1px solid ${COLORS.border};margin:28px 0 20px">
<p style="color:${COLORS.mutedForeground};font-size:12px;line-height:1.6;margin:0;text-align:center">${tenantName}<br>${escapeHtml(t.footer)}</p>
</div></div></body></html>`;

  const text = [
    t.greeting(input.customerName),
    "",
    t.body,
    "",
    `${t.orderNumberLabel}: ${input.orderNumber}`,
    "",
    t.attachmentHint,
    "",
    input.tenantName,
    t.footer,
  ].join("\n");

  return {
    from: platformFromAddress(
      input.tenantName,
      input.fromEmail ? { fromEmail: input.fromEmail } : {},
    ),
    to: input.customerEmail,
    subject: t.subject(input.orderNumber),
    html,
    text,
    attachments: [{ filename: input.filename, content: input.bytes }],
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}
