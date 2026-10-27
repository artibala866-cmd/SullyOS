# SullyOS 六模块生活闭环成熟化：代码核实与阶段交接（2026-10-28）

> 本文是 **阶段 0 / 阶段 1 的源码审计记录**，不是体验验收证书。不得以此推定已完成整个成熟化项目。
>
> 基线：`remove-checkphone-vrworld-lifesim` @ `8d59f18a0fa657c462e622af86a8831b86f447a8`。本轮改动从该提交创建独立分支，不合入 `master`，不触及其他进行中的 3D PR。

## 产品边界（须保留）

- 主要闭环严格限定：**日程、真人感、私聊、记忆宫殿、查手机、主动消息**。
- 查手机查看的是 **Char 自己的手机**；Char↔NPC 手机微信和 Char→User 主动消息不是同一收件人/通道。
- 主功能既有的手动/自动选择应当保留；次要应用不得强制自动化。
- 不增加第二套自主生活引擎，不复制参考 MarshmallowMachine APK 的源码或 UI。
- 优先修复已有数据链上的断点，保持用户的原数据、开关值和单项手动生成入口。

## 已核实的实际代码关系

| 职责 | 仓库入口/读写 | 审计判断 |
| --- | --- | --- |
| 当日计划上下文（**计划不是事实**） | `utils/characterLifeScheduleContext.ts` → `utils/dailySchedule.ts`, `utils/scheduleTime.ts`; `readCharacterLifeEvents` 读已确认事件 | 已有分离结构；实际活动覆盖计划的优先级仍待场景检查 |
| 私聊及 Char 上下文 | `apps/Chat.tsx`, `hooks/useChatAI.ts`, `context/OSContext.tsx` → `utils/characterPhoneContext.ts` | 既有调用；最新分支包含 10 月 27 日时间感知修复，避免回退 |
| User 私聊镜像到 Char 微信 | `utils/characterPhonePrivateSync.ts`: `mirrorPrivateChat`，保留来源消息 ID | 已有实现；未做实机持久化验收 |
| NPC 联系人、微信会话及手动批量 | `utils/characterPhoneNpcs.ts`, `utils/characterPhoneChats.ts`, `components/chat/CharacterPhone.tsx` 的 `generateInbox` | 已有增量更新/同轮朋友圈/手动入口；仍待重载、并发和部分成功测试 |
| 私聊同轮附带手机记录 | `utils/phoneChatPiggyback.ts` → `extractChatPhoneEvents`, `applyChatPhoneEvents` | 已有可选机制；不能视为默认自动开启 |
| 手机生活事件的权威写入 | `utils/characterLifeEvents.ts`: `recordCharacterLifeEvent`；生产者包含 `characterPhoneAutonomy.ts` 和手机 UI | 已有按事件 ID 去重；真实事件不等于推测、计划 |
| 生活事件进入记忆宫殿 | `context/OSContext.tsx` 的 `enqueuePhoneMemory` → `utils/memoryPalace/pipeline.ts` 的 `ingestPhoneEventToPalace` | 已有去重/重试队列；长时间、异步失败和重载仍需测试 |
| 手机事件影响主动消息 | `context/OSContext.tsx` 中 `markAmsgStateDirty`；AMSG 经 `utils/activeMsgClient.ts`, `utils/activeMsgRuntime.ts` | 现有快照同步；**不是**将 NPC 手机消息直接转发给 User |
| Char 手机前台自主调度 | `context/OSContext.tsx` 中 `tick`，`runCharacterPhoneAutonomy` 等消费 `characterPhoneApiBudget` | 独立于 AMSG 的前台计时器；统一时间调度仍待专门设计审计 |

## 证实的问题及本批次边界

1. **设置实际含义与入口不一致（已补小范围闸门）**：
   `OSContext.tsx` 中生活事件监听曾对来源为非 phone 的事件设置 `budgeted: false`，可以绕过“独立后台 AI 请求”预算；`tick` 与动态互动监听也未全部在入口处核对“Char 手机自主生活”总开关。
   现在统一在事件驱动的**手机自主 AI 生成**、前台调度及朋友圈互动触发点核对原有开关，并让事件驱动的备忘录/朋友圈决策遵循共享预算。**事件保存、AMSG 上下文刷新、记忆宫殿归档仍先执行，不受这道 AI 生成闸门限制**。
2. **请求生命周期不一致（已局部修复）**：
   `characterPhoneAiRequest.ts` 已有 150 秒保护和后台熔断，但 `characterMemoAutonomy.ts` 与 `characterMomentAutonomy.ts` 自己设了 60 秒 `AbortSignal.timeout` 且绕过共同请求封装。本批改为共用该封装，不改模型/提示词/保存合同，不自动重试；仍保留必要超时，不宣称已彻底解决慢请求。
3. **失败语义不清（已局部修复）**：
   共享请求将“客户端等待上限”“主动取消”“网络连接中断”区分说明；服务端是否继续处理 **未知**，不误报服务端失败，不自动重发。
4. **其余不作不实判断**：
   `CharacterPhone.tsx` 已有设置搜索、折叠分组、原有单项生成和一次生成微信全套按钮。本轮没有删除功能或重排 UI。其实际卡手程度、手动套件的局部写入恢复、手机浏览切页与存档重载都 **待实操**。
5. **更深的调度协作仍未完成**：
   现有前台手机 tick 与 AMSG 云端任务相互独立。以后只能在实测证据支持时复用现有任务/时间上下文，不能直接合并收件人渠道或改变云端任务。

## 保护的行为

- 未修改 User 私聊发送、AMSG 2.0 云端收件、记忆宫殿存档接口、联系人数据结构或日程计划数据库。
- 未移除手动生成、关闭开关后手动操作、一次微信全套生成及同轮 piggyback 的现有机制。
- 没有修改 49 动作、家具、3D 家园或参考 APK 内容。
- 发生事件后的**非 AI**同步（生活事件保存、AMSG 快照更新和 Palace 队列）保留。

## 风险与验收（严禁跳过）

- 本分支是审查用补丁：尚未安装依赖执行 Vitest、全项目 TypeScript/生产构建；既有 preview 工作流仅监听 **开发分支 push**，创建其他分支并不会自动覆盖它的构建认证。
- 需定向运行：
  `pnpm exec vitest run utils/characterPhoneAiRequest.test.ts utils/characterPhoneApiBudget.test.ts utils/characterPhoneAutonomy.test.ts utils/characterLifeLoop.test.ts utils/phoneChatPiggyback.test.ts`；
  然后 `pnpm run build`。若失败，先修复同一分支，**不得直接合入开发分支**。
- 必做可观察场景：
  1. 关闭“允许独立后台 AI 请求”后触发**phone 和 amsg2 两种来源**生活事件：保存及 Palace/AMSG 同步照常，零新的自主手机 API；
  2. 关闭“Char 手机自主生活”：前台 tick、动态评论及事件触发的自主手机 API 停止；显式手动生成仍可用；
  3. 打开设置并允许预算：不同来源的自动手机请求确实按现有额度记账；主动消息自身不受手机预算限制；
  4. 备忘录、朋友圈慢响应/网络中断/人为取消：不重复请求，错误有可理解说明，已保存数据不被重置；
  5. 角色切换、页面重载、事件重复派发：不存在跨 Char 错写、重复记录和不可恢复锁；
  6. 使用 Android 浏览器/App 实机验证长时间正常聊天、手机 UI 返回及打开/关闭，不得将静态代码检查等同于体验验收。

## 后续分阶段工作（本轮**未完成**）

- **阶段 2**：沿现有设置折叠/搜索 UI 理清依赖并减少显性复杂度；逐屏手动体验检查，不删原选项与数据。
- **阶段 3**：继续核实各手机独立 API 入口，评估安全保存部分结果、超时后状态不确定时的查询恢复；不得无约束延长时限或增加自动重试。
- **阶段 4**：分析前台手机自主调度与现有 AMSG 的时间、状态与任务复用边界，不重建调度器。
- **阶段 5**：对跨天时区、实时活动优先级、承诺与未完话题做多角色回归。
- **阶段 6**：按用户八个端到端场景实机验收；未验收不得宣称系统成熟。
