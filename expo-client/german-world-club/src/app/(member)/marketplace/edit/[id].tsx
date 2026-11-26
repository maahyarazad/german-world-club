import { useLocalSearchParams } from 'expo-router';

import { ListingForm } from '@/components/listing-form';

/**
 * Edit one of your own listings (feature 037, US1 and US2): the same form as a
 * new listing, loaded from `GET /marketplace/mine/:id`, with the Publish switch.
 * Whose listing this is, and whether it may still be edited, is the server's
 * answer; the form only draws what it says.
 */
export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListingForm editId={id} />;
}
