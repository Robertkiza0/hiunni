-- 의뢰서 ③: 익명 오픈톡(자동 닉네임). In an anonymous room, messages show a per-room
-- automatic nickname instead of the account nickname, and the account id is never exposed.
-- Additive only (client rule: change the DB through migrations, never drop data).
ALTER TABLE rooms ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;
