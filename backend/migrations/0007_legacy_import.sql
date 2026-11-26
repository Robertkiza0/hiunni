-- F01 member/content migration support (tools/migrate-members.mjs).
--
-- oauth_links: Google/Naver identities of existing members, copied as stored by the existing
-- service (provider + subject_hash, never the raw subject). The real login (F01) looks members up
-- here so a member's Google/Naver account keeps landing on the same member after the move.
CREATE TABLE oauth_links (
  provider      TEXT NOT NULL CHECK (provider IN ('google', 'naver')),
  subject_hash  TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (provider, subject_hash)
);
CREATE INDEX idx_oauth_links_user ON oauth_links(user_id);

-- The existing service's own 업종 label (일프로, 텐카페, …) before grouping into our three
-- 업종, so the grouping can be revised later without going back to the old database.
ALTER TABLE stores ADD COLUMN source_industry TEXT;
