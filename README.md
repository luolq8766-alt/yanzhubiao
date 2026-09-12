# 研助表

供 **1 位老师 + 9 位学生** 使用的课题组财务与学习任务 PWA。手机浏览器打开 HTTPS 链接即可使用，可添加到 iPhone / Android 桌面。界面采用深蓝、青绿与简洁科研图表。

**当前交付是可运行源码与独立演示版，没有代建 GitHub 或 Supabase 账号，也没有连接真实财务数据。** 未配置云数据库时，页面明确显示“交互演示”；这时不同设备的数据不会共享。按下方步骤完成配置后，进入真实账号模式，演示切换器自动消失。

## 先体验

1. 安装 Node.js 22.12 或更高版本。
2. 在本项目目录打开终端：

```bash
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

3. 打开终端显示的本地链接。右上角演示身份选择器可切换老师和 9 名学生。
4. 演示数据在本机持久保存。正式部署后不导入演示数据。

## 功能

| 功能 | 实现 |
| --- | --- |
| 学生独立财务表 | 服务器 RLS + 受控 RPC；只能读写本人账目，老师读取全组 |
| 硕士 / 博士培养档案 | 硕士 3 年、博士 5 年；剩余年数 = 培养年限 − 当前年级 + 1 |
| 月度 / 年度报表 | 选择自然年与月份，可查看全年、月差额、年差额、全部在读年度累计差额 |
| 明细 | 日期、具体事务、类型、费用分类、金额、支付方式、已报销金额、备注 |
| 预算预警 | 每人单月支出、累计负差额；达到 80% 黄色、达到 100% 红色 |
| Excel / PDF | 原生 `.xlsx` 含数值单元格和汇总表；中文 PDF 自动分页，带签字栏 |
| 学习任务 | 老师发布内容与奖励，每项限 1 名学生；原子领取、可取消、老师验收 |
| 领取隐私 | 其他学生只能读领取状态，读不到领取者 ID、姓名或邮箱 |
| 自动定额 | 云端定时任务在北京时间每日 00:05 补齐当月记录；1 号生成新月份；重复运行不重记 |
| 可视化 | 分类饼图、年度月度趋势、科研支出/研助比、资金需求参考估算 |
| 净收入清算 | 补助与奖励 − 待报销垫付 − 个人承担费用 |
| 离线 | Service Worker 缓存应用；IndexedDB 保存账号缓存与持久待同步队列 |
| 多设备冲突 | 版本校验、请求幂等、冲突不覆盖；下载备份后由用户核对 |
| 手机使用 | 自适应布局、底部导航、独立窗口、Android/iOS 桌面图标 |

**培养年度解释：** 硕士 2 年级、第一份报表年份 2026，生成 2026 和 2027 年。当前实现为自然年制，非 9 月至次年 8 月的学年制。年份可以在初次登记时选择。定额记账起始月是登记当月或所选开始年份的 1 月（二者取较晚值），不会为入组前月份自动发放。

## GitHub 上线：一次配置，全组使用

GitHub Pages 提供前端 HTTPS 链接；Supabase 提供真实登录、数据库、访问权限和定时记账。单独上传静态网页无法让十个人安全共享账目。

### 1. 新建 Supabase 项目

到 [Supabase 控制台](https://supabase.com/dashboard) 创建项目。打开 **SQL Editor**，依次执行：

1. `supabase/schema.sql`：表结构、权限、业务函数。只需在新的项目执行一次。
2. `supabase/invite.example.sql`：先将示例邮箱换成 1 位老师和 9 位学生的真实邮箱，再执行。
3. `supabase/cron.sql`：定时生成每月定额收入。若未启用 Cron，先在项目中启用对应扩展。

**邀请名单只能在数据库管理端修改。** 学生无法通过注册表单把自己变成老师。所有注册账号必须完成邮箱验证后才能登记；公开的页面不等于公开的财务数据。

打开 **Project Settings → API / API Keys**（控制台名称可能更新），记录项目 URL 和公开的 **publishable key 或 legacy anon key**。绝不要把 `service_role`、secret key、数据库密码写入前端或 GitHub。

### 2. 上传项目源码到 GitHub

1. 新建仓库，例如 `yanzhubiao`，默认分支 `main`。
2. 解压代码包，将其中 `yanzhubiao` 文件夹**内部的文件**放在仓库根目录。根目录应直接出现 `package.json`、`src`、`supabase`、`.github` 等。
3. 不要只把 ZIP 文件上传到仓库：GitHub 不会自动解压。注意隐藏目录 `.github` 和隐藏文件 `.gitignore`、`.env.example` 也要上传。
4. 推荐通过 GitHub Desktop 添加文件夹并发布仓库，避免浏览器遗漏隐藏文件。
5. 不上传 `node_modules`、真实 `.env`、真实邀请邮箱名单、个人备份或任何财务数据。

### 3. 配置网页构建变量

仓库 **Settings → Secrets and variables → Actions → Variables**，新建两个 **Repository variables**（这里是 Variables，不是 Secrets）：

| 变量 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | 你的 Supabase 项目 URL，如 `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 公开 publishable key 或 legacy anon key |

这两个值会打包进浏览器代码，属于预期设计；权限安全由数据库角色、RLS 和函数内校验提供。没有配置这两个值时会构建成演示版。

仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

打开 **Actions → Deploy Yanzhubiao → Run workflow**。流程会安装依赖、运行测试、打包、发布。完成后，Pages 页面会给出类似 `https://你的用户名.github.io/yanzhubiao/` 的正式链接。

应用使用相对资源路径，兼容仓库子路径与根域名，不需要修改源码中的仓库名。

### 4. 配置登录邮件回跳

Supabase **Authentication → URL Configuration**：

- Site URL：填刚才的正式 Pages 链接，保留末尾 `/`。
- Redirect URLs：加入同一个完整链接；本机联调可另外加入本机地址。
- Email provider：开启邮箱验证；使用合适的 SMTP 发信服务或由管理员预先创建、确认成员账号。默认测试邮件服务的收件人与发送速率限制可能影响 10 人注册，按 Supabase 当前控制台说明配置。

老师和学生用各自被邀请的邮箱注册、验证、登录。首次进入填写姓名、硕博身份、当前年级、首份报表年份。老师账号会自动识别，硕博选项不影响老师角色。

### 5. 设置补助并核对

老师进入“设置”，为各成员填写每月金额，再设置单月支出与累计负差额阈值。首次设定金额会补齐记账起始月以来尚未生成的月份；后续改金额不回写已有月份。设置 0 表示停止生成新补助。

Supabase Cron 里查看 `yanzhu-monthly-allowance` 的最近执行状态。也可在 SQL Editor 执行：

```sql
select private.generate_allowances(null);
```

重复执行应返回 0 或仅补齐缺少的记录。Cron 的 UTC 表达式 `5 16 * * *` 对应北京时间次日 00:05，数据库唯一约束保证每位学生每月只有一条定额流水。应用打开后也会补齐，作为任务中断后的恢复措施。

**本项目只计算和记账，不连接银行卡、不执行真实转账。** 任务奖励也不会因验收自动变成收入；老师应在实际确认奖励时新增“任务奖励”记录，避免重复记账。

## 手机安装与离线

- iPhone / iPad：Safari 打开正式链接 → 分享 → 添加到主屏幕。
- Android：Chrome 或支持 PWA 的浏览器打开 → 菜单 → 安装应用 / 添加到主屏幕。
- 首次必须联网打开、登录并加载一次，等待同步完成。后台关闭后重新打开仍可读取当前账号已缓存的数据。
- 无网时可新增、编辑未报销账目，先存 IndexedDB。恢复网络且应用处于打开状态时会同步；切回前台、网络恢复和每分钟检查都会触发重试。
- iOS 不保证关闭应用后的后台运行，所以这里不承诺关掉应用后继续同步。领取任务、验收和改设置必须联网。
- PDF 字体首次按需下载（约 11 MB），第一次导出成功后会被本机缓存，随后可离线导出。Excel 依赖随应用预缓存。
- 浏览器可能在空间不足或清理网站数据时删除缓存。长期离线前先确认加载完成，重要未同步记录可用“导出本机备份”额外留存。
- 本机缓存只为本人设备设计；不要在多人共用设备长期保持登录。正式退出会清理该账号在本机的数据缓存，未同步时会阻止退出。

## 财务口径

金额全部以**整数分**存储和计算，导出为元，避免小数累计误差。

```text
本期研助收入 = 研助补助 + 已记账任务奖励
本期科研支出 = 个人垫付 + 个人承担 + 课题组支付的费用
月 / 年 / 总差额 = 对应期间的研助收入 - 科研支出
待报销 = 个人垫付金额 - 老师已确认报销金额
实际净收入 = 研助收入 - 待报销 - 个人承担费用
```

因此，“差额”用于观察科研投入与补助的关系，“净收入”用于观察学生资金周转，两者不是同一个指标。报销回款不再作为助研收入重复统计。报表中某个月的待报销金额反映该月支出**截至目前**的报销状态，不是该月月末的历史快照。

老师确认报销：进入对应账目的编辑表单，修改“已报销金额”。已发生报销的账目由老师维护；定额自动生成记录锁定，需调整时由老师新增说明清楚的额外补助记录或通过数据库审计更正。

当切换到全年汇总时，预算预警比较的是该年内**最高单月支出**，不会拿整年支出与一个月预算比较。

## 文件说明

```text
src/App.jsx             界面、学生/老师工作台与表单
src/styles.css          响应式视觉系统
src/domain.js           财务计算、培养年限、演示数据
src/store.js            登录、缓存、持久队列、版本冲突与同步
src/exports.js          Excel/PDF 生成
supabase/schema.sql     数据库与权限（含审计记录）
supabase/cron.sql       定时记账
supabase/invite.example.sql  管理端邀请名单模板
scripts/build-sw.mjs    生成带资源指纹的离线缓存
public/                 桌面图标、manifest、中文字体与许可证
.github/workflows/deploy.yml  GitHub 自动测试与部署
tests/                  财务公式、数据库权限与导出检查
```

## 验证与维护

```bash
pnpm test
pnpm test:db
node tests/exports.mjs
pnpm build
pnpm preview
```

数据库测试使用 PGlite 运行实际 SQL 和模拟 Auth 身份，覆盖权限、幂等、版本冲突、任务隐私与月度去重。它不替代真实 Supabase 邮件、跨设备网络、定时调度的上线验收。

正式交给全组前，用老师、学生 A、学生 B 三个账号各登录一次：A 新建支出 → 老师看到 → B 看不到；A 领取任务 → 老师看到 A 姓名 → B 只看到占用；A 飞行模式录入 → 重新联网打开 → 老师看到新记录。核对 Excel、PDF 与原始数据金额相同。

建议定期使用数据库提供的备份方式，并从老师账号导出年度 Excel/PDF。应用内 JSON 是人工恢复备份，**没有自动导入覆盖数据库的入口**。`private.audit_log` 保存账目修改前后值，可由数据库管理员调查和人工恢复。涉及培养年限调整，管理员应先核对历史账目，再在 SQL 中一致更新 `grade/start_year/end_year`，不要直接删除已记账账号。

当前为一个课题组设计，容量在数据库登记函数中限制为 10 人；如需多人课题组、多导师、多团队，应扩展表结构和 RLS，不能仅修改前端人数。

Supabase 项目的可用性、暂停、备份和邮件政策取决于你选用的计划；可参考当前控制台信息。需要在中国大陆环境使用时，请在实际学校网络与手机网络上验证 GitHub Pages 和 Supabase 的访问情况。

## 官方参考

- [Vite：GitHub Pages 部署](https://vite.dev/guide/static-deploy#github-pages)
- [Supabase：行级权限](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [MDN：PWA 安装](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- 中文字体 Noto Sans SC 随包提供，按 `public/fonts/OFL.txt` 中的 SIL Open Font License 使用。
