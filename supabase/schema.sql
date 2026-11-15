-- Τρέξε ολόκληρο αυτό το αρχείο στο Supabase → SQL Editor → New query → Run.

-- ============ Κινήσεις ============
-- amount_cents: ακέραιος σε λεπτά, με πρόσημο (έξοδο = αρνητικό, έσοδο = θετικό).
-- Το υπόλοιπο = SUM(amount_cents). Δεν αποθηκεύεται πουθενά ως ξεχωριστός αριθμός.
create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('expense', 'income', 'initial', 'adjustment')),
  amount_cents bigint not null check (amount_cents <> 0 or kind = 'initial'),
  note         text,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- Για το μέλλον: κατηγορίες. Προς το παρόν μένει κενό.
  category_id  uuid null,
  check (
    (kind = 'expense' and amount_cents < 0) or
    (kind = 'income'  and amount_cents > 0) or
    kind in ('initial', 'adjustment')
  )
);
create index transactions_user_time_idx on public.transactions (user_id, occurred_at desc);

-- ============ Ρυθμίσεις ============
create table public.settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  payday_cents  bigint not null default 100000 check (payday_cents > 0)
);

-- ============ Row Level Security ============
alter table public.transactions enable row level security;
alter table public.settings     enable row level security;

create policy "own transactions select" on public.transactions for select using (user_id = auth.uid());
create policy "own transactions insert" on public.transactions for insert with check (user_id = auth.uid());
create policy "own transactions update" on public.transactions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transactions delete" on public.transactions for delete using (user_id = auth.uid());

create policy "own settings select" on public.settings for select using (user_id = auth.uid());
create policy "own settings insert" on public.settings for insert with check (user_id = auth.uid());
create policy "own settings update" on public.settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Δικαιώματα για συνδεδεμένους χρήστες (το RLS περιορίζει σε ποιες γραμμές).
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update on public.settings to authenticated;

-- Οι ανώνυμοι χρήστες δεν έχουν καμία πρόσβαση.
revoke all on public.transactions from anon;
revoke all on public.settings     from anon;
