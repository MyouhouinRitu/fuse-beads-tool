# UI 控件契约审计表

> 基线版本：0.5.0（弹窗体系、色板配置弹窗、编辑工具侧栏、快照改名、P0/P1/P2 界面统一等改动，2026-08）
>
> 目的：梳理当前界面各组件的实际行为与目标契约，作为后续统一按钮、菜单、弹窗、表单、异步反馈与无障碍行为的实施基线。
>
> 状态图例：✅ 已完成；🟡 部分完成；⬜ 待办

优先级约定：

- **P0**：行为 / 键盘 / 无障碍直接可见的问题，优先修复。
- **P1**：视觉与设计令牌统一。
- **P2**：契约测试与加固。

## 0. 通用弹层（popup.js / focus.js）

| 契约 | 当前状态 | 说明 |
| --- | --- | --- |
| 模态弹窗：`role="dialog" aria-modal="true"` + 标题关联 | ✅ | `#popup-dialog`、`#palette-dialog` 已具备 |
| Tab 焦点圈定与关闭后还原 | ✅ | focus.js 统一管理 |
| Escape = 取消 / 关闭 | ✅ | shortcuts.js 统一入口 |
| 点击遮罩 = 取消 / 关闭（登录门禁除外） | ✅ | popup / palette / doc / export 已接入 |
| Confirm / Prompt 返回 Promise | ✅ | popup.js |
| Enter = 确认（Prompt 输入框回车提交） | ✅ | popup.js keydown 处理 |
| 弹窗打开时锁定背景滚动 | ✅ | focus.js 计数锁定 / 释放 body overflow |

## 1. 菜单与组合框

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| `#btn-fix-menu` + `#fix-menu`（使用问题修复） | 点击开合；点击外部关闭；Escape 关闭；打开聚焦首项；↑↓ / Home / End 导航；Enter 执行；关闭后焦点还原 | 已按 Menu 契约实现（menu.js 统一管理） | Menu 契约 | ✅ |
| `#target-pixels` + `#target-pixels-btn` + `#target-pixels-menu`（像素量预设） | 输入可编辑；箭头开合菜单；↑↓ 高亮预设、Enter 应用、Esc 关闭、焦点留在输入框；点击外部关闭 | 已按 Combobox 契约实现（role=combobox / option、aria-expanded / controls / activedescendant）；箭头按钮已移除 aria-hidden（可聚焦元素不可对辅助技术隐藏） | Combobox 契约 | ✅ |

## 2. 弹窗与浮层

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| `#popup-dialog`（确认 / 输入） | popup.js 管理；Promise；Escape / 遮罩取消；Enter 确认；焦点圈定与还原；测试钩子 `__popupAutoConfirm` | 无背景滚动锁定 | Dialog 契约 + Enter 确认 | ✅ |
| `#palette-dialog`（色板配置） | 工具栏「色板配置」按钮打开；focus.js 管理；Escape / 遮罩 / 关闭按钮关闭；含固定表头颜色表；16 进制输入完整显示 | 无背景滚动锁定 | Dialog 契约 | 🟡 |
| `#doc-dialog`（文档） | focus.js 管理；Escape 关闭；点击遮罩关闭；已补 role / aria-modal / aria-labelledby | 已实现 | Dialog 契约 | ✅ |
| `#export-dialog`（导出） | focus.js 管理；Escape 关闭并重置；busy 遮罩 + 进度条；点击遮罩关闭；已补 ARIA | 重置逻辑仅在此实现（样板） | Dialog 契约 | ✅ |
| `#login-mask`（登录） | focus.js 管理；Escape 仅清错误；Enter 提交；已补 ARIA；withPending 防重复提交 | 已实现（强制弹窗例外） | Dialog 契约 + withPending | ✅ |
| `#quick-picker`（九宫格） | `<fieldset>`（group 语义）；Escape / 1-9 / 取消关闭；mouseleave 还原预览；关闭后还原焦点（可聚焦的触发元素） | 已改为非模态 Popover 语义（fieldset）；canvas 不可聚焦时焦点还原受限 | Popover 契约：非模态、不抢焦点、Esc / 选择 / 取消关闭、关闭后还原预览与焦点 | ✅ |
| `#toast` | 队列 + important / 普通分级；`role="status"`；success / error 样式变体 | 已实现 | 统一「何时 toast」规则 | ✅ |

## 3. 原生下拉 select

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| `#sel-distance`（颜色距离） | 自绘箭头，与目标像素量共用外观 | 与其它 select 不一致 | 所有 select 共用同一套外观：统一箭头、内边距、圆角与 focus 环 | 🟡 |
| `#empty-style`（透明色） | 原生 select，仅调整宽度 | 无自绘箭头，外观与 `sel-distance` 不一致 | 同上 | ⬜ |
| `#config-select`（色板配置） | 原生 select，未定制样式 | 浏览器默认外观 | 同上 | ⬜ |
| `#dlg-format` / `#dlg-empty-style` | 原生 select | 默认外观 | 同上 | ⬜ |

## 4. 按钮体系

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| default / `.primary` / `.danger` | 全局基础样式；disabled 统一 0.45 透明度；统一 `:focus-visible` 环 | 已实现 | 统一 variant + size + disabled + focus-visible 令牌 | ✅ |
| `.tool`（画笔 / 取色 / 橡皮 / 裁剪 / 魔棒） | `.active` 高亮；再次点击回到选择模式；`aria-pressed` 与 active 同步 | 已实现 | Toggle 按钮契约 | ✅ |
| `.tool-mini`（自动裁剪 / 应用等） | 使用 `--btn-pad-sm` 与 `--radius-sm` 令牌 | 已归入 size=sm 变体 | size=sm 变体 | ✅ |
| `.add-btn` / `.panel-expand` / `.dropdown-item` / `.del` / `.color-header` | 各自手写 padding / radius / hover | 同一页面存在多种按钮风格 | 统一为 variant × size；特殊布局样式收敛到令牌 | ⬜ |
| `.tab` / `.panel-toggle` | 已随侧栏改版移除 | 不再属于契约 | 删除相关条目 | ✅ |
| `#btn-theme` | 文案切换夜间 / 日间；`aria-pressed` 同步 | 已实现 | Toggle 按钮契约 | ✅ |

## 5. 折叠面板

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| 编辑工具面板头 `#left-panel-head` | button 标题头；点击收起 / 展开；`aria-expanded` / `aria-controls` 同步；收起显示竖向展开条 | 已实现 | 面板头 button + aria | ✅ |
| 颜色清单面板头 `#color-highlight-panel-head` | button 标题头；点击收起 / 展开；aria 同步 | 已实现 | 同上 | ✅ |
| 快照清单面板头 `#right-panel-head` | button 标题头；点击收起 / 展开；aria 同步 | 已实现 | 同上 | ✅ |

## 6. 表单控件

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| number 输入（目标像素量 / 每格大小 / 外边距） | 有 min / max，change 时收敛越界值 | focus 环与按钮不统一；无非法值提示 | 统一输入类 focus 环；非法值给 `aria-invalid` + 行内提示 | ⬜ |
| text / password（色号 / 名称 / hex / Token） | 基础样式 | 仅登录有行内错误，色表无校验反馈 | 表单错误契约：行内错误 + `aria-live` | ⬜ |
| 颜色表 16 进制输入 | 宽度 84px，完整显示 `#RRGGBB` | 已修复优先级覆盖问题 | 保持「完整显示」契约，测试断言 ≥80px | ✅ |
| checkbox（`.chk`） | accent-color 统一 | 无突出问题 | 保持，规范 label 绑定 | ✅ |
| range（颜色数量 / 画笔尺寸 / 魔棒容差） | input 实时更新 + 数值标签 | 宽度不统一（120 / 84 / 84） | 统一尺寸令牌 | ⬜ |

## 7. 异步操作与反馈

| 操作 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| 导出 | busy 遮罩 + 进度条 + 状态文案 | 已较完整 | 作为「异步操作样板」，抽出通用 pending 样式 | 🟡 |
| 登录 | withPending 防重复提交 + `aria-busy` | 已实现 | `withPending(trigger, task)` | ✅ |
| 导入图片 / 重新压缩 | withPending 防重复提交；成功 / 失败有 toast | 已实现（无进行中提示条） | 同上 + 成功 / 失败 toast | ✅ |
| 配置新建 / 导入 / 重命名 / 删除 | withPending 防重复提交；toast 反馈 | 已实现 | 同上 | ✅ |
| 打开 / 保存项目 | withPending 防重复提交；toast 反馈 | 已实现 | 同上 | ✅ |

## 8. 确认与输入

| 操作 | 当前行为 | 差异 / 问题 | 目标契约 | 状态 |
| --- | --- | --- | --- | --- |
| 删除配置 / 清空快照 / 删除快照 / 覆盖前确认 | popup.js 自绘确认弹窗；Escape / 遮罩取消；Enter 确认；Promise 返回 | 已实现（danger 视觉强调待 P1 统一） | ConfirmDialog 契约 | ✅ |
| 新建 / 重命名配置 | popup.js 自绘输入弹窗；Enter 提交；空值校验 + `aria-invalid` + 行内错误 | 已实现 | PromptDialog 契约 | ✅ |
| 删除正在使用的颜色 | 直接删除，不再弹确认 | 符合简化后的产品预期 | 已确认行为，写入契约 | ✅ |

## 9. 键盘 / 焦点 / ARIA

| 维度 | 当前行为 | 目标契约 | 状态 |
| --- | --- | --- | --- |
| Escape | 已按优先级处理（popup → palette → doc → 菜单 → export → login → quick-picker → 工具） | 菜单 / 弹窗 / quick-picker 已还原焦点；登录例外保留 | 统一：所有可关闭浮层关闭后还原焦点（登录例外） | ✅ |
| Tab | 弹窗内已循环；菜单支持方向键；面板头已是 button 可 Tab 到达 | 像素量箭头保持 `tabindex="-1"`（输入框即组合框触发器，属预期） | 全部控件可 Tab 到达，菜单支持方向键 | ✅ |
| 焦点环 | 输入框与按钮均有统一 focus-visible 环 | 已实现 | 全局统一 focus-visible 令牌 | ✅ |
| ARIA 角色 | 菜单 / 弹窗 / toggle / 面板头 / doc / export / login 已补齐 | 按上表逐项补齐 | ✅ |

## 10. 设计令牌 / 主题

| 维度 | 当前行为 | 目标契约 | 状态 |
| --- | --- | --- | --- |
| 颜色 | 基础变量 + surface-hover / surface-active / focus-ring / input-bg / btn-bg / border-strong / border-soft / danger-border / workspace-bg 令牌；主要硬编码已收敛 | 仅剩余极少量专用色（toast 成功/失败、滚动条等） | 迁移到令牌，暗色主题只改变量 | ✅ |
| 圆角 / 间距 | radius-xs / sm / md / lg 令牌已定义并用于按钮、弹窗、下拉、颜色行等 | 已收敛主要圆角；间距仍以局部值为主 | 定义 radius 与 spacing 刻度 | 🟡 |

## 11. 落地顺序（修订版）

1. **修订审计表**（本文档）：以当前代码为基线，标记已完成项。✅
2. **P0 行为契约**：popup 补 Enter 确认；菜单 / 组合框键盘与焦点还原；面板头改 button + ARIA；quick-picker 焦点还原。✅
3. **P0 反馈契约**：`withPending` 应用到登录、导入 / 重新压缩、配置增删改、打开 / 保存项目。✅
4. **P1 视觉令牌**：按钮 variant / size、select 统一样式、radius / spacing 令牌、暗色主题收敛。✅
5. **P2 测试**：新增 `tests/dom_contract_test.mjs`，把弹窗 ARIA、面板头 / toggle 状态、组合框键盘、确认弹窗校验、withPending 禁用、设计令牌存在性固化为用例。✅
