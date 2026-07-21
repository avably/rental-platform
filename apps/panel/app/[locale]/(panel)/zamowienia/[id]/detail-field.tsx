/**
 * Para etykieta/wartość szczegółu zamówienia — odpowiednik
 * `[data-label-value]` z sekcji 05 artefaktu: mikro-etykieta wersalikami nad
 * wartością, wartość 500 15/22. Jedno miejsce, żeby pola nie rozjechały się
 * między kolumną główną a panelem bocznym.
 */
export function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div data-label-value className="grid gap-1.5">
      <span className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </span>
      <strong className="text-[15px] leading-[22px] font-medium">{children}</strong>
    </div>
  );
}
