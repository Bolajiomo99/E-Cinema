-- Hackathon judges' demo account owns one seeded studio, so the studio portal shows real films.
-- The account claims it on its next sign-in (studios.Mine matches by email).
INSERT INTO studio_members (studio, email, role)
SELECT 'Lagoon Gate Pictures', 'demo+judges@e-cinema.net', 'owner'
WHERE EXISTS (SELECT 1 FROM studios WHERE name = 'Lagoon Gate Pictures')
ON CONFLICT DO NOTHING;
