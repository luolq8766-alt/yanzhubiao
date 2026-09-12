# 研助表 2.0

供 **1 位老师 + 9 位学生** 使用的财务与学习任务 PWA。Chrome / Safari 打开 HTTPS 链接后可添加到安卓、iPhone 桌面。前端 React + Vite，数据库 Supabase，网站部署到 GitHub Pages。

**已经使用 1.0 的用户：先读 [升级指南-v2.0.md](./升级指南-v2.0.md)。执行专用升级 SQL，再更新 GitHub 源码；不要重新初始化数据库。**

## 2.0 功能

- 教师按成员、年月填写并更正月度补助，2000 改 4000 直接替换，版本检查防止并发覆盖。
- 按硕士 / 博士各年级设置固定工资与生效月，定时自动入账；某月可单独更正，保留审计。
- 学生收入与教师团队支出分别汇总；固定工资、月度补助、出差工资、奖金分开显示。
- 单次事务填写日期范围、多项费用；允许 0 元，包含招待费。
- 出差含往返当天，工资 120 元/天，下井另加 60 元/天；下井天数由学生填写、服务端校验。关联工资随事务修改和删除。
- 学生手动登记奖金；任务现金奖励由老师填写数字金额，老师验收后自动记账且不重复。其他学生看不到领取者身份。
- 一键下载真正的 Excel `.xlsx`，含财务明细、成员汇总和费用分项；保留中文 PDF 导出。
- 月、年、全部培养年度差额，个人垫资与净收入清算，费用饼图与年度趋势。
- 本机 IndexedDB + 离线持久队列，联网同步，幂等请求与版本冲突保护。

## 本机运行

需要 Node.js 22.12 或更高版本、pnpm 11.19.0。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

未配置 `.env` 时为独立演示版，示例数据仅保存在本机，可切换师生身份。正式部署配置云数据库后，演示切换器自动消失。

此电脑源码在 `F:\矿大\课程作业\研助表`。已构建的版本可双击“启动研助表.cmd”打开。此地址仅供本机预览；团队成员使用 GitHub Pages 正式链接。

## 全新项目上线

### 1. 初始化新的 Supabase 项目

在 SQL Editor 依次执行：

1. `supabase/schema.sql`：仅全新空数据库执行一次，已包含 2.0 功能。
2. `supabase/invite.example.sql`：先把示例邮箱改成老师和学生的真实邮箱；不要把真实名单上传公开仓库。
3. `supabase/cron.sql`：设置每天北京时间 00:05 补齐工资；每月 1 号产生新月份记录，应用上线同步也会补齐。

**已有项目不执行上述初始化流程，而执行 `supabase/migrations/202609120001_v2.sql`。** 当前是 SQL Editor 部署方式，不直接使用 `supabase db reset` 或把增量文件当成从零建库的 CLI 迁移链。

老师身份由服务器邀请名单决定，学生不能自行提升权限。开启邮箱验证；注册必须使用被邀请的邮箱。管理员设置受数据库函数保护，学生只能操作本人允许的账目。

### 2. 上传 GitHub

把完整源码包解压后的**内部文件**放到仓库根目录，根目录直接包含 `package.json`、`src/`、`public/`、`supabase/`、`scripts/`、`tests/` 和 `.github/`。

不要只上传 ZIP，也不要把文件夹中的文件全部摊到根目录。真实入口是 `src/main.jsx`。不上传 `node_modules`、`dist`、真实 `.env`、备份和个人财务数据。推荐 GitHub Desktop，以免遗漏隐藏文件。

### 3. 配置构建变量与 GitHub Pages

仓库 Settings → Secrets and variables → Actions → **Variables**，添加 Repository variables：

| 名称 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://你的项目ID.supabase.co`，不带 `/rest/v1/` 或 `/auth/v1/` |
| `VITE_SUPABASE_ANON_KEY` | 公开 publishable key 或 legacy anon key |

不能使用管理员 secret、service_role 或数据库密码。公开前端使用公开 key 是预期行为，数据隔离由 RLS 和受控 RPC 提供。

Settings → Pages → Source 选择 **GitHub Actions**。进入 Actions → **Deploy Yanzhubiao** → Run workflow。上传到 main 后也会自动运行。绿色完成后使用 Pages 提供的 HTTPS 链接。

### 4. 邮件回跳和注册

Supabase Authentication → URL Configuration：Site URL 与 Redirect URLs 都填写正式 Pages 地址，保留末尾 `/`。

邮件验证用于正式成员注册，默认测试邮件服务的收件人与速率有限。正式使用请配置合适的 SMTP，或由管理员预先创建并确认成员账号。默认邮件测试收件名单与本项目的学生邀请名单不是一回事。

### 5. 登记档案并设置工资、补助

学生填写姓名、硕博身份、当前年级和首份报表年份。例如硕二、2026，报表年份为 2026 和 2027。当前是**自然年度制**，年级按首份报表年推算，每年 1 月加 1；不自动按 9 月晋级。

老师在“设置 → 按年级设置固定工资”填写各年级标准和生效月；每月补助在“按月发放与更正”中逐月登记。工资从成员记账起始月生成，早期在读月份可以单独补录。调标准时会重算适用期间的自动工资，手动更正过的月份不被覆盖。具体操作、旧数据迁移、截图问题核对见升级指南。

## 财务计算

金额以整数分保存，界面和导出按元显示。

```text
学生收入 = 固定工资 + 补助 + 出差工资 + 奖金
科研费用 = 个人垫付 + 个人承担 + 课题组直接支付
月 / 年 / 总差额 = 学生收入 − 科研费用
待报销 = 个人垫付 − 老师确认报销金额
个人实际净收入 = 学生收入 − 待报销 − 个人承担
团队已记账支出 = 学生收入 + 课题组直接支付 + 已确认报销
团队费用（含待报销）= 团队已记账支出 + 待报销
出差工资 = （结束日期 − 开始日期 + 1）× 120 元 + 下井天数 × 60 元
```

跨月事务的全部费用和关联工资归开始日期所在月，不按天拆分。事务内各项费用共用同一支付方式；不同支付方式请分笔。报销不重复计入学生收入；各月的报销统计反映原支出截至当前的状态，不是当月银行现金流。

所有工资、补助和奖金都是记账数据，**不会执行真实银行转账**。预算预警仍比较每人单月科研费用和累计负差额；全年视图使用最高单月费用比较阈值。

## 手机与离线

- iPhone：Safari 打开正式链接 → 分享 → 添加到主屏幕。
- Android：Chrome 打开 → 安装应用 / 添加到主屏幕。
- 首次联网登录并完成一次同步后，可读取缓存并离线记账。恢复网络、切回前台或每分钟检查时同步；iOS 关闭应用后不保证后台运行。
- 月度工资/补助管理、工资标准、任务领取和验收需要在线确认。普通支出和自填奖金支持离线队列。
- 未同步记录不要清理网站数据；先导出本机 JSON 备份。JSON 没有自动覆盖数据库的导入入口。
- Excel 直接下载 `.xlsx`；微信内置浏览器拦截下载时请改用 Safari / Chrome。PDF 第一次导出需联网加载中文字体，之后字体可缓存。
- 多设备冲突不会覆盖云端记录，先保存本机备份，再在待同步列表核对并放弃冲突副本。

## 验证

```bash
pnpm test
pnpm test:db
node tests/exports.mjs
pnpm build
pnpm preview
```

测试覆盖日期、金额、统计、离线队列、数据库权限、月度更正、工资标准、任务奖励幂等，以及 1.0 数据升级和重复升级。PGlite 使用模拟 Auth，不替代真实 Supabase 邮件、Cron 与多人手机实测。详见 [验收说明.md](./验收说明.md)。

文件：`src/Payroll.jsx` 是工资与补助设置；`src/domain.js` 为计算；`src/store.js` 为同步；`src/exports.js` 为导出。`supabase/schema.sql` 为新库初始化；`supabase/migrations/202609120001_v2.sql` 为旧库升级。

## 官方参考

- [GitHub 添加和更新文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Supabase 数据库迁移](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase 行级权限](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Cron](https://supabase.com/docs/guides/cron)

中文字体采用 SIL Open Font License，许可证在 `public/fonts/OFL.txt`。请定期做数据库备份。GitHub Pages / Supabase 的连通性、免费额度、暂停和邮件规则取决于服务商，实际学校和手机网络需自行核对。
