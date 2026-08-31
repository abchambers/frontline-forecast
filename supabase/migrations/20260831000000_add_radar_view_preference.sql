-- Andrew's call 2026-08-31: the local mosaic (multi-station composite) becomes the default radar
-- view for everyone, not an opt-in. Signed-in users get a Control Center toggle to switch back to
-- the single-station view if they prefer it; anonymous visitors always see the mosaic (no account
-- to persist a preference to). Defaults to 'mosaic' for every existing row.
alter table profiles add column radar_view_preference text not null default 'mosaic';
