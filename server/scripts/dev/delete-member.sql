-- Delete ONE member and everything that hangs off them — for test and
-- development databases only.
--
-- The platform is built so this cannot normally happen: members refuse DELETE
-- by trigger (§12 rule 4), the audit log and the referral/XP ledger are
-- append-only, profiling children are final, a thread post's media cannot be
-- detached. This script switches off exactly those delete-refusing triggers,
-- for its own transaction only, and switches them back on before it ends.
-- It deliberately does NOT use `session_replication_role = replica`: that
-- also turns off foreign-key enforcement, so a reference this script missed
-- would silently leave orphans. With FKs on, a missed reference makes the
-- whole run fail and roll back instead.
--
-- What else goes, because it cannot exist without this member:
--   * their thread posts, AND every post replying to or quoting them, at any
--     depth (other members' posts included — a reply needs its parent);
--   * every conversation they took part in, and every conversation about one
--     of their listings (the other participant loses it too);
--   * referrals they made or were made through, and the XP entries for them —
--     including XP a referrer earned for referring this member;
--   * audit rows naming them as actor or target, their sessions, tokens,
--     counters and queued mail.
-- Uploaded files stay in storage (`var/`, or the bucket); only their rows go.
--
-- HOW TO RUN (as the database owner, e.g. `postgres` — the app role may not
-- delete from the audit log). The whole script is ONE statement, so it behaves
-- the same in psql, DBeaver, DataGrip or pgAdmin, with auto-commit on or off.
--   1. Edit the two settings at the top of the block below:
--        target_ref    — the member's email or id;
--        really_delete — false (the default) is a DRY RUN: everything is
--                        done, counted, and undone again, and the NOTICE
--                        lines say what would go. Set true to delete.
--   2. Run the whole file (DBeaver: "Execute script", Alt+X). The counts are
--      NOTICEs — in DBeaver, open the Output panel (Ctrl+Shift+O) to see them.
--
-- If a client reports 25P02 "current transaction is aborted", an EARLIER
-- statement on that connection failed and the connection is still inside its
-- transaction: roll back (or reconnect), then look at the first error.
--
-- With psql:  psql "$DATABASE_URL" -f server/scripts/dev/delete-member.sql
-- With Docker: docker exec -i <postgres container> psql -U postgres -d <db> < server/scripts/dev/delete-member.sql

DO $$
DECLARE
  -- ===== EDIT THESE TWO ====================================================
  target_ref    text    := 'someone@demo.invalid';   -- the member's email or id
  really_delete boolean := false;                    -- false = dry run, true = delete
  -- =========================================================================
  m            uuid;
  m_email      text;
  n            bigint;
  -- The delete-refusing triggers, and nothing else. FK triggers stay on.
  guards       text[][] := ARRAY[
    ['members', 'members_refuse_delete'],
    ['audit_log', 'audit_log_no_update'],
    ['member_designations', 'member_designations_guard'],
    ['thread_post_media', 'thread_post_media_guard'],
    ['member_profiling_kids', 'member_profiling_kids_final'],
    ['member_profiling_partner', 'member_profiling_partner_final'],
    ['referral_links', 'referral_links_transition'],
    ['referrals', 'referrals_append_only'],
    ['xp_entries', 'xp_entries_append_only']
  ];
  i int;
BEGIN
  -- ---- Guards --------------------------------------------------------------
  -- Only the local development database.
  IF current_database() <> 'german_world_club' THEN
    RAISE EXCEPTION 'Connected to "%", not german_world_club. Nothing was changed.', current_database();
  END IF;

  SELECT id, email INTO m, m_email FROM members
   WHERE email = lower(target_ref) OR id::text = target_ref;
  IF m IS NULL THEN
    RAISE EXCEPTION 'No member matches "%". Nothing was changed.', target_ref;
  END IF;
  RAISE NOTICE '% member % <%> from %',
    CASE WHEN really_delete THEN 'Deleting' ELSE 'DRY RUN — would delete' END, m, m_email, current_database();

  -- Everything below runs in an inner block, which PL/pgSQL gives its own
  -- savepoint: a dry run raises at the end and is rolled back to here — the
  -- trigger switches included — without failing the statement.
  BEGIN

  -- ---- Switch the delete guards off, for this transaction only -------------
  FOR i IN 1 .. array_length(guards, 1) LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', guards[i][1], guards[i][2]);
  END LOOP;

  -- ---- Threads: their posts, and every reply/quote under them --------------
  DROP TABLE IF EXISTS doomed_posts;
  CREATE TEMP TABLE doomed_posts ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT id FROM thread_posts WHERE author_id = m
      UNION
      SELECT p.id FROM thread_posts p JOIN tree ON p.reply_to_id = tree.id OR p.root_id = tree.id OR p.quote_of_id = tree.id
    )
    SELECT id FROM tree;
  SELECT count(*) INTO n FROM doomed_posts;
  RAISE NOTICE '  thread posts (theirs + replies/quotes under them): %', n;
  -- Self-references are RESTRICT, checked row by row: delete leaves first.
  LOOP
    DELETE FROM thread_posts p
     WHERE p.id IN (SELECT id FROM doomed_posts)
       AND NOT EXISTS (
         SELECT 1 FROM thread_posts c
          WHERE c.id IN (SELECT id FROM doomed_posts) AND c.id <> p.id
            AND (c.reply_to_id = p.id OR c.root_id = p.id OR c.quote_of_id = p.id));
    EXIT WHEN NOT FOUND;
  END LOOP;
  IF EXISTS (SELECT 1 FROM thread_posts WHERE id IN (SELECT id FROM doomed_posts)) THEN
    RAISE EXCEPTION 'Some thread posts could not be removed (a reference cycle?). Rolled back.';
  END IF;

  DELETE FROM thread_likes WHERE member_id = m;          GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  likes on others'' posts: %', n;
  DELETE FROM thread_reposts WHERE member_id = m;        GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  reposts: %', n;
  DELETE FROM thread_reports WHERE reporter_id = m;      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  thread reports filed: %', n;
  DELETE FROM thread_post_mentions WHERE member_id = m;  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  mentions of them: %', n;

  -- ---- Conversations: theirs, and any about their listings -----------------
  DELETE FROM conversations c
   WHERE c.id IN (SELECT conversation_id FROM conversation_participants WHERE member_id = m)
      OR (c.subject_type = 'marketplace_listing'
          AND c.subject_id IN (SELECT id FROM marketplace_listings WHERE owner_id = m));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  conversations: %', n;

  -- ---- Marketplace ---------------------------------------------------------
  DELETE FROM marketplace_listings WHERE owner_id = m;   GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  marketplace listings: %', n;
  DELETE FROM marketplace_reports WHERE reporter_id = m; GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  marketplace reports filed: %', n;
  DELETE FROM marketplace_terms_acceptances WHERE member_id = m;

  -- ---- Profile, social graph, settings -------------------------------------
  DELETE FROM member_avatars WHERE member_id = m;
  DELETE FROM member_links WHERE member_id = m;
  DELETE FROM member_designations WHERE member_id = m;
  DELETE FROM member_follows WHERE follower_id = m OR followee_id = m;
  DELETE FROM member_blocks WHERE blocker_id = m OR blocked_id = m;
  DELETE FROM member_mutes WHERE muter_id = m OR muted_id = m;
  DELETE FROM member_activity_cursor WHERE member_id = m;
  DELETE FROM message_mail_schedule WHERE member_id = m;
  DELETE FROM member_push_preferences WHERE member_id = m;

  -- ---- Media they uploaded (rows only; files stay in storage) --------------
  DELETE FROM assets
   WHERE uploader_kind = 'member' AND uploaded_by = m
     AND NOT EXISTS (SELECT 1 FROM thread_post_media x WHERE x.asset_id = assets.id)
     AND NOT EXISTS (SELECT 1 FROM marketplace_listing_media x WHERE x.asset_id = assets.id)
     AND NOT EXISTS (SELECT 1 FROM member_avatars x WHERE x.asset_id = assets.id);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  media assets (rows): %', n;

  -- ---- Onboarding and profiling --------------------------------------------
  DELETE FROM member_profiling_kids WHERE member_id = m;
  DELETE FROM member_profiling_partner WHERE member_id = m;
  DELETE FROM member_profiling WHERE member_id = m;
  DELETE FROM device_approvals WHERE member_id = m;

  -- ---- Referrals and XP (018) ----------------------------------------------
  DROP TABLE IF EXISTS doomed_referrals;
  CREATE TEMP TABLE doomed_referrals ON COMMIT DROP AS
    SELECT r.id FROM referrals r
     WHERE r.referee_member_id = m
        OR r.link_id IN (SELECT id FROM referral_links WHERE owner_kind = 'member' AND owner_id = m);
  DROP TABLE IF EXISTS doomed_xp;
  CREATE TEMP TABLE doomed_xp ON COMMIT DROP AS
    SELECT id FROM xp_entries
     WHERE referral_id IN (SELECT id FROM doomed_referrals)
        OR (owner_kind = 'member' AND owner_id = m);
  -- Reversals point at the entry they reverse (RESTRICT): them first.
  DELETE FROM xp_entries WHERE id IN (SELECT id FROM doomed_xp) AND reverses_entry_id IS NOT NULL;
  DELETE FROM xp_entries WHERE reverses_entry_id IN (SELECT id FROM doomed_xp);
  DELETE FROM xp_entries WHERE id IN (SELECT id FROM doomed_xp);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  XP entries: % (plus reversals)', n;
  DELETE FROM referrals WHERE id IN (SELECT id FROM doomed_referrals);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  referrals: %', n;
  UPDATE membership_applications SET pending_referral_link_id = NULL
   WHERE pending_referral_link_id IN (SELECT id FROM referral_links WHERE owner_kind = 'member' AND owner_id = m);
  DELETE FROM referral_links WHERE owner_kind = 'member' AND owner_id = m;
  DELETE FROM membership_applications WHERE member_id = m;

  -- ---- Events, offers, push ------------------------------------------------
  DELETE FROM redemption_feedback WHERE redemption_id IN (SELECT id FROM redemptions WHERE member_id = m);
  DELETE FROM redemptions WHERE member_id = m;           GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  offer redemptions: %', n;
  DELETE FROM event_registrations WHERE member_id = m;   GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  event registrations: %', n;
  DELETE FROM push_deliveries WHERE member_id = m;
  DELETE FROM push_test_recipients WHERE member_id = m;
  DELETE FROM push_devices WHERE member_id = m;

  -- ---- Credentials, counters, mail, audit ----------------------------------
  DELETE FROM sessions WHERE account_kind = 'member' AND account_id = m;   -- refresh tokens cascade
  DELETE FROM otp_challenges WHERE account_kind = 'member' AND account_id = m;
  DELETE FROM password_reset_tokens WHERE account_kind = 'member' AND account_id = m;
  DELETE FROM counters WHERE subject = m::text;
  DELETE FROM mail_outbox WHERE lower(to_address) = lower(m_email);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  queued/sent mail rows: %', n;
  DELETE FROM audit_log WHERE actor_id::text = m::text OR target_id::text = m::text;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  audit rows: %', n;

  -- ---- The member ----------------------------------------------------------
  DELETE FROM members WHERE id = m;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'The member row was not deleted. Rolled back.'; END IF;

  -- ---- Guards back on, before the transaction can end ----------------------
  FOR i IN 1 .. array_length(guards, 1) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', guards[i][1], guards[i][2]);
  END LOOP;

    IF NOT really_delete THEN
      -- Caught just below: undoes everything in this inner block.
      RAISE EXCEPTION USING ERRCODE = 'GW001', MESSAGE = 'dry run';
    END IF;
    RAISE NOTICE 'Done: member % deleted.', m_email;
  EXCEPTION WHEN SQLSTATE 'GW001' THEN
    RAISE NOTICE 'DRY RUN: nothing was changed. Set really_delete := true to delete.';
  END;
END
$$;
