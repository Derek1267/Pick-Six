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
  week        int  not null,               -- NFL week; daily sports: week index (Mon–Sun)
  slate       text,                        -- NFL "2-12"; daily sports: "2026-11-23" (US Eastern day)
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
      -- Google sign-in: use the first name from the Google profile
      nullif(split_part(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
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

  if p_sport not in ('nfl', 'nba', 'nhl', 'mlb', 'mls', 'nll') then
    raise exception 'Unknown sport %', p_sport;
  end if;

  -- Default season: the one with upcoming games. In the off-season, the next one
  -- (the latest loaded + 1), so leagues can make predictions before the schedule is out.
  v_season := coalesce(
    p_season,
    (select season from games where sport = p_sport and start_time > now()
       order by start_time limit 1),
    (select max(season) + 1 from games where sport = p_sport)
  );
  if v_season is null then
    raise exception 'The % season hasn''t been loaded yet — check back when its schedule is out', upper(p_sport);
  end if;

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
      and (g.winner <> 'tie' or g.sport = 'mls') -- ties don't count, except soccer draws (you can pick a draw)
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
  conference text not null,                 -- AFC/NFC, East/West, AL/NL
  seed       int  not null check (seed between 1 and 8),
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

-- =====================================================================
-- v3: NBA, NHL, MLB (safe to run on an existing database)
-- =====================================================================

alter table public.games add column if not exists slate text;
update public.games set slate = season_type || '-' || week where slate is null and sport = 'nfl';
create index if not exists games_slate on public.games (sport, season, slate);

alter table public.playoff_seeds drop constraint if exists playoff_seeds_conference_check;
alter table public.playoff_seeds drop constraint if exists playoff_seeds_seed_check;
do $$ begin
  alter table public.playoff_seeds add constraint playoff_seeds_seed_check check (seed between 1 and 8);
exception when duplicate_object then null;
end $$;

-- Ask the API to pick up new columns right away.
notify pgrst, 'reload schema';

-- =====================================================================
-- v4: league management (safe to run on an existing database)
-- =====================================================================

-- The owner can remove players (players can still remove themselves via "leave league").
drop policy if exists "owner removes members" on public.league_members;
create policy "owner removes members" on public.league_members
  for delete to authenticated
  using (exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid()));

-- The owner can delete the whole league (picks and brackets go with it).
drop policy if exists "owner deletes league" on public.leagues;
create policy "owner deletes league" on public.leagues
  for delete to authenticated using (created_by = auth.uid());

-- =====================================================================
-- v5: teams, players and award picks (safe to run on an existing database)
-- =====================================================================

-- Every team with its conference (from ESPN standings) — used by "Build your own" brackets.
create table if not exists public.teams (
  sport      text not null,
  abbr       text not null,
  name       text not null,
  logo       text,
  conference text not null,
  wins       int not null default 0,
  losses     int not null default 0,
  ties       int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sport, abbr)
);

-- Players (from ESPN rosters, refreshed daily) — used to pick award winners.
create table if not exists public.players (
  id         text primary key,          -- "<sport>-<espn id>"
  sport      text not null,
  name       text not null,
  team_abbr  text,
  position   text,
  headshot   text,
  updated_at timestamptz not null default now()
);
create index if not exists players_sport on public.players (sport, name);

-- Each player's award picks: player ids, or "custom:<name>" for someone not in the list.
create table if not exists public.award_picks (
  league_id   uuid not null references public.leagues (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  question_id text not null,
  players     text[] not null default '{}' check (cardinality(players) <= 10),
  updated_at  timestamptz not null default now(),
  primary key (league_id, user_id, question_id)
);

-- Per-league award settings, set by the league owner: when picks lock, and the real winners.
create table if not exists public.award_settings (
  league_id   uuid not null references public.leagues (id) on delete cascade,
  question_id text not null,
  locked_at   timestamptz,
  answers     text[],
  updated_at  timestamptz not null default now(),
  primary key (league_id, question_id)
);

drop trigger if exists award_picks_touch on public.award_picks;
create trigger award_picks_touch before update on public.award_picks
  for each row execute function public.touch_updated_at();

create or replace function public.is_league_owner(p_league uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from leagues where id = p_league and created_by = auth.uid());
$$;

-- Award picks stay open until the owner locks that question.
create or replace function public.award_is_open(p_league uuid, p_question text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from award_settings
    where league_id = p_league and question_id = p_question
      and locked_at is not null and locked_at <= now()
  );
$$;

alter table public.teams          enable row level security;
alter table public.players        enable row level security;
alter table public.award_picks    enable row level security;
alter table public.award_settings enable row level security;

drop policy if exists "teams readable" on public.teams;
create policy "teams readable" on public.teams for select to anon, authenticated using (true);
drop policy if exists "players readable" on public.players;
create policy "players readable" on public.players for select to anon, authenticated using (true);

-- award picks: your own always; everyone's once that question is locked; edit only while open
drop policy if exists "see own award picks" on public.award_picks;
create policy "see own award picks" on public.award_picks
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "see league award picks after lock" on public.award_picks;
create policy "see league award picks after lock" on public.award_picks
  for select to authenticated using (is_league_member(league_id) and not award_is_open(league_id, question_id));
drop policy if exists "make award pick while open" on public.award_picks;
create policy "make award pick while open" on public.award_picks
  for insert to authenticated
  with check (user_id = auth.uid() and is_league_member(league_id) and award_is_open(league_id, question_id));
drop policy if exists "change award pick while open" on public.award_picks;
create policy "change award pick while open" on public.award_picks
  for update to authenticated
  using (user_id = auth.uid() and award_is_open(league_id, question_id))
  with check (user_id = auth.uid() and is_league_member(league_id) and award_is_open(league_id, question_id));
drop policy if exists "remove award pick while open" on public.award_picks;
create policy "remove award pick while open" on public.award_picks
  for delete to authenticated using (user_id = auth.uid() and award_is_open(league_id, question_id));

-- award settings: members read; only the owner writes
drop policy if exists "members see award settings" on public.award_settings;
create policy "members see award settings" on public.award_settings
  for select to authenticated using (is_league_member(league_id));
drop policy if exists "owner sets awards" on public.award_settings;
create policy "owner sets awards" on public.award_settings
  for all to authenticated using (is_league_owner(league_id)) with check (is_league_owner(league_id));

grant select on public.teams, public.players to anon, authenticated;
grant select, insert, update, delete on public.award_picks, public.award_settings to authenticated;
grant execute on function public.is_league_owner(uuid) to authenticated;
grant execute on function public.award_is_open(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- v5.1: tighten function permissions (Supabase security advisor)
-- =====================================================================

-- Helper functions are only used inside security rules for signed-in users.
revoke all on function public.is_league_member(uuid)            from public, anon;
revoke all on function public.is_league_owner(uuid)             from public, anon;
revoke all on function public.game_is_open(text)                from public, anon;
revoke all on function public.game_has_started(text)            from public, anon;
revoke all on function public.game_fits_league(text, uuid)      from public, anon;
revoke all on function public.bracket_state(uuid)               from public, anon;
revoke all on function public.award_is_open(uuid, text)         from public, anon;
grant execute on function public.is_league_member(uuid), public.is_league_owner(uuid),
  public.game_is_open(text), public.game_has_started(text), public.game_fits_league(text, uuid),
  public.bracket_state(uuid), public.award_is_open(uuid, text) to authenticated;
-- The sign-up trigger runs on its own; nobody needs to call it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
alter function public.touch_updated_at() set search_path = public;

-- =====================================================================
-- v6: All-Stars tab (safe to run on an existing database)
-- =====================================================================

-- Whole teams (Pro Bowl rosters) need up to 44 spots; empty spots are stored as ''.
alter table public.award_picks drop constraint if exists award_picks_players_check;
do $$ begin
  alter table public.award_picks add constraint award_picks_players_check check (cardinality(players) <= 60);
exception when duplicate_object then null;
end $$;

-- Divisions (used for the NHL's division All-Star teams).
alter table public.teams add column if not exists division text;
create index if not exists players_team on public.players (sport, team_abbr);

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- v8: MLS and NLL. Soccer picks can be a draw ('tie').
-- ---------------------------------------------------------------------
alter table public.picks drop constraint if exists picks_pick_check;
alter table public.picks add constraint picks_pick_check check (pick in ('home', 'away', 'tie'));
