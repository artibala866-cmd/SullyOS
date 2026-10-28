# 学习室 · 私聊授权和到点提醒隔离

实现位于 `utils/sullyWorkspace.ts`、`utils/workspacePrivateChat.ts`、
`apps/WorkspacePanel.tsx`、`utils/studyRoomReminders.ts` 和 `hooks/useChatAI.ts`。

## 授权规则

- `sully_workspace_v1` 仍保存在本机 IndexedDB assets，与旧自习室课程和番茄钟数据隔离；完整备份沿用原 assets 导出。
- `privateChatPermissions[charId]` 有 `study` 和 `commissions` 两个明确的布尔值，缺失、旧备份或非 true 值都视为 **关闭**。不同 Char 之间不继承权限。
- 仅 ChatApp 普通私聊在每一轮将要发送时读取该角色授权；同一轮的本地生成/即时对话共用同一份结果。不修改原先的 `ChatPrompts`、角色卡、世界书或 AMSG fire_pack。未授权时返回空块，连标题都不提供。
- 开启学习共享只包含课程名称、星期、上课时间、作业名称、截止时间和完成状态；画稿共享仅包含匿名序号、标准阶段、状态、日期和剩余时间；**不包含稿名**（稿名里也可能写客户姓名或订单号）。老师、地址、客户、约定价格、详细需求、委托备注、课程笔记、作业笔记及 PDF 原文始终不共享。列表有数量与字符长度上限。
- 用户主动点击学习室里的「问 Char」「提问」属于**另一次明确发给 AI 的请求**，不是正常私聊授权开关的后台读取。编辑内容不会由模型自动覆盖。
- 关闭授权立即阻断以后的 ChatApp 请求读取；已经向模型发送过的内容、已生成的回复和历史记忆**不会因此自动清除**。已经在发送中的请求也无法撤回。

## 关联提醒

- AMSG 2.0 固定提醒仍须逐项手工确认，默认不建立；不调用 AI 生成到点消息。
- 关闭某角色的一个共享分类时**先落库撤销共享**，再尝试取消该角色对应分类的固定提醒。不会触碰其他角色或其他分类。
- 远端取消失败、创建结果不明或者本地记录没有远端 UUID 时不能标成「已取消」：保留记录和任务身份，UI 显示数量、错误、AMSG 核查提示。绝不盲重试创建，以免幽灵任务或重复推送。
- 重新开启私聊共享**不会**自动恢复已取消的提醒；提醒和共享是两次分别的授权。

## 验收边界

`utils/workspacePrivateChat.test.ts`、`utils/workspacePrivateChat.wiring.test.ts`、
`utils/studyRoomReminders.test.ts` 覆盖权限、脱敏字段、读取时机与撤销后失败保留。
真机通知、远端 Worker 部署和在线 API 费用不包含在自动化测试中，
未经用户明确操作不得自动排程/部署或调收费模型。
