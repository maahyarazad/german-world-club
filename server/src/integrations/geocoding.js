import { requestDependency } from './http-client.js'

/**
 * Geocoding (resilience.md §2).
 *
 * Declared fallback: **save the record without coordinates, backfill later**.
 *
 * This is the clearest case in the table of a fallback that is genuinely
 * better than a failure. An outlet's address is the information staff actually
 * entered; the latitude and longitude are a derived convenience used to drop a
 * pin. Refusing to save a partner's new branch because a geocoding API is down
 * would lose real work to protect a decoration.
 *
 * The 120 s reset is the longest in the table for the same reason: nothing is
 * blocked while the circuit is open, so there is no cost to being patient.
 */

export function createGeocodingClient({ baseUrl = 'https://geocoding.invalid', send = requestDependency } = {}) {
  return {
    name: 'geocoding',

    async locate({ street, city, country }, { signal } = {}) {
      const query = new URLSearchParams({ q: [street, city, country].filter(Boolean).join(', ') })
      const response = await send('geocoding', `${baseUrl}/search?${query}`, { method: 'GET', signal })
      const result = await response.body.json()

      if (!result?.lat || !result?.lon) return geocodingUnavailable()
      return { latitude: Number(result.lat), longitude: Number(result.lon), resolved: true }
    },
  }
}

/**
 * The declared unavailable behaviour.
 *
 * `resolved: false` rather than a throw, so the caller stores what it has.
 * `needsBackfill` is the marker a later job reads — without it the record looks
 * complete and nobody ever comes back for it.
 */
export function geocodingUnavailable() {
  return { latitude: null, longitude: null, resolved: false, needsBackfill: true }
}
