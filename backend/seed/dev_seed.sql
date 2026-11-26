-- SYNTHETIC development data only. No real members, stores, shops or phone numbers.
-- Accounts A/B/C match the reference spec's "합성 계정 A/B/C". Safe to re-run (INSERT OR IGNORE).
-- Reset everything with: npm run db:reset:local

INSERT OR IGNORE INTO users (id, nickname, role, show_last_seen, last_seen_at, created_at) VALUES
  ('usera',    '테스트A',      'member',   0, NULL,          1795000000000),
  ('userb',    '테스트B',      'member',   0, NULL,          1795000000000),
  ('userc',    '테스트C',      'member',   0, NULL,          1795000000000),
  ('manager1', '합성 실장 하나', 'operator', 1, 1795100000000, 1795000000000),
  ('manager2', '합성 실장 둘',  'operator', 0, 1795100000000, 1795000000000),
  ('admin1',   '운영자(합성)',  'admin',    0, NULL,          1795000000000);

-- ── Stores & store rooms (실시간현황) ────────────────────────────────
INSERT OR IGNORE INTO stores (id, name, region, created_at) VALUES
  ('store1', '합성 가게 하나', 'gangnam', 1795000000000),
  ('store2', '합성 가게 둘',  'hongdae', 1795000000000),
  ('store3', '합성 가게 셋',  'gangnam', 1795000000000);

INSERT OR IGNORE INTO store_staff (store_id, user_id, title, is_operator) VALUES
  ('store1', 'manager1', '실장', 1),
  ('store1', 'manager2', '부실장', 0),
  ('store2', 'manager2', '실장', 1);

INSERT OR IGNORE INTO rooms (id, kind, title, region, status, join_policy, capacity, store_id, created_at) VALUES
  ('room1',  'store',   '합성 가게 하나 · 가게방', 'gangnam', 'open', 'approval', 30,   'store1', 1795000000300),
  ('room2',  'store',   '합성 가게 둘 · 가게방',  'hongdae', 'open', 'approval', 20,   'store2', 1795000000200),
  ('room3',  'store',   '합성 가게 셋 · 가게방',  'gangnam', 'open', 'open',     NULL, 'store3', 1795000000100),
  ('gen1',   'general', '강남 퇴근길 수다방',      'gangnam', 'open', 'open',     50,   NULL,     1795000000050),
  ('open1',  'general', '익명 오픈톡',             NULL,      'open', 'open',     NULL, NULL,     1795000000045),
  ('daily1', 'daily',   '오늘 뭐 먹지',           NULL,      'open', 'open',     NULL, NULL,     1795000000040),
  ('daily2', 'daily',   '출근 전 메이크업 정보',    NULL,      'open', 'open',     NULL, NULL,     1795000000030),
  ('daily3', 'daily',   '고민 상담소',            NULL,      'open', 'open',     NULL, NULL,     1795000000020);

-- 익명 오픈톡: messages show automatic per-room nicknames (migration 0002).
UPDATE rooms SET anonymous = 1 WHERE id = 'open1';

INSERT OR IGNORE INTO room_members (room_id, user_id, state, role, updated_at) VALUES
  ('room1', 'manager1', 'active', 'manager', 1795000000000),
  ('room2', 'manager2', 'active', 'manager', 1795000000000);

-- NULL = not reported (shown as —), distinct from 0.
INSERT OR IGNORE INTO room_status (room_id, choice, entry, waiting, vacancy, updated_at, updated_by) VALUES
  ('room1', 4, 12, 3, 2,    1795100000000, 'manager1'),
  ('room2', 0, 8,  NULL, 0, 1795100000000, 'manager2');

INSERT OR IGNORE INTO store_prices (id, store_id, label, amount, note, sort) VALUES
  ('s1p1', 'store1', '기본',   50000, NULL,        0),
  ('s1p2', 'store1', '연장',   NULL,  '문의',       1),
  ('s1p3', 'store1', '룸 차지', 0,     '합성 예시',  2),
  ('s2p1', 'store2', '기본',   45000, NULL,        0);

INSERT OR IGNORE INTO store_terms (id, store_id, term, definition, sort) VALUES
  ('s1t1', 'store1', 'TC',   '테이블 차지 (합성 예시)', 0),
  ('s1t2', 'store1', '초중', '초이스 중인 인원 (합성 예시)', 1),
  ('s1t3', 'store1', '엔트리', '오늘 출근 등록 인원 (합성 예시)', 2);

INSERT OR IGNORE INTO vacancy_logs (id, store_id, vacancy, note, recorded_by, created_at) VALUES
  ('s1v1', 'store1', 3, '21시 기준', 'manager1', 1795090000000),
  ('s1v2', 'store1', 2, '22시 기준', 'manager1', 1795100000000);

-- ── Lounge board (라운지) ──────────────────────────────────────────
INSERT OR IGNORE INTO posts (id, author_id, board, category, title, body, is_notice, like_count, comment_count, mutation_id, created_at) VALUES
  ('post0', 'admin1', 'lounge', 'free',     '[공지] 합성 데이터 개발 환경입니다', '이 화면의 글·계정·가게·장소는 모두 합성 데이터입니다. 실제 회원 정보가 아닙니다.', 1, 0, 0, 'seedmut0', 1795000000000),
  ('post1', 'userb',  'lounge', 'free',     '오늘 출근 다들 하시나요',     '비 와서 고민되네요. 다들 어떻게 하세요?', 0, 3, 2, 'seedmut1', 1795090000000),
  ('post2', 'userc',  'lounge', 'question', '새벽 퇴근 후 택시 꿀팁 있나요', '강남에서 새벽 3시쯤 퇴근하면 택시 잡기 너무 어려워요.', 0, 5, 1, 'seedmut2', 1795080000000),
  ('post3', 'usera',  'lounge', 'info',     '심야 헤어샵 정리해봤어요',     '플레이스 탭에서 심야·24시 필터로도 찾을 수 있어요.', 0, 8, 0, 'seedmut3', 1795070000000),
  ('post4', 'userb',  'lounge', 'together', '주말 같이 운동하실 분',       '토요일 오전 한강에서 가볍게 걸어요.', 0, 1, 0, 'seedmut4', 1795060000000),
  ('post5', 'userc',  'lounge', 'free',     '요즘 위로가 되는 노래',       '퇴근길에 듣는 노래 추천해 주세요.', 0, 2, 0, 'seedmut5', 1795050000000),
  ('post6', 'usera',  'lounge', 'question', '세금 신고 어떻게 하세요?',     '처음이라 잘 모르겠어요. 경험 공유 부탁드려요.', 0, 4, 0, 'seedmut6', 1795040000000),
  ('post7', 'userb',  'lounge', 'info',     '24시 카페 위치 공유',         '합성 예시 글입니다.', 0, 0, 0, 'seedmut7', 1795030000000);

INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES
  ('post1', 'usera', 1795090000000), ('post1', 'userc', 1795090000000), ('post1', 'manager1', 1795090000000),
  ('post2', 'usera', 1795080000000), ('post2', 'userb', 1795080000000), ('post2', 'manager1', 1795080000000), ('post2', 'manager2', 1795080000000), ('post2', 'admin1', 1795080000000),
  ('post3', 'userb', 1795070000000), ('post3', 'userc', 1795070000000), ('post3', 'manager1', 1795070000000), ('post3', 'manager2', 1795070000000),
  ('post3', 'admin1', 1795070000000), ('post3', 'usera', 1795070000000), ('post3', 'userb', 1795070000001), ('post3', 'userc', 1795070000001),
  ('post4', 'usera', 1795060000000),
  ('post5', 'usera', 1795050000000), ('post5', 'userb', 1795050000000),
  ('post6', 'userb', 1795040000000), ('post6', 'userc', 1795040000000), ('post6', 'manager1', 1795040000000), ('post6', 'admin1', 1795040000000);
-- keep counters consistent with the like rows above (duplicates were ignored)
UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = posts.id);

INSERT OR IGNORE INTO comments (id, post_id, author_id, body, is_secret, like_count, mutation_id, created_at) VALUES
  ('cm1', 'post1', 'usera', '저는 오늘 쉬어요!', 0, 0, 'seedcm1', 1795091000000),
  ('cm2', 'post1', 'userc', '비밀 댓글 예시입니다. 글쓴이(테스트B)와 저만 볼 수 있어요.', 1, 0, 'seedcm2', 1795092000000),
  ('cm3', 'post2', 'userb', '미리 호출 앱 켜두면 좀 나아요', 0, 0, 'seedcm3', 1795081000000),
  ('cm4', 'post2', 'manager2', '가게 앞에서 기다리시면 저희가 잡아드려요 (합성 예시)', 0, 0, 'seedcm4', 1795082000000);
UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id AND c.deleted_at IS NULL);

-- A pending DM request so 테스트A's inbox is not empty.
INSERT OR IGNORE INTO dm_requests (id, from_user, to_user, post_id, message, status, created_at) VALUES
  ('dmreq1', 'userc', 'usera', 'post3', '정리 글 잘 봤어요! 몇 가지 여쭤봐도 될까요?', 'pending', 1795095000000);

-- ── Places (플레이스) ──────────────────────────────────────────────
-- category (의뢰서 플레이스 분류): hair 헤어·메이크업 / rental 홀복·렌탈 / clinic 성형·시술 / nail 네일&취미 / living 생활필수 / fun 놀거리 ZIP
INSERT OR IGNORE INTO places (id, name, category, region, recommended, created_at) VALUES
  ('pl01', '합성 헤어 A',     'hair',      'gangnam', 1, 1795000000000),
  ('pl02', '합성 헤어 B',     'hair',      'gangnam', 0, 1795000000000),
  ('pl03', '합성 메이크업 C',  'hair',      'hongdae', 1, 1795000000000),
  ('pl04', '합성 24시 헤메',   'hair',      'gangnam', 0, 1795000000000),
  ('pl05', '합성 클리닉 A',    'clinic',    'gangnam', 0, 1795000000000),
  ('pl06', '합성 클리닉 B',    'clinic',    'jamsil',  0, 1795000000000),
  ('pl07', '합성 홀복 렌탈 A',    'rental',    'gangnam', 1, 1795000000000),
  ('pl08', '합성 홀복 렌탈 B',    'rental',    'hongdae', 0, 1795000000000),
  ('pl09', '합성 네일 A',     'nail',      'gangnam', 0, 1795000000000),
  ('pl10', '합성 취미 공방 B',     'nail',      'jamsil',  0, 1795000000000),
  ('pl11', '합성 생활용품 A',    'living',    'gangnam', 0, 1795000000000),
  ('pl12', '합성 놀거리 카페',  'fun',       'hongdae', 0, 1795000000000),
  ('pl13', '합성 영업시간 미등록', 'hair',   'jamsil',  0, 1795000000000),
  ('pl14', '합성 주말 휴무 예시', 'nail',    'gangnam', 0, 1795000000000);

-- weekday 0=Sun..6=Sat; minutes from 00:00; close > 1440 = closes after midnight.
INSERT OR IGNORE INTO place_hours (place_id, weekday, open_min, close_min) VALUES
  -- pl01: Mon–Sat 12:00–21:00
  ('pl01',1,720,1260),('pl01',2,720,1260),('pl01',3,720,1260),('pl01',4,720,1260),('pl01',5,720,1260),('pl01',6,720,1260),
  -- pl02: Tue–Sun 13:00–03:00 (late night)
  ('pl02',0,780,1620),('pl02',2,780,1620),('pl02',3,780,1620),('pl02',4,780,1620),('pl02',5,780,1620),('pl02',6,780,1620),
  -- pl03: Fri/Sat 18:00–04:00
  ('pl03',5,1080,1680),('pl03',6,1080,1680),
  -- pl04: 24h every day
  ('pl04',0,0,1440),('pl04',1,0,1440),('pl04',2,0,1440),('pl04',3,0,1440),('pl04',4,0,1440),('pl04',5,0,1440),('pl04',6,0,1440),
  -- pl05: Mon–Fri 10:00–19:00
  ('pl05',1,600,1140),('pl05',2,600,1140),('pl05',3,600,1140),('pl05',4,600,1140),('pl05',5,600,1140),
  -- pl06: Mon–Sat 11:00–23:00
  ('pl06',1,660,1380),('pl06',2,660,1380),('pl06',3,660,1380),('pl06',4,660,1380),('pl06',5,660,1380),('pl06',6,660,1380),
  -- pl07: every day 14:00–02:00
  ('pl07',0,840,1560),('pl07',1,840,1560),('pl07',2,840,1560),('pl07',3,840,1560),('pl07',4,840,1560),('pl07',5,840,1560),('pl07',6,840,1560),
  -- pl08: Sat/Sun 11:00–20:00
  ('pl08',0,660,1200),('pl08',6,660,1200),
  -- pl09: Mon–Sat 19:00–05:00
  ('pl09',1,1140,1740),('pl09',2,1140,1740),('pl09',3,1140,1740),('pl09',4,1140,1740),('pl09',5,1140,1740),('pl09',6,1140,1740),
  -- pl10: Wed–Sun 12:00–20:00
  ('pl10',0,720,1200),('pl10',3,720,1200),('pl10',4,720,1200),('pl10',5,720,1200),('pl10',6,720,1200),
  -- pl11: Fri 20:00–02:00
  ('pl11',5,1200,1560),
  -- pl12: every day 09:00–24:00
  ('pl12',0,540,1440),('pl12',1,540,1440),('pl12',2,540,1440),('pl12',3,540,1440),('pl12',4,540,1440),('pl12',5,540,1440),('pl12',6,540,1440),
  -- pl14: Mon–Fri 10:00–20:00 (no weekend)
  ('pl14',1,600,1200),('pl14',2,600,1200),('pl14',3,600,1200),('pl14',4,600,1200),('pl14',5,600,1200);
  -- pl13 intentionally has no hours (unknown ≠ closed)

INSERT OR IGNORE INTO place_closures (place_id, date) VALUES ('pl02', '2026-11-25'), ('pl07', '2026-11-28');

-- 업종 and 동네 for the 초이스톡 filters (migration 0006). Synthetic stores; real 동 names are just places.
UPDATE stores SET category = 'hyperpublic', area = '역삼동' WHERE id = 'store1';
UPDATE stores SET category = 'jjeomo',      area = '서교동' WHERE id = 'store2';
UPDATE stores SET category = 'ten',         area = '논현동' WHERE id = 'store3';
