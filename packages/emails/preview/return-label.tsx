import {
  ReturnLabelEmail,
  type ReturnLabelEmailProps,
} from "../src/index";

function ReturnLabelPreview(props: ReturnLabelEmailProps) {
  return <ReturnLabelEmail {...props} />;
}

ReturnLabelPreview.PreviewProps = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  orderNumber: "AV-2026-001",
  shipmentNumber: "GK240610123456",
  tenantName: "Wypożyczalnia Północ",
} satisfies ReturnLabelEmailProps;

export default ReturnLabelPreview;
