import {
  RentalPickedUp,
  type RentalLifecycleEmailProps,
} from "../src/index";

function RentalPickedUpPreview(props: RentalLifecycleEmailProps) {
  return <RentalPickedUp {...props} />;
}

RentalPickedUpPreview.PreviewProps = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  orderNumber: "AV-2026-001",
  pickupLocationName: "Magazyn Główny",
  startDate: "20.07.2026",
  tenantName: "Wypożyczalnia Północ",
  totalRentalFormatted: "550,00 zł",
} satisfies RentalLifecycleEmailProps;

export default RentalPickedUpPreview;
