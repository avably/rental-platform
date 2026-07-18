/**
 * Port Vercel Domains API — rejestracja hostów storefrontu (Zadanie 2.6,
 * ADR-046). Wzorzec portu zewnętrznego z ADR-031 (klient kurierski):
 *
 *   1. `fetch` WSTRZYKIWANY (`fetchFn`) — testy kontraktowe biegną na nagranych
 *      fixtures, CI nie dotyka sieci ani konta dostawcy.
 *   2. Konfiguracja per INSTANCJA, nie moduł — brak stanu statycznego, który
 *      dałoby się współdzielić między wywołaniami.
 *   3. ZERO logowania na konsolę; diagnostykę niesie `VercelDomainsError`
 *      (status, kod dostawcy). Token nie ma jak trafić do logu, bo nic nie
 *      logujemy, a komunikaty błędów przechodzą przez `redactToken`.
 *   4. Brak konfiguracji = twardy `VercelConfigError` (config.ts), nigdy cichy
 *      sukces ani „domyślny projekt".
 *
 * PO CO NAM TEN PORT. Cloudflare trzyma statyczny wildcard `*.avably.io CNAME`
 * na cel projektu storefrontu, więc DNS rozwiąże KAŻDĄ subdomenę — ale hosting
 * oddaje 404 dla hostów, których nie ma w projekcie. Rejestracja hosta przez to
 * API jest więc warunkiem, żeby żądanie w ogóle doszło do naszego middleware.
 */
import { resolveVercelConfig, type VercelConfigOptions } from "./config";
import type { DomainDnsRecord, DomainStatus, VercelDomainsConfig } from "./types";

export const VERCEL_API_BASE = "https://api.vercel.com";

/**
 * Cel rekordu CNAME dla WŁASNEJ domeny najemcy. Wartość stała dostawcy — nie
 * przychodzi w odpowiedzi API (`verification` niesie wyłącznie wyzwania
 * WŁASNOŚCI), a najemca musi ją dostać, żeby cokolwiek wpisać u rejestratora.
 */
export const CUSTOM_DOMAIN_CNAME_TARGET = "cname.vercel-dns.com";

export class VercelDomainsError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "VercelDomainsError";
  }
}

/**
 * Ostatnia zapora przed wyciekiem tokenu do UI i do `domains.last_error`:
 * komunikat dostawcy bywa echem żądania, a `last_error` trafia na ekran
 * najemcy i do bazy. Wycinamy token BEZWARUNKOWO, zamiast ufać, że dostawca
 * go nie odbije — koszt jednej podmianki, zysk: sekret nie ma ścieżki na zewnątrz.
 */
export function redactToken(message: string, token: string): string {
  if (!token) return message;
  return message.split(token).join("[usunięto]");
}

/** Odpowiedź błędu dostawcy: `{ error: { code, message } }`. */
interface VercelErrorBody {
  error?: { code?: string; message?: string };
}

/** Wycinek odpowiedzi domenowej, na którym nam zależy (reszta pól ignorowana). */
interface VercelDomainBody {
  name?: string;
  verified?: boolean;
  verification?: { type?: string; domain?: string; value?: string; reason?: string }[];
}

function toDomainStatus(host: string, body: VercelDomainBody): DomainStatus {
  const records: DomainDnsRecord[] = (body.verification ?? []).map((entry) => ({
    type: entry.type ?? "TXT",
    name: entry.domain ?? host,
    value: entry.value ?? "",
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));

  return {
    host,
    // Dostawca identyfikuje host NAZWĄ (endpointy są `/domains/{name}`), więc to
    // ona jest identyfikatorem, który zapisujemy w provider_domain_id. Zapisujemy
    // go dopiero, gdy dostawca potwierdził istnienie hosta w projekcie.
    providerDomainId: body.name ?? host,
    verified: body.verified === true,
    requiredRecords: records,
  };
}

export interface VercelDomainsClientOptions extends VercelConfigOptions {
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

export class VercelDomainsClient {
  private readonly config: VercelDomainsConfig;
  private readonly fetchFn: typeof fetch;

  /** Rzuca `VercelConfigError`, gdy brak tokenu/projektu — nigdy cicha atrapa. */
  constructor(options: VercelDomainsClientOptions = {}) {
    this.config = resolveVercelConfig(options);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private url(path: string): string {
    const suffix = this.config.teamId ? `?teamId=${encodeURIComponent(this.config.teamId)}` : "";
    return `${VERCEL_API_BASE}${path}${suffix}`;
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url(path), {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      // Awaria transportu (DNS/timeout) — komunikat wołającego, nie stack trace
      // dostawcy. Redakcja i tu: URL z tokenem w query nie występuje, ale
      // komunikat sieciowy bywa echem żądania.
      const detail = error instanceof Error ? error.message : String(error);
      throw new VercelDomainsError(
        redactToken(`Połączenie z API domen nie powiodło się: ${detail}`, this.config.token),
      );
    }

    // Nie-JSON (strona serwisowa dostawcy) staje się treścią błędu niżej,
    // zamiast po cichu udawać poprawną odpowiedź (wzorzec ADR-031).
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { message: text.slice(0, 200) } };
      }
    }
    return { status: response.status, body };
  }

  private fail(status: number, body: unknown): VercelDomainsError {
    const error = (body as VercelErrorBody | null)?.error;
    const message = error?.message ?? `API domen odpowiedziało ${status}`;
    return new VercelDomainsError(
      redactToken(message, this.config.token),
      status,
      error?.code,
    );
  }

  /**
   * Rejestruje host w projekcie storefrontu. IDEMPOTENTNE: host już wpięty w
   * NASZ projekt nie jest błędem — dostawca oddaje wtedy 409, a my sprawdzamy
   * stan i zwracamy go tak, jakby rejestracja właśnie się udała. Ponowne
   * kliknięcie „dodaj" i ponowienie po awarii sieci nie mogą wywalić akcji.
   *
   * Host zajęty przez CUDZY projekt daje ten sam 409, ale `getDomainStatus`
   * zwraca wtedy null — i wtedy błąd JEST realny (nie wolno udawać, że host
   * jest nasz). To rozróżnienie jest jedynym powodem, dla którego 409 wymaga
   * drugiego zapytania zamiast ślepego „uznaj za sukces".
   */
  async addDomain(host: string): Promise<DomainStatus> {
    const { status, body } = await this.request(
      `/v10/projects/${encodeURIComponent(this.config.projectId)}/domains`,
      { method: "POST", body: JSON.stringify({ name: host }) },
    );

    if (status >= 200 && status < 300) {
      return toDomainStatus(host, (body ?? {}) as VercelDomainBody);
    }

    if (status === 409) {
      const existing = await this.getDomainStatus(host);
      if (existing) return existing;
    }

    throw this.fail(status, body);
  }

  /**
   * Stan hosta u dostawcy. `null` = host NIE JEST w naszym projekcie (404) —
   * świadomie nie błąd: „nie ma go" to legalna odpowiedź dla ekranu domen i
   * warunek rozstrzygnięcia idempotencji w `addDomain`.
   */
  async getDomainStatus(host: string): Promise<DomainStatus | null> {
    const { status, body } = await this.request(
      `/v9/projects/${encodeURIComponent(this.config.projectId)}/domains/${encodeURIComponent(host)}`,
      { method: "GET" },
    );

    if (status === 404) return null;
    if (status >= 200 && status < 300) {
      return toDomainStatus(host, (body ?? {}) as VercelDomainBody);
    }
    throw this.fail(status, body);
  }

  /**
   * Wypina host z projektu. 404 tolerowane (host już nieobecny = stan docelowy
   * osiągnięty) — usunięcie ma być idempotentne, żeby ponowienie po zerwanym
   * połączeniu nie zostawiało wiersza, którego nie da się skasować.
   */
  async removeDomain(host: string): Promise<void> {
    const { status, body } = await this.request(
      `/v9/projects/${encodeURIComponent(this.config.projectId)}/domains/${encodeURIComponent(host)}`,
      { method: "DELETE" },
    );

    if (status === 404 || (status >= 200 && status < 300)) return;
    throw this.fail(status, body);
  }
}
