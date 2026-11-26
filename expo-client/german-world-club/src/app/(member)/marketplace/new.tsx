import { ListingForm } from '@/components/listing-form';

/**
 * A new marketplace listing (feature 017, US3) — on a screen that slides in from
 * the right (see _layout.tsx). The form itself is `ListingForm`, shared with the
 * edit screen so the fields, thresholds and layout are one definition (feature 037).
 */
export default function NewListing() {
  return <ListingForm />;
}
