/**
 * Kształty portu Vercel Domains API (Zadanie 2.6, ADR-046).
 *
 * Typy naszej strony granicy, nie odwzorowanie 1:1 odpowiedzi dostawcy:
 * z odpowiedzi bierzemy WYŁĄCZNIE to, czego potrzebuje panel i routing
 * (identyfikator hosta, werdykt weryfikacji, rekordy do wpisania u
 * rejestratora). Reszta pól (plan, redirect, gitBranch, …) świadomie nie
 * przechodzi przez granicę — nie mamy jak jej utrzymać w zgodzie z dryfem API.
 */

/** Rekord DNS, który najemca ma wpisać u SWOJEGO rejestratora. */
export interface DomainDnsRecord {
  /** 'CNAME' | 'TXT' | 'A' — verbatim od dostawcy (wzorzec provider_status, ADR-031). */
  type: string;
  /** Nazwa rekordu (host albo etykieta wyzwania własności). */
  name: string;
  /** Wartość rekordu. */
  value: string;
  /** Powód, dla którego dostawca żąda tego rekordu (jeśli podany). */
  reason?: string;
}

/** Stan hosta u dostawcy — jedyne, co odzwierciedlamy w public.domains. */
export interface DomainStatus {
  host: string;
  /** Identyfikator hosta u dostawcy → domains.provider_domain_id. */
  providerDomainId: string | null;
  /** Werdykt WŁASNOŚCI wydany przez dostawcę → domains.verified. */
  verified: boolean;
  /** Rekordy do wpisania u rejestratora, żeby host zaczął działać. */
  requiredRecords: DomainDnsRecord[];
}

/** Konfiguracja portu — rozstrzygana JAWNIE, nigdy zgadywana z NODE_ENV. */
export interface VercelDomainsConfig {
  token: string;
  projectId: string;
  teamId?: string | undefined;
}

/** Stan konfiguracji do pokazania operatorowi (wzorzec emailAvailability). */
export interface VercelDomainsAvailability {
  available: boolean;
  reason?: string;
}
