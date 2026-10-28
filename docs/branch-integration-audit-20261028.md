# SullyOS 历史分支与 master 差异核查台账（2026-10-28）

> **核查状态：阶段性、保守。** 这是提交标题的逐项初筛和文件树／Git 祖先关系统计，**不是**“183 个提交已逐个完成运行时等价分析”的证明。凡标为 A、B、F 的内容均不得直接搬运；源码调用关系、当前设计与用户意图必须另行核对。仓库唯一开发/交付分支为 `remove-checkphone-vrworld-lifesim`。

## 已确认基线与限制

- 历史快照目标 HEAD：`9169f3680572f3edf0977e3f08306edece0afed3`；master HEAD：`298410606cd24380ef3f00eba695627f4038adc0`。
- 合并基点：`a6e763709892b717a5776ac6eee7fcc5f3a9571c`。master 独有提交 183；目标分支独有提交 1877。
- 两分支文件树逐路径 blob SHA 核对：相同 3442；仅 master 534；仅目标 174；同路径内容不同 424。
- 16 个其他远端分支全部是目标分支祖先（逐分支 compare behind_by=0），**这仅说明提交祖先关系，不证明旧代码行为仍存在**。
- GitHub 开放 PR 仅发现 #8（草稿；源 `fix/home3d-motion-foundation-recovery-20261027` → 基线 `feat/amaama-unity-retarget-probe`）。仍有视觉/物理验证未完成，禁止把 PR 当已验收。
- 目标 `.github/workflows/build-html-preview.yml` 用目标分支构建并部署 Pages；2026-10-28 run #1239 在初次核查时通过。其他 master 触发器与 Cloudflare 独立，暂不改。
- 无可用的本地仓库 checkout：无法在本环境直接运行 `git status`、`pnpm install`、Vitest、`tsc`、本地构建和浏览器真实交互；以 GitHub 文件/提交/Actions 状态为准。

## 16 个历史分支的逐项记录

| 分支 | 本次检验 HEAD（前 12 位） | 独有提交数 | 当前处理 |
|---|---|---:|---|
| `codex/spark-community-system-20261027` | `a0428fa098a0` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `feat/amaama-unity-retarget-probe` | `8e7afdaa9122` | 0（祖先） | 保留：PR #8 仍开放、原动作回归依赖未迁移 |
| `fix/chat-emotion-buff-independent-home-20261028` | `dec8c1a70290` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/chat-home-experience-regressions-20261028` | `aeffea4beb00` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-distance-gait-20261027` | `40bed16e127b` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-dream-entry-20261027` | `f93325d6c437` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-dream-entry-final-20261027` | `9481a13f5077` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-furniture-points-audit-20261027` | `1b39ebbf7f38` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-gray-screen-phone-overlay-20261027` | `453aa2da1b15` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-gray-screen-thought-bubble` | `4540e1a377be` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-motion-foundation-recovery-20261027` | `f1a53df2b6ee` | 0（祖先） | 保留：PR #8 仍开放、原动作回归依赖未迁移 |
| `fix/home3d-thought-bubble-rail` | `25fe99088bc1` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/home3d-thought-clock-preserve-initiative` | `fe2b4364999f` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/phone-life-budget-routing-audit-20261028` | `88ea33c6e6cc` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/spark-community-stability-20261028` | `f2739f837785` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |
| `fix/time-awareness-phone-home-recovery-20261028` | `7587508173b4` | 0（祖先） | **已删除**：SHA/PR/CI/部署校验通过，清理日志已复核 |

## master 独有提交初筛（183/183）

- D-保留退役/撤销决定，不恢复：14 条
- E-旧默认分支、部署或一次性维护历史：17 条
- A-候选：语音/缓存/安全/隐私/备份（需源码级确认）：30 条
- B-待核对：目标分支有相近功能（不可直接推定等效）：100 条
- F-用途或整合必要性尚未确认：22 条

说明：
- **D**：已废弃的旧查手机实现以及用户已撤销的小红书改动（包括其撤销提交）；不自动恢复。
- **E**：仅面向旧 `master`、旧 Android manifest 或历史一次性工作流的提交；不直接带入当前 Pages/Cloudflare 架构。
- **A-候选**：可能具有保留价值但尚需源码对照、运行环境和用户意图核实；**当前没有认定任何一项必须移植**。
- **B-待核对**：目标已有相近模块、动作或测试，但不宣称具体修复等价；需查真实调用链并回归验证。
- **F**：目前证据不足，保留待确认，不直接移植。
- PR merge commits 出现在清单中，但不能与其对应 feature commits 双重计作独立功能。

| 序号 | SHA | 历史提交标题 | 初筛类别 |
|---:|---|---|---|
| 001 | [`017a16c87227`](https://github.com/artibala866-cmd/SullyOS/commit/017a16c87227534b4432541a3d82095ca013c258) | fix: improve resource loading, chat styles and navigation controls | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 002 | [`614b9f805a26`](https://github.com/artibala866-cmd/SullyOS/commit/614b9f805a2656e636f55bb21b1d82ce078df1dc) | Merge pull request #738 from qegj567-cloud/codex/resource-loading-startup | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 003 | [`5e0abf40af55`](https://github.com/artibala866-cmd/SullyOS/commit/5e0abf40af553c866c0a77a1e44e301c437f05bc) | fix(amsg2): open settings before checking push readiness (#739) | F-用途或整合必要性尚未确认 |
| 004 | [`25d7aff7cdbd`](https://github.com/artibala866-cmd/SullyOS/commit/25d7aff7cdbdf3147fa3d66233773e938df8c889) | fix(ios): 避免主屏幕应用顶部系统背景模糊 (#740) | F-用途或整合必要性尚未确认 |
| 005 | [`38ac203205a7`](https://github.com/artibala866-cmd/SullyOS/commit/38ac203205a7566e7dcaf7e0e3348b905d63a924) | fix(chat): preserve words when wrapping message text (#741) | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 006 | [`9b2002f5c776`](https://github.com/artibala866-cmd/SullyOS/commit/9b2002f5c776c82bee0b820d7213ea32af613e6f) | fix(persona-sim): preserve scripts and resume playback | F-用途或整合必要性尚未确认 |
| 007 | [`2071d752796b`](https://github.com/artibala866-cmd/SullyOS/commit/2071d752796bbcde8ffa5c8df834dcb549390f05) | fix(chat): separate story timeline from message receipt time | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 008 | [`891ae0fae44e`](https://github.com/artibala866-cmd/SullyOS/commit/891ae0fae44ecf23654dce0fefcf8fdaf70e03f8) | fix: 修复剧情时间干扰线上回复与人格模拟续播 (#742) | F-用途或整合必要性尚未确认 |
| 009 | [`49fe51d389ce`](https://github.com/artibala866-cmd/SullyOS/commit/49fe51d389ce630cab1c92ac1a5ecf8448f78354) | feat(tts): integrate ElevenLabs v4 voice models | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 010 | [`8d8681505d9a`](https://github.com/artibala866-cmd/SullyOS/commit/8d8681505d9a0212713793fb65f614a0be019a05) | feat(tts): add streaming speech and timed captions | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 011 | [`96e85900e98d`](https://github.com/artibala866-cmd/SullyOS/commit/96e85900e98dac8f083c4438a0fff4794d6e0312) | docs(tts): add user-facing voice update announcement | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 012 | [`571d84dc3eb6`](https://github.com/artibala866-cmd/SullyOS/commit/571d84dc3eb62548cbb3f9716a3e397c32bd1adc) | Merge pull request #743 from qegj567-cloud/codex/elevenlabs-streaming-voice | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 013 | [`7495fa364160`](https://github.com/artibala866-cmd/SullyOS/commit/7495fa364160a60e0da365d8adc021441235b910) | feat: add story memory conversion and fix 3d avatar appearance | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 014 | [`60041c10e639`](https://github.com/artibala866-cmd/SullyOS/commit/60041c10e63900ff5796803f8c01134c9f5d5d27) | Merge pull request #744 from qegj567-cloud/codex/story-memory-avatar-fixes | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 015 | [`c722e1262dc3`](https://github.com/artibala866-cmd/SullyOS/commit/c722e1262dc34d8cc0d38f976037352b4dfb7209) | fix: verify startup scripts before serving and repair corrupt caches | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 016 | [`cde9eff311b6`](https://github.com/artibala866-cmd/SullyOS/commit/cde9eff311b680cb9dc5d621aaede4a6590e725f) | Merge pull request #745 from qegj567-cloud/codex/startup-script-integrity | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 017 | [`c5a52e90eae7`](https://github.com/artibala866-cmd/SullyOS/commit/c5a52e90eae7007dfce0f08a86c482dca45abe21) | fix(room3d): keep settings above pet portraits | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 018 | [`62001dd28e53`](https://github.com/artibala866-cmd/SullyOS/commit/62001dd28e538b16d39f261f7db94998be22aacf) | Merge pull request #746 from qegj567-cloud/codex/home-settings-layer | F-用途或整合必要性尚未确认 |
| 019 | [`d10b34a4a863`](https://github.com/artibala866-cmd/SullyOS/commit/d10b34a4a863e362882ab16bc35f8f69a04d72b6) | fix: confirm shared beauty sections and allow screenshot covers | F-用途或整合必要性尚未确认 |
| 020 | [`fdfbcd0333cb`](https://github.com/artibala866-cmd/SullyOS/commit/fdfbcd0333cb892af165323970cb549a5970b48f) | Merge pull request #747 from qegj567-cloud/codex/beauty-share-scope-cover | F-用途或整合必要性尚未确认 |
| 021 | [`5b11d47aa2f9`](https://github.com/artibala866-cmd/SullyOS/commit/5b11d47aa2f955a93287980425c444f54ecf855e) | fix(wardrobe): add built-in sounds and current usage badges | F-用途或整合必要性尚未确认 |
| 022 | [`70e3e7f5be8d`](https://github.com/artibala866-cmd/SullyOS/commit/70e3e7f5be8d7d524dd330d299f0c72464f2b94c) | Merge pull request #748 from qegj567-cloud/codex/wardrobe-current-sounds | F-用途或整合必要性尚未确认 |
| 023 | [`aede14e651aa`](https://github.com/artibala866-cmd/SullyOS/commit/aede14e651aa6005aa53c43a7bd2bdd571fe8b1b) | chore: publish Android v3.5.9 manifest | E-旧默认分支、部署或一次性维护历史 |
| 024 | [`a333d0eacef1`](https://github.com/artibala866-cmd/SullyOS/commit/a333d0eacef1c182a87fa3b9e31a31cea5e95050) | Merge pull request #749 from qegj567-cloud/codex/android-v3-5-9-r2-manifest | E-旧默认分支、部署或一次性维护历史 |
| 025 | [`92e9729eadef`](https://github.com/artibala866-cmd/SullyOS/commit/92e9729eadefb83a3b7b2e89210376533811ca4d) | feat: add private real location and regenerate story event summaries | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 026 | [`5c4805459a29`](https://github.com/artibala866-cmd/SullyOS/commit/5c4805459a29098cee64b122c7f23c4053a465b2) | fix: mark location unknown for scheduled proactive messages | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 027 | [`00ae4bdc3be2`](https://github.com/artibala866-cmd/SullyOS/commit/00ae4bdc3be2840401e5cfae62fa6d3647243cae) | Merge pull request #750 from qegj567-cloud/codex/real-location-and-story-fixes | F-用途或整合必要性尚未确认 |
| 028 | [`fb6fcb71a2dc`](https://github.com/artibala866-cmd/SullyOS/commit/fb6fcb71a2dc77b9bc1ccaeb447fa4af41797d20) | chore(android): publish 3.5.10 update manifest | E-旧默认分支、部署或一次性维护历史 |
| 029 | [`21630409b6b5`](https://github.com/artibala866-cmd/SullyOS/commit/21630409b6b575084d16ee672d99b1eb37cb51ce) | Merge pull request #751 from qegj567-cloud/codex/android-v3-5-10-manifest | E-旧默认分支、部署或一次性维护历史 |
| 030 | [`61388201b968`](https://github.com/artibala866-cmd/SullyOS/commit/61388201b968611096cb4004abadd6ef26edaf9d) | fix: apply avatar frames after bubbles and select target | F-用途或整合必要性尚未确认 |
| 031 | [`6acadfd26709`](https://github.com/artibala866-cmd/SullyOS/commit/6acadfd267096ce4aa3b308cf6ee65e9e64b5859) | Merge pull request #752 from qegj567-cloud/codex/avatar-frame-target | F-用途或整合必要性尚未确认 |
| 032 | [`2b2858a6ad43`](https://github.com/artibala866-cmd/SullyOS/commit/2b2858a6ad437831d0d3b17cb35cb3315af470a9) | chore(android): publish 3.5.11 update manifest | E-旧默认分支、部署或一次性维护历史 |
| 033 | [`e8915c19f092`](https://github.com/artibala866-cmd/SullyOS/commit/e8915c19f0921361eb7cba0f87d4a528b910d7c1) | Merge pull request #753 from qegj567-cloud/codex/android-v3-5-11-manifest | E-旧默认分支、部署或一次性维护历史 |
| 034 | [`c729a2fc552f`](https://github.com/artibala866-cmd/SullyOS/commit/c729a2fc552f80e41424fbac3fa3bf1b0aeabbd7) | fix: resolve mobile home, camera, MCP and location feedback | F-用途或整合必要性尚未确认 |
| 035 | [`97693fcba0a2`](https://github.com/artibala866-cmd/SullyOS/commit/97693fcba0a2475c49ffd240a4a760e3fd5d2581) | Merge pull request #754 from qegj567-cloud/codex/mobile-feedback-location-fixes | F-用途或整合必要性尚未确认 |
| 036 | [`f9b49580c186`](https://github.com/artibala866-cmd/SullyOS/commit/f9b49580c186947a23e6cd2a7556e9dca8c4ed63) | fix: resume startup caching and bound archived chat reads | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 037 | [`27f060c1bc0c`](https://github.com/artibala866-cmd/SullyOS/commit/27f060c1bc0c5381d5fad0e03eae353fc8517599) | Merge pull request #755 from qegj567-cloud/codex/resume-cache-and-archive-chat | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 038 | [`e5c138f1124c`](https://github.com/artibala866-cmd/SullyOS/commit/e5c138f1124c028366b96a2b28df8e0db12a3787) | fix: retain build assets across releases and avoid offline reloads | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 039 | [`13547a7622a8`](https://github.com/artibala866-cmd/SullyOS/commit/13547a7622a8550f0ddc3d94eccc19431629abe3) | Merge pull request #756 from qegj567-cloud/codex/resource-load-stability | F-用途或整合必要性尚未确认 |
| 040 | [`7fe730b0c8f3`](https://github.com/artibala866-cmd/SullyOS/commit/7fe730b0c8f322b4f17143c62155916eb2e229d1) | fix(privacy): bound probe cleanup and preserve audit errors (#757) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 041 | [`810b79e32569`](https://github.com/artibala866-cmd/SullyOS/commit/810b79e3256967439605360bc4c7aebed4d74133) | perf(privacy): optimize probe lookup and batch daily cleanup | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 042 | [`ee27fc5eb5ac`](https://github.com/artibala866-cmd/SullyOS/commit/ee27fc5eb5acac64ee24bd98d020446e2ab1b666) | perf(privacy): optimize probe lookup and batch daily cleanup (#758) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 043 | [`7c4091b5e123`](https://github.com/artibala866-cmd/SullyOS/commit/7c4091b5e1238a3ca63a15e5337acc75376bf6fc) | fix(backup): bound export memory and compact memory link weights | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 044 | [`9b2a76a87967`](https://github.com/artibala866-cmd/SullyOS/commit/9b2a76a87967a93523acfcb7972a22023a98caad) | fix(ci): refresh PR size labels without stale labels (#760) | F-用途或整合必要性尚未确认 |
| 045 | [`874d8ef15571`](https://github.com/artibala866-cmd/SullyOS/commit/874d8ef155711e6e128367534561f6fc9d97db58) | feat(startup): warn once about unofficial deployments (#761) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 046 | [`da33732253fb`](https://github.com/artibala866-cmd/SullyOS/commit/da33732253fbf3174bf068a237375155a8d1a846) | fix(date): preserve reading position and expose resource recovery (#762) | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 047 | [`b687e2b0ee6a`](https://github.com/artibala866-cmd/SullyOS/commit/b687e2b0ee6aee15c8bf87ab91658423a9782f85) | feat(collaboration): add dark themes and custom appearance CSS (#763) | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 048 | [`4314f679010b`](https://github.com/artibala866-cmd/SullyOS/commit/4314f679010b9a358168b1a7cb9aff364decd4f8) | feat(collaboration): integrate appearance collections and beauty sharing (#764) | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 049 | [`452e7f3f87cd`](https://github.com/artibala866-cmd/SullyOS/commit/452e7f3f87cd1e511c58e08accd38832d51def01) | fix(backup): bound export memory and compact memory link weights (#759) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 050 | [`9f41eddaa983`](https://github.com/artibala866-cmd/SullyOS/commit/9f41eddaa983c70f8dd41691a414e753357492cc) | fix(amsg): harden task inputs and adopt released next SDKs (#765) | F-用途或整合必要性尚未确认 |
| 051 | [`cca77fa7e385`](https://github.com/artibala866-cmd/SullyOS/commit/cca77fa7e385a18c6124b660f5d2e622f8227039) | chore(ui): simplify overly technical user-facing copywriting (#766) | F-用途或整合必要性尚未确认 |
| 052 | [`4834ee915e5a`](https://github.com/artibala866-cmd/SullyOS/commit/4834ee915e5a54ad1ba29f174a5410130a490d0b) | fix(storage): heal SAR archive, settings state, and HWM after localStorage wipe (#767) | F-用途或整合必要性尚未确认 |
| 053 | [`6247ae1a8f9c`](https://github.com/artibala866-cmd/SullyOS/commit/6247ae1a8f9ca5255986cff1542d17001fdf8bb6) | chore(security): disable pdfjs eval and update undici/brace-expansion (#768) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 054 | [`48e8e538ab66`](https://github.com/artibala866-cmd/SullyOS/commit/48e8e538ab66e83aecfe541df0340dcfb0ec1041) | fix(amsg): adopt amsg-server 3.1.0-next.1, prune settled instant-input, and harden 1.0 proactive scheduler (#769) | F-用途或整合必要性尚未确认 |
| 055 | [`f45ce0ccc539`](https://github.com/artibala866-cmd/SullyOS/commit/f45ce0ccc53937e002c169166d03be9dbe30e311) | feat(call): add official MiniMax, Fish Audio, and ElevenLabs STT options (#770) | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 056 | [`50999a30fb8f`](https://github.com/artibala866-cmd/SullyOS/commit/50999a30fb8f4ab72e783a956358d6c5e60e007a) | fix: address chat, memory, story and 3D feedback | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 057 | [`5b261b1fcb93`](https://github.com/artibala866-cmd/SullyOS/commit/5b261b1fcb9395999dc27dc2182107211be44753) | Merge pull request #771 from qegj567-cloud/codex/feedback-bugfixes-20261025 | F-用途或整合必要性尚未确认 |
| 058 | [`32f5fef2137c`](https://github.com/artibala866-cmd/SullyOS/commit/32f5fef2137c6de311096ff9656dd01892c5bdad) | fix: preserve long memory summaries and honor collaboration API settings | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 059 | [`e19dcc12ef97`](https://github.com/artibala866-cmd/SullyOS/commit/e19dcc12ef97a1ba803af123eb180cb8bfb7a671) | Merge pull request #772 from qegj567-cloud/codex/memory-collaboration-feedback | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 060 | [`a8c1836ed01a`](https://github.com/artibala866-cmd/SullyOS/commit/a8c1836ed01ac9e84d41a7252b3e02c62968dda6) | fix(chat,home3d): restore independent opt-in emotion Buff and shared home portrait display | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 061 | [`9070745f4935`](https://github.com/artibala866-cmd/SullyOS/commit/9070745f4935f9b2ccd742e628677ae57ff70113) | chore(emotion): remove unused schedule gate import after Buff separation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 062 | [`54f7deeecc84`](https://github.com/artibala866-cmd/SullyOS/commit/54f7deeecc84c5487f4d9154d3ac177922e270eb) | fix(home3d): integrate audited furniture interactions onto production master without losing master-only fixes | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 063 | [`2359b8cc579a`](https://github.com/artibala866-cmd/SullyOS/commit/2359b8cc579a15afdda4625720394e9e172642f5) | ci(home3d): validate production master integration PR and future direct production furniture changes | E-旧默认分支、部署或一次性维护历史 |
| 064 | [`0888cfc139a9`](https://github.com/artibala866-cmd/SullyOS/commit/0888cfc139a9acc4e4522b20c2db064ddf52a4d5) | Merge verified Home3D furniture fixes into production master (#18) | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 065 | [`825ccbd4c5b1`](https://github.com/artibala866-cmd/SullyOS/commit/825ccbd4c5b1e32ee774c65b7273a73a0e225c9c) | fix(chat): surface independent emotion Buff settings immediately and repair legacy menu route | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 066 | [`a5abc6e51520`](https://github.com/artibala866-cmd/SullyOS/commit/a5abc6e51520921343c23ff55ebb75f0a24f435c) | fix(checkphone): retain live contact edits when delayed manual scan completes | D-保留退役/撤销决定，不恢复 |
| 067 | [`6469bf47041f`](https://github.com/artibala866-cmd/SullyOS/commit/6469bf47041f80ea0112d53569c314d7e63958a0) | fix(checkphone): prevent duplicate paid manual requests and stale contact overwrites on master | D-保留退役/撤销决定，不恢复 |
| 068 | [`76b4b448b4ed`](https://github.com/artibala866-cmd/SullyOS/commit/76b4b448b4eda55b339747e057f94308734c84b6) | test(checkphone): protect manual contacts when AI scan finishes after edits or deletion | D-保留退役/撤销决定，不恢复 |
| 069 | [`1c3b7fa649e2`](https://github.com/artibala866-cmd/SullyOS/commit/1c3b7fa649e2a825a36bd73b0cfc80316dfc907d) | ci(master): test phone scan concurrency and API settings before publishing site | E-旧默认分支、部署或一次性维护历史 |
| 070 | [`1815578a86b8`](https://github.com/artibala866-cmd/SullyOS/commit/1815578a86b817a70cc2c5b6b0fbfc814fcc3cb4) | fix(emotion): expose separate chat menu entry and restore end-to-end regression coverage | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 071 | [`08059d749595`](https://github.com/artibala866-cmd/SullyOS/commit/08059d749595bd256dd49290e325d39302eb6065) | fix(checkphone): reconcile manual phone scans with current contacts on master | D-保留退役/撤销决定，不恢复 |
| 072 | [`7a1fc752dab5`](https://github.com/artibala866-cmd/SullyOS/commit/7a1fc752dab528c9c255acfe947b3f43b7e7dd90) | fix(master): remove duplicate contact reconciliation symbol introduced during port | F-用途或整合必要性尚未确认 |
| 073 | [`5b3f872405fa`](https://github.com/artibala866-cmd/SullyOS/commit/5b3f872405faaa61712638c4253f66c525105029) | fix(master phone): honor chat clear during generation and retain phone data on partial mirror failure | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 074 | [`7edeaf102573`](https://github.com/artibala866-cmd/SullyOS/commit/7edeaf102573a0b8ed197e233b25cd801d1db16d) | fix(home3d): recover walking routes around moving residents without teleporting or false AI success | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 075 | [`8b45494c90d2`](https://github.com/artibala866-cmd/SullyOS/commit/8b45494c90d2bd47123a69a89e6064d74240705c) | fix(home3d): restore WebGL context and recover broken frames without resetting furniture state | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 076 | [`881fd409e837`](https://github.com/artibala866-cmd/SullyOS/commit/881fd409e8376f5e17fcd16995d16d721fba1c2d) | style(home3d): provide recoverable GPU context-loss screen without altering furniture UI | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 077 | [`a00e455d52c2`](https://github.com/artibala866-cmd/SullyOS/commit/a00e455d52c26126af315119ba576d1f53830c4d) | test(home3d): cover rerouting around residents, blocked corridor and AI chair failure semantics | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 078 | [`2fd14e16545e`](https://github.com/artibala866-cmd/SullyOS/commit/2fd14e16545eafd525caa11c953d6eaf6059541a) | test(home3d): guard WebGL context recovery, furniture-state preservation and overlay cleanup | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 079 | [`7255fac9af3d`](https://github.com/artibala866-cmd/SullyOS/commit/7255fac9af3df176438b1678e8750b75445f5ea3) | ci(home3d): check resident rerouting and WebGL context restore on every master push | E-旧默认分支、部署或一次性维护历史 |
| 080 | [`c1f48410cbb4`](https://github.com/artibala866-cmd/SullyOS/commit/c1f48410cbb460771a083927cbfb90fecce8e5d8) | feat(master phone): build bounded role-specific continuity from existing scheduled tasks and anniversaries | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 081 | [`5b1a6c7d6684`](https://github.com/artibala866-cmd/SullyOS/commit/5b1a6c7d668446c024158bcac4d89096f9695099) | test(master): verify Char phone continuity is bounded, grounded and character-specific | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 082 | [`3e6bce0c28df`](https://github.com/artibala866-cmd/SullyOS/commit/3e6bce0c28dfa6d7d7f2733398eb40ea25bc7e36) | docs(home3d): record direct-master furniture integration and preserve newer production character/bed fixes | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 083 | [`3d1ade5c8229`](https://github.com/artibala866-cmd/SullyOS/commit/3d1ade5c82298f52af86490687f9c12b53e46e97) | feat(master phone): ground manual phone and phone-AI generations in saved Schedule context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 084 | [`6db45bc6a458`](https://github.com/artibala866-cmd/SullyOS/commit/6db45bc6a4587960fa56f081d4ba66e25ec70724) | fix(master phone): bound manual AI request and JSON read without retries | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 085 | [`0ec915dc4cf6`](https://github.com/artibala866-cmd/SullyOS/commit/0ec915dc4cf63845b2a87fde57e8d02f6dfd0fc3) | fix(master phone): use single-attempt 150-second deadline for phone and AI-assistant generation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 086 | [`d42369b05c39`](https://github.com/artibala866-cmd/SullyOS/commit/d42369b05c391d2e63c1b735963e1c7e97e23bc8) | feat(spark): bring community fixes into master without merging old development branches | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 087 | [`e6dc5d8746a2`](https://github.com/artibala866-cmd/SullyOS/commit/e6dc5d8746a2b311b9a6f9d4cfc4e68c6c26c62c) | test(master phone): verify request timeout includes response decode and never repeats billing | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 088 | [`facebfb919d4`](https://github.com/artibala866-cmd/SullyOS/commit/facebfb919d40b3646234cf61d092fb67b1fd149) | ci(master): gate production site on phone continuity and timeout regressions | E-旧默认分支、部署或一次性维护历史 |
| 089 | [`22b0a981be08`](https://github.com/artibala866-cmd/SullyOS/commit/22b0a981be08519a4f87bec4ff6f78c9c4ce9693) | fix(master phone): preserve timeout error when abort-aware fetch races deadline | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 090 | [`46c8c481bede`](https://github.com/artibala866-cmd/SullyOS/commit/46c8c481bede44f2acaae1dc05ad82a7cf4b8a49) | fix(spark): add optional XhsStockImage category for master compatibility | D-保留退役/撤销决定，不恢复 |
| 091 | [`41f92ec21ffd`](https://github.com/artibala866-cmd/SullyOS/commit/41f92ec21ffd10c043f6f86eb9f526fc7adb43cc) | fix(master phone): focus anniversary grounding on recent and upcoming occasions | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 092 | [`d8e473135548`](https://github.com/artibala866-cmd/SullyOS/commit/d8e473135548039ddef99a5eccdaea3359fddb20) | test(master phone): exclude stale or distant anniversaries from current phone life | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 093 | [`8abcdb4d421a`](https://github.com/artibala866-cmd/SullyOS/commit/8abcdb4d421aa272d5483d2e10ff33250d731c6b) | fix(master phone): share chat clear invalidation across mounts and browser tabs | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 094 | [`7998bb8110aa`](https://github.com/artibala866-cmd/SullyOS/commit/7998bb8110aa3794de09eb9926090d972e728591) | fix(master phone): use character-scoped clear revisions for stale AI replies across reopened phone screens | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 095 | [`62cffac1f220`](https://github.com/artibala866-cmd/SullyOS/commit/62cffac1f2208a2cb71c2cf787859ca2ce2fc419) | test(master phone): verify chat clear invalidates earlier replies across mounts and quota failures | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 096 | [`237ec80d422a`](https://github.com/artibala866-cmd/SullyOS/commit/237ec80d422a292011d8ae055ebe68ce2fa3bd9a) | fix(master phone): preserve AI agent sessions when private-chat mirror fails and block rapid duplicate calls | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 097 | [`1160dea43f15`](https://github.com/artibala866-cmd/SullyOS/commit/1160dea43f15e9458323afe0758e19db58759ffc) | ci(master): include cross-mount phone chat clear regression before Pages release | E-旧默认分支、部署或一次性维护历史 |
| 098 | [`65911abc6f12`](https://github.com/artibala866-cmd/SullyOS/commit/65911abc6f125938fd94b7d7af21feb3f39fa389) | feat(phone master): ground Char phone in existing persisted Home3D actions without duplicate life store | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 099 | [`17247a794b49`](https://github.com/artibala866-cmd/SullyOS/commit/17247a794b49266750d541625dccdfe0ced2d874) | feat(phone master): include latest stored Home3D actions in manual phone context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 100 | [`463013975b30`](https://github.com/artibala866-cmd/SullyOS/commit/463013975b303d53d5a317462498e010c1e652b7) | test(phone master): verify Home3D event provenance, recency, dedupe and no fictional promotion | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 101 | [`59e400ffb615`](https://github.com/artibala866-cmd/SullyOS/commit/59e400ffb615125b37712dea1c994609fc74bdd2) | fix(phone master): respect deleted Home3D history when reading latest phone context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 102 | [`b70d84e84308`](https://github.com/artibala866-cmd/SullyOS/commit/b70d84e8430896c729c87c7b2d322d9e07d8bbec) | docs: require direct master delivery and prohibit AI-created side branches unless owner asks | E-旧默认分支、部署或一次性维护历史 |
| 103 | [`0566489a7308`](https://github.com/artibala866-cmd/SullyOS/commit/0566489a73087f44bc72a74ef02fa7ce885ee354) | fix(phone): isolate single record deletion and chat clear to current phone state | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 104 | [`faf8e6e1d7f2`](https://github.com/artibala866-cmd/SullyOS/commit/faf8e6e1d7f2e27eee3fd8d026a20035b6f4ed61) | fix(phone master): preserve latest records during explicit deletion and safely clean linked chat cards | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 105 | [`5d9c20b828dc`](https://github.com/artibala866-cmd/SullyOS/commit/5d9c20b828dc5e39712c3a3d28ef2513396c43a3) | test(phone master): verify deletion does not discard freshly saved phone apps, contacts or life logs | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 106 | [`5c08df68ec80`](https://github.com/artibala866-cmd/SullyOS/commit/5c08df68ec804372db70f256bce0a18d56e515e2) | ci(master): gate Pages deploy on phone archive deletion and storage isolation tests | E-旧默认分支、部署或一次性维护历史 |
| 107 | [`08484a4a7cdc`](https://github.com/artibala866-cmd/SullyOS/commit/08484a4a7cdcca969ec79e66f5f453cdd87fd1a0) | fix(xhs): require confirmed stock-image preview before saving and discard stale image loads | D-保留退役/撤销决定，不恢复 |
| 108 | [`c374f6277e98`](https://github.com/artibala866-cmd/SullyOS/commit/c374f6277e988a99a25806679637f29085eb1ade) | fix(xhs): count stock-photo usage only after a successful remote post | D-保留退役/撤销决定，不恢复 |
| 109 | [`56e10cef6cac`](https://github.com/artibala866-cmd/SullyOS/commit/56e10cef6cac39d01b58fb5125f1d49f71189f73) | test(phone): use real newlines in Home3D event sanitization regression | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 110 | [`5f7b8fbc15b1`](https://github.com/artibala866-cmd/SullyOS/commit/5f7b8fbc15b1407eebc849c80b7b52a2aefcc1c4) | fix(xhs): isolate character activity reads and authenticate MCP health check using configured cookie | D-保留退役/撤销决定，不恢复 |
| 111 | [`fb726b7a6f41`](https://github.com/artibala866-cmd/SullyOS/commit/fb726b7a6f41207c2d79e6c626c17191a72da396) | test(xhs): verify stock-photo accounting only after published success | D-保留退役/撤销决定，不恢复 |
| 112 | [`62203e5c8fd0`](https://github.com/artibala866-cmd/SullyOS/commit/62203e5c8fd0286e3c1377b78b88f50d19828e2a) | fix(phone master): interpret upcoming anniversaries in Char timezone using shared schedule helper | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 113 | [`a062a2196b2c`](https://github.com/artibala866-cmd/SullyOS/commit/a062a2196b2cc8cff852cc56a7bc8f8b02fcf123) | feat(home3d): calculate walking animation time from actual distance travelled | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 114 | [`6a8346b2b1e6`](https://github.com/artibala866-cmd/SullyOS/commit/6a8346b2b1e65426e83f6566cc618a942fcd58a7) | test(phone): protect cross-timezone anniversary boundaries in character life context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 115 | [`55727d9d0086`](https://github.com/artibala866-cmd/SullyOS/commit/55727d9d00866f4d2a1edad592be23bba0c8fbf3) | fix(spark): enforce public-only context for one-character feed and autonomous requests | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 116 | [`0938e60bbd26`](https://github.com/artibala866-cmd/SullyOS/commit/0938e60bbd26becd2ae2f4aa084d7ac0f7acd691) | fix(spark): isolate all public AI generation and filter muted search and autonomy context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 117 | [`896ce6dae99d`](https://github.com/artibala866-cmd/SullyOS/commit/896ce6dae99d7e7113dbf34f063987fd721c403a) | test(spark): cover one-person public chat/worldbook isolation without breaking private role context | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 118 | [`2d296c7de693`](https://github.com/artibala866-cmd/SullyOS/commit/2d296c7de69373f8817b696a62df2f1b7170c8ae) | ci(master): require clean TypeScript diagnostics for phone port before Pages deployment | E-旧默认分支、部署或一次性维护历史 |
| 119 | [`f05561415013`](https://github.com/artibala866-cmd/SullyOS/commit/f055614150132325ab5ef5f45c4947b84441bd22) | revert(xhs): remove unrequested stock-image preview changes from master | D-保留退役/撤销决定，不恢复 |
| 120 | [`b4c1715aa610`](https://github.com/artibala866-cmd/SullyOS/commit/b4c1715aa6100db566ea194999b9769526fe7965) | fix(spark): do not send private user name or biography in public community generation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 121 | [`0fa88ea5288e`](https://github.com/artibala866-cmd/SullyOS/commit/0fa88ea5288ee1d2dd87a902b3ecbd6ae852b43a) | revert(xhs): restore prior stock-photo usage behavior as owner requested | D-保留退役/撤销决定，不恢复 |
| 122 | [`831ee4d22d05`](https://github.com/artibala866-cmd/SullyOS/commit/831ee4d22d051a286ad9ae83a0cfc3d07e85b87a) | test(spark): public prompts exclude real user identity and private biography | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 123 | [`4163bb1b5a1c`](https://github.com/artibala866-cmd/SullyOS/commit/4163bb1b5a1c75757ef6470e5011cb447d3ea58a) | revert(xhs): remove unrequested activity and MCP-connection edits from master | D-保留退役/撤销决定，不恢复 |
| 124 | [`a6d6e91ba1fe`](https://github.com/artibala866-cmd/SullyOS/commit/a6d6e91ba1fec6cc96e9c04aa424354fe5f9263f) | revert(xhs): delete unwanted side-branch stock-photo regression test | D-保留退役/撤销决定，不恢复 |
| 125 | [`3b65bccb4475`](https://github.com/artibala866-cmd/SullyOS/commit/3b65bccb447547089983c148e65b287060d3296e) | fix(spark): keep final one-character group of batched public posts out of private worldbooks | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 126 | [`942bc7876352`](https://github.com/artibala866-cmd/SullyOS/commit/942bc78763521436ea7b175c81030a4fe804f496) | docs: prohibit re-importing XHS changes expressly withdrawn by owner | D-保留退役/撤销决定，不恢复 |
| 127 | [`61652b49c097`](https://github.com/artibala866-cmd/SullyOS/commit/61652b49c0971363fd3a730dfe6c49b27a787702) | fix(spark): never overwrite a distinct stranger account based on duplicate public nicknames | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 128 | [`adba70cbce7c`](https://github.com/artibala866-cmd/SullyOS/commit/adba70cbce7c64f443bfd5ae75fd0b577d361620) | test(spark): duplicate NPC nicknames cannot overwrite distinct stable account histories | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 129 | [`2b23fa0bc1dd`](https://github.com/artibala866-cmd/SullyOS/commit/2b23fa0bc1dd8f2151a3d5e9e7b3c43fec15fa04) | fix(spark): exclude muted authors from public reply history and character selection | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 130 | [`bfcd53333c92`](https://github.com/artibala866-cmd/SullyOS/commit/bfcd53333c92534e69fb0185234aab493cc49a8f) | fix(spark): align blocked-account badges and follows, report failed profile writes | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 131 | [`ad23dd613d98`](https://github.com/artibala866-cmd/SullyOS/commit/ad23dd613d9820c2612efdc2d1b99ddb60aca89e) | fix(spark): exclude user-private interactions and moderation history from public autonomy prompts | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 132 | [`d13da70d3dfc`](https://github.com/artibala866-cmd/SullyOS/commit/d13da70d3dfc50ba4d65db0712169d1abfde0ef2) | fix(spark): keep user's likes, saves, mutes, private DMs and follows out of NPC event memory | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 133 | [`596dca93938a`](https://github.com/artibala866-cmd/SullyOS/commit/596dca93938aa65963fdab8e6815428fdec66fc0) | test(spark): autonomous NPC history cannot read private likes, saves, DMs or moderation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 134 | [`bf64b7fd7853`](https://github.com/artibala866-cmd/SullyOS/commit/bf64b7fd7853d04159dcc8dab371b1cf6a419f7f) | refactor(phone): remove duplicate Home3D event injection already supplied by shared chat history | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 135 | [`70093cff76cc`](https://github.com/artibala866-cmd/SullyOS/commit/70093cff76cc1f33774b6dbd8f6cba22b7d11137) | refactor(phone): rely on existing Home3D projection instead of duplicate DB read and prompt block | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 136 | [`667aa7428b75`](https://github.com/artibala866-cmd/SullyOS/commit/667aa7428b75f811217855ac125123ecec6a3c6e) | test(phone): assert single Home3D source through shared history, not duplicate prompt injection | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 137 | [`14be461341ca`](https://github.com/artibala866-cmd/SullyOS/commit/14be461341ca22307541c227fbb56fe3ecb5fca3) | maintenance: one-time SHA-guarded cleanup of owner-revoked and fully integrated legacy branches | E-旧默认分支、部署或一次性维护历史 |
| 138 | [`cdaaa411e5ac`](https://github.com/artibala866-cmd/SullyOS/commit/cdaaa411e5ac4ca2dd964c9fa82bb7aa28f4ab32) | maintenance: handle null merged_at reliably when deleting user-revoked XHS branch | E-旧默认分支、部署或一次性维护历史 |
| 139 | [`8131c12976c1`](https://github.com/artibala866-cmd/SullyOS/commit/8131c12976c1279af009445f559c1e3fb2df7d4a) | refactor(phone): reuse already-read chat context for phone AI and tavern generation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 140 | [`f53a86db37a7`](https://github.com/artibala866-cmd/SullyOS/commit/f53a86db37a7c9f26b85f334265505ca938b6f81) | maintenance: remove temporary branch-cleanup workflow after seven verified legacy refs were deleted | E-旧默认分支、部署或一次性维护历史 |
| 141 | [`853b365b6f05`](https://github.com/artibala866-cmd/SullyOS/commit/853b365b6f0554b2d5ea085e7f057415931374e9) | fix(phone): avoid asserting Home events are always visible beyond user context limits | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 142 | [`051721590273`](https://github.com/artibala866-cmd/SullyOS/commit/05172159027303bfd62f6ee775c755b5edb1235b) | fix(spark): make initial NPC messages merge safely with latest concurrent DM sends | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 143 | [`4949f2e33f69`](https://github.com/artibala866-cmd/SullyOS/commit/4949f2e33f6909adda07feb7811581caacef317b) | fix(spark): avoid stale React updater overwriting private messages during migration and NPC inbox receipt | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 144 | [`3de6ca07263c`](https://github.com/artibala866-cmd/SullyOS/commit/3de6ca07263cb7d54590237ae7c70a13521d558c) | test(spark): preserve rapid DM sends across late NPC greetings and legacy migration | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 145 | [`f4d8baff2513`](https://github.com/artibala866-cmd/SullyOS/commit/f4d8baff2513be79f9faa9008eaea0f0edf5de66) | fix(spark): keep Android DM composer within visual viewport, prioritize keyboard Back and prevent cross-chat typing indicator | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 146 | [`663c364b2fb9`](https://github.com/artibala866-cmd/SullyOS/commit/663c364b2fb9d88178b23291485b37a45a18bdda) | fix(spark): isolate private-message drafts by stable recipient identity | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 147 | [`e7d88c72cdab`](https://github.com/artibala866-cmd/SullyOS/commit/e7d88c72cdab8749c8d72dd37d540a1b00f18cc7) | fix(spark): persist separate DM drafts per account and reject ambiguous same-name recipient switching | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 148 | [`b79e032006b1`](https://github.com/artibala866-cmd/SullyOS/commit/b79e032006b1ce08034240054faf732fc9fc4ac7) | test(spark): verify independent private DM drafts and no cross-account input leakage | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 149 | [`5d309cf86c19`](https://github.com/artibala866-cmd/SullyOS/commit/5d309cf86c1922b066981f86a3260600e9817b6a) | fix(spark): adapt Android comment-detail viewport and composer to soft keyboard resizing | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 150 | [`66906dd7f9cf`](https://github.com/artibala866-cmd/SullyOS/commit/66906dd7f9cf4701225afe35fa9817216fb8ae70) | fix(test): discover room3d JavaScript regression specs | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 151 | [`f3f195063b64`](https://github.com/artibala866-cmd/SullyOS/commit/f3f195063b647bd321a8dee0a1df70dd602e3b35) | refactor(room3d): avoid duplicate pet furniture reconciliation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 152 | [`a7c8d13e5584`](https://github.com/artibala866-cmd/SullyOS/commit/a7c8d13e558464c2f281e1a8031d23c39ea292db) | docs(phone): audit legacy phone branches and preserve master integration contract [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 153 | [`4f30798c4c4e`](https://github.com/artibala866-cmd/SullyOS/commit/4f30798c4c4ee2faed769a9a5651e3d1d5244fb7) | fix(phone): classify manual API cancellation and uncertain timeout [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 154 | [`baeed2739534`](https://github.com/artibala866-cmd/SullyOS/commit/baeed2739534d01401ed26614a20d7b8fc7916e6) | fix(spark): dedupe incoming batches and preserve notification read state | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 155 | [`cdbfd7e0641b`](https://github.com/artibala866-cmd/SullyOS/commit/cdbfd7e0641bee6fe670fbc0ae9efffc7d3d8173) | fix(phone): keep real Char and NPC identities separate on contact merge [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 156 | [`8d103ab360b6`](https://github.com/artibala866-cmd/SullyOS/commit/8d103ab360b670234a9965090a8197c884d911d8) | fix(spark): preserve distinct threaded replies and character handles | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 157 | [`dfd187850ef5`](https://github.com/artibala866-cmd/SullyOS/commit/dfd187850ef5483abf8967f319bb32d642df912e) | fix(phone): prioritize linked Char ID over ambiguous legacy same-name contacts [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 158 | [`6f8168116ee4`](https://github.com/artibala866-cmd/SullyOS/commit/6f8168116ee40c84cc5b394cc54534d4558f0fa4) | fix(phone): never persist duplicate IDs on generated contact conflicts [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 159 | [`2f4330028bee`](https://github.com/artibala866-cmd/SullyOS/commit/2f4330028bee535e36d0e5e1b584f87a806d0b0c) | fix(spark): clear published drafts safely after durable saves | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 160 | [`4ce27b856a13`](https://github.com/artibala866-cmd/SullyOS/commit/4ce27b856a130b4b179383d1a84e34a6266d2c6d) | fix(spark): align local like and collection actors with profile counts | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 161 | [`c87ca917b1ad`](https://github.com/artibala866-cmd/SullyOS/commit/c87ca917b1ad9dd3c0a2e3260001fb0566cd115a) | fix(phone): preserve historical per-Char phone storage in backups [skip ci] | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 162 | [`76081dfe5925`](https://github.com/artibala866-cmd/SullyOS/commit/76081dfe5925c7f23b709e44a4b1f02565a2ca6a) | fix(spark): fence deletes against late AI writes and stale generation | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 163 | [`97a0c3755ce1`](https://github.com/artibala866-cmd/SullyOS/commit/97a0c3755ce1ad6ebb9645765e686011a9a78711) | feat(phone): expose historical NPC and WeChat archive read-only [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 164 | [`56e670a23617`](https://github.com/artibala866-cmd/SullyOS/commit/56e670a236170c58cad363035ee8e92bec7d05e2) | fix(spark): retain failed post edits and offer deliberate recovery | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 165 | [`7a32a5f37034`](https://github.com/artibala866-cmd/SullyOS/commit/7a32a5f370341b17784bcd6c5ceab2588c18f52b) | fix(phone): preserve historical privacy and autonomy state in legacy backup [skip ci] | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 166 | [`6fe7bf6da880`](https://github.com/artibala866-cmd/SullyOS/commit/6fe7bf6da880109ed40267a4ff2c980a602b0545) | fix(spark): safely recover in-session failed posts without replaying paid AI | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 167 | [`86926b86c95a`](https://github.com/artibala866-cmd/SullyOS/commit/86926b86c95a1a7dfb309b7c59039d7b1c91d475) | docs(phone): reconcile legacy compatibility progress and isolated regression facts [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 168 | [`28b8d344cb5f`](https://github.com/artibala866-cmd/SullyOS/commit/28b8d344cb5f20e6ddc4f7e8f53069579cfe4f61) | fix(spark): verify durable initial-comment reservation before paid AI call | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 169 | [`0d33046e9eb2`](https://github.com/artibala866-cmd/SullyOS/commit/0d33046e9eb24c019279b525e60bbaa17eafc4fe) | fix(spark): protect live profile edits from delayed account hydration | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 170 | [`13ec79442d4a`](https://github.com/artibala866-cmd/SullyOS/commit/13ec79442d4ac55c2f9555366e49dbe857049b7e) | fix(spark): recover community DB failures without overwriting relationships | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 171 | [`95c0cc0ea61c`](https://github.com/artibala866-cmd/SullyOS/commit/95c0cc0ea61cec3ea0db383f1202977b050cfa41) | fix(spark): confirm durable DM outbox before billing and restore IndexedDB backup | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 172 | [`c1b018355a3b`](https://github.com/artibala866-cmd/SullyOS/commit/c1b018355a3b715b42259a33804e189624197650) | test(spark): verify durable DM backup and migrate legacy threads on restore | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 173 | [`cfc183117739`](https://github.com/artibala866-cmd/SullyOS/commit/cfc183117739328b2c42f435015074f3bf85cd4e) | fix(spark): keep confirmed DM sent receipts ahead of stale failed cache | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 174 | [`a612deac9878`](https://github.com/artibala866-cmd/SullyOS/commit/a612deac9878ff14cf35e94a62acfa91293457d9) | fix(phone): isolate real Char and NPC conversations by stable contact ID [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 175 | [`48185a456a4f`](https://github.com/artibala866-cmd/SullyOS/commit/48185a456a4f0b9bda28a8b055cc3c8a6b110a91) | fix(phone): invalidate stale real and NPC conversations on clear or rebind [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 176 | [`5f28706f999a`](https://github.com/artibala866-cmd/SullyOS/commit/5f28706f999addf0c04094b81158f7bebaa02921) | docs(phone): audit transplanted safeguards and outstanding integration risks [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 177 | [`d5a1dea7ff04`](https://github.com/artibala866-cmd/SullyOS/commit/d5a1dea7ff046aa561d26f17f1bd523dd2db688a) | fix(spark): persist private DM drafts with ordered IndexedDB recovery | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 178 | [`0a7e2c4a2c55`](https://github.com/artibala866-cmd/SullyOS/commit/0a7e2c4a2c5514ab6e9a345318aafe522a36496b) | fix(spark): keep later private draft edits after send persistence | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 179 | [`1ee9d929cd71`](https://github.com/artibala866-cmd/SullyOS/commit/1ee9d929cd718e24963bcbe9030b97418bbc4762) | fix(spark): show DM draft persistence errors in composer and test aborted writes | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 180 | [`20b476f7de01`](https://github.com/artibala866-cmd/SullyOS/commit/20b476f7de0141f089146be3b4640609bc47662c) | fix(spark): narrow draft backup timestamp type before validation | A-候选：语音/缓存/安全/隐私/备份（需源码级确认） |
| 181 | [`57bbd0ac276e`](https://github.com/artibala866-cmd/SullyOS/commit/57bbd0ac276ecb49979a9cc7b2e99e3cd771afc3) | fix(phone): bound real NPC requests and guard delayed topic archives [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 182 | [`7247a086fb36`](https://github.com/artibala866-cmd/SullyOS/commit/7247a086fb36c13333bbe5b557ff6393cb5336ba) | fix(phone): reject ambiguous real identities in legacy contact binding [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |
| 183 | [`298410606cd2`](https://github.com/artibala866-cmd/SullyOS/commit/298410606cd24380ef3f00eba695627f4038adc0) | fix(phone): stage replacement cards before deletion and repair edited real mirrors [skip ci] | B-待核对：目标分支有相近功能（不可直接推定等效） |

## 重要路径差异及风险

- **不要恢复旧应用入口**：仅 master 有 `apps/CheckPhone.tsx`、`apps/VRWorldApp.tsx`、`apps/LifeSimApp.tsx`，目标已独立拥有角色手机和 3D 家园实现。必须核对实际调用后才决定是否有任何独立价值。
- **需优先判断的候选**：`api/elevenlabs/stt.ts`、`api/fishaudio/stt.ts`、`api/minimax/stt.ts`、`components/voice/StreamingVoiceBar.tsx`、`hooks/useStreamingVoice.ts`、旧 WebGL 恢复回归测试、启动/静态缓存、安全、备份、Spark 私信持久化及私有信息隔离。
- **不要搬迁 master 专用 CI 与发布配置**：`deploy-pages.yml`、`deploy-cloudflare-worker.yml`、隐私/Worker 同步工作流需独立审查部署目标。
- **目标保留的新体系**：`components/chat/CharacterPhone.tsx`、`utils/characterPhone*`、`apps/room3d/chibi/motionConstraintPipeline.ts`、`apps/room3d/chibi/legContactIK.ts` 和相关新测试，不能被旧代码覆盖。
- `CLAUDE.md` 已通过 `@AGENTS.md` 引入统一开发规则，不应维护第二份冲突规则。
- 目标分支 `spark-community-regression.yml` 的旧 push 引用已改为唯一目标分支；`home3d-motion-regression.yml` 仍引用 PR #8 的源/目标及旧基线脚本，未完成 PR 评审前不删除这两个分支。

## 后续验收闸门

1. A/B/F 逐项源码/测试证据核对，必要时最小移植；默认不移植不明确的功能。
2. 保留 PR #8 的尚未完成部分，核对视觉与实时交互，另定 PR 结案/迁移方式。
3. 清理远端分支前逐个刷新 SHA、查询开放 PR、检查工作流/部署/脚本/回滚依赖并记录删除结果；未完成不得标记成功。
4. 对当前分支执行完整依赖安装、相关 Vitest、TypeScript、生产构建、特殊审计、Pages 发布与关键浏览器交互验收。
5. 不改变 GitHub 默认分支；若确需改变需用户单独授权。

## 实际远端分支清理结果

- 已完成 one-time Actions 执行：[run 40667321969](https://github.com/artibala866-cmd/SullyOS/actions/runs/40667321969)，结论 **success**。
- 清理执行前逐项确认 14 个候选的原始 SHA 未发生并行变更、`behind_by=0`、无开放 PR 源分支引用、无有效工作流及脚本引用，也无活动部署记录；分别执行远端 ref 删除，并对每一个返回 404 验证不存在。
- **14 个远端独立分支已成功删除**；再次读取远端 branch API 后只剩 `master`、`remove-checkphone-vrworld-lifesim`、`feat/amaama-unity-retarget-probe`、`fix/home3d-motion-foundation-recovery-20261027`。
- 仍保留两个 PR #8 所依赖的 Home3D 旧分支。旧 Spark 分支在目标 Spark 回归运行 #339 成功并改正触发条件后纳入清理。
- 临时 SHA 检查清理工作流 `.github/workflows/one-time-history-branch-cleanup.yml` 仅用于这次清理，并已提交删除：`5de5e2676816227f6462feec64d43b6aafc17fbe`。此工作流不留作未来自动删分支的机制。
- `master` 默认分支、Cloudflare 配置、用户现有数据及主要功能文件均未因清理发生改动。

## 重点源码实查新增发现

- Home3D：目标 `apps/room3d/editor.js` 已有 `gpuContextLost`、`webglcontextlost`、`recoverFrameFailure`、`contextRecovery` 等对应恢复路径，**不能仅根据 master 多出来的回归测试就断定目标缺少 WebGL 恢复能力**；仍需浏览器故障注入验收。
- Spark 私信：`master` 的 `utils/sparkDMQueue.ts` 和 `apps/SocialApp.tsx` 有 `parseSparkDMThreadSnapshot`、`mergeSparkDMThreadSnapshots`、`dmReadyRef`、`dmPersistenceIssue` 等保存/恢复机制，而目标这两份文件缺少这些同名机制。**这是尚未证明功能等价的高优先级待核查差异**；不能直接覆盖目标 Spark 的新逻辑。
- 语音：目标存在 `apps/CallApp.tsx` 和 `api/elevenlabs/tts.ts`，但 master 独有三家 STT API、`utils/voiceStream.ts` 与配套流式语音组件；是否按当前需求继续提供这些能力尚待确认，禁止整套回填。
- 目标 Spark 回归已在 [run #339](https://github.com/artibala866-cmd/SullyOS/actions/runs/40666892594) 和 [run #340](https://github.com/artibala866-cmd/SullyOS/actions/runs/40667197261) 成功；实际 Pages 后续最新发布结果必须待 Actions 最新运行完成后再确认。
- 这些源码实查不是全部 183 个提交的逐项调用级验收；该后续工作仍属未完成事项。

## 二次复核：分支 UI 与 Home3D 回归（2026-10-28）

> 本节记录对上一轮报告的**纠错及新发现**；不能据此宣布所有 master 独有提交均已完成源码级审计。

- 先对历史初始 HEAD `9169f3680572f3edf0977e3f08306edece0afed3` 至首次交付 `87548856cbf59711d72a5a2fbe94818588ba2120` 进行 GitHub compare：6 个顺序提交净涉及仅 `AGENTS.md`、`.github/workflows/spark-community-regression.yml`、本台账 3 路径；临时一次性清理工作流不在最终文件树内。最后 Pages #1245、Spark #343 通过。无新增独立分支，master 未修改。
- **新增发现并修复（构建 UI 漏项）**：原 `vite.config.ts` 将 `main/master` 当作发布分支，遗漏当前唯一正式交付分支，导致后者默认启用 BuildBadge/DevDebugPanel。已经改为 `scripts/buildBadgeVisibility.ts` 的显式分支策略，并新增 `scripts/buildBadgeVisibility.test.ts`，纳入 Pages 部署前测试。历史 main/master 隐藏 UI 的既有规则不变；`VITE_SHOW_BUILD_BADGE=1` 仍可本地临时调试。同步修订 `README.md`、`docs/dev-debug.md`、BuildBadge 注释；未调整用户数据、API、其他部署目标。修复版 Pages [run #1252](https://github.com/artibala866-cmd/SullyOS/actions/runs/40668840468) 已包含专项测试、原有测试、构建和部署，结论 success；Spark [run #350](https://github.com/artibala866-cmd/SullyOS/actions/runs/40668840343) success。
- **PR #8 文件级复核**：从现有 PR 文件清单取得 27 条路径；其最新 head `f1a53df2b6ee28b5e58d4f716d088c5e4213a4e3` 与目标 HEAD 比对，26 个 blob SHA 完全相同，`apps/room3d/editor.js` 经后续修改（与旧 PR 版本不同），无缺失路径。Git 祖先关系和文件一致性不代表 49 动作视觉验收；PR 继续 Draft，两个来源分支暂留。
- **Home3D CI 触发遗漏**：目标现存 `home3d-motion-regression.yml` 有全部 23 个专项测试路径，但 push 仅监听旧 motion 分支，无法为目标分支的未来提交自动运行完整回归。本次仅增加目标分支 push 触发，保留 PR #8 旧分支触发、手工触发和旧基线比较脚本；验证 CI 是否通过后再考虑 PR 结案和老引用移除。该 test-only 工作流不部署网站。
- **仍未移植的高优先级修复**：目标 `apps/SocialApp.tsx` 的 `saveDMThreads` 捕获 localStorage 写入错误仅记录警告，`sendSparkDM` 继续清空输入并调用付费 AI；master 有 `DB.saveAsset` IndexedDB 备份、历史恢复、付费前确认、发送失败回滚与草稿保护。此处通过代码调用关系证实存在真实差异，但尚未安全适配、缺少失败注入回归，**不能认定已整合或覆盖整个 SocialApp**。
- **未改动的设置与风险**：GitHub 默认分支仍是 master；其历史 `AGENTS.md` 强制 master 的旧文字仍存在，只有当前目标分支和其 `CLAUDE.md` 已经使用新规则。必须显式检出目标分支；更改默认分支设置需用户新授权。Cloudflare/历史 Pages/Worker 同步流程依旧为独立部署对象，未擅自改触发。完整浏览器/真机验收仍未执行。
- **环境限制**：GitHub 连接器可读取和提交，但当前计算容器无 GitHub 网络 DNS，不能建立本地 Git checkout；`git status`、本地 pnpm 与浏览器验证无法在此环境直接完成。CI 通过不等于真实交互全部验收。
