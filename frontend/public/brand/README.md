# NoteWithAI 折页品牌图标

`notewithai.svg` 是唯一 SVG 母版：蓝色圆角纸片、右下角浅蓝到白色的内折页；不含文字、边框或角色装饰。按 2026-11-08 提供的品牌参考图重建矢量，而非裁切展示稿。

- 100×100 画布，主体从 3 到 97；圆角半径 23（约为主体宽度的 24.5%）。
- 折页从 x=51.5、y=55 开始，内弯圆角约 17；下缘为向右上收起的斜边。
- 主色 #266FE1，蓝色主体有克制的明暗过渡；折页为 #F8FBFF / #C9DAFC / #9DBCF7 / #B8D1FF 渐变。
- Gaussian Blur 仅用于折页阴影和边缘光，并被纸片 / 折页轮廓裁切；背景透明，外轮廓不模糊。

运行 `npm --prefix frontend run brand:assets`，由已有 Next.js 依赖 sharp 生成：

| 资源 | 用途 |
| --- | --- |
| public/brand/icon-{16,24,32,48,180,192,512}.png | 保持同一比例的透明 PNG |
| src/app/icon.svg | 母版的生成副本，Next.js 自动生成 SVG 图标标签与内容哈希 |
| src/app/favicon.ico | 包含 16/32/48px PNG 的 ICO，Next.js 自动生成兼容图标标签 |
| src/app/apple-icon.png | 180px 不透明白色画布，居中 120px 图形，适配 Apple 主屏幕 |

文件约定是唯一图标元数据来源，根 layout 不再手写 icons。项目当前没有 Web App Manifest / PWA，192/512px PNG 仅作为后续可复用素材，不代表新增 PWA 功能。不要另外添加 public/icon.svg 或 public/favicon.ico，避免与 App Router 路径冲突。

界面统一使用 `src/components/brand/BrandIcon.tsx`，图形和 NoteWithAI 文字独立排版。修改母版后重新运行生成命令，不手改生成的图标。SVG 图标与 Apple 图标由 Next.js 更新哈希；部分浏览器仍长期缓存固定路径 favicon.ico，上线后可能需要关闭旧标签页并重新打开或强制刷新。
