/**
 * Typy wierszy odpowiadające schematowi z supabase/migrations/0001_core.sql.
 * Utrzymywane ręcznie do czasu podpięcia generatora typów (supabase gen types)
 * na projekcie dev — patrz docs/konwencje-migracji.md.
 */

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
  price_grosze: number;
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
