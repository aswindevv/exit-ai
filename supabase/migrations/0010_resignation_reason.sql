alter table public.exit_cases add column if not exists resignation_reason text;

comment on column public.exit_cases.resignation_reason is
    'Optional free-text reason the employee gave when submitting their resignation. Not an assessment field (no risk/rehire inference here) so it is safe on the base row.';
