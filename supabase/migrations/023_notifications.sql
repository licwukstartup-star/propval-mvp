-- Migration 023: In-app notifications
--
-- Rollback:
--   DROP TABLE IF EXISTS notifications;

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  type        text not null
              check (type in ('review_request', 'review_complete', 'revision_needed', 'edit_by_reviewer', 'approval', 'acknowledgement')),
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user_unread on notifications(user_id, is_read) where not is_read;
create index idx_notifications_user_recent on notifications(user_id, created_at desc);

alter table notifications enable row level security;

create policy "Users can view their own notifications"
  on notifications for select using (user_id = auth.uid());

create policy "System can insert notifications"
  on notifications for insert with check (true);

create policy "Users can update their own notifications"
  on notifications for update using (user_id = auth.uid());
