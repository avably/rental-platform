/**
 * Schemat formularza definicji pola własnego (C6-A1, ADR-118).
 *
 * Bramką ostateczną jest baza (CHECK-i i triggery 0057) — PostgREST nie umie
 * jednak przełożyć jej odmowy na nic czytelnego, więc komunikat dla operatora
 * powstaje tutaj. Reguły kształtu (opcje, granice) pochodzą z
 * `@avably/core` — jedno źródło dla panelu, checkoutu i API v1.
 */
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  optionsForType,
  type CustomFieldType,
} from "@avably/core";
import { z } from "zod";

const OPTION_MESSAGES: Record<string, string> = {
  empty: "Lista wyboru musi mieć przynajmniej jedną pozycję.",
  tooMany: `Lista wyboru może mieć najwyżej ${CUSTOM_FIELD_LIMITS.optionsMax} pozycji.`,
  tooLong: `Pozycja listy może mieć najwyżej ${CUSTOM_FIELD_LIMITS.optionMax} znaków.`,
  duplicate: "Pozycje listy wyboru nie mogą się powtarzać.",
  controlChars: "Pozycja listy zawiera niedozwolone znaki.",
  notSelect: "Opcje ma wyłącznie lista wyboru.",
};

const checkboxSchema = z
  .string()
  .nullish()
  .transform((raw) => raw === "on" || raw === "true" || raw === "1");

export const customFieldDefinitionSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITIES, { message: "Wybierz, czego pole dotyczy." }),
    fieldType: z.enum(CUSTOM_FIELD_TYPES, { message: "Wybierz rodzaj pola." }),
    label: z
      .string()
      .trim()
      .min(1, "Podaj nazwę pola.")
      .max(CUSTOM_FIELD_LIMITS.labelMax, `Nazwa może mieć najwyżej ${CUSTOM_FIELD_LIMITS.labelMax} znaków.`),
    helpText: z
      .string()
      .trim()
      .max(
        CUSTOM_FIELD_LIMITS.helpTextMax,
        `Podpowiedź może mieć najwyżej ${CUSTOM_FIELD_LIMITS.helpTextMax} znaków.`,
      ),
    optionsText: z.string(),
    required: checkboxSchema,
    showInPanel: checkboxSchema,
    showInCheckout: checkboxSchema,
    showInContract: checkboxSchema,
  })
  .transform((input, ctx) => {
    const parsed = optionsForType(input.fieldType as CustomFieldType, input.optionsText);
    if (parsed.issue) {
      ctx.addIssue({
        code: "custom",
        path: ["optionsText"],
        message: OPTION_MESSAGES[parsed.issue] ?? OPTION_MESSAGES.empty!,
      });
      return z.NEVER;
    }
    // Pole niewidoczne NIGDZIE byłoby polem, którego nikt nie wypełni ani nie
    // zobaczy — a jego wartości i tak zostałyby w danych. Odmowa jest tańsza
    // niż tłumaczenie później, skąd wzięły się dane bez formularza.
    if (!input.showInPanel && !input.showInCheckout && !input.showInContract) {
      ctx.addIssue({
        code: "custom",
        path: ["showInPanel"],
        message: "Wskaż przynajmniej jedno miejsce, w którym pole ma być widoczne.",
      });
      return z.NEVER;
    }
    return {
      entity: input.entity,
      fieldType: input.fieldType,
      label: input.label,
      helpText: input.helpText === "" ? null : input.helpText,
      options: parsed.options,
      required: input.required,
      showInPanel: input.showInPanel,
      showInCheckout: input.showInCheckout,
      showInContract: input.showInContract,
    };
  });

export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionSchema>;

export function readDefinitionForm(formData: FormData) {
  return customFieldDefinitionSchema.safeParse({
    entity: formData.get("entity"),
    fieldType: formData.get("fieldType"),
    label: formData.get("label"),
    helpText: formData.get("helpText") ?? "",
    optionsText: formData.get("optionsText") ?? "",
    required: formData.get("required"),
    showInPanel: formData.get("showInPanel"),
    showInCheckout: formData.get("showInCheckout"),
    showInContract: formData.get("showInContract"),
  });
}
