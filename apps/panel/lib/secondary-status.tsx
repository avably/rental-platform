import { StatusBadge, statusTones, type StatusTone } from "@avably/ui";
import { useTranslations } from "next-intl";

/**
 * Semantyka statusów ekranów drugorzędnych (P8, artefakt Fazy 2 —
 * powierzchnia `secondary-status-map`).
 *
 * Osobny byt od `statusSemantics` z `@avably/ui` ŚWIADOMIE: tamta mapa opisuje
 * cykl życia zamówienia, płatności i wysyłki — rzeczy, które mają wspólny
 * słownik z artefaktem sekcji 07 i wspólną historię migracji. Tu opisujemy
 * stany konfiguracji (domena, transport poczty, sekret kuriera, zaproszenie,
 * 2FA), które z tamtymi osiami nie mają nic wspólnego poza wyglądem chipa.
 * Artefakt zapisał to wprost: „pozostaje osobnym kontraktem od statusów
 * zamówień, płatności i wysyłek".
 *
 * Kopia 1:1 powierzchni artefaktu — pilnuje tego
 * `test/secondary-status-contract.test.ts`, dokładnie jak `status-contract`
 * w pakiecie UI. Ekrany NIGDY nie wpisują tonu literałem; jedyną drogą do
 * chipa jest `SecondaryStatusChip`.
 */
export const secondaryStatusSemantics = {
  domain: { live: "positive", pending: "attention", registration_failed: "problem" },
  "domain-provider": { available: "positive", unavailable: "attention" },
  "email-transport": { available: "positive", unavailable: "attention" },
  "email-sender": { configured: "positive", missing: "attention" },
  "email-log": { sent: "positive", failed: "problem" },
  "delivery-secret": { configured: "positive", missing: "attention" },
  invitation: { accepted: "positive", pending: "attention" },
  organization: { active: "positive" },
  security: { not_configured: "attention", configured: "positive" },
  "site-section": { enabled: "positive", disabled: "neutral" },
  "site-publish": { published: "positive" },
} as const satisfies Record<string, Record<string, StatusTone>>;

export type SecondaryStatusAxis = keyof typeof secondaryStatusSemantics;
export type SecondaryStatusValue<A extends SecondaryStatusAxis> =
  keyof (typeof secondaryStatusSemantics)[A] & string;

/**
 * Osie, które mają w panelu WŁASNY ekran, a więc i etykiety w słowniku.
 *
 * P8a zostawił `site-section` i `site-publish` bez etykiet, bo edytor strony
 * sklepu szedł osobną paczką: mapa musiała je zawierać (zgodność 1:1 z
 * artefaktem), ale ekranu, który by je pokazał, jeszcze nie było. P8b ten ekran
 * dostarcza, więc obie osie wchodzą tu razem z resztą — lista rośnie wtedy i
 * tylko wtedy, gdy powstaje ekran czytający daną oś. Kontrakt kompletności
 * etykiet iteruje po tej liście, nie po całej mapie.
 */
export const SECONDARY_LABELLED_AXES = [
  "domain",
  "domain-provider",
  "email-transport",
  "email-sender",
  "email-log",
  "delivery-secret",
  "invitation",
  "organization",
  "security",
  "site-section",
  "site-publish",
] as const satisfies readonly SecondaryStatusAxis[];

export function secondaryStatusProps<A extends SecondaryStatusAxis>(
  axis: A,
  value: SecondaryStatusValue<A>,
): { tone: StatusTone; "data-secondary-status-axis": A; "data-secondary-status-value": string } {
  const tone = secondaryStatusSemantics[axis][value] as StatusTone;
  if (!statusTones.includes(tone)) throw new Error(`Nieznany rodzaj statusu: ${axis}/${value}`);
  // Atrybuty osi jak w chipach artefaktu — dają kontraktowi renderu i
  // weryfikacji w przeglądarce jednoznaczny uchwyt do stanu.
  return { tone, "data-secondary-status-axis": axis, "data-secondary-status-value": value };
}

/**
 * Chip stanu ekranu drugorzędnego. Zawsze niesie TEKST wartości (twardy zakaz
 * `color-only-status` z artefaktu), a etykieta idzie ze słownika
 * `secondaryStatus.<oś>.<wartość>`, którego treść PL przypina do artefaktu
 * kontrakt copy.
 */
export function SecondaryStatusChip<A extends SecondaryStatusAxis>({
  axis,
  value,
}: {
  axis: A;
  value: SecondaryStatusValue<A>;
}) {
  const t = useTranslations("secondaryStatus");
  // next-intl nie umie przejść ścieżki złożonej z parametru generycznego —
  // rzutujemy WYŁĄCZNIE kształt klucza; para oś/wartość jest już ograniczona
  // typem do kluczy mapy, a komplet etykiet pilnuje kontrakt.
  const key = `${axis}.${value}` as Parameters<typeof t>[0];

  return <StatusBadge {...secondaryStatusProps(axis, value)}>{t(key)}</StatusBadge>;
}
