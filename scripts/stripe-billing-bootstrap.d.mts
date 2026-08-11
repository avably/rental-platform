/**
 * Typy bootstrapu cennika SaaS (dla testu parytetu w packages/core).
 * Implementacja: stripe-billing-bootstrap.mjs (Node bez transpilacji).
 */
export declare const SAAS_BOOTSTRAP_PLANS: readonly {
  id: string;
  name: string;
  monthlyNetGrosze: number;
  yearlyNetGrosze: number;
}[];
export declare const BOOTSTRAP_API_VERSION: string;
