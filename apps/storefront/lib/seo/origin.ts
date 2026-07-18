/**
 * Origin kanoniczny dla adresów absolutnych SEO (Zadanie 2.7, ADR-044).
 *
 * DWIE OSIE, DWIE REGUŁY — bo kanon znaczy co innego po każdej stronie:
 *
 * - Oś TENANCKA: kanonem sklepu JEST host, którym przyszło żądanie
 *   (`<slug>.avably.io`). Każdy tenant ma własną subdomenę, więc canonical
 *   budujemy z nagłówka `Host` — nie z globalnej stałej. Dzięki temu ten sam
 *   kod daje poprawny canonical w produkcji i w dev (`acme.localhost:3033`).
 *
 * - Oś MARKETINGOWA: kanonem jest JEDEN adres (`www.avably.io`, ADR o kanonie
 *   www) niezależnie od tego, czym przyszło żądanie. Preview `*.vercel.app`
 *   i apex NIE mogą generować własnych canonicali — to byłby dublet treści
 *   konkurujący z kanonem w indeksie. Dlatego w produkcji zawsze
 *   `CANONICAL_SITE_URL`, a origin żądania służy wyłącznie w dev.
 *
 * Funkcje są CZYSTE (host/proto jako argumenty) — testowalne bez serwera.
 */
import { CANONICAL_SITE_URL } from "@avably/core";

/** Hosty, które w dev chodzą po http (bez TLS). Reszta zawsze https. */
function isLocalHost(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() ?? "";
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]";
}

/**
 * Origin z nagłówka `Host` (+ `X-Forwarded-Proto`, gdy stoi przed nami proxy).
 * Zwraca `null` dla pustego/niepoprawnego hosta — wołający nie ma wtedy jak
 * zbudować canonicala i po prostu go pomija (lepiej brak niż zły).
 */
export function originFromHost(host: string | null | undefined, forwardedProto?: string | null): string | null {
  const trimmed = (host ?? "").trim();
  // Host niesie klient — nie wpuszczamy do adresu niczego poza [znaki hosta:port].
  if (trimmed === "" || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(trimmed)) return null;

  // `X-Forwarded-Proto` może nieść listę ("https, http") — bierzemy pierwszy.
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : isLocalHost(trimmed) ? "http" : "https";
  return `${scheme}://${trimmed.toLowerCase()}`;
}

/**
 * Origin osi MARKETINGOWEJ. W produkcji zawsze kanon — patrz docblock: preview
 * i apex nie mają prawa wystawiać własnych canonicali. Poza produkcją origin
 * żądania, żeby lokalna weryfikacja sitemapy pokazywała realne, klikalne linki.
 */
export function marketingOrigin(
  host: string | null | undefined,
  forwardedProto?: string | null,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  if (nodeEnv === "production") return CANONICAL_SITE_URL;
  return originFromHost(host, forwardedProto) ?? CANONICAL_SITE_URL;
}
