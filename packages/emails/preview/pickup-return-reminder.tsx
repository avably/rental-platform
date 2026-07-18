import {
  PickupReturnReminderEmail,
  type PickupReturnReminderEmailProps,
} from "../src/index";

function PickupReturnReminderPreview(props: PickupReturnReminderEmailProps) {
  return <PickupReturnReminderEmail {...props} />;
}

PickupReturnReminderPreview.PreviewProps = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  locationAddress: "ul. Składowa 5, 00-001 Warszawa",
  locationName: "Magazyn Główny",
  orderNumber: "AV-2026-001",
  tenantName: "Wypożyczalnia Północ",
} satisfies PickupReturnReminderEmailProps;

export default PickupReturnReminderPreview;
