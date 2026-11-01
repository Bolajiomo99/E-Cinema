-- Community (Figma 32:951 feed, 96:1566 group page): groups people join, posts with photos and
-- polls, likes, comments, follows, and machine translation of posts into the reader's language.
CREATE TABLE communities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 60),
  about       text NOT NULL DEFAULT '' CHECK (char_length(about) <= 400),
  rules       text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 600),
  visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  members     integer NOT NULL DEFAULT 0 CHECK (members >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX communities_name ON communities (lower(name));

CREATE TABLE community_members (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'mod', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, account_id)
);
CREATE INDEX community_members_account ON community_members (account_id);

-- A party can be listed on a community's page.
ALTER TABLE parties ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE SET NULL;
CREATE INDEX parties_community ON parties (community_id) WHERE community_id IS NOT NULL;

CREATE TABLE posts (
  id           bigserial PRIMARY KEY,
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('text', 'photo', 'poll')),
  body         text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  lang         text NOT NULL DEFAULT '' CHECK (lang ~ '^([a-z]{2,3})?$'),
  media_key    text CHECK (media_key ~ '^posts/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  showtime_id  text REFERENCES showtimes(id) ON DELETE SET NULL, -- "watched <film>"
  poll_ends_at timestamptz,
  pinned       boolean NOT NULL DEFAULT false,
  likes        integer NOT NULL DEFAULT 0 CHECK (likes >= 0),
  comments     integer NOT NULL DEFAULT 0 CHECK (comments >= 0),
  shares       integer NOT NULL DEFAULT 0 CHECK (shares >= 0),
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (kind <> 'photo' OR media_key IS NOT NULL),
  CHECK (kind <> 'poll' OR poll_ends_at IS NOT NULL),
  CHECK (kind = 'photo' OR body <> '')
);
CREATE INDEX posts_feed ON posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_community ON posts (community_id, pinned DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_author ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_tags ON posts USING gin (tags) WHERE deleted_at IS NULL;

CREATE TABLE poll_options (
  post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  idx     smallint NOT NULL CHECK (idx BETWEEN 0 AND 5),
  label   text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  votes   integer NOT NULL DEFAULT 0 CHECK (votes >= 0),
  PRIMARY KEY (post_id, idx)
);

CREATE TABLE poll_votes (
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idx        smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);

CREATE TABLE post_likes (
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);

CREATE TABLE post_comments (
  id         bigserial PRIMARY KEY,
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX post_comments_post ON post_comments (post_id, id) WHERE deleted_at IS NULL;

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows (followee_id);

CREATE TABLE post_translations (
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  lang       text NOT NULL CHECK (lang ~ '^[a-z]{2,3}$'),
  body       text NOT NULL,
  source     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, lang)
);

CREATE TABLE post_reports (
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('spam', 'abuse', 'spoiler', 'piracy', 'other')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, reporter_id)
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('premiere', 'language', 'party', 'reply', 'share', 'gift', 'friend', 'payment', 'refund', 'lottery', 'signin', 'follow', 'like', 'comment'));

-- Starter communities for the main audiences, so the page has somewhere to begin. They start
-- empty: member counts are real.
INSERT INTO communities (slug, name, about, rules) VALUES
  ('nollywood-fans', 'Nollywood Fans', 'For lovers of Nigerian film: premieres, party plans, snack photos and honest reviews.', 'Be kind. No spoilers before the credits roll. No pirated links, ever.'),
  ('anime-naija', 'Anime Naija', 'Anime nights, dub debates and watch parties for fans across Nigeria.', 'Be kind. Mark spoilers. No pirated links.'),
  ('k-drama-lagos', 'K-Drama Lagos', 'Korean drama and film fans in Lagos and beyond.', 'Be kind. Mark spoilers. No pirated links.'),
  ('bollywood-africa', 'Bollywood Africa', 'Bollywood premieres and sing-alongs for fans across Africa.', 'Be kind. Mark spoilers. No pirated links.');
