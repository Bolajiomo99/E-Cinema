-- Rooms and VR halls (Figma 83:831): room types the CEO and cabinet publish without a developer.
-- VR and AR halls become the halls viewers can pick in the VR cinema; party and private rooms
-- become the rooms a host can open a watch party in.
CREATE TABLE room_types (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,48}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  kind        text NOT NULL CHECK (kind IN ('vr', 'ar', 'party', 'private')),
  scene       text NOT NULL CHECK (scene IN ('hall', 'rooftop', 'space', 'living', 'lounge')),
  seats       int  NOT NULL CHECK (seats BETWEEN 2 AND 500),
  audience    text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'vip', 'adult', 'kids')),
  voice       boolean NOT NULL DEFAULT true,
  spatial     boolean NOT NULL DEFAULT true,
  avatars     boolean NOT NULL DEFAULT true,
  live        boolean NOT NULL DEFAULT false,
  sort        int  NOT NULL DEFAULT 0,
  updated_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The halls and rooms that already existed before this page.
INSERT INTO room_types (id, name, kind, scene, seats, audience, live, sort) VALUES
  ('cinema-hall',   'Cinema hall',   'vr',      'hall',    84,  'everyone', true, 1),
  ('rooftop-lagos', 'Rooftop Lagos', 'vr',      'rooftop', 84,  'everyone', true, 2),
  ('space-dome',    'Space dome',    'vr',      'space',   84,  'everyone', true, 3),
  ('living-room',   'Living room',   'ar',      'living',  84,  'everyone', true, 4),
  ('watch-party',   'Watch party',   'party',   'lounge',  500, 'everyone', true, 5);

ALTER TABLE parties ADD COLUMN room_type text REFERENCES room_types(id);
