export type { ContractCustomField, ContractPdfProps, ContractLocale } from "./types";
/**
 * Znak najemcy w umowie (ADR-175). `contractLogoFormat` eksportujemy dla
 * WOŁAJĄCEGO: to on decyduje, czy w ogóle sięgać po plik, a pytanie „czy ten
 * format wejdzie do dokumentu" ma jedną odpowiedź i mieszka w tym pakiecie.
 */
export {
  CONTRACT_LOGO_FORMATS,
  contractLogoFormat,
  contractLogoImage,
  type ContractLogo,
  type ContractLogoFormat,
} from "./logo";
export { renderContractPdf } from "./render";
