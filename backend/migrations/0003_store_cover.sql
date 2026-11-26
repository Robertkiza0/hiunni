-- 초이스톡 list: one cover photo per store, shown like a product picture.
-- The photo is ordinary private R2 media (F02); the store operator sets it.
-- Additive only (client rule: change the DB through migrations, never drop data).
ALTER TABLE stores ADD COLUMN cover_media_id TEXT REFERENCES media(id);
