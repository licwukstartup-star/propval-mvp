-- Migration 020: Report Copies (immutable versioned snapshots)
--
-- Rollback:
--   DROP POLICY IF EXISTS "Users can view copies for their cases or firm cases" ON report_copies;
--   DROP POLICY IF EXISTS "Users can insert copies for their own cases" ON report_copies;
--   DROP TABLE IF EXISTS report_copies;

create table report_copies (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  version         integer not null,
  label           text not null,
  status          text not null default 'draft'
                  check (status in ('draft', 'ready_for_review', 'under_review', 'revision_requested', 'approved', 'final')),
  editor_html     text not null,
  editor_json     jsonb,
  wizard_snapshot jsonb,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),

  constraint uq_report_copy_case_version unique(case_id, version)
);

-- Indexes
create index idx_report_copies_case on report_copies(case_id, version desc);
create index idx_report_copies_created_by on report_copies(created_by);

-- RLS
alter table report_copies enable row level security;

create policy "Users can view copies for their cases or firm cases"
  on report_copies for select using (
    created_by = auth.uid()
    or case_id in (
      select c.id from cases c
      join firm_members fm on fm.firm_id = c.firm_id
      where fm.user_id = auth.uid()
    )
  );

create policy "Users can insert copies for their own cases"
  on report_copies for insert with check (
    created_by = auth.uid()
  );

create policy "Users can update status/label on their own copies"
  on report_copies for update using (
    created_by = auth.uid()
  );

create policy "Users can delete their own draft copies"
  on report_copies for delete using (
    created_by = auth.uid()
    and status = 'draft'
  );
