import {
  RentalLifecycleEmailTemplate,
  type RentalLifecycleEmailProps,
} from "./rental-lifecycle-email";

export function RentalPickedUp(props: RentalLifecycleEmailProps) {
  return <RentalLifecycleEmailTemplate {...props} template="pickedUp" />;
}
