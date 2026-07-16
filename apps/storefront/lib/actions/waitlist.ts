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

import { checkPublicRateLimit } from "@/lib/rate-limit";
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
    checkRateLimit: checkPublicRateLimit,
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
