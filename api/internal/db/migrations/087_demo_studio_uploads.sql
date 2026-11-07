-- Lagoon Gate Pictures (the judges' demo studio) screens three lineup films that were added
-- before studios could upload. Give each its studio record, linked to the premiere it already
-- has, so Premieres, Film detail and AI dubbing work on them like on a studio's own upload.
-- Red Earth's subtitle file is the stand-in film's English script (Tears of Steel, CC BY 3.0),
-- put in private storage by .github/workflows/demo-studio-script.yml; its Yoruba dub starts
-- translating as soon as the dub worker sees it.
INSERT INTO studio_uploads (id, studio, title, status, logline, genres, age_rating, languages, created_at, updated_at)
SELECT v.id::uuid, 'Lagoon Gate Pictures', v.title, 'submitted', v.logline, v.genres, 'PG-13', 'English', s.starts_at - interval '21 days', now()
FROM (VALUES
  ('4c6f6764-0000-4000-8000-000000000001', 'Red Earth', 'red-earth-2026-11-02', 'A farming family races the early rains to bring in the harvest their village depends on.', 'Drama'),
  ('4c6f6764-0000-4000-8000-000000000002', 'Tide of Lagos', 'tide-of-lagos-2026-11-01', '', 'Drama'),
  ('4c6f6764-0000-4000-8000-000000000003', 'Lagos Lights', 'lagos-lights-2026-11-04', '', 'Comedy')
) AS v (id, title, showtime, logline, genres)
JOIN showtimes s ON s.id = v.showtime AND s.studio = 'Lagoon Gate Pictures'
ON CONFLICT (id) DO NOTHING;

UPDATE studio_uploads SET languages = 'Yoruba' WHERE id = '4c6f6764-0000-4000-8000-000000000002';

INSERT INTO studio_premieres (upload, showtime_id, mode, starts_at, seats, encores, price_cents, published_at, updated_at)
SELECT u.id, s.id, 'global', s.starts_at, s.capacity, 0, s.price_cents, s.starts_at - interval '14 days', now()
FROM studio_uploads u JOIN showtimes s ON s.id = CASE u.id::text
  WHEN '4c6f6764-0000-4000-8000-000000000001' THEN 'red-earth-2026-11-02'
  WHEN '4c6f6764-0000-4000-8000-000000000002' THEN 'tide-of-lagos-2026-11-01'
  WHEN '4c6f6764-0000-4000-8000-000000000003' THEN 'lagos-lights-2026-11-04' END
WHERE NOT EXISTS (SELECT 1 FROM studio_premieres p WHERE p.showtime_id = s.id)
ON CONFLICT (upload) DO NOTHING;

INSERT INTO studio_upload_files (id, upload_id, kind, name, size_bytes, content_type, key, status, info)
SELECT '4c6f6764-0000-4000-8000-000000000101', u.id, 'subtitles', 'RedEarth_EN.srt', 4764, 'application/x-subrip',
  'studio-uploads/4c6f6764-0000-4000-8000-000000000001/4c6f6764-0000-4000-8000-000000000101.srt', 'uploaded', '76 lines'
FROM studio_uploads u WHERE u.id = '4c6f6764-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

INSERT INTO studio_dubs (upload, lang, status)
SELECT u.id, 'yo', 'translating' FROM studio_uploads u WHERE u.id = '4c6f6764-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
