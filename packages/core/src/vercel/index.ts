export {
  CUSTOM_DOMAIN_CNAME_TARGET,
  VERCEL_API_BASE,
  VercelDomainsClient,
  VercelDomainsError,
  redactToken,
  type VercelDomainsClientOptions,
} from "./api";

export {
  VERCEL_PROJECT_ENV,
  VERCEL_TEAM_ENV,
  VERCEL_TOKEN_ENV,
  VercelConfigError,
  resolveVercelConfig,
  vercelDomainsAvailability,
  type VercelConfigOptions,
} from "./config";

export {
  checkDomainSafely,
  registerDomainSafely,
  type DomainRegistrationDeps,
  type DomainRegistrationResult,
} from "./registration";

export type {
  DomainDnsRecord,
  DomainStatus,
  VercelDomainsAvailability,
  VercelDomainsConfig,
} from "./types";
