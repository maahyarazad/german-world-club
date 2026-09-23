import type { Pool } from 'pg'

/**
 * The vehicle feature catalogue (§7's "~40 feature checkboxes").
 *
 * Data, not schema — which is the whole reason this is a table rather than
 * forty boolean columns (research.md R3). Adding "roof box" is a row, and
 * staff can do it under the permission system rather than waiting for a
 * migration.
 *
 * **No labels here.** The server emits no localised text, so each feature
 * carries a stable `key` and the two catalogues in `client/src/i18n/` supply
 * the German and English words. `tests/ops/no-server-localisation` asserts no
 * response body varies with `Accept-Language`.
 */

type Feature = { key: string; grouping: string }

const FEATURES: readonly Feature[] = [
  // --- comfort -------------------------------------------------------------
  { key: 'air_conditioning', grouping: 'comfort' },
  { key: 'climate_control', grouping: 'comfort' },
  { key: 'heated_seats', grouping: 'comfort' },
  { key: 'ventilated_seats', grouping: 'comfort' },
  { key: 'leather_seats', grouping: 'comfort' },
  { key: 'electric_seats', grouping: 'comfort' },
  { key: 'memory_seats', grouping: 'comfort' },
  { key: 'heated_steering_wheel', grouping: 'comfort' },
  { key: 'panoramic_roof', grouping: 'comfort' },
  { key: 'sunroof', grouping: 'comfort' },
  { key: 'keyless_entry', grouping: 'comfort' },
  { key: 'keyless_start', grouping: 'comfort' },
  { key: 'power_tailgate', grouping: 'comfort' },
  { key: 'tinted_windows', grouping: 'comfort' },

  // --- safety --------------------------------------------------------------
  { key: 'abs', grouping: 'safety' },
  { key: 'esp', grouping: 'safety' },
  { key: 'airbags_front', grouping: 'safety' },
  { key: 'airbags_side', grouping: 'safety' },
  { key: 'airbags_curtain', grouping: 'safety' },
  { key: 'lane_assist', grouping: 'safety' },
  { key: 'blind_spot_monitor', grouping: 'safety' },
  { key: 'adaptive_cruise_control', grouping: 'safety' },
  { key: 'emergency_braking', grouping: 'safety' },
  { key: 'parking_sensors_front', grouping: 'safety' },
  { key: 'parking_sensors_rear', grouping: 'safety' },
  { key: 'reversing_camera', grouping: 'safety' },
  { key: 'camera_360', grouping: 'safety' },
  { key: 'tyre_pressure_monitor', grouping: 'safety' },
  { key: 'isofix', grouping: 'safety' },

  // --- media and connectivity ---------------------------------------------
  { key: 'navigation', grouping: 'media' },
  { key: 'bluetooth', grouping: 'media' },
  { key: 'apple_carplay', grouping: 'media' },
  { key: 'android_auto', grouping: 'media' },
  { key: 'dab_radio', grouping: 'media' },
  { key: 'premium_sound', grouping: 'media' },
  { key: 'wireless_charging', grouping: 'media' },
  { key: 'head_up_display', grouping: 'media' },
  { key: 'usb_c_ports', grouping: 'media' },

  // --- drivetrain and equipment -------------------------------------------
  { key: 'all_wheel_drive', grouping: 'drivetrain' },
  { key: 'tow_bar', grouping: 'drivetrain' },
  { key: 'roof_rails', grouping: 'drivetrain' },
  { key: 'alloy_wheels', grouping: 'drivetrain' },
  { key: 'winter_tyres', grouping: 'drivetrain' },
  { key: 'spare_wheel', grouping: 'drivetrain' },
]

/** Every feature key, for the i18n parity check in the client. */
export const VEHICLE_FEATURE_KEYS: readonly string[] = FEATURES.map((f) => f.key)

/**
 * Idempotent and additive, like the rest of the demo seed. A feature that is
 * already there keeps its id, because listings reference it.
 */
export async function seedVehicleFeatures(pool: Pool): Promise<number> {
  let position = 0
  for (const feature of FEATURES) {
    position += 1
    await pool.query(
      `INSERT INTO vehicle_features (key, grouping, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET grouping = EXCLUDED.grouping, position = EXCLUDED.position`,
      [feature.key, feature.grouping, position],
    )
  }
  return FEATURES.length
}
