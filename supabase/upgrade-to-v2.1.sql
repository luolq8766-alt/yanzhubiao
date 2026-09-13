-- 已有 1.0 / 2.0 项目用本脚本升级到 2.1；全选执行。
-- 研助表 2.0：已有 1.0 数据库只执行本文件；可重复执行，不删除历史记录。
begin;
alter table public.entries drop constraint if exists entries_kind_check;
alter table public.entries add constraint entries_kind_check check(kind in('expense','salary','allowance','reward'));
alter table public.entries drop constraint if exists entries_amount_check;
alter table public.entries add constraint entries_amount_check check(amount between 0 and 10000000000);
alter table public.entries add column if not exists end_date date;
update public.entries set end_date=date where end_date is null;
alter table public.entries add column if not exists items jsonb not null default '[]';
alter table public.entries add column if not exists is_trip boolean not null default false;
alter table public.entries add column if not exists underground_days int not null default 0;
alter table public.entries add column if not exists trip_wage bigint not null default 0;
alter table public.entries add column if not exists salary_month date;
alter table public.entries add column if not exists salary_manual boolean not null default false;
alter table public.entries add column if not exists task_id uuid references public.tasks(id);
create unique index if not exists entries_salary_month_unique on public.entries(owner_id,salary_month);
create unique index if not exists entries_task_reward_unique on public.entries(task_id);
alter table public.tasks add column if not exists reward_amount bigint not null default 0 check(reward_amount between 0 and 10000000000);
create table if not exists public.salary_rules(effective_month date primary key check(extract(day from effective_month)=1),rates jsonb not null,version int not null default 1);
alter table public.salary_rules enable row level security;
revoke all on public.salary_rules from public,anon,authenticated;
grant select on public.salary_rules to authenticated;
drop policy if exists salary_rules_read on public.salary_rules;
create policy salary_rules_read on public.salary_rules for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid()));

create or replace function private.money_value(value text) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if value is null or value !~ '^[0-9]+$' or length(value)>11 then raise exception '金额必须是有效的整数分'; end if;
 if value::bigint>10000000000 then raise exception '金额不能超过一亿元'; end if;
 return value::bigint;
end; $$;

create or replace function public.save_entry(p_entry jsonb,p_expected_version int,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.entries; saved public.entries; person public.profiles; uid uuid:=auth.uid(); teacher boolean:=private.is_teacher();
 eid uuid:=(p_entry->>'id')::uuid; result jsonb; d date:=(p_entry->>'date')::date; ed date:=coalesce((p_entry->>'end_date')::date,d);
 amt bigint:=private.money_value(p_entry->>'amount'); reimb bigint:=private.money_value(coalesce(p_entry->>'reimbursed','0'));
 kind_value text:=p_entry->>'kind'; cats text:=p_entry->>'category'; lines jsonb:=coalesce(p_entry->'items','[]'); item jsonb;
 total bigint:=0; trip boolean:=coalesce((p_entry->>'is_trip')::boolean,false); underground int:=coalesce((p_entry->>'underground_days')::int,0); wage bigint:=0;
begin
 if uid is null or eid is null or p_operation is null or p_expected_version is null then raise exception '请登录并提交完整账目'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 select r.result into result from private.receipts r where actor=uid and operation=p_operation;
 if found then return result; end if;
 perform pg_advisory_xact_lock(hashtextextended(eid::text,1));
 select * into person from public.profiles where id=(p_entry->>'owner_id')::uuid and role='student';
 if not found or (person.id<>uid and not teacher) then raise exception '无权修改此成员账目'; end if;
 if d is null or ed is null or ed<d or extract(year from d) not between person.start_year and person.end_year or extract(year from ed) not between person.start_year and person.end_year then raise exception '日期不在成员的在读年度内或结束早于开始'; end if;
 select * into old from public.entries where id=eid for update;
 if found then
  if old.owner_id<>person.id then raise exception '不能修改账目归属'; end if;
  if old.version<>p_expected_version then raise exception 'CONFLICT:账目已在另一台设备修改，请核对云端记录'; end if;
  if old.task_id is not null then raise exception '任务奖励随老师验收自动记账，不能单独修改'; end if;
  if old.allowance_month is not null or old.salary_month is not null then
   if not teacher then raise exception '工资及月度补助只能由老师修改'; end if;
   if d<>old.date or kind_value<>old.kind then raise exception '月度工资和补助不能更改所属月份或类型，请在月度发放中更正'; end if;
  end if;
 else
  if p_expected_version<>0 then raise exception 'CONFLICT:云端账目不存在'; end if;
  if kind_value='salary' then raise exception '固定工资请在月度发放中填写'; end if;
 end if;
 if not teacher and (kind_value not in('expense','reward') or coalesce(old.kind,kind_value) not in('expense','reward') or reimb<>coalesce(old.reimbursed,0)) then raise exception '工资、补助及报销确认只能由老师录入'; end if;
 if not teacher and coalesce(old.reimbursed,0)>0 then raise exception '已报销账目请联系老师更正'; end if;
 if jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)>50 then raise exception '一笔事务最多 50 项费用'; end if;
 if kind_value='expense' then
  if jsonb_array_length(lines)>0 then
   for item in select * from jsonb_array_elements(lines) loop
    if coalesce(length(trim(item->>'name')),0) not between 1 and 80 or coalesce(item->>'category','') not in('差旅费','版面费/文章开销','试剂耗材费','测试费','测试加工费','招待费','其他') then raise exception '费用明细名称或分类无效'; end if;
    total:=total+private.money_value(item->>'amount');
   end loop;
   if total<>amt then raise exception '费用合计与明细不一致'; end if;
   select case when count(distinct x->>'category')=1 then min(x->>'category') else '多项费用' end into cats from jsonb_array_elements(lines) x;
  elsif cats not in('差旅费','版面费/文章开销','试剂耗材费','测试费','测试加工费','招待费','其他') then raise exception '费用分类无效'; end if;
 else
  if trip or jsonb_array_length(lines)>0 then raise exception '只有科研支出可以包含出差与费用明细'; end if;
 end if;
 if trip then
  if underground<0 or underground>ed-d+1 or coalesce(p_entry->>'underground_days','0') !~ '^[0-9]+$' then raise exception '下井天数必须为整数，且不能超过出差天数'; end if;
  wage:=(ed-d+1)*12000+underground*6000;
 else underground:=0; end if;
 insert into public.entries(id,owner_id,date,end_date,kind,category,description,amount,funding,reimbursed,note,version,deleted,items,is_trip,underground_days,trip_wage,salary_manual)
 values(eid,person.id,d,ed,kind_value,cats,trim(p_entry->>'description'),amt,p_entry->>'funding',reimb,coalesce(p_entry->>'note',''),coalesce(old.version,0)+1,coalesce((p_entry->>'deleted')::boolean,false),lines,trip,underground,wage,old.salary_month is not null)
 on conflict(id) do update set date=excluded.date,end_date=excluded.end_date,kind=excluded.kind,category=excluded.category,description=excluded.description,amount=excluded.amount,funding=excluded.funding,reimbursed=excluded.reimbursed,note=excluded.note,version=excluded.version,deleted=excluded.deleted,items=excluded.items,is_trip=excluded.is_trip,underground_days=excluded.underground_days,trip_wage=excluded.trip_wage,salary_manual=excluded.salary_manual,updated_at=now() returning * into saved;
 result:=to_jsonb(saved);
 insert into private.receipts values(uid,p_operation,result);
 insert into private.audit_log(actor,action,entity,details) values(uid,'save_entry',eid,jsonb_build_object('before',to_jsonb(old),'after',result));
 return result;
end; $$;

-- 旧版 allowance 保留原日期、原金额。新固定工资从老师设置的生效月起生成。
create or replace function private.generate_allowances(p_owner uuid default null) returns int language plpgsql security definer set search_path='' as $$
declare n int;
begin
 perform pg_advisory_xact_lock(729194);
 insert into public.entries(owner_id,date,end_date,kind,category,description,amount,funding,note,salary_month)
 select p.id,m::date,m::date,'salary','固定工资','当月固定工资',coalesce((r.rates->>(p.degree||'_'||(p.grade+extract(year from m)::int-p.start_year)))::bigint,0),'team','按年级标准自动记账',m::date
 from public.profiles p cross join lateral generate_series(greatest(p.start_month,make_date(p.start_year,1,1)),least(date_trunc('month',now() at time zone 'Asia/Shanghai')::date,make_date(p.end_year,12,1)),interval '1 month') m
 cross join lateral(select rates from public.salary_rules where effective_month<=m::date order by effective_month desc limit 1) r
 where p.role='student' and (p_owner is null or p.id=p_owner) and coalesce((r.rates->>(p.degree||'_'||(p.grade+extract(year from m)::int-p.start_year)))::bigint,0)>0
 on conflict(owner_id,salary_month) do nothing;
 get diagnostics n=row_count;return n;
end; $$;

create or replace function public.save_monthly_payment(p_owner uuid,p_month date,p_kind text,p_amount bigint,p_expected_version int,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.profiles; old public.entries; saved public.entries; result jsonb;
begin
 if not private.is_teacher() then raise exception '仅老师可填写月度工资和补助'; end if;
 if p_operation is null or p_expected_version is null or p_amount is null or p_amount not between 0 and 10000000000 or p_kind is null or p_kind not in('salary','allowance') or p_month is null or extract(day from p_month)<>1 then raise exception '请选择有效月份、类型和非负金额'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 select r.result into result from private.receipts r where actor=auth.uid() and operation=p_operation;
 if found then return result; end if;
 perform pg_advisory_xact_lock(729194);
 select * into person from public.profiles where id=p_owner and role='student';
 if not found or extract(year from p_month) not between person.start_year and person.end_year then raise exception '请选择成员在读年度内的月份'; end if;
 select * into old from public.entries where owner_id=p_owner and (case when p_kind='salary' then salary_month else allowance_month end)=p_month for update;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'CONFLICT:该月份已被修改，请同步后重新打开表单'; end if;
 insert into public.entries(id,owner_id,date,end_date,kind,category,description,amount,funding,note,allowance_month,salary_month,salary_manual,version)
 values(coalesce(old.id,gen_random_uuid()),p_owner,p_month,p_month,p_kind,case when p_kind='salary' then '固定工资' else '月度补助' end,case when p_kind='salary' then '当月固定工资' else '当月补助' end,p_amount,'team','老师按指定年月确认',case when p_kind='allowance' then p_month end,case when p_kind='salary' then p_month end,p_kind='salary',coalesce(old.version,0)+1)
 on conflict(id) do update set amount=excluded.amount,deleted=false,version=excluded.version,salary_manual=excluded.salary_manual,updated_at=now() returning * into saved;
 result:=to_jsonb(saved);
 insert into private.receipts values(auth.uid(),p_operation,result);
 insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'save_monthly_payment',saved.id,jsonb_build_object('before',to_jsonb(old),'after',result));
 return result;
end; $$;

create or replace function public.save_salary_rules(p_month date,p_rates jsonb,p_expected_version int) returns void language plpgsql security definer set search_path='' as $$
declare k text; old public.salary_rules; next_month date; rec public.entries; amt bigint; person public.profiles;
begin
 if not private.is_teacher() then raise exception '仅老师可设置工资标准'; end if;
 if p_month is null or extract(day from p_month)<>1 or extract(year from p_month) not between 2000 and 2100 or jsonb_typeof(p_rates) is distinct from 'object' or p_expected_version is null then raise exception '生效月份或工资标准无效'; end if;
 foreach k in array array['master_1','master_2','master_3','doctor_1','doctor_2','doctor_3','doctor_4','doctor_5'] loop perform private.money_value(p_rates->>k); end loop;
 perform pg_advisory_xact_lock(729194);
 select * into old from public.salary_rules where effective_month=p_month for update;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'CONFLICT:工资标准已修改，请同步后重试'; end if;
 insert into public.salary_rules values(p_month,p_rates,coalesce(old.version,0)+1) on conflict(effective_month) do update set rates=excluded.rates,version=excluded.version;
 select min(effective_month) into next_month from public.salary_rules where effective_month>p_month;
 for rec in select * from public.entries where salary_month>=p_month and (next_month is null or salary_month<next_month) and not salary_manual and not deleted for update loop
  select * into person from public.profiles where id=rec.owner_id;
  amt:=private.money_value(p_rates->>(person.degree||'_'||(person.grade+extract(year from rec.salary_month)::int-person.start_year)));
  if rec.amount<>amt then
   update public.entries set amount=amt,version=version+1,updated_at=now() where id=rec.id;
   insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'salary_rate_recalculation',rec.id,jsonb_build_object('before',to_jsonb(rec),'new_amount',amt));
  end if;
 end loop;
 perform private.generate_allowances(null);
 insert into private.audit_log(actor,action,details) values(auth.uid(),'save_salary_rules',jsonb_build_object('before',to_jsonb(old),'effective_month',p_month,'rates',p_rates));
end; $$;

create or replace function public.save_settings(p_settings jsonb,p_stipends jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_teacher() then raise exception '仅老师可设置'; end if;
 if jsonb_array_length(coalesce(p_stipends,'[]'))>0 then raise exception '请刷新到研助表 2.0，在工资标准或月度发放中修改金额'; end if;
 update public.team_settings set team_name=trim(p_settings->>'team_name'),monthly_limit=private.money_value(p_settings->>'monthly_limit'),gap_limit=private.money_value(p_settings->>'gap_limit') where id=1;
 insert into private.audit_log(actor,action,details) values(auth.uid(),'save_settings',p_settings);
end; $$;

drop function public.list_tasks();
create function public.list_tasks() returns table(id uuid,title text,content text,reward text,category text,deadline date,status text,created_at timestamptz,taken boolean,my_claim boolean,reward_amount bigint) language sql stable security definer set search_path='' as $$
 select t.id,t.title,t.content,t.reward,t.category,t.deadline,t.status,t.created_at,exists(select 1 from public.task_claims c where c.task_id=t.id),exists(select 1 from public.task_claims c where c.task_id=t.id and c.student_id=auth.uid()),t.reward_amount from public.tasks t where exists(select 1 from public.profiles where profiles.id=auth.uid()) order by t.created_at desc;
$$;
create or replace function public.save_task(p_task jsonb) returns void language plpgsql security definer set search_path='' as $$
declare old public.tasks;
begin
 if not private.is_teacher() then raise exception '仅老师可发布任务'; end if;
 select * into old from public.tasks where id=(p_task->>'id')::uuid for update;
 if found and old.status='completed' then raise exception '已完成任务不能修改奖励'; end if;
 insert into public.tasks(id,title,content,reward,reward_amount,category,deadline) values((p_task->>'id')::uuid,trim(p_task->>'title'),trim(p_task->>'content'),trim(p_task->>'reward'),private.money_value(coalesce(p_task->>'reward_amount','0')),p_task->>'category',(p_task->>'deadline')::date)
 on conflict(id) do update set title=excluded.title,content=excluded.content,reward=excluded.reward,reward_amount=excluded.reward_amount,category=excluded.category,deadline=excluded.deadline;
 insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'save_task',(p_task->>'id')::uuid,jsonb_build_object('before',to_jsonb(old),'after',p_task));
end; $$;
create or replace function public.complete_task(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare task public.tasks; person public.profiles; d date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 if not private.is_teacher() then raise exception '仅老师可验收'; end if;
 select * into task from public.tasks where id=p_id for update;
 if not found then raise exception '任务不存在'; end if;
 if task.status='completed' then return; end if;
 select p.* into person from public.task_claims c join public.profiles p on p.id=c.student_id where c.task_id=p_id;
 if not found then raise exception '任务尚未被领取'; end if;
 if task.reward_amount>0 then
  if extract(year from d) not between person.start_year and person.end_year then raise exception '验收日期不在成员在读年度内，请先核对培养档案'; end if;
  insert into public.entries(owner_id,date,end_date,kind,category,description,amount,funding,note,task_id)
  values(person.id,d,d,'reward','任务奖金','任务奖金 · '||task.title,task.reward_amount,'team','老师验收后自动记账；不重复发放',p_id) on conflict(task_id) do nothing;
 end if;
 update public.tasks set status='completed' where id=p_id;
 insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'complete_task',p_id,jsonb_build_object('reward_amount',task.reward_amount,'student_id',person.id));
end; $$;

revoke execute on function private.money_value(text) from public,anon,authenticated;
revoke execute on function public.save_monthly_payment(uuid,date,text,bigint,int,uuid),public.save_salary_rules(date,jsonb,int),public.list_tasks() from public,anon;
grant execute on function public.save_monthly_payment(uuid,date,text,bigint,int,uuid),public.save_salary_rules(date,jsonb,int),public.list_tasks() to authenticated;
notify pgrst,'reload schema';


-- 研助表 2.1：在已升级 2.0 的数据库执行；可重复执行。

create table if not exists private.schema_versions(version text primary key, applied_at timestamptz not null default now());
create table if not exists private.v21_archive(entity text not null,id text not null,payload jsonb not null,primary key(entity,id));
create table if not exists public.annual_salary_rules(year int primary key check(year between 2026 and 2100),rates jsonb not null,version int not null default 1);
alter table public.annual_salary_rules enable row level security;
revoke all on public.annual_salary_rules from public,anon,authenticated;
grant select on public.annual_salary_rules to authenticated;
drop policy if exists annual_salary_read on public.annual_salary_rules;
create policy annual_salary_read on public.annual_salary_rules for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid()));
alter table public.entries add column if not exists allowance_manual boolean not null default false;
do $$ begin
 if not exists(select 1 from private.schema_versions where version='2.1') then
  insert into private.v21_archive select 'entries',id::text,to_jsonb(e) from public.entries e on conflict do nothing;
  insert into private.v21_archive select 'profiles',id::text,to_jsonb(p) from public.profiles p on conflict do nothing;
  insert into private.v21_archive select 'salary_rules',effective_month::text,to_jsonb(r) from public.salary_rules r on conflict do nothing;
  -- 一个年度多个旧标准时，以该年最后一次标准作为全年标准；修改前值保存在私有升级快照。
  insert into public.annual_salary_rules(year,rates)
   select distinct on(extract(year from effective_month)) extract(year from effective_month)::int,rates from public.salary_rules
   where extract(year from effective_month) between 2026 and 2100 order by extract(year from effective_month),effective_month desc on conflict do nothing;
  update public.entries set allowance_manual=true where allowance_month is not null;
  update public.profiles set start_month=greatest(date '2026-06-01',make_date(start_year,1,1)) where role='student';
 end if;
end; $$;
alter table public.entries drop column if exists funding;
alter table public.entries drop column if exists reimbursed;
alter table public.entries drop column if exists salary_manual;
revoke all on private.v21_archive,private.schema_versions from public,anon,authenticated;

create or replace function public.save_entry(p_entry jsonb,p_expected_version int,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.entries; saved public.entries; person public.profiles; uid uuid:=auth.uid(); teacher boolean:=private.is_teacher();
 eid uuid:=(p_entry->>'id')::uuid; result jsonb; d date:=(p_entry->>'date')::date; ed date:=coalesce((p_entry->>'end_date')::date,d);
 amt bigint:=private.money_value(p_entry->>'amount');
 kind_value text:=p_entry->>'kind'; cats text:=p_entry->>'category'; lines jsonb:=coalesce(p_entry->'items','[]'); item jsonb;
 total bigint:=0; trip boolean:=coalesce((p_entry->>'is_trip')::boolean,false); underground int:=coalesce((p_entry->>'underground_days')::int,0); wage bigint:=0;
begin
 if uid is null or eid is null or p_operation is null or p_expected_version is null then raise exception '请登录并提交完整账目'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 select r.result - 'funding' - 'reimbursed' - 'salary_manual' into result from private.receipts r where actor=uid and operation=p_operation;
 if found then return result; end if;
 perform pg_advisory_xact_lock(729194);
 perform pg_advisory_xact_lock(hashtextextended(eid::text,1));
 select * into person from public.profiles where id=(p_entry->>'owner_id')::uuid and role='student';
 if not found or (person.id<>uid and not teacher) then raise exception '无权修改此成员账目'; end if;
 if d is null or d<date '2026-06-01' or ed is null or ed<d or extract(year from d) not between person.start_year and person.end_year or extract(year from ed) not between person.start_year and person.end_year then raise exception '日期不在成员的在读年度内或结束早于开始'; end if;
 select * into old from public.entries where id=eid for update;
 if found then
  if old.owner_id<>person.id then raise exception '不能修改账目归属'; end if;
  if old.version<>p_expected_version then raise exception 'CONFLICT:账目已在另一台设备修改，请核对云端记录'; end if;
  if old.task_id is not null then raise exception '任务奖励随老师验收自动记账，不能单独修改'; end if;
  if old.salary_month is not null or old.kind='salary' then raise exception '固定工资由年度年级标准统一维护，不能按月单独修改'; end if;
  if old.allowance_month is not null then
   if not teacher then raise exception '工资及月度补助只能由老师修改'; end if;
   if d<>old.date or kind_value<>old.kind then raise exception '月度工资和补助不能更改所属月份或类型，请在月度发放中更正'; end if;
  end if;
 else
  if p_expected_version<>0 then raise exception 'CONFLICT:云端账目不存在'; end if;
  if kind_value='salary' then raise exception '固定工资请在年度年级标准中填写'; end if;
 end if;
 if kind_value='salary' then raise exception '固定工资由年度年级标准统一维护'; end if;
 if not teacher and (kind_value not in('expense','reward') or coalesce(old.kind,kind_value) not in('expense','reward')) then raise exception '补助只能由老师录入'; end if;
 if jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)>50 then raise exception '一笔事务最多 50 项费用'; end if;
 if kind_value='expense' then
  if jsonb_array_length(lines)>0 then
   for item in select * from jsonb_array_elements(lines) loop
    if coalesce(length(trim(item->>'name')),0) not between 1 and 80 or coalesce(item->>'category','') not in('差旅费','版面费/文章开销','试剂耗材费','测试费','测试加工费','招待费','其他') then raise exception '费用明细名称或分类无效'; end if;
    total:=total+private.money_value(item->>'amount');
   end loop;
   if total<>amt then raise exception '费用合计与明细不一致'; end if;
   select case when count(distinct x->>'category')=1 then min(x->>'category') else '多项费用' end into cats from jsonb_array_elements(lines) x;
  elsif cats not in('差旅费','版面费/文章开销','试剂耗材费','测试费','测试加工费','招待费','其他') then raise exception '费用分类无效'; end if;
 else
  if trip or jsonb_array_length(lines)>0 then raise exception '只有科研支出可以包含出差与费用明细'; end if;
 end if;
 if trip then
  if underground<0 or underground>ed-d+1 or coalesce(p_entry->>'underground_days','0') !~ '^[0-9]+$' then raise exception '下井天数必须为整数，且不能超过出差天数'; end if;
  wage:=(ed-d+1)*12000+underground*6000;
 else underground:=0; end if;
 insert into public.entries(id,owner_id,date,end_date,kind,category,description,amount,note,version,deleted,items,is_trip,underground_days,trip_wage)
 values(eid,person.id,d,ed,kind_value,cats,trim(p_entry->>'description'),amt,coalesce(p_entry->>'note',''),coalesce(old.version,0)+1,coalesce((p_entry->>'deleted')::boolean,false),lines,trip,underground,wage)
 on conflict(id) do update set date=excluded.date,end_date=excluded.end_date,kind=excluded.kind,category=excluded.category,description=excluded.description,amount=excluded.amount,note=excluded.note,version=excluded.version,deleted=excluded.deleted,items=excluded.items,is_trip=excluded.is_trip,underground_days=excluded.underground_days,trip_wage=excluded.trip_wage,allowance_manual=(public.entries.allowance_month is not null or public.entries.allowance_manual),updated_at=now() returning * into saved;
 result:=to_jsonb(saved);
 insert into private.receipts values(uid,p_operation,result);
 insert into private.audit_log(actor,action,entity,details) values(uid,'save_entry',eid,jsonb_build_object('before',to_jsonb(old),'after',result));
 return result;
end; $$;
create or replace function public.complete_task(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare task public.tasks; person public.profiles; d date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 if not private.is_teacher() then raise exception '仅老师可验收'; end if;
 select * into task from public.tasks where id=p_id for update;
 if not found then raise exception '任务不存在'; end if;
 if task.status='completed' then return; end if;
 select p.* into person from public.task_claims c join public.profiles p on p.id=c.student_id where c.task_id=p_id;
 if not found then raise exception '任务尚未被领取'; end if;
 if task.reward_amount>0 then
  if extract(year from d) not between person.start_year and person.end_year then raise exception '验收日期不在成员在读年度内，请先核对培养档案'; end if;
  insert into public.entries(owner_id,date,end_date,kind,category,description,amount,note,task_id)
  values(person.id,d,d,'reward','任务奖金','任务奖金 · '||task.title,task.reward_amount,'老师验收后自动记账；不重复发放',p_id) on conflict(task_id) do nothing;
 end if;
 update public.tasks set status='completed' where id=p_id;
 insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'complete_task',p_id,jsonb_build_object('reward_amount',task.reward_amount,'student_id',person.id));
end; $$;
create or replace function private.generate_allowances(p_owner uuid default null) returns int language plpgsql security definer set search_path='' as $$
declare n int;
begin
 perform pg_advisory_xact_lock(729194);
 with changed as (
 insert into public.entries(owner_id,date,end_date,kind,category,description,amount,note,salary_month)
 select p.id,m::date,m::date,'salary','固定工资','当月固定工资（支出）',coalesce((r.rates->>(p.degree||'_'||(p.grade+r.year-p.start_year)))::bigint,0),'年度年级标准自动记账；固定工资已包含在实际补助中',m::date
 from public.profiles p join public.annual_salary_rules r on r.year between p.start_year and p.end_year
 cross join lateral generate_series(greatest(date '2026-06-01',make_date(r.year,1,1),make_date(p.start_year,1,1)),least(date_trunc('month',now() at time zone 'Asia/Shanghai')::date,make_date(r.year,12,1)),interval '1 month') m
 where p.role='student' and (p_owner is null or p.id=p_owner)
 on conflict(owner_id,salary_month) do update set amount=excluded.amount,deleted=false,version=public.entries.version+1,updated_at=now(),description=excluded.description
 where public.entries.amount<>excluded.amount or public.entries.deleted
 returning id
 ) select count(*) into n from changed;
 return n;
end; $$;

create or replace function public.save_annual_salary(p_year int,p_rates jsonb,p_expected_version int) returns void language plpgsql security definer set search_path='' as $$
declare k text; old public.annual_salary_rules;
begin
 if not private.is_teacher() then raise exception '仅老师可设置年度工资标准'; end if;
 if p_year is null or p_year not between 2026 and 2100 or jsonb_typeof(p_rates) is distinct from 'object' or p_expected_version is null then raise exception '请选择有效年度并填写年级标准'; end if;
 foreach k in array array['master_1','master_2','master_3','doctor_1','doctor_2','doctor_3','doctor_4','doctor_5'] loop perform private.money_value(p_rates->>k); end loop;
 perform pg_advisory_xact_lock(729194);
 select * into old from public.annual_salary_rules where year=p_year for update;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'CONFLICT:年度标准已修改，请同步后重新打开'; end if;
 insert into private.audit_log(actor,action,details) values(auth.uid(),'save_annual_salary',jsonb_build_object('before',to_jsonb(old),'year',p_year,'rates',p_rates,'previous_entries',(select coalesce(jsonb_agg(e),'[]') from public.entries e where kind='salary' and extract(year from date)=p_year)));
 insert into public.annual_salary_rules values(p_year,p_rates,coalesce(old.version,0)+1) on conflict(year) do update set rates=excluded.rates,version=excluded.version;
 perform private.generate_allowances(null);
end; $$;

create or replace function public.save_salary_rules(p_month date,p_rates jsonb,p_expected_version int) returns void language plpgsql security definer set search_path='' as $$
begin raise exception '请刷新到 2.1，按年度设置固定工资，不再按月份设置'; end; $$;

create or replace function private.set_allowance(p_owner uuid,p_month date,p_amount bigint,p_expected_version int,p_manual boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.entries; saved public.entries; person public.profiles;
begin
 if not private.is_teacher() then raise exception '仅老师可填写补助'; end if;
 if p_amount is null or p_amount not between 0 and 10000000000 or p_expected_version is null or p_month is null or p_month<date '2026-06-01' or extract(day from p_month)<>1 then raise exception '请选择 2026 年 6 月起的有效月份和非负金额'; end if;
 select * into person from public.profiles where id=p_owner and role='student';
 if not found or extract(year from p_month) not between person.start_year and person.end_year then raise exception '请选择成员在读年度内的月份'; end if;
 select * into old from public.entries where owner_id=p_owner and allowance_month=p_month for update;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'CONFLICT:该月补助已修改，请同步后重新打开'; end if;
 insert into public.entries(id,owner_id,date,end_date,kind,category,description,amount,note,allowance_month,allowance_manual,version)
 values(coalesce(old.id,gen_random_uuid()),p_owner,p_month,p_month,'allowance','月度补助','实际月度补助（含固定工资）',p_amount,case when p_manual then '老师按个人设置' else '老师按年级统一设置' end,p_month,p_manual,coalesce(old.version,0)+1)
 on conflict(id) do update set amount=excluded.amount,deleted=false,allowance_manual=excluded.allowance_manual,version=excluded.version,updated_at=now(),description=excluded.description,note=excluded.note returning * into saved;
 insert into private.audit_log(actor,action,entity,details) values(auth.uid(),'set_allowance',saved.id,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
 return to_jsonb(saved);
end; $$;

create or replace function public.save_monthly_payment(p_owner uuid,p_month date,p_kind text,p_amount bigint,p_expected_version int,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_teacher() then raise exception '仅老师可填写补助'; end if;
 if p_operation is null or p_kind is distinct from 'allowance' then raise exception '这里只填写实际月度补助；固定工资按年度年级设置'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 select r.result into result from private.receipts r where actor=auth.uid() and operation=p_operation;
 if found then return result - 'funding' - 'reimbursed'; end if;
 perform pg_advisory_xact_lock(729194);
 result:=private.set_allowance(p_owner,p_month,p_amount,p_expected_version,true);
 insert into private.receipts values(auth.uid(),p_operation,result);
 return result;
end; $$;

create or replace function public.save_grade_allowance(p_month date,p_grade text,p_amount bigint,p_versions jsonb,p_include_individual boolean,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.profiles; old public.entries; results jsonb:='[]'; n int; changed int:=0; result jsonb;
begin
 if not private.is_teacher() then raise exception '仅老师可按年级设置补助'; end if;
 if p_operation is null or p_include_individual is null or p_month is null or p_month<date '2026-06-01' or extract(day from p_month)<>1 or p_grade is null or p_grade !~ '^(master_[1-3]|doctor_[1-5])$' or p_amount is null or p_amount not between 0 and 10000000000 or jsonb_typeof(p_versions) is distinct from 'object' then raise exception '年级、月份或金额无效'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 select r.result into result from private.receipts r where actor=auth.uid() and operation=p_operation;
 if found then return result; end if;
 perform pg_advisory_xact_lock(729194);
 -- Team registration uses the same lock to keep the reviewed recipient list stable.
 perform pg_advisory_xact_lock(729193);
 select count(*) into n from public.profiles p where p.role='student' and extract(year from p_month) between p.start_year and p.end_year and (p.degree||'_'||(p.grade+extract(year from p_month)::int-p.start_year))=p_grade;
 if n=0 then raise exception '该年月没有符合此年级的学生'; end if;
 if n<>(select count(*) from jsonb_object_keys(p_versions)) then raise exception 'CONFLICT:成员名单已变，请同步后重试'; end if;
 for person in select * from public.profiles p where p.role='student' and extract(year from p_month) between p.start_year and p.end_year and (p.degree||'_'||(p.grade+extract(year from p_month)::int-p.start_year))=p_grade order by p.id loop
  select * into old from public.entries where owner_id=person.id and allowance_month=p_month for update;
  if not(p_versions ? person.id::text) or (p_versions->>person.id::text) is null or (p_versions->>person.id::text) !~ '^[0-9]+$' or (p_versions->>person.id::text)::int<>coalesce(old.version,0) then raise exception 'CONFLICT:成员补助已修改，请同步后重试'; end if;
  if old.allowance_manual and not old.deleted and not p_include_individual then continue; end if;
  results:=results||jsonb_build_array(private.set_allowance(person.id,p_month,p_amount,coalesce(old.version,0),false));
  changed:=changed+1;
 end loop;
 result:=jsonb_build_object('changed',changed,'preserved',n-changed,'entries',results);
 insert into private.receipts values(auth.uid(),p_operation,result);
 return result;
end; $$;

-- Existing signup checks, role assignment and team capacity are preserved.
create or replace function private.profile_start_v21() returns trigger language plpgsql set search_path='' as $$
begin if new.role='student' then new.start_month:=greatest(date '2026-06-01',make_date(new.start_year,1,1)); end if; return new; end; $$;
drop trigger if exists profile_start_v21 on public.profiles;
create trigger profile_start_v21 before insert on public.profiles for each row execute function private.profile_start_v21();
revoke execute on function private.set_allowance(uuid,date,bigint,int,boolean),private.profile_start_v21() from public,anon,authenticated;
revoke execute on function public.save_annual_salary(int,jsonb,int),public.save_grade_allowance(date,text,bigint,jsonb,boolean,uuid) from public,anon;
grant execute on function public.save_annual_salary(int,jsonb,int),public.save_grade_allowance(date,text,bigint,jsonb,boolean,uuid) to authenticated;
select private.generate_allowances(null);
insert into private.schema_versions(version) values('2.1') on conflict do nothing;
notify pgrst,'reload schema';
commit;
