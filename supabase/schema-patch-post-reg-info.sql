-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Covers two things:
--   1. Two optional "next steps" links on an event (WhatsApp group / Google
--      Form or any other link) that get shown to a person once their
--      registration for that event goes through.
--   2. Replaces the `is_open` boolean with a three-state
--      `registration_status` ('open' | 'upcoming' | 'closed') so admins can
--      mark an event as "coming soon" before registrations actually open,
--      not just open/closed.
--
-- Safe to run more than once (uses IF NOT EXISTS / OR REPLACE throughout).

-- ===================== 1. post-registration links =====================

alter table public.events
  add column if not exists whatsapp_link text,
  add column if not exists form_link text;

comment on column public.events.whatsapp_link is 'Optional WhatsApp group invite link, shown to a person after they successfully register for this event.';
comment on column public.events.form_link is 'Optional follow-up link (e.g. a Google Form), shown to a person after they successfully register for this event.';

-- ===================== 2. registration_status (open/upcoming/closed) =====================

alter table public.events
  add column if not exists registration_status text;

-- backfill from the old boolean so existing events don't silently flip
-- to "upcoming" (the new default) — anything currently is_open = true
-- becomes 'open', everything else becomes 'closed'.
update public.events
set registration_status = case when is_open then 'open' else 'closed' end
where registration_status is null;

alter table public.events
  alter column registration_status set default 'upcoming',
  alter column registration_status set not null;

alter table public.events
  drop constraint if exists events_registration_status_check;
alter table public.events
  add constraint events_registration_status_check
  check (registration_status in ('open', 'upcoming', 'closed'));

-- Old `is_open` boolean is superseded by registration_status. Dropped here;
-- if you'd rather keep it around for now (e.g. some other tool still reads
-- it), comment this out — the app code no longer touches it either way.
alter table public.events drop column if exists is_open;
