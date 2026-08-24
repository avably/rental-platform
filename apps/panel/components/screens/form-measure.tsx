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
 * szerokości wspólnego kontenera panelu (`max-w-5xl`, ADR-243) z layoutu. Miara
 * dotyczy wiersza tekstu do czytania i pola do wypełnienia, nie danych, które
 * chcą kolumn.
 *
 * Formularz, który sam w sobie jest całym blokiem miary, może nieść atrybut
 * bezpośrednio (`<form data-form-line-measure>`) — tak jak w artefakcie.
 *
 * Reszta propów idzie na element, żeby blok miary mógł nieść WŁASNĄ kotwicę
 * ekranu (`data-site-editor-controls` w edytorze strony) bez drugiego, pustego
 * `<div>` dokoła. Szerokości to nie dotyczy: `className` z `max-w-*` zapala skan
 * spójności (ADR-060), a liczby w tym pliku pilnuje `form-measure-contract`.
 */
export function FormMeasure({
  children,
  className,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"div">, "children" | "className">) {
  return (
    <div data-form-line-measure className={className} {...rest}>
      {children}
    </div>
  );
}
