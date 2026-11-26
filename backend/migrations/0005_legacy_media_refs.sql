-- F02: where each migrated photo came from in the existing service's database.
-- Filled by tools/migrate-photos.mjs (media-import.sql). One row per source cell; several cells
-- holding the same picture share one media row (content-addressed R2 key legacy/<sha256>.<ext>).
-- Nothing in the old data is deleted; this only links old rows to the new media table.
CREATE TABLE legacy_media_refs (
  source_table   TEXT NOT NULL,
  source_column  TEXT NOT NULL,
  source_pk      TEXT NOT NULL,   -- JSON of the source row's primary key, e.g. {"id":"..."}
  media_id       TEXT NOT NULL REFERENCES media(id),
  PRIMARY KEY (source_table, source_column, source_pk)
);
CREATE INDEX idx_legacy_media_refs_media ON legacy_media_refs(media_id);
