-- Private content records for the HQ half of the site builder. These rows are
-- intentionally not public: the production configuration endpoint filters to
-- public records and only the owner HQ session can read or edit these values.

insert into public.site_content (key, section, label, value, is_public)
values
  ('hq.brand', 'HQ', 'HQ identity', '{"eyebrow":"Operations","name":"Frontline Forecast","tagline":"Private company operations."}'::jsonb, false),
  ('hq.navigation', 'HQ', 'HQ navigation', '{"items":[{"id":"/","label":"Overview","enabled":true},{"id":"/accounts","label":"Services","enabled":true},{"id":"/finance","label":"Finance","enabled":true},{"id":"/people","label":"People","enabled":true},{"id":"/licensing","label":"Licensing","enabled":true},{"id":"/sites","label":"Site","enabled":true},{"id":"/roadmap","label":"Roadmap","enabled":true},{"id":"/security","label":"Security","enabled":true}]}'::jsonb, false),
  ('hq.pages', 'HQ', 'HQ page copy', '{"overview":{"eyebrow":"Operations","title":"Operations","description":"Work, dates, and company controls."},"services":{"eyebrow":"Services","title":"Services and accounts","description":"Provider ownership, renewal dates, and review status."},"finance":{"eyebrow":"Financial operations","title":"Finance","description":"Costs, commitments, and upcoming due dates."},"people":{"eyebrow":"People","title":"People and access","description":"Profiles and role requests."},"licensing":{"eyebrow":"Licensing","title":"Licensing","description":"Organizations, access, and readiness."},"site":{"eyebrow":"Production","title":"Publishing","description":"Edit the production and operations experience."},"roadmap":{"eyebrow":"Build path","title":"Next decisions.","description":"Work in the order that keeps the company flexible and ready."},"security":{"eyebrow":"Profile and security","title":"Account security","description":"Your private account and access settings."}}'::jsonb, false)
on conflict (key) do nothing;
