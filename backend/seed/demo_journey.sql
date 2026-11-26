-- SYNTHETIC demo data for the 홈 → 초이스톡 → 가게방 → 담당찾기 walkthrough.
-- Fake stores and staff only. No real members, venues or phone numbers.
-- Load after dev_seed.sql:  wrangler d1 execute hiunni-db --local --file=seed/demo_journey.sql
-- Safe to re-run: inserts are IGNOREd, and status times are refreshed to "now" on every run.

INSERT OR IGNORE INTO users (id, nickname, role, show_last_seen, last_seen_at, created_at) VALUES
  ('staff1', '합성 담당 민지', 'operator', 1, 1795100000000, 1795000000000),
  ('staff2', '합성 담당 서연', 'operator', 1, 1795100000000, 1795000000000),
  ('staff3', '합성 팀장 유나', 'operator', 0, 1795100000000, 1795000000000),
  ('staff4', '합성 담당 하은', 'operator', 1, NULL,          1795000000000),
  ('staff5', '합성 부장 지우', 'operator', 1, 1795100000000, 1795000000000),
  ('staff6', '합성 실장 셋',   'operator', 1, 1795100000000, 1795000000000),
  ('staff7', '합성 담당 수아', 'operator', 0, 1795100000000, 1795000000000);

-- Long names on purpose: the list must stay readable at 390 px.
INSERT OR IGNORE INTO stores (id, name, region, created_at) VALUES
  ('store4',  '합성 가게 넷 강남역 테헤란로 본점 2층 라운지', 'gangnam', 1795000000000),
  ('store5',  '합성 가게 다섯',                              'gangnam', 1795000000000),
  ('store6',  '합성 가게 여섯 홍대입구역 9번 출구 앞 신관',     'hongdae', 1795000000000),
  ('store7',  '합성 가게 일곱',                              'jamsil',  1795000000000),
  ('store8',  '합성 가게 여덟 잠실새내 먹자골목 안쪽 별관',     'jamsil',  1795000000000),
  ('store9',  '합성 가게 아홉',                              'gangnam', 1795000000000),
  ('store10', '합성 가게 열',                                'hongdae', 1795000000000),
  ('store11', '합성 가게 열하나 논현동 학동사거리 지하 1층',    'gangnam', 1795000000000);

INSERT OR IGNORE INTO store_staff (store_id, user_id, title, is_operator) VALUES
  ('store1', 'staff1', '담당', 0),
  ('store1', 'staff2', '담당', 0),
  ('store1', 'staff3', '팀장', 0),
  ('store1', 'staff4', '담당', 0),
  ('store1', 'staff5', '부장', 0),
  ('store4', 'staff6', '실장', 1),
  ('store4', 'staff7', '담당', 0),
  ('store4', 'staff1', '담당', 0),
  ('store4', 'staff3', '팀장', 0),
  ('store4', 'staff5', '부장', 0);

INSERT OR IGNORE INTO rooms (id, kind, title, region, status, join_policy, capacity, store_id, created_at) VALUES
  ('room4',  'store', '합성 가게 넷 강남역 테헤란로 본점 2층 라운지', 'gangnam', 'open', 'open',     40,   'store4',  1795000000090),
  ('room5',  'store', '합성 가게 다섯',                              'gangnam', 'open', 'approval', 20,   'store5',  1795000000089),
  ('room6',  'store', '합성 가게 여섯 홍대입구역 9번 출구 앞 신관',     'hongdae', 'open', 'open',     NULL, 'store6',  1795000000088),
  ('room7',  'store', '합성 가게 일곱',                              'jamsil',  'open', 'open',     30,   'store7',  1795000000087),
  ('room8',  'store', '합성 가게 여덟 잠실새내 먹자골목 안쪽 별관',     'jamsil',  'open', 'approval', 25,   'store8',  1795000000086),
  ('room9',  'store', '합성 가게 아홉',                              'gangnam', 'open', 'open',     NULL, 'store9',  1795000000085),
  ('room10', 'store', '합성 가게 열',                                'hongdae', 'open', 'open',     15,   'store10', 1795000000084),
  ('room11', 'store', '합성 가게 열하나 논현동 학동사거리 지하 1층',    'gangnam', 'open', 'open',     NULL, 'store11', 1795000000083);

-- A spread of states: busy, confirmed zeros, partly unreported, and room9/room11 with no report at all.
INSERT OR REPLACE INTO room_status (room_id, choice, entry, waiting, vacancy, updated_at, updated_by) VALUES
  ('room1',  4,  12, 3,    2, CAST(strftime('%s','now') AS INTEGER) * 1000 - 120000,   'manager1'),
  ('room4',  7,  18, 5,    1, CAST(strftime('%s','now') AS INTEGER) * 1000 - 60000,    'staff6'),
  ('room5',  0,  6,  0,    3, CAST(strftime('%s','now') AS INTEGER) * 1000 - 600000,   'staff6'),
  ('room6',  2,  9,  NULL, 0, CAST(strftime('%s','now') AS INTEGER) * 1000 - 1500000,  'staff6'),
  ('room7',  0,  0,  0,    0, CAST(strftime('%s','now') AS INTEGER) * 1000 - 300000,   'staff6'),
  ('room8',  3,  11, 2,    4, CAST(strftime('%s','now') AS INTEGER) * 1000 - 7200000,  'staff6'),
  ('room10', 1,  5,  1,    2, CAST(strftime('%s','now') AS INTEGER) * 1000 - 240000,   'staff6');

-- 업종 and 동네 for the 초이스톡 filters (migration 0006).
UPDATE stores SET category = 'hyperpublic', area = '역삼동' WHERE id = 'store4';
UPDATE stores SET category = 'ten',         area = '청담동' WHERE id = 'store5';
UPDATE stores SET category = 'hyperpublic', area = '동교동' WHERE id = 'store6';
UPDATE stores SET category = 'jjeomo',      area = '잠실동' WHERE id = 'store7';
UPDATE stores SET category = 'hyperpublic', area = '삼전동' WHERE id = 'store8';
UPDATE stores SET category = 'jjeomo',      area = '신사동' WHERE id = 'store9';
UPDATE stores SET category = 'ten',         area = '연남동' WHERE id = 'store10';
UPDATE stores SET category = 'hyperpublic', area = '논현동' WHERE id = 'store11';
