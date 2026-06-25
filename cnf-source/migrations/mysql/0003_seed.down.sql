DELETE FROM users WHERE username='admin';
DELETE FROM datacenters WHERE name='Default-DC';
DELETE FROM roles WHERE name IN ('admin','operator','viewer');
