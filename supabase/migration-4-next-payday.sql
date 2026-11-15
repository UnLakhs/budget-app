-- Τρέξε το στο Supabase → SQL Editor (μία φορά), ΜΕΤΑ το migration-3.
-- Αντί για σταθερή μέρα του μήνα, αποθηκεύεται η ημερομηνία της επόμενης πληρωμής.
alter table public.settings drop column if exists payday_day;
alter table public.settings add column if not exists next_payday date null;
