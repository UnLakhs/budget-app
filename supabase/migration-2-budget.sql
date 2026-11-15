-- Τρέξε το στο Supabase → SQL Editor (μία φορά). Προσθέτει budget και σήμανση λογαριασμών.
alter table public.transactions add column if not exists is_bill boolean not null default false;
alter table public.settings     add column if not exists monthly_budget_cents bigint null check (monthly_budget_cents > 0);
