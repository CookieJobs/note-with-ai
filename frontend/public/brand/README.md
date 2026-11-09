# NoteWithAI 折页品牌图标

`notewithai.png` 是唯一母版：蓝色圆角纸片、右下角白色卷起的折页；不含文字、边框或角色装饰。按 2026-11-09 用户提供的 1254×1254 渲染稿提取：保留纸片本体，移除白色背景与投影，得到透明 PNG。原稿中图形像素为 679×682，母版按该原始分辨率保存为 726×726 正方形，不做放大。

- 正方形透明画布，主体横向占 93.5%、纵向占 94%，四周留白约 3%，与旧图标在界面中的视觉体量一致。
- 纸片外轮廓取原图抗锯齿边缘，alpha 过渡约 1px；白底和投影全部移除，深色背景上不会出现灰边。
- 蓝色主体与白色折页的明暗来自原渲染稿本身，没有重新矢量描摹，以免手工重建丢失折页卷曲细节。
- 16/24/32/48px 采用直接从母版缩放的真彩 PNG，不做锐化，避免小尺寸出现白色描边。

运行 `npm --prefix frontend run brand:assets`，由已有 Next.js 依赖 sharp 从母版生成：

| 资源 | 用途 |
| --- | --- |
| public/brand/icon-{16,24,32,48,180,192,512}.png | 从母版缩放的透明 PNG；`icon-192.png` 供界面 BrandIcon 使用（最大展示 48px，保留高分屏余量），其余为复用素材 |
| src/app/icon.png | 192px App Router PNG 图标，Next.js 自动生成带内容哈希的图标标签 |
| src/app/favicon.ico | 包含 16/32/48px PNG 的 ICO，Next.js 自动生成兼容图标标签；浏览器标签页优先使用它 |
| src/app/apple-icon.png | 180px 不透明白色画布，居中 120px 图形，适配 Apple 主屏幕 |

文件约定是唯一图标元数据来源，根 layout 不再手写 icons。项目当前没有 Web App Manifest / PWA，192/512px PNG 仅作为后续可复用素材，不代表新增 PWA 功能。不要另外添加 `public/icon.svg` 或 `public/favicon.ico`，避免与 App Router 路径冲突。

界面统一使用 `src/components/brand/BrandIcon.tsx`，加载 `/brand/icon-192.png`；图形和 NoteWithAI 文字独立排版。修改母版后重新运行生成命令，不手改生成的图标。`icon.png` 与 Apple 图标由 Next.js 更新哈希；部分浏览器仍长期缓存固定路径 `favicon.ico`，上线后可能需要关闭旧标签页并重新打开或强制刷新。
