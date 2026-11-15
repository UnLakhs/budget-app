-- Τρέξε το στο Supabase → SQL Editor (μία φορά). Προσθέτει κατηγορίες εξόδων.
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.categories enable row level security;
create policy "own categories select" on public.categories for select using (user_id = auth.uid());
create policy "own categories insert" on public.categories for insert with check (user_id = auth.uid());
create policy "own categories update" on public.categories for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own categories delete" on public.categories for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.categories to authenticated;
revoke all on public.categories from anon;

-- Η στήλη transactions.category_id υπήρχε ήδη· τώρα συνδέεται με τις κατηγορίες.
-- Αν σβηστεί μια κατηγορία, οι κινήσεις της μένουν χωρίς κατηγορία.
alter table public.transactions
  add constraint transactions_category_fk
  foreign key (category_id) references public.categories(id) on delete set null;
