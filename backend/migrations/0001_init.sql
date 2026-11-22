-- HIUNNI backend schema (candidate). Synthetic/staging only until the production
-- D1 schema (worker/drizzle) is received and reconciled. See backend/README.md.
-- All timestamps are UTC epoch milliseconds. Nullable counters mean "not entered",
-- which is intentionally different from 0.

-- ── Accounts & sessions ────────────────────────────────────────────────
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  nickname        TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator', 'admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  show_last_seen  INTEGER NOT NULL DEFAULT 0,          -- F08 opt-in
  last_seen_at    INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,                    -- SHA-256 of bearer token; raw token never stored
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id),
  blocked_id  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL REFERENCES users(id),
  target_type  TEXT NOT NULL CHECK (target_type IN ('user', 'post', 'comment', 'dm_message', 'room_message')),
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at   INTEGER NOT NULL,
  UNIQUE (reporter_id, target_type, target_id)
);

-- ── F02 Media (R2) ─────────────────────────────────────────────────────
CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  r2_key        TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

-- ── Stores (F07/F08) ───────────────────────────────────────────────────
CREATE TABLE stores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  region      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE store_staff (
  store_id     TEXT NOT NULL REFERENCES stores(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,                          -- e.g. 실장
  is_operator  INTEGER NOT NULL DEFAULT 0,             -- may edit prices/terms/vacancy
  PRIMARY KEY (store_id, user_id)
);

CREATE TABLE store_prices (
  id        TEXT PRIMARY KEY,
  store_id  TEXT NOT NULL REFERENCES stores(id),
  label     TEXT NOT NULL,
  amount    INTEGER,                                   -- NULL = 문의/미정, distinct from 0
  note      TEXT,
  sort      INTEGER NOT NULL
);
CREATE INDEX idx_store_prices_store ON store_prices(store_id, sort);

CREATE TABLE store_terms (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  sort        INTEGER NOT NULL
);
CREATE INDEX idx_store_terms_store ON store_terms(store_id, sort);

CREATE TABLE vacancy_logs (
  id           TEXT PRIMARY KEY,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  vacancy      INTEGER NOT NULL CHECK (vacancy >= 0),
  note         TEXT,
  recorded_by  TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_vacancy_logs_store ON vacancy_logs(store_id, created_at DESC);

-- ── F03 Rooms / realtime ───────────────────────────────────────────────
CREATE TABLE rooms (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('general', 'store', 'daily')),
  title        TEXT NOT NULL,
  region       TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  join_policy  TEXT NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('open', 'approval')),
  capacity     INTEGER,                                -- NULL = unlimited
  store_id     TEXT REFERENCES stores(id),
  created_at   INTEGER NOT NULL,
  CHECK ((kind = 'store') = (store_id IS NOT NULL))
);

CREATE TABLE room_members (
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  state       TEXT NOT NULL CHECK (state IN ('pending', 'active', 'rejected', 'left', 'blocked')),
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager')),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE room_status (
  room_id     TEXT PRIMARY KEY REFERENCES rooms(id),
  choice      INTEGER,                                 -- 초중
  entry       INTEGER,                                 -- 엔트리
  waiting     INTEGER,                                 -- 대기
  vacancy     INTEGER,                                 -- 빈방
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE room_messages (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,       -- total order for backfill after reconnect
  id          TEXT NOT NULL UNIQUE,
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  sender_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT,
  media_id    TEXT REFERENCES media(id),
  request_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (room_id, sender_id, request_id)              -- idempotent retries
);
CREATE INDEX idx_room_messages_room ON room_messages(room_id, seq);

CREATE TABLE realtime_tickets (
  ticket_hash  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  channel      TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER
);

-- ── F04 Anonymous consent-based DM ─────────────────────────────────────
CREATE TABLE dm_conversations (
  id          TEXT PRIMARY KEY,
  user_a      TEXT NOT NULL REFERENCES users(id),      -- user_a < user_b (sorted)
  user_b      TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE dm_requests (
  id               TEXT PRIMARY KEY,
  from_user        TEXT NOT NULL REFERENCES users(id),
  to_user          TEXT NOT NULL REFERENCES users(id),
  post_id          TEXT,                               -- F09: request started from a post
  message          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  conversation_id  TEXT REFERENCES dm_conversations(id),
  created_at       INTEGER NOT NULL,
  decided_at       INTEGER,
  CHECK (from_user <> to_user)
);
CREATE UNIQUE INDEX uq_dm_requests_pending ON dm_requests(from_user, to_user) WHERE status = 'pending';
CREATE INDEX idx_dm_requests_to ON dm_requests(to_user, status);

CREATE TABLE dm_messages (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  id               TEXT NOT NULL UNIQUE,
  conversation_id  TEXT NOT NULL REFERENCES dm_conversations(id),
  sender_id        TEXT NOT NULL REFERENCES users(id),
  body             TEXT,
  media_id         TEXT REFERENCES media(id),
  request_id       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (conversation_id, sender_id, request_id),
  CHECK (body IS NOT NULL OR media_id IS NOT NULL)
);
CREATE INDEX idx_dm_messages_conv ON dm_messages(conversation_id, seq);

CREATE TABLE dm_reads (
  conversation_id  TEXT NOT NULL REFERENCES dm_conversations(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  last_read_seq    INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

-- ── F09 Board ──────────────────────────────────────────────────────────
CREATE TABLE posts (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL REFERENCES users(id),
  board          TEXT NOT NULL,
  category       TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  is_notice      INTEGER NOT NULL DEFAULT 0,
  like_count     INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  mutation_id    TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  UNIQUE (author_id, mutation_id)
);
CREATE INDEX idx_posts_latest ON posts(board, created_at DESC, id DESC);
CREATE INDEX idx_posts_popular ON posts(board, like_count DESC, created_at DESC, id DESC);

CREATE TABLE post_likes (
  post_id     TEXT NOT NULL REFERENCES posts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id),
  author_id    TEXT NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  is_secret    INTEGER NOT NULL DEFAULT 0,
  like_count   INTEGER NOT NULL DEFAULT 0,
  mutation_id  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  UNIQUE (author_id, mutation_id)
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at, id);

CREATE TABLE comment_likes (
  comment_id  TEXT NOT NULL REFERENCES comments(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- ── F10 Places ─────────────────────────────────────────────────────────
CREATE TABLE places (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  region       TEXT NOT NULL,
  recommended  INTEGER NOT NULL DEFAULT 0,             -- synthetic flag, not a verification badge
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_places_cat ON places(category, region);

-- One row per opening interval. weekday: 0=Sun..6=Sat (KST). Minutes from 00:00 of that
-- weekday. close_min may exceed 1440 for intervals that cross midnight (e.g. 20:00-03:00
-- is open_min=1200, close_min=1620). No rows at all = hours unknown.
CREATE TABLE place_hours (
  place_id  TEXT NOT NULL REFERENCES places(id),
  weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_min  INTEGER NOT NULL CHECK (open_min BETWEEN 0 AND 1439),
  close_min INTEGER NOT NULL,
  CHECK (close_min > open_min AND close_min <= open_min + 1440)
);
CREATE INDEX idx_place_hours_place ON place_hours(place_id);

CREATE TABLE place_closures (
  place_id  TEXT NOT NULL REFERENCES places(id),
  date      TEXT NOT NULL,                             -- 'YYYY-MM-DD' (KST business day)
  PRIMARY KEY (place_id, date)
);

CREATE TABLE saved_items (
  user_id      TEXT NOT NULL REFERENCES users(id),
  target_type  TEXT NOT NULL CHECK (target_type IN ('room', 'place')),
  target_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

-- ── F05 Notifications & push ───────────────────────────────────────────
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('comment', 'dm', 'saved')),
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC, id DESC);

CREATE TABLE notification_prefs (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  comment       INTEGER NOT NULL DEFAULT 1,
  dm            INTEGER NOT NULL DEFAULT 1,
  saved         INTEGER NOT NULL DEFAULT 1,
  dnd_start     INTEGER,                               -- minutes from 00:00 KST, NULL = off
  dnd_end       INTEGER,
  hide_content  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE device_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  session_id  TEXT NOT NULL REFERENCES sessions(id),   -- removed on logout of that session
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  token       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);

-- Outbound push queue. Delivery to FCM/APNs is NOT implemented yet (no credentials);
-- rows stay 'pending' until a sender is configured. See README.
CREATE TABLE push_outbox (
  id               TEXT PRIMARY KEY,
  notification_id  TEXT NOT NULL REFERENCES notifications(id),
  device_token_id  TEXT NOT NULL,
  platform         TEXT NOT NULL,
  payload          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at       INTEGER NOT NULL
);
