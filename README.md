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
``
## 官方参考

- [Vite：GitHub Pages 部署](https://vite.dev/guide/static-deploy#github-pages)
- [Supabase：行级权限](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [MDN：PWA 安装](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- 中文字体 Noto Sans SC 随包提供，按 `public/fonts/OFL.txt` 中的 SIL Open Font License 使用。
