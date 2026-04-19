-- 029: Requester-side last-view tracking for chat unread indicator
ALTER TABLE request ADD COLUMN last_viewed_by_requester_at TIMESTAMPTZ;
