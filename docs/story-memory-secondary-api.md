# 剧情独立记忆总结副 API

位置：见面 → 剧情 → 新建/编辑剧情 → 03 / Memory → 剧情记忆总结副 API。

## 使用方式

默认关闭：沿用该处理入口之前的 API 路由，不更改历史剧情及用户现有配置。

开启后可从系统现有的 API 预设库选择，选择时只复制 URL / Key / Model 到当前 StoryTheaterEntry.memorySummaryApi；不会改变全局 apiConfig、角色 dialogueApi、全局记忆宫殿 lightLLM、嵌入模型、向量配置，亦不会改动预设本身。之后删改预设不会偷偷切换剧情副 API。也可手填三个字段；Key 可留空用于无需密钥的代理。

单条剧情独立保存在 story_theaters IndexedDB，已有系统备份中包含剧情数据，恢复时由 normalizeStoryTheater 清理副 API 字段。编辑时点击“保存并进入”才真正保存；取消时保留旧配置。关闭时恢复旧的记忆调用路径。

## 使用范围

| 本剧情请求 | 启用副 API 时 | 默认未设置时 |
| --- | --- | --- |
| 虚构剧场事件盒自动摘要 | 只用本剧情副 API | 原全局主 API |
| 事件盒手动「重新总结」 | 只用本剧情副 API | 原全局主 API |
| 独立向量归档中的轻量 LLM 提取 | 只用本剧情副 API | 之前的全局宫殿 LightLLM／主 API |
| 事件盒手动转角色记忆 | 只用本剧情副 API | 之前的全局宫殿 LightLLM／主 API |
| 本剧情「真实时间陪伴」的角色记忆整理及消化 | 只用本剧情副 API | 之前的全局宫殿 LightLLM／主 API |
| 剧情正文续写/改写/开场 | 不影响，仍使用全局主 API | 原样 |
| 见面普通陪伴、私聊、日程、查手机、家园、主动消息、全局记忆宫殿等 | 完全不读取本剧情副 API | 原样 |
| 向量的 Embedding 与远程向量存储 | 不影响 | 原样 |

副 API 发生错误时不自动回退到昂贵主 API；旧事件盒和原文不被替换或删除。重新总结仍做源原文完整性校验；自动归档以已有事务确保正文与归档状态同时提交或同时不改。独立向量仍要求事先配置 embedding，副 API 只替代其 LLM 提取阶段。

若用户正在生成剧情正文时切换记忆 API，则新的配置仅从保存后发生的记忆处理读取，不取消已在进行中的请求。

## 验证

- 工具及隔离单测：utils/storyMemoryApi.test.ts、utils/storyMemoryApiWiring.test.ts。
- 真正发请求的事件盒重新总结测试：utils/storyTheaterArchive.test.ts，比较 URL、鉴权和模型，证明没有昂贵 API 兜底。
- 剧情数据持久化回归：utils/db.storyTheater.test.ts。
- 真实 React 编辑器七场景截图：story-memory-api-visual.html，tests/story-memory-api-visual.tsx，由 .github/workflows/story-memory-api-visual.yml 的 Chromium 和 Vitest 执行并上传截图（仅虚构 URL 和密钥）。
- 修改仅在既有 remove-checkphone-vrworld-lifesim 分支，发布只经 SullyOS-Dev-Preview 既有站点工作流。
