/** Wewnętrzny helper — nie eksportowany z pakietu. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Brak zmiennej środowiskowej ${name} — uzupełnij .env.local (patrz README).`,
    );
  }
  return value;
}
