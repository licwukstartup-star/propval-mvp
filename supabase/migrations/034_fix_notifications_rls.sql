-- Migration 034: Harden notification INSERT policy
--
-- Previously the INSERT policy used `with check (true)` which allowed
-- any authenticated user to create notifications targeting any other user.
-- Notifications are only created by backend services using the service_role
-- key, so restrict INSERT to service_role only.
--
-- Rollback:
--   DROP POLICY "Service role inserts notifications" ON notifications;
--   CREATE POLICY "System can insert notifications"
--     ON notifications FOR INSERT WITH CHECK (true);

drop policy if exists "System can insert notifications" on notifications;

create policy "Service role inserts notifications"
  on notifications for insert
  to service_role
  with check (true);
