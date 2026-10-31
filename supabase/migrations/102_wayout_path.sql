-- The path: each move broken into small steps, tapped through (migration 102)
--
-- ⭐ Daniel, 31 Oct 2026, from doing Duolingo: "it's interactive like a game,
-- some of this could be really beneficial for unstuck." Each move of the plan
-- becomes a few small steps somebody can do in one sitting. They tap "I did it",
-- "Not yet" or "It didn't work", and type what a step saved them each month.
--
-- Two columns on the SESSION, because the path covers all three moves at once
-- and is written in one go for the plan as it stands:
--   · path        what the model wrote (steps, what needs what, what waits for
--                 a date). Carries the plan's move titles as `key`, so a rebuilt
--                 plan is noticed and gets a new path.
--   · path_state  their taps, keyed by step id:
--                 { "1.2": { "s": "done", "saved": 25, "at": "…" } }
--                 s = done · tried · later · parked (with "until")
--
-- ⚠️ THEIR CLAIM, NOT A VERIFICATION, the same as done_at (056). Nothing asks
-- for proof, and a typed "saved $40 a month" is their number, never checked.
--
-- ⚠️ THE PATH IS THE PAID HALF, like the walkthrough. Free while payments are
-- off, exactly as 055 made the walkthrough: finishing the intake is the
-- entitlement. 🔴 On the day payments go live, change the condition below to
-- `new.status <> 'paid'` in the same commit as 055's.

alter table public.wayout_sessions
  add column if not exists path jsonb,
  add column if not exists path_state jsonb not null default '{}'::jsonb;

comment on column public.wayout_sessions.path is
  'The plan broken into small steps (102). Written by the model, checked by enforcePathContract.';
comment on column public.wayout_sessions.path_state is
  'Their taps on the path, keyed by step id (102). Their claim, not a verification.';

create or replace function public.wayout_path_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return new;                       -- service role
  end if;
  -- FREE BETA: a finished intake is the entitlement. Restore to
  -- `new.status <> 'paid'` on the day payments go live (see 055).
  if new.path is distinct from old.path and new.path is not null and new.status = 'draft' then
    raise exception 'wayout: a path belongs to a finished intake';
  end if;
  return new;
end;
$$;

drop trigger if exists wayout_path_guard on public.wayout_sessions;
create trigger wayout_path_guard
  before update of path on public.wayout_sessions
  for each row execute function public.wayout_path_guard();
