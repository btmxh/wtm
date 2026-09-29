PRAGMA foreign_keys = ON;

-- YouTube channels we crawl for clips.
CREATE TABLE IF NOT EXISTS clippers (
  id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  uploads_playlist_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Talents you follow. `aliases` is a JSON array of case-insensitive
-- substrings (name variants, hashtags, etc.) used to detect their
-- presence in a clip's title/description.
CREATE TABLE IF NOT EXISTS oshis (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crawled videos and shorts.
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL UNIQUE,
  clipper_id INTEGER NOT NULL REFERENCES clippers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  -- Starts as a duration<=60s guess; verify_shorts.ts confirms the real
  -- answer via the youtube.com/shorts/{id} redirect trick and flips
  -- kind_verified so future collect runs stop overwriting it.
  kind TEXT NOT NULL CHECK (kind IN ('short', 'video')),
  kind_verified INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clips_clipper ON clips(clipper_id);
CREATE INDEX IF NOT EXISTS idx_clips_published_at ON clips(published_at);
CREATE INDEX IF NOT EXISTS idx_clips_kind_verified ON clips(kind_verified);

-- Which oshi(s) a clip features. A clip can feature more than one
-- (collabs). `source` tracks how the link was made so heuristic guesses
-- can be safely re-derived without clobbering manual/LLM corrections.
CREATE TABLE IF NOT EXISTS clip_oshis (
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  oshi_id INTEGER NOT NULL REFERENCES oshis(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'heuristic' CHECK (source IN ('heuristic', 'llm', 'manual')),
  PRIMARY KEY (clip_id, oshi_id)
);

-- Pre-made vocabulary, managed via the /tags web UI (create/rename/delete) -
-- not created ad hoc while tagging a clip. `prompt` is an optional criterion
-- an LLM auto-tagger will use later to decide whether a clip matches; NULL
-- until that lands.
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  prompt TEXT
);

CREATE TABLE IF NOT EXISTS clip_tags (
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'llm')),
  confidence REAL,
  PRIMARY KEY (clip_id, tag_id)
);

-- A clip is "watched" iff a row exists here. The takeaway is required
-- at the point of marking watched, not a nullable field filled in later.
CREATE TABLE IF NOT EXISTS watches (
  clip_id INTEGER PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
  watched_at TEXT NOT NULL DEFAULT (datetime('now')),
  takeaway TEXT NOT NULL
);
