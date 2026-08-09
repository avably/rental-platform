/**
 * Nowe pole własne (C6-A1, ADR-118).
 *
 * `force-dynamic` jak lista: ekran jest interaktywny (useActionState), a
 * statyczny prerender z nonce'em CSP zabiłby hydrację po cichu (ADR-083).
 */
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenHeader, ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { createDefinitionAction } from "../actions";
import { DefinitionForm } from "../definition-form";

export const dynamic = "force-dynamic";

export default async function NewCustomFieldPage() {
  const ctx = await requireMemberPage("/organizacja/pola-wlasne/nowe");
  // Zakładanie definicji jest zastrzeżone dla właściciela (polityka
  // `tenant_insert`, 0057). Ekran, który pokazuje formularz i dopiero po
  // wysyłce mówi „nie wolno", byłby atrapą — 404 jest uczciwsze.
  if (ctx.role !== "owner") notFound();

  const t = await getTranslations("customFields");

  return (
    <FormMeasure>
      <div className="flex flex-col gap-4">
        <ScreenHeader
          back={{ href: "/organizacja/pola-wlasne", label: t("backToList") }}
          title={t("newField")}
        />
        <ScreenSection title={t("form.section")}>
          <DefinitionForm
            action={createDefinitionAction}
            defaults={{
              entity: "customer",
              fieldType: "text",
              label: "",
              helpText: "",
              optionsText: "",
              required: false,
              showInPanel: true,
              showInCheckout: false,
              showInContract: false,
            }}
          />
        </ScreenSection>
      </div>
    </FormMeasure>
  );
}
