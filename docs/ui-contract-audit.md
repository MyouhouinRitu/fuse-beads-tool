# UI 控件契约审计表

> 基线版本：0.4.1
>
> 目的：梳理当前界面各控件族的实际行为与目标契约，作为后续统一按钮、菜单、弹窗、表单、异步反馈与无障碍行为的实施基线。

优先级约定：

- **P0**：行为 / 键盘 / 无障碍直接可见的问题，优先修复。
- **P1**：视觉与设计令牌统一。
- **P2**：契约测试与加固。

## 1. 自定义菜单

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| `btn-fix-menu` + `#fix-menu`（使用问题修复） | 点击开关；点外部关闭；Escape 关闭；菜单项点击后关闭并打开文档弹窗 | 打开时焦点不进菜单；无 ↑↓ 导航；关闭后焦点不还原；无 `aria-activedescendant` | **Menu 契约**：打开聚焦首项；↑↓ / Home / End 导航；Enter 执行；Esc / 点外部关闭并还原焦点到触发器 |
| `#target-pixels-btn` + `#target-pixels-menu`（目标像素量预设） | 点击开关；点外部关闭；Escape 关闭；选择预设写入输入框 | 触发器 `tabindex="-1"`，键盘不可达；语义是「输入 + 预设」却使用 menu；依赖 stopPropagation 绕过 label 的 hack | **Combobox 契约**：输入框 `role="combobox"` + `aria-expanded` / `aria-controls`，预设项 `role="option"`；↑↓ 选择预设、Enter 应用、Esc 关闭、焦点留在输入框 |

## 2. 原生下拉 select

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| `#sel-distance`（颜色距离） | 原生 select，带自绘箭头 | 与其它 select 样式不统一 | 所有 select 共用同一套外观：统一箭头、内边距、圆角与 focus 环 |
| `#empty-style`（透明色） | 原生 select，仅调整宽度 | 无自绘箭头，外观与 `sel-distance` 不一致 | 同上 |
| `#config-select`（色板配置） | 原生 select，未定制样式 | 浏览器默认外观 | 同上 |
| `#dlg-format` / `#dlg-empty-style` | 原生 select | 默认外观 | 同上 |

## 3. 弹窗与浮层

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| `#doc-dialog`（文档弹窗） | focus.js 管理焦点陷阱与还原；Escape 关闭 | 无 `role="dialog"` / `aria-modal` / `aria-labelledby`；未锁定背景滚动 | **Dialog 契约**：`role="dialog" aria-modal="true"` + 标题关联；打开锁滚动；Esc 关闭并重置 |
| `#export-dialog`（导出） | focus.js 管理；Escape 关闭并重置状态；带 busy 遮罩 | 无 dialog ARIA；重置逻辑只在此实现，未推广 | 同上，作为「关闭必重置」的样板 |
| `#login-mask`（登录） | focus.js 管理；Escape 仅清错误；Enter 提交 | 与其它弹窗 Escape 规则不同（强制流程例外，需显式声明）；无 ARIA | 同上；契约中标注「强制弹窗例外」，错误行内展示 |
| `#quick-picker`（九宫格） | `role="dialog"` 但不走 focus.js；Escape / 1-9 / 取消关闭；mouseleave 还原预览 | 角色是 dialog 但无焦点管理，语义错位 | **Popover 契约**：非模态、不抢焦点、Esc / 选择 / 取消关闭，关闭后还原预览与焦点 |
| `#toast` | 有队列与 important / 普通分级，`role="status"` | 无成功 / 错误视觉分级 | 增加 success / error 样式变体，统一「何时 toast」规则 |

## 4. 按钮体系

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| default / `.primary` / `.danger` | 全局基础样式，disabled 统一 0.45 透明度 | 缺少统一 `:focus-visible` 环 | 统一 variant + size + disabled + focus-visible 令牌 |
| `.tool`（画笔 / 取色 / 橡皮 / 裁剪 / 魔棒） | `.active` 高亮；再次点击回到选择模式 | 无 `aria-pressed` | Toggle 按钮契约：`aria-pressed` 与视觉 active 同步 |
| `.tool-mini`（自动裁剪 / 应用等） | 手写小尺寸样式，disabled 重复声明 | 与其它小按钮不共享尺寸令牌 | 归入 size=sm 变体 |
| `.add-btn` / `.panel-toggle` / `.panel-expand` / `.tab` / `.dropdown-item` / `.qp-btn` / 历史项按钮 / `.del` | 各自手写 padding / radius / hover | 同一页面存在多种按钮风格 | 统一为 variant × size，特殊布局样式收敛到令牌 |
| `#btn-theme` | 文案切换夜间 / 日间 | 无 `aria-pressed` | Toggle 按钮契约 |
| 标签页 `.tab` | button + `.active` 类 | 无 `role="tab"` / `aria-selected` | 补 tablist / tab 角色，或至少统一 active 语义 |

## 5. 折叠面板

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| 左侧面板 | 真 button（toggle + expand） | 无 `aria-expanded` / `aria-controls` | 统一 button + aria 属性 |
| 颜色清单面板 | 可点击 div 头部 | 键盘不可达；无 aria | 头部改真 button，同步 `aria-expanded` |
| 事务历史面板 | 可点击 div 头部 | 同上 | 同上 |

## 6. 表单控件

| 控件 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| number 输入（目标像素量 / 每格大小 / 外边距） | 有 min / max，change 时收敛越界值 | focus 环与按钮不统一；无非法值提示 | 统一输入类 focus 环；非法值给 `aria-invalid` + 行内提示 |
| text / password（色号 / 名称 / hex / Token） | 基础样式 | 仅登录有行内错误，色表无校验反馈 | 表单错误契约：行内错误 + aria-live |
| checkbox（`.chk`） | accent-color 统一 | 无突出问题 | 保持，规范 label 绑定 |
| range（颜色数 / 画笔尺寸 / 魔棒容差） | input 实时更新 + 数值标签 | 宽度不统一（220 / 84 / 84） | 统一尺寸令牌 |

## 7. 异步操作

| 操作 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| 导出 | busy 遮罩 + 进度条 + 状态文案 | 已较完整 | 作为「异步操作样板」，抽出共用 pending 样式 |
| 登录 | 无 pending，按钮可重复点击 | 可连续提交 | **withPending(trigger, task)**：pending 时禁用按钮 + `aria-busy`，结束恢复 |
| 导入图片 / 重新压缩 | 无进行中提示，成功无反馈 | 压缩耗时但界面无反馈 | 同上 + 成功 / 失败 toast |
| 配置新建 / 导入 / 重命名 / 删除 | toast 反馈，无 pending | 可重复点击 | 同上 |
| 打开 / 保存项目 | toast 反馈，无 pending | 同上 | 同上 |

## 8. 确认与输入

| 操作 | 当前行为 | 差异 / 问题 | 目标契约 |
| --- | --- | --- | --- |
| 删除配置 / 清空状态 / 删除事务 / 覆盖前确认 | 浏览器原生 `confirm` | 与产品内弹窗割裂、不可主题化、阻塞式 | 自定义 ConfirmDialog：danger 强调、取消 / 确认、焦点陷阱、Esc = 取消、Promise 返回 |
| 新建 / 重命名配置 | 浏览器原生 `prompt` | 同上 | 自定义 PromptDialog：输入校验、Enter 确认、Esc 取消、焦点管理 |

## 9. 键盘 / 焦点 / ARIA

| 维度 | 当前行为 | 目标契约 |
| --- | --- | --- |
| Escape | 已按优先级处理，但 quick-picker 关闭后不还原焦点 | 统一：所有可关闭浮层关闭后还原焦点（登录例外） |
| Tab | 弹窗内已循环；菜单不可达；目标像素量箭头不可达；面板头不可达 | 全部控件可 Tab 到达，菜单支持方向键 |
| 焦点环 | 输入框有自定义环，按钮无统一 `:focus-visible` | 全局统一 focus-visible 令牌 |
| ARIA 角色 | 菜单有 role，弹窗缺 role，toggle 缺 `aria-pressed` | 按上表逐项补齐 |

## 10. 设计令牌 / 主题

| 维度 | 当前行为 | 目标契约 |
| --- | --- | --- |
| 颜色 | 基础变量已有，但大量组件硬编码 `#fff` / `#f0f4ff` / `#e5f0ff` | 迁移到 surface / surface-hover / border / focus-ring 等令牌，暗色主题只改变量 |
| 圆角 / 间距 | 4 / 5 / 6 / 7 / 8 / 10 / 12px 随机出现 | 定义 radius-sm / md / lg 与 spacing 刻度 |

## 11. 落地顺序

1. **P0 行为契约**：menu / combobox / dialog / popover 四套共享逻辑，替换目标像素量与 fix-menu，面板头改 button，补 ARIA 与焦点还原。
2. **P0 反馈契约**：`withPending` + 自定义 Confirm / Prompt，替换原生弹窗。
3. **P1 视觉令牌**：按钮 variant / size、select 统一样式、radius / spacing 令牌、暗色主题收敛。
4. **P2 测试**：新增「组件契约测试」，把 Esc 关闭、焦点还原、aria 属性、pending 禁用、确认弹窗行为固化为用例。
