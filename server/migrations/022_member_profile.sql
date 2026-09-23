-- The member-editable half of the profile (feature 009).
--
-- Only what the profile screen can actually write. §2's wider profile —
-- interests, employment, privacy settings, committees — arrives with the
-- features that read and write it, not as columns nothing fills.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS bio  text,
  ADD COLUMN IF NOT EXISTS city text;

DO $$ BEGIN
  ALTER TABLE members ADD CONSTRAINT members_bio_length  CHECK (bio IS NULL OR char_length(bio) <= 500);
  ALTER TABLE members ADD CONSTRAINT members_city_length CHECK (city IS NULL OR char_length(city) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
