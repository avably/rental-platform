"use server";

/**
 * Server Action waitlisty — jedyne publiczne wejście do zapisu.
 *
 * Ten plik jest CIENKI z rozmysłem: dostarcza rdzeniowi (lib/waitlist/core.ts)
 * to, czego rdzeń nie umie zdobyć bez Next.js i bez sieci — IP, stan
 * kill-switcha i wywołanie RPC. Cała logika decyzyjna (kolejność bramek,
 * mapowanie na statusy kontraktu) siedzi w rdzeniu, żeby dało się ją testować
 * bez `next/headers`.
 *
 * Kontrakt zwracanych statusów: lib/waitlist/contract.ts.
 */
import { headers } from "next/headers";

import {
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  checkRateLimit,
} from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  isWaitlistEnabled,
  joinWaitlistCore,
  type WaitlistRpcArgs,
  type WaitlistRpcOutcome,
} from "@/lib/waitlist/core";
import type { WaitlistInput, WaitlistResult } from "@/lib/waitlist/contract";

export async function joinWaitlist(input: WaitlistInput): Promise<WaitlistResult> {
  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";

  return joinWaitlistCore(input, {
    enabled: isWaitlistEnabled(),
    ip,
    // Prefiks domykany tutaj, a nie w rdzeniu: rdzeń zna limit waitlisty, ale
    // przestrzeń kluczy jest własnością warstwy security.
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX }),
    // Sekret i transport zostają domyślne (env Vercela / globalny fetch) —
    // semantyka fail-closed vs dev-skip: @avably/security/turnstile.
    verifyCaptcha: (token) => verifyTurnstile(token),
    callRpc: async (args: WaitlistRpcArgs): Promise<WaitlistRpcOutcome> => {
      const supabase = await createSupabaseServerClient();
      // Schemat `app` jest wystawiony przez PostgREST wyłącznie po to, by dać
      // dostęp do RPC (patrz config.toml) — tabela public.waitlist_signups
      // pozostaje dla anona niedostępna, bo nie ma grantu.
      const { data, error } = await supabase.schema("app").rpc("join_waitlist", args);
      if (error) throw new Error(error.message);
      return data === "duplicate" ? "duplicate" : "success";
    },
  });
}
