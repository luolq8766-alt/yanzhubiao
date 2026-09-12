-- 改成真实邮箱后在 Supabase SQL Editor 执行；角色只能在这里指定。
-- 请勿将真实邮箱名单上传到公开 GitHub 仓库。
insert into private.allowed_emails(email,role) values
 ('teacher@example.edu','teacher'),
 ('student1@example.edu','student'),
 ('student2@example.edu','student'),
 ('student3@example.edu','student'),
 ('student4@example.edu','student'),
 ('student5@example.edu','student'),
 ('student6@example.edu','student'),
 ('student7@example.edu','student'),
 ('student8@example.edu','student'),
 ('student9@example.edu','student')
on conflict(email) do update set role=excluded.role;
