-- 在 schema.sql 后执行。每天北京时间 00:05 按年度年级标准补齐截至本月的固定工资支出。
-- 因唯一约束，同月永远只生成一条。1 号会生成新月份，无需有人打开网页。
create extension if not exists pg_cron;
select cron.schedule('yanzhu-monthly-allowance', '5 16 * * *', $$select private.generate_allowances(null);$$);
