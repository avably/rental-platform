import {
  RentalLifecycleEmailTemplate,
  type RentalLifecycleEmailProps,
} from "./rental-lifecycle-email";

export function RentalCancelled(props: RentalLifecycleEmailProps) {
  return <RentalLifecycleEmailTemplate {...props} template="cancelled" />;
}
