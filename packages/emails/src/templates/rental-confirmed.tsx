import {
  RentalLifecycleEmailTemplate,
  type RentalLifecycleEmailProps,
} from "./rental-lifecycle-email";

export function RentalConfirmed(props: RentalLifecycleEmailProps) {
  return <RentalLifecycleEmailTemplate {...props} template="confirmed" />;
}
