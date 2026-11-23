-- =====================================================================
-- Pick Six — database schema for Supabase
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: it uses "if not exists" / "or replace" where it can.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row per signed-up user (created automatically by a trigger below).
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  created_at   timestamptz not null default now()
);

-- A private group of friends.
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 50),
  invite_code text not null unique,
  sport       text not null default 'nfl',
  season      int  not null,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- Real games, written only by the sync script (service role).
create table if not exists public.games (
  id          text primary key,            -- ESPN event id
  sport       text not null,               -- 'nfl'
  season      int  not null,               -- e.g. 2026
  season_type int  not null,               -- 1 pre, 2 regular, 3 post
  week        int  not null,
  start_time  timestamptz not null,
  status      text not null default 'pre' check (status in ('pre', 'in', 'post')),
  status_detail text,                       -- e.g. "Q3 4:12", "Final"
  home_team   text not null,
  home_abbr   text not null,
  home_logo   text,
  home_record text,
  home_score  int,
  away_team   text not null,
  away_abbr   text not null,
  away_logo   text,
  away_record text,
  away_score  int,
  winner      text check (winner in ('home', 'away', 'tie')),
  updated_at  timestamptz not null default now()
);
create index if not exists games_lookup on public.games (sport, season, season_type, week);

-- One pick per user, per league, per game.
create table if not exists public.picks (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.games (id) on delete cascade,
  pick       text not null check (pick in ('home', 'away')),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id, game_id)
);
create index if not exists picks_by_game on public.picks (game_id);

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------

-- Is the current user in this league? (security definer avoids RLS recursion)
create or replace function public.is_league_member(p_league uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from league_members
    where league_id = p_league and user_id = auth.uid()
  );
$$;

-- Is this game still open for picks? (scheduled and not yet kicked off)
create or replace function public.game_is_open(p_game text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from games
    where id = p_game and status = 'pre' and start_time > now()
  );
$$;

-- Has this game kicked off? (picks become visible to the league)
create or replace function public.game_has_started(p_game text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from games
    where id = p_game and (status <> 'pre' or start_time <= now())
  );
$$;

-- Does the game belong to the league's sport and season?
create or replace function public.game_fits_league(p_game text, p_league uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from games g join leagues l on l.id = p_league
    where g.id = p_game and g.sport = l.sport and g.season = l.season
  );
$$;

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      'Player'
    ), 30)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep picks.updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists picks_touch on public.picks;
create trigger picks_touch before update on public.picks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Actions the website calls (RPCs)
-- ---------------------------------------------------------------------

-- Create a league; the creator becomes its owner. Returns the new league.
create or replace function public.create_league(p_name text, p_sport text default 'nfl', p_season int default null)
returns public.leagues
language plpgsql security definer set search_path = public
as $$
declare
  v_code   text;
  v_league leagues;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
  v_season int;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'League name is required';
  end if;

  -- Default season: the latest season we have games for, else this year.
  v_season := coalesce(
    p_season,
    (select max(season) from games where sport = p_sport),
    extract(year from now())::int
  );

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from leagues where invite_code = v_code);
  end loop;

  insert into leagues (name, invite_code, sport, season, created_by)
  values (trim(p_name), v_code, p_sport, v_season, auth.uid())
  returning * into v_league;

  insert into league_members (league_id, user_id, role)
  values (v_league.id, auth.uid(), 'owner');

  return v_league;
end;
$$;

-- Join a league by invite code. Returns the league (joining twice is harmless).
create or replace function public.join_league(p_code text)
returns public.leagues
language plpgsql security definer set search_path = public
as $$
declare
  v_league leagues;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in';
  end if;

  select * into v_league from leagues where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'No league found with that code';
  end if;

  insert into league_members (league_id, user_id)
  values (v_league.id, auth.uid())
  on conflict do nothing;

  return v_league;
end;
$$;

-- Leaderboard rows: one per member per week they have graded picks in.
-- Members with no graded picks yet still appear once (week = null).
create or replace function public.league_leaderboard(p_league uuid)
returns table (user_id uuid, display_name text, season_type int, week int, correct int, graded int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_league_member(p_league) then
    raise exception 'Not a member of this league';
  end if;

  return query
  with graded as (
    select pk.user_id, g.season_type, g.week,
           count(*) filter (where pk.pick = g.winner)::int as correct,
           count(*)::int as graded
    from picks pk
    join games g on g.id = pk.game_id
    where pk.league_id = p_league and g.winner is not null
    group by pk.user_id, g.season_type, g.week
  )
  select m.user_id, p.display_name, gr.season_type, gr.week,
         coalesce(gr.correct, 0), coalesce(gr.graded, 0)
  from league_members m
  join profiles p on p.id = m.user_id
  left join graded gr on gr.user_id = m.user_id
  where m.league_id = p_league;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: who can see and change what
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.leagues        enable row level security;
alter table public.league_members enable row level security;
alter table public.games          enable row level security;
alter table public.picks          enable row level security;

-- profiles: any signed-in user can see names; you can only edit your own.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- leagues: only members can see a league. Creating/joining goes through the RPCs.
drop policy if exists "leagues for members" on public.leagues;
create policy "leagues for members" on public.leagues
  for select to authenticated using (is_league_member(id));
drop policy if exists "owner renames league" on public.leagues;
create policy "owner renames league" on public.leagues
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

-- league_members: members see each other; you can leave a league yourself.
drop policy if exists "members see members" on public.league_members;
create policy "members see members" on public.league_members
  for select to authenticated using (is_league_member(league_id));
drop policy if exists "leave league" on public.league_members;
create policy "leave league" on public.league_members
  for delete to authenticated using (user_id = auth.uid());

-- games: public schedule, read-only for everyone (sync script uses the service key).
drop policy if exists "games readable" on public.games;
create policy "games readable" on public.games
  for select to anon, authenticated using (true);

-- picks:
--   * you always see your own picks
--   * you see league-mates' picks only once that game has kicked off
--   * you can make/change/remove a pick only before kickoff, only in your leagues
drop policy if exists "see own picks" on public.picks;
create policy "see own picks" on public.picks
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "see league picks after kickoff" on public.picks;
create policy "see league picks after kickoff" on public.picks
  for select to authenticated using (is_league_member(league_id) and game_has_started(game_id));

drop policy if exists "make pick before kickoff" on public.picks;
create policy "make pick before kickoff" on public.picks
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_league_member(league_id)
    and game_fits_league(game_id, league_id)
    and game_is_open(game_id)
  );
drop policy if exists "change pick before kickoff" on public.picks;
create policy "change pick before kickoff" on public.picks
  for update to authenticated
  using (user_id = auth.uid() and game_is_open(game_id))
  with check (
    user_id = auth.uid()
    and is_league_member(league_id)
    and game_fits_league(game_id, league_id)
    and game_is_open(game_id)
  );
drop policy if exists "remove pick before kickoff" on public.picks;
create policy "remove pick before kickoff" on public.picks
  for delete to authenticated using (user_id = auth.uid() and game_is_open(game_id));

-- RPC permissions
revoke all on function public.create_league(text, text, int) from public, anon;
revoke all on function public.join_league(text)              from public, anon;
revoke all on function public.league_leaderboard(uuid)       from public, anon;
grant execute on function public.create_league(text, text, int) to authenticated;
grant execute on function public.join_league(text)              to authenticated;
grant execute on function public.league_leaderboard(uuid)       to authenticated;

-- =====================================================================
-- Playoff brackets (added in v2 — safe to run on an existing database)
-- =====================================================================

-- Current playoff seeds per conference ("if the season ended today" until week 18 is done).
-- Written by the sync script from ESPN standings.
create table if not exists public.playoff_seeds (
  sport      text not null,
  season     int  not null,
  conference text not null check (conference in ('AFC', 'NFC')),
  seed       int  not null check (seed between 1 and 7),
  team_abbr  text not null,
  team_name  text not null,
  logo       text,
  wins       int not null default 0,
  losses     int not null default 0,
  ties       int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sport, season, conference, seed)
);

-- One bracket per player per league: { "AFC-WC-0": "BUF", ..., "SB": "KC" }
create table if not exists public.bracket_picks (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  picks      jsonb not null default '{}'::jsonb check (jsonb_typeof(picks) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

drop trigger if exists bracket_picks_touch on public.bracket_picks;
create trigger bracket_picks_touch before update on public.bracket_picks
  for each row execute function public.touch_updated_at();

-- Brackets open once the regular season is over (seeds are final) and lock
-- when the first playoff game kicks off.
create or replace function public.bracket_state(p_league uuid)
returns text  -- 'not_ready' | 'open' | 'locked'
language sql stable security definer set search_path = public
as $$
  with l as (select sport, season from leagues where id = p_league),
  reg as (
    select count(*) as total, count(*) filter (where g.status <> 'post') as unfinished
    from games g, l where g.sport = l.sport and g.season = l.season and g.season_type = 2
  ),
  lock as (
    select min(g.start_time) as first_kick
    from games g, l where g.sport = l.sport and g.season = l.season and g.season_type = 3
  )
  select case
    when (select first_kick from lock) is not null and (select first_kick from lock) <= now() then 'locked'
    when (select total from reg) > 0 and (select unfinished from reg) = 0 then 'open'
    else 'not_ready'
  end;
$$;

alter table public.playoff_seeds enable row level security;
alter table public.bracket_picks enable row level security;

drop policy if exists "seeds readable" on public.playoff_seeds;
create policy "seeds readable" on public.playoff_seeds
  for select to anon, authenticated using (true);

-- You always see your own bracket; everyone's brackets are revealed at lock.
drop policy if exists "see own bracket" on public.bracket_picks;
create policy "see own bracket" on public.bracket_picks
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "see league brackets after lock" on public.bracket_picks;
create policy "see league brackets after lock" on public.bracket_picks
  for select to authenticated using (is_league_member(league_id) and bracket_state(league_id) = 'locked');

drop policy if exists "save bracket while open" on public.bracket_picks;
create policy "save bracket while open" on public.bracket_picks
  for insert to authenticated
  with check (user_id = auth.uid() and is_league_member(league_id) and bracket_state(league_id) = 'open');
drop policy if exists "update bracket while open" on public.bracket_picks;
create policy "update bracket while open" on public.bracket_picks
  for update to authenticated
  using (user_id = auth.uid() and bracket_state(league_id) = 'open')
  with check (user_id = auth.uid() and is_league_member(league_id) and bracket_state(league_id) = 'open');

grant execute on function public.bracket_state(uuid) to authenticated;
