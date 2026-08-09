/**
 * Edycja pola własnego (C6-A1, ADR-118).
 *
 * Gdy pole ma już zapisane wartości, wybór rodzaju i encji przychodzi
 * WYGASZONY: baza i tak odmówi (zamrożenie typu, 0057), a ekran ma powiedzieć
 * to wcześniej i po ludzku, zamiast oddawać surowy błąd bazy po wysyłce.
 */
import { customFieldDefinitionFromRow, selectOptionsToText } from "@avably/core";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenHeader, ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { updateDefinitionAction } from "../actions";
import { DefinitionForm } from "../definition-form";

export const dynamic = "force-dynamic";

export default async function EditCustomFieldPage({
  params,
}: {
  params: Promise<{ definitionId: string }>;
}) {
  const { definitionId } = await params;
  const ctx = await requireMemberPage(`/organizacja/pola-wlasne/${definitionId}`);
  if (ctx.role !== "owner") notFound();

  const { data: row } = await ctx.supabase
    .from("custom_field_definitions")
    .select(
      "id, entity, field_type, label, help_text, required, options, position, show_in_panel, show_in_checkout, show_in_contract, archived_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", definitionId)
    .maybeSingle();

  // Cudze i nieistniejące pole dają TĘ SAMĄ odpowiedź — RLS nic nie oddało,
  // więc ekran nie ma czego rozróżniać (i nie powinien).
  if (!row) notFound();

  const definition = customFieldDefinitionFromRow(
    row as Parameters<typeof customFieldDefinitionFromRow>[0],
  );

  const { data: inUseRows } = await ctx.supabase.schema("app").rpc("custom_fields_in_use");
  const inUse = ((inUseRows ?? []) as { definition_id: string }[]).some(
    (entry) => entry.definition_id === definition.id,
  );

  const t = await getTranslations("customFields");

  return (
    <FormMeasure>
      <div className="flex flex-col gap-4">
        <ScreenHeader
          back={{ href: "/organizacja/pola-wlasne", label: t("backToList") }}
          title={definition.label}
        />
        <ScreenSection title={t("form.section")}>
          <DefinitionForm
            action={updateDefinitionAction.bind(null, definition.id)}
            locked={inUse}
            defaults={{
              entity: definition.entity,
              fieldType: definition.type,
              label: definition.label,
              helpText: definition.helpText ?? "",
              optionsText: selectOptionsToText(definition.options),
              required: definition.required,
              showInPanel: definition.showInPanel,
              showInCheckout: definition.showInCheckout,
              showInContract: definition.showInContract,
            }}
          />
        </ScreenSection>
      </div>
    </FormMeasure>
  );
}
