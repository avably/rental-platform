/**
 * Miara wiersza formularza (P8 — reguła `data-form-measure-contract` artefaktu
 * Fazy 2).
 *
 * Ekrany operacyjne mają JEDNĄ czytelną szerokość treści edytowalnej. Wartość
 * (42rem) mieszka w `app/globals.css` jako `--form-line-measure`; ten
 * komponent tylko przypina atrybut, który tę regułę uruchamia. Nie przyjmuje
 * `className` z szerokością i nie ma wariantów — cała jego wartość polega na
 * tym, że nie ma czego lokalnie „podkręcić".
 *
 * Czego NIE obejmuje: tabele, listy danych i podgląd sklepu zostają na pełnej
 * szerokości kontenera `max-w-6xl` z layoutu. Miara dotyczy wiersza tekstu do
 * czytania i pola do wypełnienia, nie danych, które chcą kolumn.
 *
 * Formularz, który sam w sobie jest całym blokiem miary, może nieść atrybut
 * bezpośrednio (`<form data-form-line-measure>`) — tak jak w artefakcie.
 */
export function FormMeasure({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-form-line-measure className={className}>
      {children}
    </div>
  );
}
