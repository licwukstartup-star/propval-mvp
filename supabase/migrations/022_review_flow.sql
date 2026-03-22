-- Migration 022: Review & Approval flow
--
-- Rollback:
--   DROP TABLE IF EXISTS review_events;
--   DROP TABLE IF EXISTS review_requests;

create table review_requests (
  id              uuid primary key default gen_random_uuid(),
  copy_id         uuid not null references report_copies(id) on delete cascade,
  case_id         uuid not null references cases(id) on delete cascade,
  requested_by    uuid not null references auth.users(id),
  reviewer_id     uuid not null references auth.users(id),
  status          text not null default 'pending'
                  check (status in ('pending', 'in_review', 'revision_requested', 'approved', 'rejected')),
  reviewer_notes  text,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,

  constraint uq_review_per_copy unique(copy_id)
);

create index idx_review_requests_reviewer on review_requests(reviewer_id, status);
create index idx_review_requests_requester on review_requests(requested_by);

create table review_events (
  id              uuid primary key default gen_random_uuid(),
  review_id       uuid not null references review_requests(id) on delete cascade,
  actor_id        uuid not null references auth.users(id),
  action          text not null
                  check (action in ('submitted', 'opened', 'commented', 'edited', 'approved', 'rejected', 'revision_requested', 'acknowledged')),
  detail          text,
  new_copy_id     uuid references report_copies(id),
  created_at      timestamptz not null default now()
);

create index idx_review_events_review on review_events(review_id, created_at);

-- RLS
alter table review_requests enable row level security;
alter table review_events enable row level security;

-- Review requests visible to requester, reviewer, and firm members
create policy "Visible to requester and reviewer"
  on review_requests for select using (
    requested_by = auth.uid()
    or reviewer_id = auth.uid()
    or case_id in (
      select c.id from cases c
      join firm_members fm on fm.firm_id = c.firm_id
      where fm.user_id = auth.uid()
    )
  );

create policy "Requester can insert"
  on review_requests for insert with check (
    requested_by = auth.uid()
  );

create policy "Participants can update"
  on review_requests for update using (
    requested_by = auth.uid() or reviewer_id = auth.uid()
  );

-- Review events visible to anyone who can see the review request
create policy "Visible to review participants"
  on review_events for select using (
    review_id in (
      select id from review_requests
      where requested_by = auth.uid() or reviewer_id = auth.uid()
    )
  );

create policy "Participants can insert events"
  on review_events for insert with check (
    actor_id = auth.uid()
  );
