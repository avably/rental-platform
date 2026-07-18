/**
 * Uczciwa CZĘŚCIOWA PORAŻKA rejestracji hosta (ADR-033/036 → ADR-046).
 *
 * TO JEST SEDNO ZADANIA 2.6. Rejestracja hosta u dostawcy jest wywołaniem
 * SIECIOWYM do usługi trzeciej, a wisi na dwóch operacjach, które nie mogą od
 * niej zależeć: zakładaniu ORGANIZACJI i dodawaniu WŁASNEJ domeny. Gdyby błąd
 * dostawcy propagował się w górę, awaria cudzego API wywracałaby onboarding —
 * najemca nie założyłby konta, bo hosting miał pięciominutowy incydent.
 *
 * Dlatego ta funkcja NIE RZUCA NIGDY. Zwraca wynik z `error: string | null`,
 * który wołający zapisuje do `domains.last_error` i pokazuje operatorowi wraz
 * z możliwością ponowienia. Operacja nadrzędna idzie dalej.
 *
 * To NIE jest połknięcie błędu (czego ADR-033 zakazuje): różnica jest w tym, że
 * porażka zostaje ZAPISANA i POKAZANA. Cichy sukces to „powiedzieliśmy, że
 * działa"; uczciwa częściowa porażka to „organizacja powstała, host czeka,
 * oto powód i przycisk ponowienia".
 *
 * `catch` jest CELOWO szeroki (nie tylko VercelDomainsError): brak konfiguracji
 * (VercelConfigError z konstruktora klienta), nieoczekiwany kształt odpowiedzi
 * i błąd programistyczny w porcie mają dać ten sam skutek co odmowa dostawcy.
 * Wąski catch zamieniałby każdy nieprzewidziany wyjątek z powrotem w awarię
 * onboardingu — czyli w dokładnie to, czemu ten wzorzec zapobiega.
 */
import { VercelDomainsClient, type VercelDomainsClientOptions } from "./api";
import type { DomainDnsRecord, DomainStatus } from "./types";

/** Wynik zapisywalny wprost w kolumnach public.domains. */
export interface DomainRegistrationResult {
  /** true = host jest u dostawcy (świeżo zarejestrowany albo już był). */
  ok: boolean;
  /** → domains.provider_domain_id (NULL przy porażce). */
  providerDomainId: string | null;
  /** → domains.verified dla kind='custom' (werdykt dostawcy, nie nasz). */
  verified: boolean;
  /** Rekordy DNS do pokazania najemcy. */
  requiredRecords: DomainDnsRecord[];
  /** → domains.last_error. NULL przy sukcesie (czyści zaległy powód). */
  error: string | null;
}

export interface DomainRegistrationDeps extends VercelDomainsClientOptions {
  /** Klient wstrzykiwany w testach; domyślnie budowany z konfiguracji env. */
  client?: Pick<VercelDomainsClient, "addDomain" | "getDomainStatus">;
}

function fromStatus(status: DomainStatus): DomainRegistrationResult {
  return {
    ok: true,
    providerDomainId: status.providerDomainId,
    verified: status.verified,
    requiredRecords: status.requiredRecords,
    error: null,
  };
}

function fromError(error: unknown): DomainRegistrationResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    providerDomainId: null,
    verified: false,
    requiredRecords: [],
    // Komunikat idzie do bazy i na ekran, więc długość jest ograniczona —
    // strona serwisowa dostawcy potrafi zwrócić kilobajty HTML-a.
    error: message.slice(0, 500),
  };
}

/** Rejestracja hosta, która NIGDY nie wywraca operacji nadrzędnej. */
export async function registerDomainSafely(
  host: string,
  deps: DomainRegistrationDeps = {},
): Promise<DomainRegistrationResult> {
  try {
    const client = deps.client ?? new VercelDomainsClient(deps);
    return fromStatus(await client.addDomain(host));
  } catch (error) {
    return fromError(error);
  }
}

/** Odczyt werdyktu weryfikacji — ta sama zasada: nie rzuca, opisuje porażkę. */
export async function checkDomainSafely(
  host: string,
  deps: DomainRegistrationDeps = {},
): Promise<DomainRegistrationResult> {
  try {
    const client = deps.client ?? new VercelDomainsClient(deps);
    const status = await client.getDomainStatus(host);
    if (!status) {
      // Host nie jest w projekcie — nie awaria, ale i nie sukces: najemca ma
      // zobaczyć, że trzeba ponowić rejestrację, a nie „czekamy na DNS".
      return {
        ok: false,
        providerDomainId: null,
        verified: false,
        requiredRecords: [],
        error: "Domena nie jest zarejestrowana u dostawcy — ponów rejestrację.",
      };
    }
    return fromStatus(status);
  } catch (error) {
    return fromError(error);
  }
}
