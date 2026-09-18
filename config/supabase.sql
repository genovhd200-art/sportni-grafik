-- Общите отметки „поето“ на дъската.
-- Пуска се веднъж в Supabase → SQL Editor → New query → Run.
--
-- Всеки с линка към дъската може да чете и да слага/маха отметка — нищо
-- друго. Няма лични данни: само id на събитието и дали е поето.

create table if not exists public.done_marks (
  event_id   text primary key,
  done       boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.done_marks enable row level security;

drop policy if exists "всеки чете"      on public.done_marks;
drop policy if exists "всеки отбелязва" on public.done_marks;
drop policy if exists "всеки променя"   on public.done_marks;

create policy "всеки чете"      on public.done_marks for select using (true);
create policy "всеки отбелязва" on public.done_marks for insert with check (length(event_id) <= 80);
create policy "всеки променя"   on public.done_marks for update using (true) with check (length(event_id) <= 80);

grant select, insert, update on public.done_marks to anon;
