# SullyOS 家园人物动作系统 · 持续审计与修复进度

更新时间：2026-10-27。**本文件记录可核实的代码事实、待验证项与后续执行顺序；不把代码提交等同于画面验收。**

## 0. 分支与保护边界

- 工作分支：`fix/home3d-motion-foundation-recovery-20261027`；基于 `feat/amaama-unity-retarget-probe` 的 `8e7afdaa`。审查入口：Draft PR #8（目标为开发分支，不是 `master`）。
- 文件 `docs/room3d-body2-actions.md` 保存上一 AI 的中断记录，相关的「154 项 / 153 项通过」属于**上一轮历史记录**，不能作为当前分支的测试结果。
- 既有 `selectedMotionCatalog.json` 49 条动作；`selectedMotions.ts` 中 8 个菜单分类；`motionCapabilities.ts` 中 10 个内部能力。均不得擅自减少。保留现有动作文件、专用姿势、原本的用户语义。
- 2026-10-27 重新核对：因执行环境无法访问外部网络，无法本地克隆完整仓库或在此环境安装依赖。正在为本分支建立只测试不部署的 CI 验证；无运行结果前标为**未验证**。

## 1. 十类能力与真实入口（逐项检查结果）

| 能力 | 现有实现/调用入口 | 当前状态 |
| --- | --- | --- |
| `singlePose` | `selectedMotions.ts`, `visitor.ts` | 已存在；全 49 画面待验收 |
| `handContact` | `socialContact.ts` → `furnitureHandRotation` | 共享手部求解已存在；方向退化修复已提交，待测试 |
| `bodyContact` | `socialContact.ts`, `selectedSocial.ts` | 只有简化躯干约束；拥抱/亲密完整碰撞未覆盖 |
| `armWrap` | `hugMotion.ts`, `hugArmClearance.ts` | 保留专用抱臂逻辑，拍背位移调整待测 |
| `faceContact` | `headContactIK.ts`, `templateFaceContact.ts` | 存在；嘴/头接触边界仍需视觉复核 |
| `seatTransition` | `seatChange.js`, 家具座位/床位路径 | 座位已有专用流程；不能误套站立 IK |
| `residentNavigation` | `residentNavigation.js`, `editor.js`, `visitor.ts` | 世界距离驱动步态已恢复；双人接近速率与扫掠空间待验收 |
| `pairedSync` | `selectedSocial.ts` | 共用时间轴保留；停止、切动作及多用户动态干涉待测 |
| `propInteraction` | `socialProps.ts`, `motionTemplateScope.ts` | 原道具生命周期保留，仍需中断回归 |
| `supportAndLift` | `intimacyMotion.ts` | 公主抱支撑锚和可达校正已修改；重量、惯性及不可达回退不完整 |

`motionContactProfiles.ts` 共有 8 个既有接触配置：`cmu-20_10`、`cmu-18_03`、`cmu-20_12`、`cmu-22_07`、`cmu-22_05`、`cmu-22_04`、`cmu-22_09`、`cmu-22_03`。这些配置已由 `motionConstraintPipeline.ts` 统一依序执行 `bodyPlacement → clearance → contactIK → presentation`，在 `motionTemplates.ts` 使用站立身高差策略。`home-hug`、亲吻、公主抱、沙发膝枕等仍是独立适配器，没有假装已完成整套模板迁移。

## 2. 已完成**代码提交**（不代表已通过测试）

| 模块 | 具体修改 | 验证状态 |
| --- | --- | --- |
| `roomWalk.ts`, `visitor.ts` | 恢复从 `40bed16e` 等提交找回的按世界移动距离驱动步态时钟；走停/切换重置 | 提交已核实；Vitest/画面待跑 |
| `legContactIK.ts` | 新增世界脚底快照、脚部角度保持、单支撑脚目标、切换滞回、时间跳变重置 | 提交已核实；需验证脚滑与 IK 连续性 |
| `standingHeightAdaptation.ts`, `intimacyMotion.ts` | 复用站立支撑捕获/恢复；接触后更新脚底；保留独立表演 | 提交已核实；要排查大身高差和补偿冲突 |
| `furnitureMotion.ts` | 向量平行或退化时建立稳定手部正交基 | 提交已核实；数值测试待跑 |
| `motionConstraintPipeline.ts`, `motionTemplates.ts`, `selectedSocial.ts` | 八种既有接触配置进入同一四阶段顺序，移除重复独立屈膝 | 提交已核实；八动作及坐姿兼容待测 |
| `intimacyMotion.ts` 公主抱 | 以肩宽、躯干与双臂可达约束取代固定骨盆偏移 | 提交已核实；不能认定完整动力学托举 |
| `hugMotion.ts` | 增加沿背部表面的拍背轨迹，保留原 `> .04` 位移测试要求 | 提交已核实；原失败尚未重跑 |
| 测试文件 | `utils/chibiRoomWalk.test.ts`、`utils/chibiFurnitureMotion.test.ts`、`utils/chibiMotionRecovery.test.ts`、原 `motionTemplates.test.ts` 和 `motionConstraintPipeline.test.ts` | **测试定义已添加/更新，不表示通过** |

## 3. 进行中的问题、已知风险

1. **阶段一 / 步态**：接触点锁定与真实距离时钟已连接，但起步加速度、急停减速、转身轨迹、骨盆横向重心、脚底与地形碰撞、双人接近时钟尚未完整实现。世界脚锁本身也必须经 30/60/120 Hz、移动父节点、身高变换和时间重置验证。
2. **阶段二 / 人体接触**：现有接触规则对胸/髋是近似体积，不是实际皮肤/服装碰撞；手肘、头发、身体局部穿透未全部受控。接触不能统一靠拉远角色解决。
3. **阶段三 / 身高差**：`standingHeightAdaptation.ts` 已复用脚部支持，但站立接触与 `intimacyMotion.ts` 的专用策略仍需验收不同体型/身份互换；保护已吸附座位。
4. **阶段四 / 公主抱**：当前属于运动学可达修复，尚缺支撑残差的统一不可达回退、惯性、承重重心与抱人行走的协调；不能宣称完成全过程动作重构。
5. **阶段五 / 系统协作**：动作过程中肢体扫掠与家具/墙/第三人占用空间的持续检查不足；快速取消/重开、道具失败及换人恢复需要完整验证。
6. **历史未解决失败**：上一记录的 `utils/chibiIntimacy.test.ts` 拍背位移约 `.02066`，原断言为 `> .04`。已修改拍背轨迹，**必须重测**，禁止放宽阈值。
7. **浏览器视觉验收未完成**：测试通过也不能替代动作画面检查。当前未证明无穿模、没有脚滑或所有 49 动作自然。

## 4. 验证清单及记录（严格区分）

- [x] 直接在 GitHub 核对 49 动作、8 菜单分类、10 能力及原始分支代码。
- [x] 从实际分支恢复世界步态时钟；修改/新增代码均有 GitHub 提交可回看。
- [x] 将旧「仅一个动作使用调度」的**过时范围断言**更新为八个动作覆盖，保持原定质量阈值不变。
- [ ] Vitest：`chibiRoomWalk`、`chibiFurnitureMotion`、`chibiMotionRecovery`、`chibiIntimacy`，以及 `motionTemplates`、`motionConstraintPipeline`、`standingHeightAdaptation`、`selectedSocial` 相关测试。
- [ ] TypeScript：改动文件零新错；全仓既有类型错误单独统计，不掩盖。
- [ ] 数值：三组身高、身份互换、脚底漂移、手掌距离、关节角度、30/60/120 Hz、时间跳转。
- [ ] 真实画面：接近→互动→结束/取消→重开、侧向/旋转、床/椅/家具/第三人附近、异常中断；49 动作全覆盖。
- [ ] 性能：行为循环的分配次数、低性能设备帧时间及无新常驻道具/IK 对象。

## 4A. 2026-10-27 实际 CI 与新发现

- **已通过**：测试专用 GitHub Actions（不构建、不部署、不合并）在提交 `6fadce7` 的运行 40421402302：9 文件 / 45 项 Vitest 全部通过；包括新加的真实骨架 80%/100%/125% 身高和旋转场景脚部测试，检验相同世界支撑点下滑移较未校正值小于一半；历史拥抱拍背 `> .04` 测试也通过，未改阈值。
- **已通过**：对 15 个修改涉及的 TypeScript 文件做与 `feat/amaama-unity-retarget-probe` 精确基线的差分诊断：基线 19 项 / 当前 19 项，**新增 0 项**；其他依赖文件现有诊断 18 项。这不是全仓 `tsc --noEmit` 成功。
- **本轮发现并处理、回归已通过**：`selectedSocial.ts` 原 `restore()` 在 `motionScope.stop()` 抛错时提前停止，会残留 `session`/`prop`。现通过 `stopSafely()` 先完成其他资源释放，再清理会话/恢复站姿；回归测试确认出错的资源不影响其他资源释放，下一次动作仍可启动。
- **修复迭代记录**：最初新增的真实脚锁测试出现 1.139 / 1.516（约 25% 改善）未达到 50% 指标。增加 IK 迭代无效；最终增加有上限的骨盆姿势层补偿、继续保留脚部 IK，随后 45 项测试通过；不得把原来的失败 run 说成通过。
- **扩大回归验证**：提交 `0c9a3e0` 的 GitHub Actions 运行 40422047381：18 个测试文件 / **100 项全部通过**，在脚步与接触外覆盖后抱、摸头、牵手、膝枕、面部接触、道具和导航空间；16 个目标 TypeScript 文件相对开发基线 **新增错误 0**（现有目标错误 19、其他依赖错误 18）。尚非完整 49 动作视觉矩阵。
- **仍待画面确认**：骨盆补偿上限和支持脚切换的视觉连续性、坐姿/第三人/家具附近扫掠、低端设备性能。绝不把数值通过等同于无穿模。

## 5. 下一步执行顺序

1. 运行只测试不部署的 CI，并逐项修复真实失败（不能跳过 `chibiIntimacy` 旧失败）。若自动测试无法启动，应保留未验证状态。
2. 复核脚部 IK + 世界移动 + 双人接近，完成支持脚切换与起停连续性，再推进下一阶段。
3. 将通用身体表面目标与穿透约束接入现有手部/臂部 IK，并保留亲密动作的专用时间曲线。
4. 公主抱增加不可达残差检测、恢复和完整承重/移动路径（先数值后浏览器验收）。
5. 测试通过并获得视觉验收之前，PR 保留 Draft，**不合并 `master`，不发布或部署网站**。

每次继续开发请先读本文件；每一模块按“修改了什么 → 解决了什么 → 测试了什么 → 还剩什么”更新。
