import {
  NewOrderNotification,
  type NewOrderNotificationProps,
} from "../src/index";

function NewOrderNotificationPreview(props: NewOrderNotificationProps) {
  return <NewOrderNotification {...props} />;
}

NewOrderNotificationPreview.PreviewProps = {
  locale: "pl",
  customerName: "Alicja Nowak",
  orderNumber: "ZAM-2026-001",
  orderUrl: "https://app.example.test/orders/order-preview",
  rentalEndDate: "23.07.2026",
  rentalStartDate: "20.07.2026",
  totalAmount: "1 299,00 zł",
} satisfies NewOrderNotificationProps;

export default NewOrderNotificationPreview;
