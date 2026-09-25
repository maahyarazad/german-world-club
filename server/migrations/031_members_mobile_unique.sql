-- One mobile number, one member.
--
-- The number is where a sign-in code is sent. Two members sharing one means
-- either can receive the other's code, and "which account did you mean?" has
-- no safe answer before authentication. Registration and the step-3 contact
-- change (onboarding/application/contact.ts) both refuse a number in use; this
-- index is what makes that true under concurrency rather than merely likely.

-- The demo seed used to draw numbers at random from the 1,000-number range
-- Ofcom reserves for fiction (+44 7700 900xxx), so a 200-member demo population
-- shared some. Those are renumbered to unused numbers from the same range.
-- ONLY generated demo members (@demo.invalid) are touched, and the first holder
-- of a number keeps it, preferring a real member over a demo one.
WITH holders AS (
  SELECT id,
         email LIKE '%@demo.invalid' AS demo,
         row_number() OVER (PARTITION BY mobile ORDER BY (email LIKE '%@demo.invalid'), created_at, id) AS nth
    FROM members
   WHERE mobile IS NOT NULL
),
victims AS (
  SELECT id, row_number() OVER (ORDER BY id) AS slot
    FROM holders
   WHERE nth > 1 AND demo
),
free AS (
  SELECT candidate AS mobile, row_number() OVER (ORDER BY candidate) AS slot
    FROM (SELECT '+447700900' || lpad(n::text, 3, '0') AS candidate FROM generate_series(0, 999) AS n) AS range
   WHERE candidate NOT IN (SELECT mobile FROM members WHERE mobile IS NOT NULL)
)
UPDATE members m
   SET mobile = free.mobile
  FROM victims
  JOIN free USING (slot)
 WHERE m.id = victims.id;

-- Anything still shared involves a real member. Stop here, naming the count:
-- deciding which person keeps a number is not a migration's call.
DO $$
DECLARE
  shared integer;
BEGIN
  SELECT count(*) INTO shared
    FROM (SELECT mobile FROM members WHERE mobile IS NOT NULL GROUP BY mobile HAVING count(*) > 1) AS d;
  IF shared > 0 THEN
    RAISE EXCEPTION '% mobile number(s) are shared by more than one member; resolve them before applying 031', shared;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS members_mobile_unique ON members (mobile) WHERE mobile IS NOT NULL;
