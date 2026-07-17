import {
  RentalLifecycleEmailTemplate,
  type RentalLifecycleEmailProps,
} from "./rental-lifecycle-email";

export function RentalReadyForPickup(props: RentalLifecycleEmailProps) {
  return <RentalLifecycleEmailTemplate {...props} template="readyForPickup" />;
}
