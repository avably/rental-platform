/**
 * Lista odczytowa etykieta → wartość (P8, `.secondary-read-list` z artefaktu
 * Fazy 2).
 *
 * Trzy ekrany pokazują dane, których w tym miejscu NIE da się zmienić:
 * organizacja (ADR-059 D5), umowy w widoku członka zespołu i rekord DNS do
 * przepisania u rejestratora. Wszystkie trzy pisały to wcześniej po swojemu —
 * raz `<p><strong>Etykieta:</strong> wartość</p>`, raz własna siatka `<dl>`.
 * Wyłączony formularz byłby tu gorszym rozwiązaniem niż lista: sugeruje, że
 * edycja jest o jedno uprawnienie dalej, a nie że jej nie ma.
 *
 * `numeric` włącza cyfry tabelaryczne — WYŁĄCZNIE dla danych liczbowych
 * (ADR-053 D3), nigdy dla nazw i identyfikatorów.
 */
export function ReadList({
  rows,
  ...rest
}: {
  rows: readonly { label: string; value: React.ReactNode; numeric?: boolean }[];
} & React.ComponentProps<"dl">) {
  return (
    <dl className="grid gap-0" {...rest}>
      {rows.map((row) => (
        <div
          key={row.label}
          data-field={row.label}
          className="border-border grid grid-cols-1 gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(9rem,0.65fr)_1fr] sm:gap-4"
        >
          <dt className="text-muted-foreground text-[13px] leading-[18px] font-medium">
            {row.label}
          </dt>
          <dd
            className={`text-sm leading-5 font-medium break-words ${row.numeric ? "tabular-nums" : ""}`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
