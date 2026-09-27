-- Move moodle_credentials from one-row-per-user to one-row-per-(user, site),
-- so a single student can link 0..N SUNLearn instances (src/sunlearn-sites.ts)
-- instead of exactly one. SQLite can't ALTER a table's primary key in place,
-- so this rebuilds the table and copies existing rows across verbatim — the
-- single credential a user had before this migration becomes that user's
-- first (and, until they connect more, only) site row. No data is dropped.
CREATE TABLE moodle_credentials_v2 (
  user_id TEXT NOT NULL,
  moodle_base_url TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, moodle_base_url)
);

INSERT INTO moodle_credentials_v2 (user_id, moodle_base_url, encrypted_token, created_at, updated_at)
SELECT user_id, moodle_base_url, encrypted_token, created_at, updated_at FROM moodle_credentials;

DROP TABLE moodle_credentials;
ALTER TABLE moodle_credentials_v2 RENAME TO moodle_credentials;

-- linking_sessions must now remember which SUNLearn site a given linking
-- attempt was started against, so a connection link copied from one site
-- (e.g. EMSLearn) can never complete a session that was started for another
-- (e.g. STEMLearn) — see src/linking/session-store.ts. Existing rows predate
-- multi-site and were always implicitly the deployment's single configured
-- Moodle site; NULL there is handled by the resolver as "use the legacy
-- single-site default", not as "any site".
ALTER TABLE linking_sessions ADD COLUMN moodle_base_url TEXT;
