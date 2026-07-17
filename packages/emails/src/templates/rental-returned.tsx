import {
  RentalLifecycleEmailTemplate,
  type RentalLifecycleEmailProps,
} from "./rental-lifecycle-email";

export function RentalReturned(props: RentalLifecycleEmailProps) {
  return <RentalLifecycleEmailTemplate {...props} template="returned" />;
}
