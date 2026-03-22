-- Migration 021: QA Results (AI quality assurance findings per report copy)
--
-- Rollback:
--   DROP POLICY IF EXISTS "Users can view QA results for accessible copies" ON qa_results;
--   DROP POLICY IF EXISTS "Users can insert QA results" ON qa_results;
--   DROP TABLE IF EXISTS qa_results;

create table qa_results (
  id          uuid primary key default gen_random_uuid(),
  copy_id     uuid not null references report_copies(id) on delete cascade,
  run_by      uuid not null references auth.users(id),
  findings    jsonb not null default '[]'::jsonb,
  model_used  text,
  created_at  timestamptz not null default now()
);

create index idx_qa_results_copy on qa_results(copy_id, created_at desc);

alter table qa_results enable row level security;

create policy "Users can view QA results for accessible copies"
  on qa_results for select using (
    run_by = auth.uid()
    or copy_id in (
      select rc.id from report_copies rc
      join cases c on c.id = rc.case_id
      join firm_members fm on fm.firm_id = c.firm_id
      where fm.user_id = auth.uid()
    )
  );

create policy "Users can insert QA results"
  on qa_results for insert with check (
    run_by = auth.uid()
  );
