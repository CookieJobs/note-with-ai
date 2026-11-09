# 蓝色折页品牌换新与验证（2026-11-09）

本轮按用户提供的最终参考图（1254×1254，白底蓝色折页渲染稿）换新。只替换品牌资产、品牌露出与图标声明；保留原有品牌命名与排版。

## 修改文件

- 更新母版 `frontend/public/brand/notewithai.png`：从参考稿提取纸片本体，移除白底与投影，726×726 透明 PNG。
- 更新透明 PNG：同目录 `icon-{16,24,32,48,180,192,512}.png`，均由母版缩放生成。
- 更新 App Router 图标：`frontend/src/app/icon.png`（192px）、`favicon.ico`（16/32/48px）、`apple-icon.png`（180px 白底）。
- 删除旧矢量 `frontend/public/brand/notewithai.svg` 与 `frontend/src/app/icon.svg`。
- 更新 `frontend/scripts/generate-brand-assets.mjs`：改为从 PNG 母版生成（sharp，`palette:false` 真彩输出）。
- 更新 `frontend/src/components/brand/BrandIcon.tsx`：界面统一加载 `/brand/icon-192.png`。
- 更新 `frontend/public/brand/README.md`、`frontend/src/components/brand/README.md`、`frontend/src/app/README.md`。

## 关键决定

- 参考稿是带高光、卷曲与渐变阴影的渲染图，重新矢量描摹会明显损失折页细节，因此母版采用栅格 PNG，按原稿中纸片的原生分辨率保存（679×682 内容，726×726 画布，四周约 3% 留白）。
- 只移除白色背景与外部投影；纸片自身的明暗与折页白面保留。透明边缘由原图抗锯齿边界还原，并做 1px 级颜色外扩，深色背景上无灰边。
- 16/24/32/48px 直接由母版缩放，不做锐化，避免小尺寸出现白色描边。

## 验证记录

- `npm --prefix frontend run brand:assets` 重新生成全部图标；7 个 PNG 尺寸、透明通道与四角透明检查通过；`favicon.ico` 含 16/32/48 三帧 PNG；Apple 图标 180px 不透明白底。
- 独立验证全部通过：`npm run typecheck`；Vitest 71 个测试文件 / 603 项测试；`/tmp` 副本 `next build` 成功（21/21 静态页，未触碰开发服务占用的 `.next`）；生产服务上 `/auth`、`/admin/login` 图标 link 与资源 HTTP 200、浏览器实际加载正常。另用第二份副本重跑 `brand:assets`，10 个产物 sha256 与仓库文件全部一致，生成可复现。
- 本地开发服务实际页面检查：`/auth` 与 `/admin/login` 品牌图形加载为 192px 源图、页面渲染正常；HTML 输出 `favicon.ico`、带内容哈希的 `icon.png`（192×192）与 `apple-icon.png`（180×180）三个图标标签，资源均 HTTP 200。
- 本目录 `preview.png` 为素材页截图，`auth.png` / `admin-login.png` 为真实页面截图（Next dev，1280×800）。

## 缓存与部署

`icon.png` 与 Apple 图标路径由 Next.js 附加内容哈希，更新后会自动换 URL；固定路径 `favicon.ico` 可能被浏览器长期缓存，线上发布后需要关闭旧标签页重新打开或强制刷新。源码修改需重新构建并替换前端容器后才在线上生效；后端与数据模型未改。
