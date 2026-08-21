-- Exported from Supabase dashboard (Database > Policies)
-- Source of truth for Row Level Security policies
-- Last synced: 2026-08-21
--
-- Reference only — these are read from pg_policies, not written as
-- runnable `create policy` statements. To recreate a policy from scratch,
-- use: create policy "<policyname>" on <tablename>
--   for <cmd> to <roles> using (<qual>) with check (<with_check>);

-- ===================== profiles =====================

-- "admins can read all profiles" | SELECT | roles: public
-- USING: is_admin_or_coordinator() OR (id = auth.uid())

-- "admins can update any profile" | UPDATE | roles: public
-- USING: is_admin_or_coordinator()
-- WITH CHECK: is_admin_or_coordinator()

-- "profiles are readable by authenticated users" | SELECT | roles: authenticated
-- USING: true

-- "users can insert own profile" | INSERT | roles: authenticated
-- WITH CHECK: auth.uid() = id

-- "users can update own profile" | UPDATE | roles: authenticated
-- USING: auth.uid() = id

-- ===================== events =====================

-- "admins can delete events" | DELETE | roles: public
-- USING: is_admin_or_coordinator()

-- "admins can insert events" | INSERT | roles: public
-- WITH CHECK: is_admin_or_coordinator()

-- "admins can update events" | UPDATE | roles: public
-- USING: is_admin_or_coordinator()
-- WITH CHECK: is_admin_or_coordinator()

-- "coordinators manage events" | ALL | roles: authenticated
-- USING: EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['coordinator','admin']))
-- WITH CHECK: same as USING
-- NOTE: overlaps with the three "admins can ..." policies above — functionally
-- redundant (both check for admin/coordinator role, just via different
-- expressions). Not a bug, just duplicated logic worth consolidating later.

-- "events are public" | SELECT | roles: anon, authenticated
-- USING: true

-- ===================== teams =====================

-- "admins can read all teams" | SELECT | roles: public
-- USING: is_admin_or_coordinator() OR (leader_id = auth.uid())

-- "admins can update all teams" | UPDATE | roles: public
-- USING: is_admin_or_coordinator()

-- "leader can update own team" | UPDATE | roles: authenticated
-- USING: leader_id = auth.uid()

-- "team visible to its members" | SELECT | roles: authenticated
-- USING: (leader_id = auth.uid()) OR EXISTS (
--   SELECT 1 FROM team_members tm
--   WHERE tm.team_id = teams.id AND tm.profile_id = auth.uid()
-- )

-- "users can create a team as leader" | INSERT | roles: authenticated
-- WITH CHECK: leader_id = auth.uid()

-- ===================== team_members =====================

-- "team members visible to teammates" | SELECT | roles: authenticated
-- USING: is_team_member(team_id, auth.uid())

-- "users can add themselves to a team" | INSERT | roles: authenticated
-- WITH CHECK: profile_id = auth.uid()

-- NOTE: no UPDATE or DELETE policy exists on this table. Confirm this is
-- intentional (e.g. no "leave team" / "remove member" feature) — if such
-- a feature exists in the app, it must be going through something other
-- than a normal RLS-covered UPDATE/DELETE.

-- ===================== registrations =====================

-- "admins can delete all registrations" | DELETE | roles: public
-- USING: is_admin_or_coordinator()

-- "admins can read all registrations" | SELECT | roles: public
-- USING: is_admin_or_coordinator() OR (profile_id = auth.uid())

-- "admins can update all registrations" | UPDATE | roles: public
-- USING: is_admin_or_coordinator()
-- WITH CHECK: is_admin_or_coordinator()

-- "coordinators see all registrations" | SELECT | roles: authenticated
-- USING: EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['coordinator','admin']))

-- "users create own registration" | INSERT | roles: authenticated
-- WITH CHECK: profile_id = auth.uid()

-- "users see own registrations" | SELECT | roles: authenticated
-- USING: profile_id = auth.uid()

-- "users update own registration" | UPDATE | roles: authenticated
-- USING: profile_id = auth.uid()

-- ===================== team_page_members =====================

-- "admins manage team page" | ALL | roles: authenticated
-- USING: EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
-- WITH CHECK: same as USING

-- "team page is public" | SELECT | roles: anon, authenticated
-- USING: is_visible = true