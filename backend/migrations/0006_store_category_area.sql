-- 초이스톡 filters from the product definition (2026-11-26): 업종 and 동네 search.
-- category  업종, the same three groups as the existing service's /api/status (하이퍼블릭·쩜오·텐).
--           NULL = not set yet (shown under 전체 only).
-- area      동네, e.g. 역삼동; matched by the list search together with the store name.
ALTER TABLE stores ADD COLUMN category TEXT CHECK (category IN ('hyperpublic', 'jjeomo', 'ten'));
ALTER TABLE stores ADD COLUMN area TEXT;
CREATE INDEX idx_stores_category ON stores(category);
