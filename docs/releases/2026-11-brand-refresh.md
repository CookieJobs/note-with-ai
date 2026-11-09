# 品牌图标换新发布与验收

日期：2026-11-10。状态：已完成生产发布与公网验收。用户于 2026-11-09 23:52 明确要求提交、推送并部署，部署流程参照本项目既有发布记录（Workbench 连接、服务器受限备份、候选检查后切换）。

## 实现范围

按用户提供的 1254×1254 蓝色折页渲染稿换新品牌图形：提取纸片本体为 726×726 透明 PNG 母版，移除白色背景与投影，保留折页卷曲、白色折面与渐变明暗；旧矢量母版 `notewithai.svg` 与 `src/app/icon.svg` 下线。界面统一组件 `BrandIcon` 改为加载 `/brand/icon-192.png`，浏览器标签页图标由 App Router 文件约定提供：`favicon.ico`（16/32/48px 多帧）、`icon.png`（192px，自动内容哈希）、`apple-icon.png`（180px 白底）。素材页与生成流程见 [品牌资源说明](../../frontend/public/brand/README.md)与[本轮预览目录](../../design-preview/brand-refresh-2026-11-09/README.md)。

前端构建只依赖新的 PNG 母版与生成脚本；后端源码、数据模型和接口未改，因此本次发布只构建并切换 frontend。

## 验证结果

- 本地独立验证：`npm run typecheck` 通过；Vitest 71 个测试文件、603 项测试通过；`/tmp` 副本生产构建成功（21/21 静态页）；生产服务 HTTP 与浏览器加载检查通过；重跑生成脚本后 10 个产物 sha256 与仓库文件完全一致，生成可确定性复现。
- 素材检查：母版与 7 个透明 PNG 尺寸、alpha 与四角透明正确；Apple 图标 180px 全不透明白底；`favicon.ico` 含 16/32/48 三帧 PNG；16/24/32/48px 缩放不做锐化，无白色描边。
- 生成脚本增加母版正方形与 alpha 通道断言，缺失时直接失败。

## 生产发布

- 发布代码：[`ab425f1dfc7130e61058d1681a9024f4b44adc3c`](https://github.com/CookieJobs/note-with-ai/commit/ab425f1dfc7130e61058d1681a9024f4b44adc3c)，已推送 `origin/main` 与 `origin/codex/notes-feed`。
- 前一线上提交：`c91ae3cc179642698d47df71d107330684984cec`（折叠纸 SVG 品牌版本，2026-11-08 23:54 上线）。切换前旧服务保持运行。
- 完成时间：2026-11-10 00:07（北京时间）。生产入口：[https://bloomy16.com](https://bloomy16.com)。
- 连接：按部署指南使用已登录 Workbench CLI；只读检查、备份、构建、候选、切换与公网验收均核对远端 JSON `exit_code`，并以独立状态文件确认耗时任务完成，未只依赖本地 CLI 退出码。
- 变更判断：仅前端资源与 `BrandIcon` 引用变化，线上后端镜像与源码版本一致，因此只重建、重启 `frontend`；Mongo、Redis、backend 容器保持运行未动。
- 备份：服务器受限目录 `backups/brand-ab425f1-20261109/` 保存前一提交、`.env`、`docker-compose.yml`、旧前后端镜像归档（83,874,570B）、Mongo archive（902,961B）及 SHA-256 校验；旧镜像另保留 `note-brand-rollback-frontend:ab425f1`、`note-brand-rollback-backend:ab425f1` 标签。发布未改动 `.env` 或 Compose 配置，未清理旧镜像、构建缓存或数据卷。
- 构建与候选：当次构建脚本在服务器受限目录生成并以 `nohup` 运行，独立日志与状态文件为 0；前端在生产机构建成功（Next.js 编译成功、21/21 静态页）。候选容器监听 `127.0.0.1:3106`，对 `/auth`、`/notes`、`/chat`、`/admin/login` 的图标 link、素材字节、旧 SVG 404 与深色品牌文字 CSS 检查通过。
- 切换：只重建 `frontend`；容器启动后 `/auth` 200、`/api/health` 200，验收脚本在 `:3000` 通过，候选容器清理。
- 公网验收：HTTPS 下 `/auth` 与 `/admin/login` 均输出 3 条图标 link；`favicon.ico`、`icon.png`、`apple-icon.png`、`/brand/icon-{16,24,32,48,180,192,512}.png` 与 `/brand/notewithai.png` 和仓库文件 sha256 逐字节一致；`/brand/notewithai.svg`、`/icon.svg` 返回 404；`/notes`、`/chat`、`/inspiration`、`/admin/login`、`/api/health` 均 200；浏览器实测品牌图 `naturalWidth=192`（渲染 48×48），页面无 4xx/5xx 资源。证据见[登录页公网截图](2026-11-brand-refresh/assets/public-auth.png)与[后台登录页公网截图](2026-11-brand-refresh/assets/public-admin-login.png)。
- 运行镜像：frontend `sha256:23270c77661186f6d83a111fe2c345e54acbe1f9a1e040da8aad2d8a07e79f0f`；backend `sha256:a66e0aaccf2b9f7c4aaba1388e7299b81b943cd084f06182a48790b16399b9f7`（未变）。候选镜像与运行镜像一致。
- 数据：发布前备份脚本导出的生产库含 81 篇笔记；本次没有数据库迁移、回填或恢复操作。
- 磁盘：发布后根分区剩余约 3.2G（92%）；按既有发布约定未清理旧镜像与构建缓存。

## 回滚

- 前端：以 `note-brand-rollback-frontend:ab425f1`（`sha256:ecd5ea9b6ca7a81cea931f92124f4b5953d30ec5b14bb24d77025693d7f97a41`）恢复旧前端容器，并在服务器 checkout 前一提交 `c91ae3c`；后端本次未变更，不需要回滚。
- 数据库不随一般代码回滚恢复，以免丢失发布后的新用户数据；不要执行删除数据卷的清理命令。
- 固定路径 `favicon.ico` 可能被浏览器长期缓存，回滚或发布后需要关闭旧标签页重开或强制刷新。
