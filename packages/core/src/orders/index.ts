// Warstwa domenowa zamówień, która nie należy ani do wyceny (rental), ani do
// kuriera (courier): dziś forma płatności i wywiedziony z niej reżim.
export {
  OFFLINE_PAYMENT_METHODS,
  ORDER_PAYMENT_METHODS,
  isOrderPaymentMethod,
  paymentProviderFor,
  requiresPaymentAccount,
  type OrderPaymentMethod,
} from "./payment-method";
