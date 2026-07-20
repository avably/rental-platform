// Sekrety tenanta (ADR-052): szyfrowanie aplikacyjne AES-256-GCM, klucz
// w env aplikacji, koperta związana AAD-em z wierszem (tenant_id, key).
// Magazyn: public.tenant_secrets (migracja 0024).
export {
  SECRETS_KEY_CURRENT_ENV,
  SECRETS_KEY_ENV_PREFIX,
  SECRET_KEY_BYTES,
  SecretsConfigError,
  resolveSecretsKeyring,
  type EnvSource,
  type SecretsKeyring,
} from "./keyring";

export {
  SecretEnvelopeError,
  decryptTenantSecret,
  encryptTenantSecret,
  type SecretEnvelope,
  type SecretLocation,
} from "./envelope";

/** Klucz sekretu: hasło do API dostawcy kurierskiego (para do
 * tenant_settings.globkurier_credentials, które trzyma część jawną). */
export const GLOBKURIER_PASSWORD_SECRET_KEY = "globkurier_password";
