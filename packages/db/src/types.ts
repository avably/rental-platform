/**
 * Typy wierszy odpowiadające schematowi z supabase/migrations/0001_core.sql.
 * Utrzymywane ręcznie do czasu podpięcia generatora typów (supabase gen types)
 * na projekcie dev — patrz docs/konwencje-migracji.md.
 */
import type { CurrencyCode, Locale } from "@avably/core";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type Role = "owner" | "staff";

export type TenantStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled"
  | "superadmin_locked";

/** Status, do którego wraca tenant po odblokowaniu przez superadmina. */
export type TenantStatusBeforeLock = Exclude<TenantStatus, "superadmin_locked">;

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  /** Zapamiętany status sprzed blokady superadmina (0004_superadmin.sql). */
  status_before_lock: TenantStatusBeforeLock | null;
  /**
   * Język storefrontu najemcy (0005_i18n.sql). Oś NIEZALEŻNA od języka panelu
   * — ten wybiera prefiks ścieżki per użytkownik.
   */
  locale: Locale;
  created_at: string;
}

export interface Member {
  tenant_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Invitation {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  /** Cena w jednostkach podrzędnych waluty `currency` (0005_i18n.sql). */
  price_grosze: number;
  /** Waluta ceny (0005_i18n.sql). Nie zakładaj PLN — czytaj kolumnę. */
  currency: CurrencyCode;
  limits: Json;
  features: Json;
  active: boolean;
}

export interface Subscription {
  tenant_id: string;
  plan_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  updated_at: string;
}

export interface UsageCounter {
  tenant_id: string;
  metric: string;
  period: string;
  value: number;
}

export interface AuditLogEntry {
  id: number;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  subject: string | null;
  details: Json | null;
  created_at: string;
}

// --- Model sekcyjny storefrontu (0019_site_model.sql, ADR-041) ---
//
// Kształt TREŚCI sekcji (content_draft/content_published) i unie template/type
// definiuje wyłącznie @avably/core/site (jedno źródło, konsumowane też przez
// edytor i render 2.3b) — tu jest Json, bo baza treści nie interpretuje.

export type SiteTemplate = import("@avably/core/site").SiteTemplate;

export type SiteSectionType = import("@avably/core/site").SectionType;

export interface Site {
  id: string;
  tenant_id: string;
  /** Szablon w SZKICU — na żywą stronę wchodzi dopiero publikacją (ADR-091). */
  template: SiteTemplate;
  /** NULL = strona nigdy nie opublikowana; stawia ją wyłącznie app.publish_site. */
  published_at: string | null;
  /** Szablon OPUBLIKOWANY; NULL = strona nigdy nie opublikowana (ADR-091). */
  template_published: SiteTemplate | null;
  created_at: string;
}

export interface SiteSection {
  id: string;
  tenant_id: string;
  site_id: string;
  type: SiteSectionType;
  /** Kolejność w SZKICU — publicznie widoczna jest position_published (ADR-091). */
  position: number;
  /** Włączenie w SZKICU — publicznie widoczne jest enabled_published (ADR-091). */
  enabled: boolean;
  /** Stan roboczy edytora — nigdy nie serwowany publicznie. */
  content_draft: Json;
  /** Stan opublikowany; NULL = sekcja nigdy nie opublikowana. */
  content_published: Json | null;
  /** Kolejność na OPUBLIKOWANEJ stronie; NULL = sekcja nigdy nieopublikowana. */
  position_published: number | null;
  /** Włączenie na OPUBLIKOWANEJ stronie; NULL = sekcja nigdy nieopublikowana. */
  enabled_published: boolean | null;
  /**
   * Sekcja USUNIĘTA W SZKICU, ale wciąż stojąca na opublikowanej stronie —
   * wiersz kasuje dopiero app.publish_site (ADR-091). Sekcja nigdy
   * nieopublikowana nie może nosić tego znacznika (CHECK 0045).
   */
  deleted_in_draft: boolean;
  updated_at: string;
}

export interface Domain {
  id: string;
  tenant_id: string;
  domain: string;
  /** false = domena nie routuje (wiring DNS/Vercel to Zadanie 2.6). */
  verified: boolean;
  created_at: string;
}

// --- Konto najemcy u dostawcy płatności (0028_payment_accounts.sql, ADR-065) ---
//
// UWAGA NA POMYŁKĘ, KTÓREJ TEN TYP MA ZAPOBIEC: `Tenant.stripe_customer_id`
// i `Tenant.stripe_subscription_id` (0001) opisują PRZECIWNY kierunek
// pieniędzy — najemca płacący NAM za subskrypcję (faza 4). Tutaj chodzi
// o konto, na które wpływają pieniądze KLIENTÓW najemcy.

export interface PaymentAccount {
  tenant_id: string;
  provider: "stripe";
  /** Identyfikator konta u dostawcy. Niezmienny po założeniu (trigger 0028). */
  provider_account_id: string;
  /**
   * CACHE PREZENTACYJNY z ostatniego odczytu `GET /v1/accounts/{id}`
   * (ADR-049) — nigdy podstawa decyzji o pobraniu pieniędzy. Ścieżka
   * płatnicza odczytuje stan u dostawcy na nowo.
   */
  charges_enabled: boolean;
  /** Osobno od charges_enabled: konto restricted przyjmuje wpłaty i blokuje wypłaty. */
  payouts_enabled: boolean;
  details_submitted: boolean;
  /** Identyfikatory wymagań dostawcy blokujących konto TERAZ. */
  requirements_due: string[];
  /** Powód ostatniej nieudanej synchronizacji; NULL = ostatni odczyt się udał. */
  last_error: string | null;
  /** Kiedy powstała kopia stanu. NULL = jeszcze nigdy nie odczytana. */
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- Uwagi przeglądu produktu (0033_review_comments.sql, ADR-071) ---
//
// NARZĘDZIE WEWNĘTRZNE na czas przeglądu przed startem: tabele platformowe
// (bez tenant_id), dostęp wyłącznie superadmin (RLS) lub service_role przez
// podwójnie bramkowany endpoint storefrontu (REVIEW_MODE + hasło site'u).

export type ReviewSurface = "panel" | "marketing" | "storefront";
export type ReviewKind = "point" | "area";
export type ReviewStatus = "open" | "done";

export interface ReviewComment {
  id: string;
  surface: ReviewSurface;
  /** Etykieta z listy 39 ekranów (np. „01 Dashboard"); prefiks numeryczny sortuje. */
  screen: string;
  /** Pathname bez prefiksu locale. */
  route: string;
  kind: ReviewKind;
  /** Pozycja znormalizowana do dokumentu (0..1). */
  pos_x: number;
  pos_y: number;
  area_w: number | null;
  area_h: number | null;
  scroll_y: number;
  body: string;
  /** 1 = najwyższy, 5 = najniższy. */
  priority: number;
  status: ReviewStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewCommentAttachment {
  id: string;
  comment_id: string;
  /** Ścieżka w prywatnym buckecie review-attachments. */
  image_path: string;
  sort: number;
  created_at: string;
}
