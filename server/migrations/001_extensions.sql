-- Extensions and every enum type, created before any table references them.
CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  CREATE TYPE account_kind     AS ENUM ('member', 'admin');
  CREATE TYPE member_status    AS ENUM ('active', 'locked', 'inactive', 'ended');
  CREATE TYPE approval_state   AS ENUM ('pending', 'approved', 'denied');
  CREATE TYPE seo_record_type  AS ENUM ('page', 'partner', 'outlet', 'event', 'article', 'committee');
  CREATE TYPE asset_kind       AS ENUM ('image', 'video');
  CREATE TYPE asset_state      AS ENUM ('processing', 'ready', 'failed');
  CREATE TYPE asset_variant    AS ENUM ('thumb', 'small', 'medium', 'large', 'poster', 'video');
  CREATE TYPE admin_module     AS ENUM (
    'members', 'invitations', 'events', 'event_registrations', 'partners',
    'partner_contracts', 'membership_orders', 'committees', 'threads_moderation',
    'marketplace_moderation', 'support_tickets', 'newsletters', 'mass_messages',
    'magazine', 'pages', 'seo', 'admins', 'settings', 'jobs'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
