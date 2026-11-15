-- Τρέξε το στο Supabase → SQL Editor (μία φορά), ΜΕΤΑ το migration-2.
-- Αντικαθιστά το "μηνιαίο budget" με στόχο αποταμίευσης, ημέρα πληρωμής και λογαριασμούς που απομένουν.
alter table public.settings drop column if exists monthly_budget_cents;
alter table public.settings add column if not exists savings_goal_cents    bigint   not null default 0 check (savings_goal_cents >= 0);
alter table public.settings add column if not exists payday_day            smallint null check (payday_day between 1 and 31);
alter table public.settings add column if not exists pending_bills_cents   bigint   not null default 0 check (pending_bills_cents >= 0);
