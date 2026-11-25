-- New offer types and the staff module for merchant stores (feature 035).
--
-- Its own file because PostgreSQL does not let a transaction use an enum value
-- it has just added: 046 and 047 reference these values, and the runner applies
-- each file as one transaction, so they must already be committed by then.

-- "freebie" and "buy one get one" (specs/035-merchant-store-offers/research.md R3).
-- `benefit_value` stays NULL for both; the price constraint on `offers` still
-- holds because neither needs a price.
ALTER TYPE benefit_kind ADD VALUE IF NOT EXISTS 'freebie';
ALTER TYPE benefit_kind ADD VALUE IF NOT EXISTS 'bogo';

-- The permission module for stores, offer categories and the platform
-- redemption report (research R2, R11). Mirrors how 030 and 040 added theirs.
ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'merchant_offers';
