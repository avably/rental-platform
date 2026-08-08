"use client";

/**
 * Widok kluczy publicznego API (M1, ADR-108) — warstwa interakcji nad akcjami
 * serwerowymi (wzorzec domains-panel).
 *
 * SUROWY KLUCZ pojawia się na ekranie DOKŁADNIE RAZ — w bloku pod formularzem
 * generowania, prosto ze stanu akcji. Lista zna wyłącznie prefiks (avbl_ +
 * 8 hex): po odświeżeniu strony klucza nie da się już zobaczyć i to jest
 * własność bezpieczeństwa, nie brak wygody (baza trzyma tylko hash).
 *
 * STAN KLUCZA jako zwykły tekst, nie chip: oś statusów drugorzędnych jest
 * zamkniętym kontraktem z artefaktem Fazy 2 (secondary-status-map) i nie
 * niesie osi kluczy API — dopisanie jej bokiem łamałoby kontrakt 1:1.
 *
 * ODWOŁANIE przez ConfirmSubmit (dwukrokowe potwierdzenie, ADR-105):
 * operacja jest nieodwracalna — wtyczka najemcy przestaje działać natychmiast.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";

import { generateApiKeyAction, revokeApiKeyAction, type GeneratedKeyState } from "./api-keys-actions";

const initialState: FormState = {};
const initialGeneratedState: GeneratedKeyState = {};

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  /** Daty sformatowane na SERWERZE (locale operatora) — klient tylko pokazuje. */
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function GenerateKeyForm() {
  const t = useTranslations("apiSettings");
  const [state, formAction, pending] = useActionState(generateApiKeyAction, initialGeneratedState);

  return (
    <ScreenSection title={t("generateTitle")} data-api-key-generate>
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="api-key-name">{t("nameLabel")}</Label>
        <Input id="api-key-name" name="name" placeholder={t("namePlaceholder")} disabled={pending} />
        <p className="text-muted-foreground">{t("nameHint")}</p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("generateCta")}
          </Button>
        </div>

        {(state.formError ?? state.fieldErrors?.name) && (
          <p role="alert" className="text-destructive">
            {state.formError ?? state.fieldErrors?.name}
          </p>
        )}
      </form>

      {state.generatedKey && (
        <div className="flex flex-col gap-2" data-api-key-generated>
          <p className="text-status-positive-fg text-sm">{t("generatedOk", { name: state.success ?? "" })}</p>
          {/* Jedyne miejsce, w którym surowy klucz istnieje na ekranie —
              zaznaczalny do skopiowania, łamany, żeby nie uciekał poza miarę. */}
          <code className="bg-muted rounded-md p-3 text-sm break-all select-all">
            {state.generatedKey}
          </code>
          <p role="status" className="text-status-attention-fg text-sm">
            {t("generatedWarning")}
          </p>
        </div>
      )}
    </ScreenSection>
  );
}

function RevokeKeyForm({ keyId }: { keyId: string }) {
  const t = useTranslations("apiSettings");
  const [state, formAction, pending] = useActionState(revokeApiKeyAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="keyId" value={keyId} />
      <ConfirmSubmit
        label={t("revokeCta")}
        question={t("revokeQuestion")}
        confirmLabel={t("revokeConfirm")}
        cancelLabel={t("revokeCancel")}
        marker="revoke-api-key"
        pending={pending}
      />
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
    </form>
  );
}

function ApiKeyCard({ apiKey, isOwner }: { apiKey: ApiKeyRow; isOwner: boolean }) {
  const t = useTranslations("apiSettings");
  const revoked = apiKey.revokedAt !== null;

  return (
    <ScreenSection
      data-api-key-state={revoked ? "revoked" : "active"}
      title={apiKey.name}
      description={<code className="text-[13px]">{apiKey.keyPrefix}…</code>}
    >
      <dl className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-xs">{t("createdLabel")}</dt>
          <dd className="text-foreground">{apiKey.createdAt}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs">{t("lastUsedLabel")}</dt>
          <dd className="text-foreground">{apiKey.lastUsedAt ?? t("neverUsed")}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs">{t("stateLabel")}</dt>
          <dd className="text-foreground">
            {revoked ? t("stateRevoked", { date: apiKey.revokedAt ?? "" }) : t("stateActive")}
          </dd>
        </div>
      </dl>

      {isOwner && !revoked && <RevokeKeyForm keyId={apiKey.id} />}
    </ScreenSection>
  );
}

export function ApiKeysPanel({
  apiKeys,
  isOwner,
  apiBaseUrl,
}: {
  apiKeys: ApiKeyRow[];
  isOwner: boolean;
  /** Baza adresowa API sklepu (host subdomeny) — informacyjnie dla integracji. */
  apiBaseUrl: string | null;
}) {
  const t = useTranslations("apiSettings");

  return (
    <>
      <ScreenSection
        data-api-keys-intro
        title={t("introTitle")}
        description={
          <>
            {t("intro")}
            {apiBaseUrl && (
              <>
                {" "}
                {t("baseUrlLabel")} <code className="text-[13px]">{apiBaseUrl}</code>
              </>
            )}
          </>
        }
      />

      {apiKeys.length === 0 ? (
        <ScreenSection data-api-key-list title={t("listHeading")} description={t("emptyState")} />
      ) : (
        <div data-api-key-list className="flex flex-col gap-4">
          {apiKeys.map((apiKey) => (
            <ApiKeyCard key={apiKey.id} apiKey={apiKey} isOwner={isOwner} />
          ))}
        </div>
      )}

      {isOwner ? (
        <GenerateKeyForm />
      ) : (
        // UI nie udaje bramki, której nie ma w bazie — mówi wprost, że
        // mutacje należą do właściciela (RLS 0053).
        <ScreenSection description={t("ownerOnly")} />
      )}
    </>
  );
}
