-- Canonical MCP user identity, decoupled from any single SUNLearn site.
--
-- Previously, an OAuth user's identity WAS whatever deriveStemlearnUserId
-- produced for the first site they happened to link in a given browser
-- flow — stable only as long as every future login went through that same
-- site first. That's wrong for a multi-site product: the same human linking
-- EMSLearn first on a new device would mint a second, disconnected identity
-- and orphan their real credentials/grants.
--
-- This table is the durable fix: it maps each verified (site, Moodle user
-- id) pair to one canonical_user_id, enforced unique per pair so two humans
-- can never collide onto one canonical identity, and looked up on every
-- authentication regardless of which site started the flow (see
-- src/oauth/canonical-identity.ts). It is empty on this migration — no
-- backfill is possible, since the plaintext Moodle numeric user id was never
-- persisted anywhere pre-migration (only its salted hash, inside the
-- existing derived user_id). That's fine by construction: the resolver mints
-- a canonical id with the SAME formula deriveStemlearnUserId always used,
-- so the currently-linked production user's very next login re-derives the
-- exact same value their existing moodle_credentials/OAuth grants already
-- use, and this table simply starts remembering it (and every site added
-- after) from that point on.
CREATE TABLE moodle_identity_aliases (
  moodle_base_url TEXT NOT NULL,
  moodle_user_id INTEGER NOT NULL,
  canonical_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moodle_base_url, moodle_user_id)
);

CREATE INDEX idx_moodle_identity_aliases_canonical ON moodle_identity_aliases (canonical_user_id);
