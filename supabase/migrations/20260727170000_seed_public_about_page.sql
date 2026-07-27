insert into public.site_content (key, section, label, description, value, is_public)
values (
  'about.public',
  'About',
  'About page',
  'Public about-page content',
  '{"eyebrow":"About Frontline Forecast","title":"Weather tools built around context.","description":"Frontline Forecast brings observations, radar, guidance, and verification together so a forecast can show its reasoning—not just its result.","principles":[{"title":"Read the atmosphere","body":"Start with what is happening now, then make the evidence visible."},{"title":"Make the forecast useful","body":"Turn guidance into a clear, time-bound decision for a real place."},{"title":"Learn from the result","body":"Compare the forecast with what happened and keep improving the next call."}]}'::jsonb,
  true
)
on conflict (key) do nothing;
