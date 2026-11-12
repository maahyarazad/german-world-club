import RequireGrant from '../RequireGrant'

/** Staff oversight of referrals and XP (feature 018, US4). Filled in by T062. */
export function AdminReferrals() {
  return <RequireGrant module="referrals" flag="read">{null}</RequireGrant>
}

export default AdminReferrals
