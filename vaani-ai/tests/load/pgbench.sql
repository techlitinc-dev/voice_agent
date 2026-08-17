# Load test: Postgres TPS (scalability doc §6.1).
# Target: 1,000 TPS on the app database.
#
# Run: pgbench -h localhost -p 5432 -U vaani -d vaani -c 20 -j 4 -T 60 -f tests/load/pgbench.sql
\set aid random(1, 100000)
\set balance random(-5000, 5000)

BEGIN;
UPDATE accounts SET balance = balance + :balance WHERE id = :aid;
SELECT balance FROM accounts WHERE id = :aid;
COMMIT;
