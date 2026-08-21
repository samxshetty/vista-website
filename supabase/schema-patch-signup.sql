-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Covers two things needed for the new login-page-doubles-as-signup flow:
--   1. Every new auth.users row (created by sb.auth.signUp on the login
--      page) automatically gets a matching public.profiles row. Without
--      this, a brand new account would be logged in but have no profile,
--      and VistaAuth.loadProfile() / the "complete your profile" step
--      would break.
--   2. A hardcoded admin email allowlist, checked *in the database*, so
--      that account always has admin access even before/without a
--      public.profiles.role of 'admin'. This is the real security
--      boundary — js/admin.js's ADMIN_EMAILS check is just UI convenience
--      and must be kept in sync with the list below by hand.
--
-- NOTE: I don't have your full `profiles` table schema (only policies.sql
-- / functions.sql were exported), so double-check the column list and any
-- NOT NULL / UNIQUE constraints in Table Editor before running the INSERT
-- below — adjust the column list if `profiles` has other required columns.

-- ===================== 1. auto-create profile row on signup =====================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, usn, semester, section, role)
  values (
    new.id,
    '',
    -- placeholder, unique per user; register.js already knows how to spot
    -- and prompt to replace any USN starting with 'PENDING-'
    'PENDING-' || substr(new.id::text, 1, 8),
    1,
    '',
    case when lower(new.email) = any (array['samridhshetty2007@gmail.com'])
      then 'admin' else 'member' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===================== 2. hardcoded admin allowlist =====================
-- Keep this ARRAY[...] in sync with ADMIN_EMAILS in js/admin.js.

create or replace function public.is_admin_or_coordinator()
 returns boolean
 language sql
 stable security definer
as $function$
  select
    (lower(auth.email()) = any (array['samridhshetty2007@gmail.com']))
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('admin', 'coordinator')
    );
$function$;

-- ===================== 4. join-team-by-code lookup =====================
-- Bug: RLS on `teams` only lets the leader or existing members SELECT a
-- team row (see policies.sql: "team visible to its members"). Someone
-- trying to *join* with a code isn't a member yet, so their lookup was
-- always silently filtered to zero rows — showing "That code doesn't
-- match a team" even with the correct code. This function looks the team
-- up (and its live member count) as a security-definer, bypassing that
-- restriction in a narrow, controlled way — it only returns what's
-- needed to join, not the full row.

create or replace function public.find_joinable_team(p_code text, p_event_id uuid)
returns table(
  team_id uuid,
  team_name text,
  is_finalized boolean,
  member_count int,
  team_max_size int
)
language sql
stable security definer
set search_path = public
as $$
  select
    t.id,
    t.team_name,
    t.is_finalized,
    (select count(*)::int from team_members tm where tm.team_id = t.id),
    e.team_max_size
  from teams t
  join events e on e.id = t.event_id
  where t.code = p_code and t.event_id = p_event_id;
$$;

-- Only does something if samridhshetty2007@gmail.com already has both an
-- auth.users row and a profiles row (e.g. created manually before this
-- patch). Harmless no-op otherwise.

update public.profiles
set role = 'admin'
where id = (select id from auth.users where lower(email) = 'samridhshetty2007@gmail.com')
  and role is distinct from 'admin';
