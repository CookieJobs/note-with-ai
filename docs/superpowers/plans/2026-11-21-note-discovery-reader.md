# Note discovery reader implementation plan

> **For agentic workers:** Use superpowers:executing-plans for implementation.

**Goal:** Keep the blank chat focused on writing and give a discovery its own full-height reading view.

**Architecture:** Keep discovery reads, action locks and saved draft intents in the existing panel. The chat page provides the home composer renderer, and the panel switches between that home and a reading view without replacing the chat page. Browser history tracks local reading navigation. The approved standalone HTML prototype defines the home-to-reader-to-chat flow.

**Tech stack:** Next.js, React, SCSS modules, Vitest.

**Design:** [Approved reader prototype](../../../design-preview/note-discovery-reader/index.html).

- [x] Add tests for concise entry, returning to the draft, independent history, and source actions after navigation.
- [x] Implement compact summaries and a full-height reader inside the chat workspace. Move existing actions and evidence into that reader, leaving backend contracts intact.
- [x] Verify navigation, long-text overflow, draft/feedback/retry and existing chat guardrails with synthetic fixtures and the production build.

验证：前端 5 个测试文件共 112 项通过，类型检查和生产构建通过。合成 API 的 Chromium 验证覆盖 1440×900、1024×768、390×650 的短卡、长正文阅读、后退焦点、草稿保留及继续探索。
