-- Onboarding on the web (feature 009, second half).
--
-- The web console runs the same Phase 1 flow as the app, but a browser has no
-- device id: web sessions are never device-bound anywhere on this platform.
-- NULL therefore means "applied on the web". Approving such an application
-- approves the member and no device; a phone the member later signs in from
-- still needs its own device approval, exactly as before.
ALTER TABLE membership_applications ALTER COLUMN device_id DROP NOT NULL;
