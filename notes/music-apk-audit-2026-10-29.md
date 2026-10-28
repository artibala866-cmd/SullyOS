# BabyLink 1.1.10 → SullyOS 音乐增量审计（2026-10-29）

## 审计范围与保护约束

- 已解包用户交付 APK，实际检查 ZIP 清单及 `assets/public/assets/` 中的 `appStore-8--S2UKz.js`、`MusicPage-VaZAlzj7.js`、`ChatRoomPage-Dtg3lJc9.js`、音乐样式构建物。
- 对照基线：目标分支 `remove-checkphone-vrworld-lifesim`，初始 HEAD `9595dda0d4353aea48055fd2e86cc50dd50aa8da`；该分支已有后续并发提交，所有代码写入均基于最新 HEAD 的非强制快进，不向 master 写入、不新建分支。
- 保护原私聊提示词及角色设定。**没有改动** `utils/chatPrompts.ts`、`utils/characterResponsePrinciples.ts`、`hooks/useChatAI.ts`。继续使用既有 `MUSIC_ACTION` 与 `useChatAutoReply` 规则，不引入额外 AI 自动触发器。

## 证据与真实差距

| 能力 | BabyLink APK 源码线索 | SullyOS 初始证据 | 结论与做法 |
| --- | --- | --- | --- |
| 多音源搜索 | `appStore` 的 `Zi`，vkeys `/v2/music/tencent/search/song`、GD `types=search&source=tencent`；`MusicPage` 来源切换 | `MusicContext.tsx` `musicApi.search` 使用网易云 Worker 与 GD fallback | 新增 QQ 真实来源链路；不伪造为网易云 |
| URL 与歌词解析 | `appStore` `Xi`，QQ MID、vkeys `geturl`、GD 同来源候补 | `musicApi.songUrl`/`lyric` 都接数字网易云 ID | 新增 source-aware `songUrlFor`/`lyricFor` |
| 免登录收藏 | `musicFavoriteTracks`、`musicCharacterLibraries` | `sully_music_guest_likes_v1` 是数字 ID 集合，Char 有独立 musicProfile | 增加仅本地 User 收藏元数据与列表；保持 Char/网易云账号分离 |
| 本地歌单 | `MusicPage` 喜欢库、角色歌单页面；与平台账号不同 | User 没有自定义免登录歌单 | 增加简单 CRUD 与歌单顺序播放 |
| 队列 | `playbackQueue`、`reorderQueue` | `MusicContext` 全局 queue、模式与持久化已有 | 只补操作入口/移位/删除，不重建播放器 |
| 播放历史 | `playbackHistory`、`link-music-cache-v1` history store | 仅有全局队列持久化 | 另外记录播放时点，禁逐 timeupdate 追加 |
| 邀请 | `startListenTogether`、`stopListenTogether`、`listeningPartner` | `findPendingMusicInvite` + 聊天 DB metadata 关联回应 | 沿用唯一 DB 邀请历史，并绑定可选当前歌曲 |
| Char 响应 | ChatRoomPage 伴听相关调用链 | `chatParser.ts` `MUSIC_ACTION:join/reject/play/invite/stop` | 保持真实角色决策；仅符合已有自动回复条件时进入原倒计时 |
| 接受后播放 | 邀请资料可携带当前 track | `respondListeningInvite` 原只改变伴听名单 | 接受带歌邀请后复用全局 player；拒绝自动播放则提示用户 |
| Char 切歌 | APK 播放队列与伴听关联 | `playListeningTrack` 已有查询/切歌动作 | 增加平台身份、真实音频检查与失败反馈 |
| 会话持续性 | `listeningPartner` 生命周期 | 初始分支已修复切歌自动结束的问题，有 startedAt/end DB | 保留持续时长及换歌不结束会话 |
| 音频缓存 | `link-music-cache-v1` IndexedDB 音频、历史和状态对象 | `utils/musicCache.ts` 已有 API TTL 去重 | 无实测性能瓶颈，不引入无限音频 Blob 持久化；历史单独有界保存 |

## 兼容和限制

- 旧 `Song.id:number` 保持不变，旧远程歌曲默认为 `netease`，本地写歌继续 `local`；新远程标识增加 `source` 与 `platformId`，QQ MID 额外保存，不以数字歌曲 ID 作跨来源比较。
- 旧 `sully_music_guest_likes_v1` 在新本地库首次加载时兼容读取；如果原先只有 ID，曲名先显示可恢复占位，实际重新播放后补元数据；不清空旧数据。
- 账号歌单不与 User 免登录歌单自动同步；Char 自己歌单沿用原始字段 `source:'user'|'discovered'`，新增可选 `musicSource/platformId`，防止字段语义冲突。
- 没有更改现有音乐 Worker 生产部署、音乐外的系统、或写歌 Blob 与歌词对轴。
- QQ 的 vkeys、GD Studio 是第三方服务，不保证任何歌曲永久可解析；接口可用性需要实际网络/Android WebView 验证，不能把模拟网络单元测试当作线上播放成功。
- 没有新增跨设备音频同步服务，没有自动强制任何 Char 接受邀请。
