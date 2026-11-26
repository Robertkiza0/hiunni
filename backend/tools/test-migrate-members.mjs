#!/usr/bin/env node
/**
 * Rehearsal for tools/migrate-members.mjs on a SYNTHETIC database built with the existing
 * service's own table definitions (copied from its schema). Covers what its preview data lacks:
 * posts, comments, likes, withdrawn members, Google/Naver links, hidden rows, broken references,
 * approximate 초중 reports, unlisted shops, and the photo → cover link with migrate-photos.mjs.
 *   node --no-warnings tools/test-migrate-members.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hiunni-members-'));
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

// The existing service's table definitions (db/schema.ts → D1), synthetic rows only.
const jpg = fs.readFileSync(path.join(here, '../seed/covers', fs.readdirSync(path.join(here, '../seed/covers')).find(f => f.endsWith('.jpg'))));
const q = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const T = '2026-03-01T09:00:00.000Z';
const dump = `
CREATE TABLE \`members\` ( \`id\` text PRIMARY KEY NOT NULL, \`created_at\` text NOT NULL );
CREATE TABLE \`community_profiles\` ( \`user_id\` text PRIMARY KEY NOT NULL, \`public_id\` text NOT NULL, \`nickname\` text NOT NULL, \`discoverable\` integer DEFAULT 0 NOT NULL, \`revision\` integer DEFAULT 1 NOT NULL, \`auto_named\` integer DEFAULT 0 NOT NULL );
CREATE TABLE \`member_oauth_links\` ( \`provider\` text NOT NULL CHECK (\`provider\` IN ('google','naver')), \`subject_hash\` text NOT NULL, \`user_id\` text NOT NULL, \`created_at\` text NOT NULL, PRIMARY KEY (\`provider\`,\`subject_hash\`) );
CREATE TABLE \`account_closures\` ( \`user_id\` text PRIMARY KEY NOT NULL, \`closed_at\` text NOT NULL );
CREATE TABLE \`shops\` ( \`id\` text PRIMARY KEY NOT NULL, \`name\` text NOT NULL, \`area\` text NOT NULL, \`industry\` text NOT NULL, \`created_at\` text NOT NULL , listed INTEGER NOT NULL DEFAULT 0, intro TEXT NOT NULL DEFAULT '');
CREATE TABLE shop_photos(shop_id TEXT PRIMARY KEY NOT NULL,image TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE \`status_reports\` ( \`id\` text PRIMARY KEY NOT NULL, \`shop_id\` text NOT NULL, \`author_id\` text NOT NULL, \`state\` text NOT NULL, \`note\` text NOT NULL, \`created_at\` text NOT NULL, \`kind\` text DEFAULT 'status' NOT NULL );
CREATE TABLE \`saved_shops\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`shop_id\` text NOT NULL, \`created_at\` text NOT NULL );
CREATE TABLE \`community_posts\` ( \`id\` text PRIMARY KEY NOT NULL, \`author\` text NOT NULL, \`category\` text NOT NULL, \`title\` text NOT NULL, \`body\` text NOT NULL, \`state\` text DEFAULT 'published' NOT NULL, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL, \`notify_comments\` integer DEFAULT 1 NOT NULL );
CREATE TABLE \`community_comments\` ( \`id\` text PRIMARY KEY NOT NULL, \`post_id\` text NOT NULL, \`author\` text NOT NULL, \`body\` text NOT NULL, \`state\` text DEFAULT 'published' NOT NULL, \`created_at\` text NOT NULL, \`name\` text DEFAULT '' NOT NULL );
CREATE TABLE \`community_likes\` ( \`id\` text PRIMARY KEY NOT NULL, \`post_id\` text NOT NULL, \`author\` text NOT NULL );
CREATE TABLE social_rooms (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('chat','meetup')), title TEXT NOT NULL, description TEXT NOT NULL, area TEXT NOT NULL, meeting_at TEXT, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 50), approval INTEGER NOT NULL CHECK(approval IN (0,1)), state TEXT NOT NULL DEFAULT 'open', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE social_room_members (room_id TEXT NOT NULL, user_id TEXT NOT NULL, alias TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('joined','pending','left','banned')), joined_at TEXT NOT NULL, last_seen TEXT, PRIMARY KEY(room_id,user_id));
CREATE TABLE social_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL);
CREATE TABLE attendance_days (user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, day));

INSERT INTO members VALUES ('m1', '${T}'), ('m2', '${T}'), ('m3', '${T}'), ('m4', 'not-a-date');
INSERT INTO community_profiles VALUES ('m1', 'p1', '합성닉네임하나', 1, 1, 0), ('m2', 'p2', '합성닉네임둘', 1, 1, 0);
INSERT INTO account_closures VALUES ('m3', '${T}');
INSERT INTO member_oauth_links VALUES ('google', 'hash-g1', 'm1', '${T}'), ('naver', 'hash-n2', 'm2', '${T}'), ('google', 'hash-gx', 'ghost', '${T}');
INSERT INTO shops VALUES ('s1', '합성 하이퍼', '강남 역삼', '하이퍼블릭', '${T}', 1, ''), ('s2', '합성 텐카페', '강남 논현', '텐카페', '${T}', 1, ''),
  ('s3', '합성 숨김', '강남', '쩜오', '${T}', 0, ''), ('s4', '합성 지방', '부산 서면', '일프로', '${T}', 1, '');
INSERT INTO shop_photos VALUES ('s1', ${q(jpg.toString('base64'))}, 1, '${T}');
INSERT INTO status_reports VALUES
  ('r1', 's1', 'm1', '초중 12', '', '2026-03-01T10:00:00.000Z', 'status'),
  ('r2', 's1', 'm1', '현황', '엔트리 57 - 대기 28', '2026-03-01T10:05:00.000Z', 'status'),
  ('r3', 's2', 'm2', '초중 20 미만', '', '2026-03-01T10:00:00.000Z', 'status'),
  ('r4', 's3', 'm2', '초중 5', '', '2026-03-01T10:00:00.000Z', 'status');
INSERT INTO saved_shops VALUES ('v1', 'm1', 's1', '${T}'), ('v2', 'm2', 's3', '${T}'), ('v3', 'ghost', 's1', '${T}');
INSERT INTO community_posts VALUES ('p1', 'm1', 'free', '합성 글 하나', '본문', 'published', '${T}', '${T}', 1),
  ('p2', 'm2', 'legal', '합성 숨긴 글', '본문', 'hidden', '${T}', '2026-03-02T00:00:00.000Z', 1), ('p3', 'ghost', 'free', '주인 없음', '본문', 'published', '${T}', '${T}', 1);
INSERT INTO community_comments VALUES ('c1', 'p1', 'm2', '댓글', 'published', '${T}', ''), ('c2', 'p1', 'm1', '숨긴 댓글', 'hidden', '${T}', ''), ('c3', 'p3', 'm1', '고아 댓글', 'published', '${T}', '');
INSERT INTO community_likes VALUES ('l1', 'p1', 'm2'), ('l2', 'p1', 'm2'), ('l3', 'p1', 'm1');
INSERT INTO social_rooms VALUES ('g1', 'm1', 'chat', '합성 오픈톡', '', '강남', NULL, 30, 1, 'open', 1, '${T}', '${T}');
INSERT INTO social_room_members VALUES ('g1', 'm1', '익명1', 'joined', '${T}', NULL), ('g1', 'm2', '익명2', 'banned', '${T}', NULL);
INSERT INTO social_messages (id, room_id, author, body, state, created_at) VALUES ('x1', 'g1', 'm1', '안녕', 'published', '${T}'), ('x2', 'g1', 'm2', '숨김', 'hidden', '${T}'), ('x3', 'g1', 'm1', '두번째', 'published', '${T}');
INSERT INTO attendance_days VALUES ('m1', '2026-03-01');
`;
const exportFile = path.join(tmp, 'synthetic-export.sql');
fs.writeFileSync(exportFile, dump);
const work = path.join(tmp, 'work');
const run = (tool, ...extra) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', path.join(here, tool), '--source', exportFile, '--work', work, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

const r = run('migrate-members.mjs', '--verify');
const e = r.entities;
check(e.users.imported === 3 && e.users.skipped.bad_created_at === 1, 'members: 3 imported, the one with a broken date listed (not guessed)');
check(e.users.withdrawn === 1 && e.users.nicknameFallback === 1, 'withdrawn member kept as withdrawn; member without a nickname gets a placeholder');
check(e.oauth_links.imported === 2 && e.oauth_links.skipped.member_missing === 1, 'Google/Naver links: 2 carried over, 1 pointing at no member listed');
check(e.stores.imported === 4 && e.store_rooms.imported === 3 && e.stores.unlistedKeptHidden === 1, 'shops: all 4 kept; the unlisted one gets no room (hidden, not deleted)');
check(r.mappings.industry['텐카페 → ten'] === 1 && r.mappings.industry['일프로 → ten'] === 1 && r.mappings.unmappedRegions['부산 서면'] === 1, '업종 grouping and unknown regions are reported');
check(e.room_status.imported === 2 && e.room_status.approximateChoiceLeftEmpty === 1, 'live status: latest per listed shop; "초중 20 미만" left empty, not guessed');
check(e.saved_rooms.imported === 1 && e.saved_rooms.skipped.shop_missing_or_unlisted === 1 && e.saved_rooms.skipped.member_missing === 1, 'saved shops: broken ones listed with the reason');
check(e.posts.imported === 2 && e.posts.hiddenKept === 1 && e.posts.skipped.author_missing === 1, 'posts: hidden post imported hidden; ownerless post listed');
check(e.comments.imported === 2 && e.comments.hiddenKept === 1 && e.comments.skipped.post_missing === 1, 'comments: hidden kept hidden; comment on a skipped post listed');
check(e.post_likes.imported === 2 && e.post_likes.skipped.duplicate_like === 1, 'likes: the double like counted once');
check(e.chat_rooms.imported === 1 && e.chat_room_members.imported === 2 && e.chat_messages.imported === 2 && e.chat_messages.skipped.hidden_in_old_service_left_there === 1, 'chat rooms, members and visible messages carried over');
check(r.sourceTables.notCarriedWithRows.includes('attendance_days (1)'), 'tables not carried over are listed with their row counts (nothing silently dropped)');
check(r.verify.countMismatch.length === 0 && r.verify.foreignKeyProblems === 0 && r.verify.sampleMismatch.length === 0 && r.verify.secondRunChangedNothing,
  'verify: counts match, no broken references, samples match, applying twice changes nothing');

// Look inside the result: build the new schema, apply photos then members, and read rows back.
fs.rmSync(path.join(work, 'objects'), { recursive: true, force: true });
run('migrate-photos.mjs');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
for (const f of fs.readdirSync(path.join(here, '..', 'migrations')).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(here, '..', 'migrations', f), 'utf8'));
db.exec(fs.readFileSync(path.join(work, 'media-import.sql'), 'utf8'));
db.exec(fs.readFileSync(path.join(work, 'import.sql'), 'utf8'));
const one = (s, ...a) => db.prepare(s).get(...a);
check(one("SELECT status FROM users WHERE id = 'm3'").status === 'withdrawn' && one("SELECT nickname FROM users WHERE id = 'm1'").nickname === '합성닉네임하나', 'users read back: nickname and withdrawn status');
check(one("SELECT category, area, region, source_industry FROM stores WHERE id = 's2'").category === 'ten' && one("SELECT area FROM stores WHERE id = 's2'").area === '논현', 'stores read back: 텐카페 → 텐 group, 동네 논현, original label kept');
check(one("SELECT COUNT(*) AS n FROM rooms WHERE id = 's3'").n === 0 && one("SELECT COUNT(*) AS n FROM stores WHERE id = 's3'").n === 1, 'unlisted shop: store kept, no room in the list');
check(JSON.stringify(one("SELECT choice, entry, waiting, vacancy FROM room_status WHERE room_id = 's1'")) === JSON.stringify({ choice: 12, entry: 57, waiting: 28, vacancy: null }), 'live status read back: 초중 12, 엔트리 57, 대기 28, 빈방 unknown (not 0)');
check(one("SELECT choice FROM room_status WHERE room_id = 's2'").choice === null, '"초중 20 미만" stays unknown');
const cover = one("SELECT s.cover_media_id, m.r2_key FROM stores s JOIN media m ON m.id = s.cover_media_id WHERE s.id = 's1'");
check(!!cover && cover.r2_key.startsWith('legacy/'), 'shop photo from the photo migration becomes the store cover');
check(one("SELECT like_count, comment_count FROM posts WHERE id = 'p1'").like_count === 2 && one("SELECT comment_count FROM posts WHERE id = 'p1'").comment_count === 1, 'post counters recomputed (2 likes, 1 visible comment)');
check(one("SELECT deleted_at FROM posts WHERE id = 'p2'").deleted_at > 0, 'hidden post is hidden here too (deleted_at), not removed');
check(one("SELECT anonymous, join_policy FROM rooms WHERE id = 'g1'").anonymous === 1 && one("SELECT state FROM room_members WHERE room_id = 'g1' AND user_id = 'm2'").state === 'blocked', '오픈톡 → 익명 오픈톡 with approval; banned member stays blocked');
check(db.prepare("SELECT body FROM room_messages WHERE room_id = 'g1' ORDER BY seq").all().map(x => x.body).join('|') === '안녕|두번째', 'messages keep their order');
check(one("SELECT user_id FROM oauth_links WHERE provider = 'google' AND subject_hash = 'hash-g1'").user_id === 'm1', 'a Google login hash still points at the same member');
check(fs.readFileSync(exportFile, 'utf8') === dump, 'source export is unchanged');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
