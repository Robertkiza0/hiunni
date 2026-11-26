-- F05: delivery bookkeeping for push_outbox (sender: src/lib/push-send.ts).
-- attempts         sends tried so far (claiming a row counts as one)
-- next_attempt_at  earliest time to try again after a temporary failure (ms)
-- claim_until      a sender owns the row until then, so two senders never send it twice (ms)
-- sent_at          when FCM accepted it
-- last_error       short reason for the last failure (no message content)
ALTER TABLE push_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_outbox ADD COLUMN claim_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_outbox ADD COLUMN sent_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN last_error TEXT;
CREATE INDEX idx_push_outbox_due ON push_outbox(status, next_attempt_at, created_at);
