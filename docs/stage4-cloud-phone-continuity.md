# 阶段 4：云端手机 NPC 待回复的有限自主延续

本阶段仅使用现有主动消息 2.0 Worker 的 `autowake` 每日自主联系机会。**不是**新增一套后台 AI 任务引擎，也不会偷偷开关、替用户创建额外付费的 NPC 轮询。

## 什么情况下会做

- 角色 **主动消息 2.0** 已明确启用，而且其 Worker 版本匹配、云端定时任务和推送可用。
- 角色手机的自主活动总开关没有关闭、手机 API 的 `backgroundApiEnabled` 没关闭，且用户另外显式开启 `chatPiggybackEnabled`（“借用现有聊天生成”）。默认 `chatPiggybackEnabled=false`，**单开真人感/主动消息不授予手机 NPC 云端回话权限**。
- 手机中存在真实保存、时间戳有效、仍未回复、且距今不超过 72 小时的**虚构 NPC** 微信消息。没有保存的联系人/消息不是理由；已链接另一真实 Char 的联系人不可被 NPC 模拟。
- Worker 自动联系到点时，先确认这一则待回复消息尚未消耗。只有成功在云端保留一次性去重标记的机会，才向**原来这次**主动消息的同一模型提示里附上独立的手机回复说明（不新增 API 请求）。

## 数据流与不可越过的闸

1. `amsgCloudPhoneSelection` 从设备手机现有通讯录/微信找符合条件的待回复线程，仅在明确 opt-in 时随下一次 `fire_pack` 带**单条联系人和最近五条已保存手机聊天摘要**上云。原有聊天、手写联系人、记忆与 phoneState 不搬家、不覆盖。
2. 手机权限、联系人、微信变动时 `OSContext` 打脏原有 AMSG 云端快照，避免旧授权一直留在 Worker。
3. Worker 只在**自动联系**（不是手动提醒或即时聊天）任务，使用既有 `cloud_phone_last_reply_attempt` 作为服务端去重。云端即使没找到合适回复，也不重新买一次 API 来补；已经预留过的消息不会反复扣费。
4. 模型可自由选择不回 NPC。回复格式为 `[[CLOUD_PHONE_REPLY:{"messages":["..."]}]]`，严格不超过两段、每段不超过 160 字。Worker 无条件从给用户看的回复里移除内部标记，**手机 NPC 内容绝不作为用户私聊发送**。
5. 只有确实生成出合格 NPC 回复，Worker 才通过现有 `ctx.emitResult` 送 `cloud-phone-reply-v1` 到服务端收件箱，`notification.show=false`。即使手机/浏览器关闭，结果可等下次上线补收；不会额外弹通知。
6. 设备收到后再次核查角色是否存在、2.0/手机权限是否仍开启、权限与清除版本是否仍匹配、NPC 联系人仍是虚构联系人、原微信最后一句没变、用户没有先回。任何条件失效就丢弃旧结果，**不复活删除的数据**。
7. 仅在确认实际追加到原微信线程后，记录来源为 phone 的 NPC-chat 生活事件；推送或收件箱重放使用稳定 `cloudSourceId` 防重复，并走现有生活事件同步管线。用户删掉原微信线程时，对应派生事件也会被清掉。

## 不宣称已经完成的范围

- 云端无法运行浏览器的完整 localStorage/IndexedDB 手机引擎。**本次仅做已有虚构 NPC 待回复消息的云端延续**，没有实现应用杀死后随时生成新 NPC、自己发朋友圈/评论、真正的真人双向私聊，或完整的 24 小时角色独立生活。
- Worker 使用用户自己部署的新版本 bundle（`AMSG_BUNDLE_VERSION=2026-10-30.1`）。只更新开发预览网页**不会自动更新用户的 Cloudflare Worker 实例**。旧版不能执行本轮新增的 NPC 云端回程。
- 同一次自主联系的 LLM 仍会消耗主对话 API；`[[SILENT]]` 只是“不联系用户”，不等于这一轮没有调用模型。
- 应用完全关闭时、未在服务端提前存在的手机事件无法由 Worker 猜出。角色的计划不等于已发生事实；云端不得补造线下经历。
- 没有真实 Worker 账号及 Android 设备的端到端连通性测试，源代码回归成功只能证明逻辑与编译，不代表用户已经成功收到云端消息。

## 验收

`.github/workflows/character-life-stage4-cloud.yml` 执行主动消息/角色手机回归、源文件 TypeScript 检查，以及 `pnpm build:workers` 真正打包。仅在 `remove-checkphone-vrworld-lifesim` 开发，独立预览站 `https://artibala866-cmd.github.io/SullyOS-Dev-Preview/`；不更改 master、正式部署配置或用户旧记录。
