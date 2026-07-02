# 代码可视化导览生成器设计方案

**Date**: 2026-07-02
**Status**: Review

## Overview

为 `noteWithAI` 设计一套“面向产品经理和接手研发”的代码可视化导览系统。该系统不是单纯的流程图，也不是只给开发者看的依赖图，而是一个可浏览的 HTML 导览站：先用业务语言解释系统如何运转，再允许用户逐层下钻到真实页面、Hook、接口、Controller、Service、Model 与外部依赖。

本方案采用“混合式生成器”路线：

- 自动从代码中扫描真实结构与关系
- 人工维护小白解释、业务含义、阅读顺序与风险提示
- 手动执行生成命令，产出静态 HTML 导览页面

## Goals

- 让产品经理能够看懂系统的核心模块、主要链路与数据流向
- 让接手项目的研发能快速定位到关键页面、接口、方法和文件
- 让导览成为源码阅读入口，而不是替代源码的第二套系统
- 让产物可以半自动更新，避免第一次整理后迅速失效
- 让同一套导览同时支持“小白模式”和“技术模式”

## Non-Goals

- 第一版不追求实时自动同步代码变化
- 第一版不做 AST 级别的超细粒度运行时还原
- 第一版不做完全自动生成的业务解释
- 第一版不做在线 CMS 或后台管理 explainers
- 第一版不尝试覆盖每一个内部变量、局部函数或微观实现细节

## Audience

导览的主要受众有两类：

- 产品经理或无代码基础读者：希望先理解“系统在做什么、为什么这么配合”
- 新接手项目的研发：希望在最短时间内知道“代码在哪里、入口在哪里、上下游是什么”

因此信息表达必须分成双层：

- 第一层使用白话解释、流程说明、业务含义
- 第二层展示真实代码位置、接口名、方法名、依赖关系

## Information Architecture

推荐使用 4 层结构，避免把整个项目塞进一张巨型流程图：

1. 首页总览
2. 模块页
3. 链路页
4. 节点详情页

### 首页总览

首页采用“混合式首页”：

- 上方展示系统地图，说明前端、后端、数据库、AI 服务与外部依赖之间的关系
- 中间展示业务入口卡片，例如登录注册、笔记、聊天、联想推荐、用户画像、Feed
- 下方提供技术分层速览，帮助技术读者快速进入前端、后端、数据层、AI 接入点

首页的目标不是承载全部细节，而是帮助用户决定“下一步点哪里”。

### 模块页

模块页按系统职责组织，例如：

- 认证模块
- 笔记模块
- 聊天模块
- 语义联想与推荐模块
- 用户画像模块
- Feed 模块

模块页需要回答三个问题：

- 这个模块解决什么业务问题
- 这个模块主要由哪些代码单元构成
- 这个模块和其他模块如何协作

### 链路页

链路页是整个导览的核心，按“用户动作 -> 前端 -> 接口 -> 后端 -> 数据/AI/缓存”的顺序组织。典型链路包括：

- 登录 / 注册
- 创建笔记
- 笔记语义联想
- 聊天发送消息
- 聊天结束后获取上下文相关笔记
- 用户画像分析
- Feed 内容推荐

每条链路上的节点都应同时呈现以下信息：

- 业务说明：这一步在产品层面起什么作用
- 代码定位：页面、Hook、接口、Controller、Service、Model 的真实名字
- 上下游关系：它由谁调用，又调用谁
- 外部依赖：MongoDB、Redis、Embedding、LLM、第三方接口在哪参与

### 节点详情页

节点详情页用于解释一个关键单元，例如 `useChatStream`、`chatService`、`recommendService` 或某个接口入口。

节点详情至少包含：

- 节点名称与类型
- 文件路径
- 关键方法名 / 接口名 / Symbol 名
- 白话解释
- 技术解释
- 上游节点与下游节点
- 所属模块与所属链路
- 风险点、失败影响和相关外部依赖

## Navigation And Interaction

推荐使用“工作台式首页 + 抽屉优先 + 必要时详情页”的交互模式。

### 全局布局

全局布局包含以下区域：

- 顶部：项目名称、全局搜索、模式切换、小白模式 / 技术模式、面包屑
- 左侧：业务模块导航与技术视角导航
- 中间：系统地图、链路图或主内容区
- 右侧：节点详情抽屉或信息面板

### 浏览方式

推荐的浏览方式如下：

- 首页进入业务模块或系统地图
- 在链路图上点击节点，优先通过右侧抽屉展示摘要
- 当用户需要查看更多内容时，再进入独立详情页

这样设计的原因：

- 减少频繁跳页，保留当前链路上下文
- 既满足快速理解，也支持深度阅读
- 让同一节点可以在多个链路里重复使用，而不用每次都跳到全新页面

### 搜索

全局搜索应支持按以下维度查找：

- 业务名称，例如“聊天”“联想推荐”
- 接口路径，例如 `POST /api/chat`
- 代码单元名，例如 `useChatStream`、`recommendService`
- 外部依赖名，例如 MongoDB、Redis、Embedding、LLM

搜索结果应可跳到：

- 对应链路页
- 对应模块页
- 对应节点详情页

## Generator Architecture

本方案采用“扫描代码结构 + explainers 补文案 + 生成 HTML”的生成器架构。

### 生成流程

推荐的生成流水线如下：

1. 扫描项目结构
2. 抽取结构节点
3. 建立节点关系
4. 合并人工解释
5. 生成 HTML 导览产物
6. 执行质量检查

### 推荐文件结构

尽量复用现有根目录 `scripts/doc-tools` 体系，避免引入新的分散入口：

```text
scripts/doc-tools/scan-architecture.js
scripts/doc-tools/build-architecture-html.js
scripts/doc-tools/check-architecture.js
scripts/doc-tools/explainers.json
docs/architecture-visual/ 或 public/architecture/
```

说明如下：

- `scan-architecture.js`：负责扫描代码结构并输出结构化数据
- `build-architecture-html.js`：负责把结构数据和 explainers 合并成 HTML
- `check-architecture.js`：负责检查断链、缺解释、无效路径、空页面等问题
- `explainers.json`：负责维护人工补充的解释文案、阅读顺序、友好标题和风险说明
- `docs/architecture-visual/` 或 `public/architecture/`：存放生成后的导览产物

## Data Model

### Node

Node 表示一个可被浏览和解释的代码单元或系统单元。支持的节点类型包括：

- 页面
- 组件
- Hook
- API 路由
- Controller
- Service
- Model
- 外部依赖

建议字段：

```ts
type ArchitectureNode = {
  id: string;
  type: 'page' | 'component' | 'hook' | 'route' | 'controller' | 'service' | 'model' | 'dependency';
  name: string;
  filePath?: string;
  symbolNames?: string[];
  moduleKey: string;
  layer: 'frontend' | 'backend' | 'data' | 'external';
  summaryPlain?: string;
  summaryTech?: string;
  tags?: string[];
};
```

### Edge

Edge 表示节点之间的关系，例如：

- 调用
- 依赖
- 读写
- 触发
- 返回
- 生成

建议字段：

```ts
type ArchitectureEdge = {
  from: string;
  to: string;
  relation: 'calls' | 'uses' | 'reads' | 'writes' | 'triggers' | 'returns' | 'depends_on';
  evidence?: string;
  confidence?: 'high' | 'medium' | 'low';
};
```

### Flow

Flow 表示一条完整业务链路，把多个节点按顺序组织起来。

建议字段：

```ts
type ArchitectureFlow = {
  key: string;
  title: string;
  moduleKey: string;
  entry: string;
  outcome: string;
  orderedNodeIds: string[];
  risks?: string[];
};
```

## Automatic Extraction Vs Manual Explanation

### 自动抽取

自动抽取负责收集“真实且稳定的结构信息”：

- 文件路径
- 目录分层
- 路由路径
- 关键方法名和导出符号名
- import / 调用线索
- Service、Controller、Model、Hook 等之间的直接关系
- 外部依赖接入点

### 人工补充

人工补充负责提供“机器不擅长稳定表达的业务信息”：

- 小白解释
- 产品价值
- 阅读顺序
- 术语翻译
- 风险提示
- 链路摘要

### 混合判断

以下信息建议采用“自动初稿 + 人工确认”的方式：

- 节点的人类友好标题
- 节点属于哪个业务模块
- 节点属于哪些链路
- 链路页的展示优先级

## Extraction Scope For This Project

针对 `noteWithAI`，第一版扫描范围建议覆盖以下目录：

```text
frontend/src/app
frontend/src/components
frontend/src/hooks
frontend/src/services
frontend/src/lib
backend/routes
backend/controllers
backend/services
backend/models
backend/config
backend/utils
```

原因如下：

- 目录层次清晰，天然适合做前端、后端、数据与外部依赖分层
- 聊天、笔记、推荐、画像等模块已经具备比较明确的职责边界
- 关键链路能较容易从现有代码中抽出，例如 `useChatStream` -> `/api/chat` -> `chatController` -> `chatService`

## Update Mechanism

更新机制采用“半自动更新”：

1. 研发在代码变更后手动运行生成命令
2. 扫描器重新生成结构数据
3. explainers 与结构数据合并
4. 构建新的 HTML 导览
5. 检查脚本输出质量问题
6. 人工预览确认后提交或分发

推荐增加以下命令：

```json
{
  "arch:scan": "node scripts/doc-tools/scan-architecture.js",
  "arch:build": "node scripts/doc-tools/build-architecture-html.js",
  "arch:check": "node scripts/doc-tools/check-architecture.js"
}
```

## Error Handling And Quality Checks

生成器需要能主动发现以下问题：

- 关键节点缺少小白解释或业务说明
- 链路引用了不存在的节点
- 节点详情页中的文件路径失效
- 某条链路页节点过多，超出推荐阈值，提示拆分专题
- 某个模块页没有任何链路或没有任何关键节点

检查脚本应输出“问题类型 + 位置 + 建议动作”，而不只是打印失败。

## Validation

### 面向产品经理的验收

- 能快速理解系统有哪些核心模块
- 能顺着一条链路看懂前端、接口、后端、数据库和 AI 的配合关系
- 能理解主要技术术语，不会因为纯技术命名而中断阅读

### 面向接手研发的验收

- 能通过搜索与导航快速跳到真实代码位置
- 能看到关键方法名、接口名和上下游关系
- 能把导览当作源码阅读入口，用来快速建立项目心智模型

### 面向维护者的验收

- 能手动重新生成最新导览
- 能在生成阶段发现明显断链和解释缺失
- 能在不改动整体框架的前提下增量补充节点和链路

## Risks And Constraints

- 静态扫描很难 100% 还原运行时真实行为，因此必须允许人工修正和补充
- 同一节点可能属于多个模块或多条链路，数据模型必须支持复用
- 首页和链路页如果塞入太多节点，会失去“导览”价值，必须设置显示层级和折叠策略
- 小白模式和技术模式必须共享同一份底层结构数据，避免出现两套不一致文档

## First Version Scope

第一版建议刻意收住边界，只保证以下能力：

- 全项目系统地图
- 核心业务模块入口
- 主要链路页
- 关键节点详情页
- 搜索、模式切换、面包屑
- 半自动生成与检查能力

第一版不做：

- 实时自动更新
- 运行时监控数据回放
- 自动生成全部 explainers
- 在线维护后台

## Open Questions

当前没有阻塞性的开放问题。后续进入实现计划阶段时，只需要进一步细化：

- 生成产物是放到 `docs/architecture-visual/` 还是 `public/architecture/`
- explainers 采用 JSON 还是更适合人工编辑的 Markdown / YAML
- 第一版链路是否先按“业务场景”组织，再补“技术专题”入口
