/**
 * ZNAK NAJEMCY W KORESPONDENCJI I W DOKUMENCIE (ADR-175) — strona panelu.
 *
 * ==================== ZNAK BIERZE SIĘ Z WIERSZA, NIE Z SESJI ====================
 *
 * Obie funkcje przyjmują WIERSZ NAJEMCY, którego dotyczy wiadomość albo umowa,
 * i nie mają dostępu do niczego innego: ani do claimu `app.tenant_id()`, ani do
 * nagłówka żądania, ani do zmiennej modułu. To nie jest ostrożność na wyrost —
 * umowy i przypomnienia powstają także w zadaniach w tle (webhook płatności,
 * cron zwrotów), gdzie „bieżący najemca" nie znaczy nic, a znak najemcy A
 * w mailu najemcy B byłby wyciekiem widocznym gołym okiem.
 *
 * Kolumna jest jedna i jest nią `logo_published`. Szkicu tu nie ma: mail
 * i umowa wychodzą na zewnątrz, więc wysłanie szkicu byłoby publikacją,
 * której operator nie zamawiał (ta sama zasada, co przy `slug_published`).
 *
 * ==================== DWIE POSTACI TEGO SAMEGO ZNAKU ====================
 *
 * E-mail dostaje ADRES: klient poczty pobiera obrazek sam, godziny po wysyłce,
 * spoza naszej sesji — bajty w treści rozdęłyby wiadomość i tak czy owak
 * zostałyby przez większość klientów odrzucone. Adres jest tym samym
 * publicznym adresem, który każdy odwiedzający widzi w nagłówku sklepu, więc
 * odbiorca nie dowiaduje się z niego niczego, czego nie ma na stronie.
 *
 * Umowa dostaje BAJTY: dokument renderuje się serwerowo i nie może zależeć od
 * sieci w chwili renderu (patrz `@avably/pdf`, `logo.ts`). Pobranie stoi więc
 * TUTAJ — z limitem czasu, sufitem rozmiaru i jedną odpowiedzią na każdą
 * porażkę: `undefined`, czyli nazwa najemcy tekstem w dokumencie.
 */
import { MAX_SITE_LOGO_BYTES, outgoingTenantMark } from "@avably/core/site";
import type { EmailTenantLogo } from "@avably/emails";
import { contractLogoFormat, type ContractLogo } from "@avably/pdf";

import { siteImagePublicBase } from "@/lib/site-image-base";

/**
 * Wiersz najemcy w zakresie potrzebnym do postawienia znaku.
 *
 * Kształt jest STRUKTURALNY, bo czytają go zapytania o różnym zestawie kolumn
 * — łączy je wyłącznie to, że pytają o `name` i `logo_published` TEGO SAMEGO
 * najemcy. Wartość kolumny przychodzi jako `unknown`: to jsonb, a jego kształt
 * pilnuje `outgoingTenantMark`, nie wołający.
 */
export interface TenantMarkRow {
  name: string;
  logo_published?: unknown;
}

/**
 * Znak do wiadomości albo `undefined` (najemca go nie ma → nazwa tekstem).
 *
 * Adres składa się z publicznego prefiksu bucketa i ścieżki z kolumny. Nie ma
 * tu ani parametrów zapytania, ani adresu podpisanego, i nie jest to
 * przeoczenie: parametr w adresie obrazu to miejsce, w którym najłatwiej
 * przypadkiem wywieźć identyfikator zamówienia albo adres klienta do logów
 * cudzego serwera.
 */
export function tenantEmailLogo(tenant: TenantMarkRow): EmailTenantLogo | undefined {
  const mark = outgoingTenantMark(tenant.logo_published, tenant.name);
  if (mark.kind !== "logo") return undefined;
  return { src: `${siteImagePublicBase()}/${mark.path}`, alt: mark.alt };
}

/** Ile czekamy na plik znaku, zanim uznamy, że umowa powstanie bez niego. */
export const TENANT_MARK_FETCH_TIMEOUT_MS = 2_000;

export interface TenantContractLogoOptions {
  /** Wstrzykiwane w testach; produkcyjnie globalny `fetch`. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Bajty znaku do umowy albo `undefined`. NIGDY NIE RZUCA.
 *
 * ============ DLACZEGO KAŻDA PORAŻKA MA TU JEDNĄ ODPOWIEDŹ ============
 *
 * Bo dokument, który przestaje powstawać, blokuje najem — a obraz jest w nim
 * ozdobą względem tej funkcji. Niedostępny bucket, przekroczony limit czasu,
 * 404 po skasowanym pliku, plik większy niż sufit modelu znaku i format,
 * którego renderer PDF nie zdekoduje, kończą się więc tym samym: umowa
 * powstaje, a w miejscu znaku stoi nazwa najemcy. Rozróżnianie tych porażek
 * miałoby sens tylko wtedy, gdyby któraś z nich miała prowadzić do INNEJ
 * decyzji — żadna nie ma.
 *
 * Formatu nie zgadujemy z nagłówka odpowiedzi: pyta o niego `contractLogoFormat`
 * po rozszerzeniu ścieżki (wzorzec ADR-160 dopuszcza cztery, dokument przyjmuje
 * dwa), a bajty i tak sprawdza jeszcze bramka pakietu umów.
 */
export async function tenantContractLogo(
  tenant: TenantMarkRow,
  options: TenantContractLogoOptions = {},
): Promise<ContractLogo | undefined> {
  const mark = outgoingTenantMark(tenant.logo_published, tenant.name);
  if (mark.kind !== "logo") return undefined;

  const format = contractLogoFormat(mark.path);
  if (!format) return undefined;

  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TENANT_MARK_FETCH_TIMEOUT_MS;

  try {
    const response = await doFetch(`${siteImagePublicBase()}/${mark.path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;

    const bytes = new Uint8Array(await response.arrayBuffer());
    // Sufit jest ten sam, co przy wgrywaniu (ADR-160): plik większy niż
    // dopuszcza model znaku nie pochodzi z naszej ścieżki zapisu, więc nie ma
    // powodu wpuszczać go do dokumentu.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SITE_LOGO_BYTES) return undefined;

    return { data: Buffer.from(bytes).toString("base64"), format };
  } catch {
    return undefined;
  }
}
