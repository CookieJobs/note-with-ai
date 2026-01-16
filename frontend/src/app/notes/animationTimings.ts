// 统一的交互/动画延时（毫秒）
// 目的：
// - 保存后稍等再退出编辑态（给用户反应时间）
// - 关闭工作台后稍等再释放冻结并触发重排动画（让移动更清晰）
export const WORKSPACE_ANIM_DELAY_MS = 650;

// 布局提交合并窗口：把“新增笔记 + 关键词变更 + embedding 回填”等紧挨着的更新合并成一次重排
export const WORKSPACE_LAYOUT_BATCH_MS = 320;

// 工作台方块移动（FLIP / push）时长：与 .workspaceCell transform transition 对齐
export const WORKSPACE_MOVE_MS = 1120;

// 新增笔记“挤出来”入场时长：与 wsCrowdPopIn 对齐
export const WORKSPACE_ENTER_MS = 1040;

// 删除动画：先灰化，再碎裂消失（结束后才触发其它方块移动）
export const WORKSPACE_DELETE_GREY_MS = 320;
export const WORKSPACE_DELETE_SHATTER_MS = 1440;
export const WORKSPACE_DELETE_TOTAL_MS = WORKSPACE_DELETE_GREY_MS + WORKSPACE_DELETE_SHATTER_MS;

