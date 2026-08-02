-- Now that starting a scenario resolves any real NWS station id (not just the
-- four preset cities), correct the seed scenarios' placeholder athens-ga
-- location to the location each actual historical event happened at.
update public.scenarios set location_id = 'birmingham-al' where slug = '2011-04-27-super-outbreak';
update public.scenarios set location_id = 'KDFW' where slug = '2021-02-14-winter-storm-uri';
update public.scenarios set location_id = 'KIAH' where slug = '2017-08-25-hurricane-harvey';
