-- 034: Rename assignment status 'unavailable' → 'not_needed' for clearer semantics
-- (本人が対応する必要がない自己申告。ブロッカーがあるという意味ではなく、対象外として扱う)

-- assignment.status: drop check, migrate values, add new check
ALTER TABLE assignment DROP CONSTRAINT assignment_status_check;
UPDATE assignment SET status = 'not_needed' WHERE status = 'unavailable';
ALTER TABLE assignment ADD CONSTRAINT assignment_status_check
  CHECK (status IN ('unopened','opened','responded','not_needed',
                    'forwarded','substituted','exempted','expired'));

-- assignment_status_history.to_status and from_status (TEXT, no CHECK)
UPDATE assignment_status_history SET to_status = 'not_needed' WHERE to_status = 'unavailable';
UPDATE assignment_status_history SET from_status = 'not_needed' WHERE from_status = 'unavailable';

-- assignment_status_history.transition_kind
ALTER TABLE assignment_status_history DROP CONSTRAINT assignment_status_history_transition_kind_check;
UPDATE assignment_status_history SET transition_kind = 'user_not_needed' WHERE transition_kind = 'user_unavailable';
ALTER TABLE assignment_status_history ADD CONSTRAINT assignment_status_history_transition_kind_check
  CHECK (transition_kind IN (
    'auto_open','user_respond','user_not_needed','user_forward',
    'manager_substitute','admin_exempt','auto_expire'
  ));
