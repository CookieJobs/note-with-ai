# 蓝色折页品牌集成与验证

本轮按用户提供的最终参考图实施；SVG 从几何与渐变重建，不使用展示稿裁切。只修改品牌资产、品牌露出及图标声明；本文记录本地验证，线上状态需另行验收。

## 修改文件

- 新增母版 `frontend/public/brand/notewithai.svg` 及资源说明 `frontend/public/brand/README.md`。
- 新增透明 PNG：同目录 `icon-16.png`、`icon-24.png`、`icon-32.png`、`icon-48.png`、`icon-180.png`、`icon-192.png`、`icon-512.png`。
- 新增 App Router 图标 `frontend/src/app/icon.svg`、`favicon.ico`、`apple-icon.png`。
- 新增共享组件 `frontend/src/components/brand/BrandIcon.tsx` 及 README。
- 新增 `frontend/scripts/generate-brand-assets.mjs`；`frontend/package.json` 增加 `brand:assets` 命令。
- 删除旧 `frontend/public/icon.svg`；`frontend/src/app/layout.tsx` 删除手动 `metadata.icons`，更新文件注释。
- 工作区：`frontend/src/components/workspace/WorkspaceShell.tsx`、`Workspace.module.scss`、README。
- 独立导航：`frontend/src/components/TopNavigation.tsx`、`TopNavigation.module.scss`。
- 认证：`frontend/src/app/auth/page.tsx`、`auth.module.scss`，覆盖登录 / 注册 / 密码重置；`login` 和 `register` 原有重定向未改。
- 后台：`frontend/src/app/admin/components/AdminShell.tsx`、`admin/login/page.tsx`、`admin/admin.module.scss`。
- AI 回答身份：`frontend/src/components/ChatMessage.tsx`。
- 更新 `frontend/src/app/README.md`、`frontend/src/components/README.md`。
- 本验收目录包含素材检查页 `index.html`、实际认证页截图 `auth.png`、后台登录截图 `admin-login.png`。

## 验证结果

- 前端 typecheck 通过；71 个测试文件、603 项测试通过，覆盖现有认证、笔记、聊天、后台及工作区回归。
- 独立复制前端到 `/tmp/nwai-brand-production`，复用已有依赖，执行生产构建成功，未改动开发服务使用的 `.next`。
- 生产构建有 `<img>` 和 Hook 依赖 lint 警告（包含本次直接展示本地 SVG 的 BrandIcon 提示），不是零警告构建。
- `check:route-budgets` 通过；`git diff --check` 通过。
- 母版与 App Router SVG 副本字节一致；ICO 二进制验证含 16/32/48px PNG；7 个透明 PNG 尺寸、alpha 和 Apple 180px 白底均检查通过。
- 使用真实 standalone 服务（3107 端口）验证 `/auth`、`/notes`、`/chat`、`/admin/login` 均生成 3 个图标链接：ICO、带内容哈希的 SVG、带内容哈希的 Apple PNG；全部 HTTP 200，SVG 内容与母版一致。
- 浏览器实际检查登录、注册、重置密码与后台登录；认证 Logo 加载成功，48×48，无拉伸。未执行真实登录、验证码发送、笔记保存或模型调用；登录后各工作区页面未逐页浏览。现有业务回归由上述测试覆盖。
- 16/24/32px PNG 已逐一目视检查。新增浅 / 深背景与多尺寸素材页；该页自动浏览器检查因连接超时未完成，实际认证与后台截图已保存。

## 缓存、PWA 与部署

项目使用 Next.js 15.5.21。采用 App Router 文件式图标元数据，不再同时手动声明 icons。项目没有现有 Manifest，不新增 PWA 功能；192/512px 是可复用素材。

源码修改需要重新构建并替换前端 Docker 容器后才在线上生效，线上发布需独立核对候选版本与实际容器。SVG / Apple 路径由 Next.js 附加内容哈希；固定 favicon.ico 可能被浏览器缓存，部署后可强制刷新或关闭旧标签页重新打开。后端和数据模型未改。

## 深色认证页修正

深色主题下品牌文字曾继承 #1D1D1F，与 #1C1C1E 卡片对比约 1.01:1；不可见文字仍占位，使图形看似偏左。深色 `.brandLogo` 与标题统一为 #F5F5F7，对比提升至 15.63:1，保留原有 flex 整组居中。该值由实际 SCSS 编译后计算验证；浅色为 16.83:1。
