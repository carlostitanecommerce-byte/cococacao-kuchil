
-- Remove overly permissive policies on realtime.messages that allowed any
-- authenticated user to read/send on any Broadcast/Presence channel/topic.
DROP POLICY IF EXISTS "Authenticated can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can send realtime messages" ON realtime.messages;

-- The app does not currently use Broadcast or Presence channels; all realtime
-- usage is via postgres_changes, which is authorized by the underlying table
-- RLS rather than realtime.messages policies. With no policies present and RLS
-- enabled on realtime.messages, private-channel broadcast/presence access is
-- denied by default. If Broadcast/Presence is introduced later, add scoped
-- policies using realtime.topic() combined with auth.uid()/role checks.
