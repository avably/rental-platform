/**
 * Walidacja formularzy ustawień dostaw — lustro CHECK-ów z migracji 0013
 * (walidacja u źródła w UI, autorytatywna w bazie). Schematy PRODUKUJĄ
 * wartości jsonb w kształcie bazy (snake_case), gotowe do upsert-u.
 *
 * Kwoty cennika wpisywane w złotych; konwersję robi parseMajorToGrosze
 * (jedyne miejsce konwersji w panelu — lib/money-input.ts). Pusta cena =
 * metoda BEZ cennika (nadanie zgłosi błąd konfiguracji — zero cichych 0);
 * pusty próg = brak progu (klucz nieobecny w jsonb, nie null — CHECK 0013).
 */
import { z } from "zod";

import { parseMajorToGrosze } from "@/lib/money-input";

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, "Wartość jest za długa.");

export const deliverySettingsCredentialsSchema = z.object({
  email: z.string().trim().email("Nieprawidłowy adres e-mail.").max(320),
  password: z.string().min(1, "Podaj hasło.").max(200, "Hasło jest za długie."),
  environment: z.enum(["test", "production"], { message: "Nieprawidłowe środowisko." }),
});

export const deliverySettingsSenderSchema = z
  .object({
    name: requiredText(200, "Podaj nazwę nadawcy."),
    street: requiredText(200, "Podaj ulicę."),
    houseNumber: requiredText(20, "Podaj numer domu."),
    apartmentNumber: z
      .string()
      .trim()
      .max(20, "Numer lokalu jest za długi.")
      .optional()
      .transform((value) => (value ? value : undefined)),
    postCode: requiredText(12, "Podaj kod pocztowy."),
    city: requiredText(120, "Podaj miasto."),
    phone: requiredText(30, "Podaj telefon."),
    email: z.string().trim().email("Nieprawidłowy adres e-mail nadawcy.").max(320),
  })
  .transform((sender) => ({
    name: sender.name,
    street: sender.street,
    house_number: sender.houseNumber,
    ...(sender.apartmentNumber !== undefined ? { apartment_number: sender.apartmentNumber } : {}),
    post_code: sender.postCode,
    city: sender.city,
    phone: sender.phone,
    email: sender.email,
  }));

const dimensionSchema = z.coerce
  .number({ message: "Podaj liczbę." })
  .positive("Wartość musi być większa od zera.")
  .max(999, "Wartość poza zakresem.");

export const deliverySettingsParcelSchema = z
  .object({
    lengthCm: dimensionSchema,
    widthCm: dimensionSchema,
    heightCm: dimensionSchema,
    weightKg: dimensionSchema,
  })
  .transform((parcel) => ({
    length_cm: parcel.lengthCm,
    width_cm: parcel.widthCm,
    height_cm: parcel.heightCm,
    weight_kg: parcel.weightKg,
  }));

/** "12,50" → 1250; "" → undefined; wejście odrzucone → błąd walidacji. */
const optionalMoney = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    if (raw === "") return undefined;
    const grosze = parseMajorToGrosze(raw);
    if (grosze === null) {
      ctx.addIssue({ code: "custom", message: "Nieprawidłowa kwota." });
      return z.NEVER;
    }
    return grosze;
  });

const PRICING_METHODS = ["courier", "parcel_locker", "own_delivery"] as const;

export const deliverySettingsPricingSchema = z
  .object({
    courierPrice: optionalMoney,
    courierFreeAbove: optionalMoney,
    parcelLockerPrice: optionalMoney,
    parcelLockerFreeAbove: optionalMoney,
    ownDeliveryPrice: optionalMoney,
    ownDeliveryFreeAbove: optionalMoney,
  })
  .transform((input, ctx) => {
    const byMethod: Record<
      (typeof PRICING_METHODS)[number],
      { price?: number; freeAbove?: number }
    > = {
      courier: { price: input.courierPrice, freeAbove: input.courierFreeAbove },
      parcel_locker: { price: input.parcelLockerPrice, freeAbove: input.parcelLockerFreeAbove },
      own_delivery: { price: input.ownDeliveryPrice, freeAbove: input.ownDeliveryFreeAbove },
    };
    const value: Record<string, { price_grosze: number; free_above_grosze?: number }> = {};
    for (const method of PRICING_METHODS) {
      const { price, freeAbove } = byMethod[method];
      if (price === undefined) {
        if (freeAbove !== undefined) {
          // Próg bez ceny to konfiguracja bez znaczenia — odrzucamy, zamiast
          // cicho ją gubić (wzorzec 0006: nadmiar jest błędem, nie szumem).
          ctx.addIssue({
            code: "custom",
            message: "Próg darmowej dostawy wymaga podania ceny metody.",
          });
          return z.NEVER;
        }
        continue;
      }
      value[method] = {
        price_grosze: price,
        ...(freeAbove !== undefined ? { free_above_grosze: freeAbove } : {}),
      };
    }
    return value;
  });
