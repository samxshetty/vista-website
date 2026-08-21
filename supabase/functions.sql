-- Exported from Supabase dashboard (Database > Functions)
-- Source of truth for finalize_team, is_admin_or_coordinator, is_team_member
-- Last synced: 2026-08-21

CREATE OR REPLACE FUNCTION public.finalize_team(p_team_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$declare
  v_leader_id  uuid;
  v_event_id   uuid;
  v_min        int;
  v_max        int;
  v_count      int;
  v_finalized  boolean;
begin
  select leader_id, event_id, is_finalized
  into v_leader_id, v_event_id, v_finalized
  from public.teams
  where id = p_team_id;

  if v_leader_id is null then
    raise exception 'Team not found';
  end if;

  if v_leader_id <> auth.uid() then
    raise exception 'Only the team leader can submit this registration';
  end if;

  if v_finalized then
    raise exception 'This team has already been submitted';
  end if;

  -- Team size limits, from events.team_min_size / team_max_size.
  select team_min_size, team_max_size
  into v_min, v_max
  from public.events
  where id = v_event_id;

  select count(*) into v_count
  from public.team_members
  where team_id = p_team_id;

  if v_min is not null and v_count < v_min then
    raise exception 'Your team needs at least % member(s) before you can submit', v_min;
  end if;

  if v_max is not null and v_count > v_max then
    raise exception 'Your team has % members, which exceeds the max of %', v_count, v_max;
  end if;

  update public.teams
  set is_finalized = true
  where id = p_team_id;

  update public.registrations
  set status = 'finalized'
  where team_id = p_team_id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.is_admin_or_coordinator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('admin', 'coordinator')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid, p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = p_profile_id
  );
$function$
;