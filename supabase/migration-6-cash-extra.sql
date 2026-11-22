-- Τρέξε το στο Supabase → SQL Editor (μία φορά). Προσθέτει μετρητά/κάρτα, μεταφορές μετρητών και έσοδα «εκτός ημερήσιου».

-- 1) Νέες στήλες
alter table public.transactions add column if not exists account  text    not null default 'bank';
alter table public.transactions add column if not exists is_extra boolean not null default false;
alter table public.settings     add column if not exists cycle_start timestamptz null;

-- 2) Ξαναφτιάχνουμε τους ελέγχους (check constraints) του πίνακα κινήσεων, ώστε να δέχεται και τον τύπο 'transfer'.
--    Οι παλιοί έλεγχοι δεν έχουν σταθερά ονόματα, γι' αυτό σβήνονται όλοι και ξαναμπαίνουν.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.transactions'::regclass and contype = 'c'
  loop
    execute format('alter table public.transactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.transactions add constraint transactions_kind_check
  check (kind in ('expense', 'income', 'initial', 'adjustment', 'transfer'));
alter table public.transactions add constraint transactions_account_check
  check (account in ('bank', 'cash'));
alter table public.transactions add constraint transactions_amount_nonzero
  check (amount_cents <> 0 or kind = 'initial');
alter table public.transactions add constraint transactions_amount_sign
  check (
    (kind = 'expense' and amount_cents < 0) or
    (kind in ('income', 'transfer') and amount_cents > 0) or
    kind in ('initial', 'adjustment')
  );
