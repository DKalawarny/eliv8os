-- ⭐ INVITE CODES YOU CAN SAY OUT LOUD, AND "DANNY INVITED YOU" (7 Nov 2026).
--
-- Daniel: "maybe the link would need some explaining on the other end so the
-- person knows to use that specific one, not just sign in normally, that way
-- they don't lose out on that person financially", then "maybe the code is
-- also a discount for them that way they will use it instead".
--
-- So every person's main link gets a short code (DANNY-4F2) a friend can type
-- in after signing up another way, and the inviter chooses whether their first
-- name is shown to people who open their link (it was always returned before).
--
-- ⚠️ Rules kept from 101: never your own code; a link claims only for an account
-- newer than the link. A TYPED code claims only for an account under 30 days
-- old, so it cannot be used to attach an old customer to someone later.

alter table public.wayout_invites
  add column if not exists short_code text unique,
  add column if not exists show_name boolean not null default true;

-- Upper-case letters only from the first name, at most 8, then three hex.
create or replace function public.wayout_make_short_code(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_base text; v_try text; i int := 0;
begin
  v_base := upper(regexp_replace(coalesce(public.wayout_first_name(p_user), ''), '[^A-Za-z]', '', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'FRIEND'), 8);
  loop
    v_try := v_base || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 3));
    exit when not exists (select 1 from public.wayout_invites where short_code = v_try);
    i := i + 1;
    if i > 20 then v_try := v_base || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)); exit; end if;
  end loop;
  return v_try;
end $$;
revoke all on function public.wayout_make_short_code(uuid) from public, anon, authenticated;

-- The caller's main link: { code, short, show_name }, made on first ask.
create or replace function public.wayout_invite_mine()
returns json language plpgsql security definer set search_path = public as $$
declare v public.wayout_invites;
begin
  if auth.uid() is null then return null; end if;
  perform public.wayout_invite_main();
  select * into v from public.wayout_invites where user_id = auth.uid() and label is null;
  if v.short_code is null then
    update public.wayout_invites set short_code = public.wayout_make_short_code(auth.uid())
     where id = v.id returning * into v;
  end if;
  return json_build_object('code', v.code, 'short', v.short_code, 'show_name', v.show_name);
end $$;
grant execute on function public.wayout_invite_mine() to authenticated;

create or replace function public.wayout_invite_show_name(p_show boolean)
returns void language sql security definer set search_path = public as $$
  update public.wayout_invites set show_name = p_show where user_id = auth.uid() and label is null
$$;
grant execute on function public.wayout_invite_show_name(boolean) to authenticated;

-- Opening a link: counts the open, and returns the inviter's first name only
-- when they have said yes to showing it.
create or replace function public.wayout_invite_open(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_show boolean;
begin
  update public.wayout_invites
     set opened = opened + 1, last_opened_at = now()
   where code = left(p_code, 20)
  returning user_id into v_user;
  if v_user is null then return null; end if;
  select coalesce(show_name, true) into v_show from public.wayout_invites where user_id = v_user and label is null;
  if v_show is false then return null; end if;
  return public.wayout_first_name(v_user);
end $$;
grant execute on function public.wayout_invite_open(text) to anon, authenticated;

-- Typing a friend's code after signing up: 'ok' · 'own' · 'unknown' · 'already' · 'too_late'.
create or replace function public.wayout_invite_claim_code(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_inv public.wayout_invites; v_created timestamptz; v_code text := upper(trim(left(coalesce(p_code, ''), 20)));
begin
  if auth.uid() is null then return 'unknown'; end if;
  if exists (select 1 from public.wayout_referrals where friend_id = auth.uid()) then return 'already'; end if;
  select * into v_inv from public.wayout_invites where short_code = v_code or code = lower(v_code) limit 1;
  if v_inv.id is null then return 'unknown'; end if;
  if v_inv.user_id = auth.uid() then return 'own'; end if;
  select created_at into v_created from auth.users where id = auth.uid();
  if v_created < now() - interval '30 days' then return 'too_late'; end if;
  insert into public.wayout_referrals (friend_id, invite_id) values (auth.uid(), v_inv.id)
  on conflict (friend_id) do nothing;
  return case when found then 'ok' else 'already' end;
end $$;
grant execute on function public.wayout_invite_claim_code(text) to authenticated;

comment on column public.wayout_invites.short_code is
  'A code to say out loud (DANNY-4F2), main link only. Typed in by a friend under 30 days old.';
comment on column public.wayout_invites.show_name is
  'Whether people who open this person''s links see their first name. Their choice; main link row only.';
