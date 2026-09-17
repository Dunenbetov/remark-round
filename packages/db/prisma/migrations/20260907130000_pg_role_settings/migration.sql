-- Настройки Postgres для приложения (аудит: postgres-untuned-no-db-runbook). Роль приложения — та, под которой
-- идут миграции (CURRENT_USER), поэтому имя не зашито. Значения применяются к новым сессиям.
--   statement_timeout 120s — зависший запрос не держит соединение из пула на 10 вечно;
--   idle_in_transaction_session_timeout 60s — брошенная транзакция не блокирует autovacuum и чужие UPDATE.
-- Тяжёлая миграция (индекс на большой таблице) начинается со строки `SET statement_timeout = 0;` — см. packages/db/README.md.
-- pg_stat_statements: расширение создаётся здесь, а shared_preload_libraries задан в команде контейнера postgres (docker-compose.yml).
ALTER ROLE CURRENT_USER SET statement_timeout = '120s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
