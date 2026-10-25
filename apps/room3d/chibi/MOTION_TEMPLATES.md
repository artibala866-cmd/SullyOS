# SullyOS 3D 家园：第五阶段动作模板开发手册

> **这是内部复用系统，不是新增菜单。** 原有 43 个动作及八个可见分类必须保持不变（目前另新增摸头、背后搂抱，共 45 个动作）。后续新动作应采用配置驱动，且不要额外引进一套 Three.js 动画播放器、动态物理引擎或每帧扫描全部动画资源的脚本。

## 总体结构与唯一入口

```text
selectedMotionCatalog.json            用户能看见的动作元数据（ID、时长、参与人数、JSON 文件）
  └─ selectedMotions.ts               原有按需 fetch、clip Promise 缓存、共享采样器
       └─ selectedSocial.ts           单一双人时间轴 + 角色站位 + 原始素材姿态
            ├─ motionTemplates.ts     新动作模板注册表（静态、参数化、启动时验证）
            ├─ motionConstraintPipeline.ts  动作阶段调度（已复用，无每帧排序）
            ├─ motionTemplateScope.ts       临时资源统一归属与释放
            ├─ motionContactProfiles.ts     已有 3 个握手 + 5 个身体接触动作自动继承
            ├─ pairedHandContact.ts         复用手掌配对缓存与现有 contactSolver
            ├─ socialContact.ts             现有手/上臂 IK 和骨骼接触配方
            ├─ templateFaceContact.ts       新模板可选的额头、脸颊、鼻尖方向轻调
            ├─ faceContactProfiles.ts       头脸局部锚点缓存、接触误差
            └─ socialProps.ts + waterGrip.ts 新模板手机/水杯道具与统一 dispose
```

**运行顺序（单一拥有者）**：校验动作 ID 和人数 → 懒加载对应动作 clip → 依据场景计算可达站位 → 行走到位 → 采样原始动画 → 应用角色根姿势 → 共享阶段调度（身体防穿模 → 头部避让 → 手/面接触 IK → 道具与表情）→ 结束或取消时释放该动作创建的临时道具和阶段状态。**不能新增第二个 render loop 或与 `selectedSocial.ts` 并行操控 root。**

### 十类能力与复用边界

| 内部能力 | 可复用的现成接口 | 新动作默认行为与限制 |
| --- | --- | --- |
| `singlePose` | `motionTemplatePresets.singlePose()`、原有采样器 | **即用**：单人姿态、表情走统一时间轴 |
| `handContact` | `pairedHands({pairing,enter,exit,curl})`、`applyPairedHandContact` | **即用**：两个角色共享接触目标，首次 clip 采样手掌配对并缓存 |
| `bodyContact` | `bodyTouch({targetBones,near,far})`、原 `contacts` | **即用**：上臂/肩部目标，不保证肩/背的任意接触面都精确贴合 |
| `armWrap` | 原有 `hugMotion.ts`、`hugArmClearance.ts`、`rearHugMotion.ts` | **专用适配器**：保护现有拥抱，不能直接套普通手掌 IK |
| `faceContact` | `faceContact('foreheadKiss')`、`templateFaceContact.ts` | **轻量方向调节**：额头、鼻尖、脸颊、唇部锚点；不保证绝对吻到皮肤，不替换原亲吻 IK |
| `seatTransition` | `seatEntry`、`seatChangePose`、`getResidentPosture` | **专用适配器**：坐/站/床姿必须通过既有家具状态机，不能直接改 root |
| `residentNavigation` | `findWalkPath`、`residentWalkMap`、角色占位 | **自动复用**：共享路径、避让、移动占位；被挡优先按需重规划 |
| `pairedSync` | `selectedSocial.ts`、单个 `session.time` | **自动复用**：两个角色同一时钟，不能分别启动或结束 |
| `propInteraction` | `phone(hand)`、`cup(handoffAt)`、`socialProps.ts` | **即用**：为新 ID 配置手机或水杯，道具随动作创建，取消即清理 |
| `supportAndLift` | `intimacyMotion.ts`、`legContactIK.ts` | **专用适配器**：重心、着地、托举均有特殊约束，不能假装普通双人动作能完成 |

十类并不意味着每类都可直接靠一段配置生成自然动画。**普通单人、配对手掌、肩部接触、轻量面部方向和手机/杯子道具是即用能力**；完整拥抱/坐姿/举起模型仍需引用经验证的专用模块。配置检查会拒绝缺少适配器的 `armWrap`、`supportAndLift`、`seatTransition`，不会默默退化为穿模动作。

## 新动作操作规范：常见动作不改播放器

1. 先准备动作素材 JSON 和授权来源，存放在原有路径 `public/room3d/motions/selected/<id>.json`；须符合现有 `SelectedClip` 格式，包含同一时间轴及对应角色数据。**切勿直接把额外动画包打进入口 bundle。**
2. 在 `selectedMotionCatalog.json` 增加一条元数据，填写 `id,label,category,source,sourceUrl,duration,participants,file,hashes`；`category` 必须是现有八个 UI 类别之一。不要改 `selectedMotions.ts` 加分支。
3. 在 `motionTemplates.ts` 的 `authoredMotionTemplates` 中配置新 ID。使用下方现有 preset；不用再追加分散的 `if(id===...)`。
4. 手掌配对的 `enter/exit` 是 **行走接近结束后的动作时间**，要先根据素材逐帧找接触时刻；原播放器普通动作对源帧有 **0.6 秒延迟**，务必实测贴合。手指卷曲 `curl` 范围 0–1。
5. 有两人时参与者必须正好为 2；严格检查起终点及家具占位，且保持一个共享 `session.time`。两个角色的名称与位置不能随意对调，除非素材角色顺序明确且有专门重映射。
6. 回归测试先运行模板测试和旧动作测试；在 Android Chrome 实测身高差、附近有第三人、家具旁、取消中途动作、重复启动同动作以及刷新后重进。

### 可直接粘贴的手掌动作模板

```ts
// motionTemplates.ts 内 authoredMotionTemplates 对象
'my-hand-action':motionTemplatePresets.pairedHands({
 pairing:'sampledClosest',
 enter:[.90,1.30], // 从动作开始计时（已考虑源帧延迟）
 exit:[2.1,2.4],
 curl:.35,
}),
```

运行时自动：使用目录对应 JSON → 行走到位 → 同步角色动画 → 已有共享手掌目标 → 已有手臂 IK 和手指卷曲 → 结束清理。**不需要新建手掌 IK 文件。**

### 可直接粘贴的扶肩动作模板

```ts
'my-shoulder-action':motionTemplatePresets.bodyTouch({
 targetBones:['L_upperArm','R_upperArm'],
 near:.47,far:.64,
}),
```

运行时自动保留原身体接触范围判断；`near`、`far` 是素材空间中的触发区间，必须检查身高与目标骨骼，不能凭视觉猜数值。

### 单人、表情、手机、水杯

```ts
'my-idle-action':motionTemplatePresets.singlePose(),
'my-phone-action':motionTemplatePresets.phone('L'),
'my-cup-action':motionTemplatePresets.cup(1.65), // 1.65s 从 A 交接给 B
```

手机的骨骼挂点、离开动作时的 dispose；水杯的握持目标和交接时间由模板接入旧系统。不应将手机/水杯重复创建到常驻场景，更不要让道具引用阻止角色被回收。

### 可选的面部模板（不是自动生成完整亲吻动画）

```ts
'my-forehead-motion':motionTemplatePresets.faceContact('foreheadKiss'),
'my-nose-motion':motionTemplatePresets.faceContact('noseTouch'),
'my-cheek-motion':motionTemplatePresets.faceContact('cheekKissLeft'),
```

此模板按需使用面部锚点和有限头/颈朝向修正，不更改根节点，也不会动现有的 `home-kiss`。如要真正接触皮肤，仍需配合素材、距离和高度接触误差检查。

### 复杂动作：必须保留专用适配器

```ts
// 不允许把以下动作强行声明为普通 pairedHands：
// 双人拥抱（armWrap）
// 坐着互动/从椅子起身（seatTransition）
// 公主抱或托举（supportAndLift）
// 双人特殊手部支撑（如掰手腕）
//
// 这些能力有现成专用逻辑，但每种新动作仍要验证骨骼、接触点和安全距离。
// 要复用它们，先写基于原模块的受控适配器和回归测试，
// 再通过模板的 adapter:'legacy' 声明（仅已经实际接线时）。
```

**严禁**为了让模板验证通过而随意把复杂动作标为 `adapter:'legacy'`，却不接线真实的姿势执行函数。

## 减少网页/手机负担的硬性约束

- 素材仍由 `loadSelectedMotion` 按需 fetch 和 Promise 缓存，不启动时拉取全部 45 条 JSON，更不能因为声明了 10 类而预建 10 套 IK。
- `motionTemplates.ts` 只含轻量静态参数，注册表一次构建、结果冻结。新动作启动时查表，不在每帧寻找模板、生成闭包或解析 JSON。
- `motionConstraintPipeline` 只执行预配置四个阶段；只有明确配置 `phases` 的动作才走新路径。其余动作完全保留旧路径。
- 配对手掌继续用 `pairedHandContact.ts` 的 WeakMap 缓存源 clip 对应的手对。人体求解器继续每位居民创建一次，不因每帧接触重复创建。
- `motionTemplateScope` 负责临时道具：取消、新动作启动、正常结束统一 dispose，清空持有数组，防止舞台垃圾累积。
- 寻路仍只在需要规划/临时受阻时调用，不在接触 IK 每帧重复 A*。
- **模板减的是重复逻辑和无效运行时构建，不代表 JSON 动画本身变小，也不保证包体有确定比例的减重。** 评估性能要用实际 Android Chrome Profiler / Performance 数据。

## 开发自检与验收

CI 构建将对本模块运行定向 Vitest：模板注册、参数错误、原有动作回归、资源生命周期、接触时间曲线、额头锚点、道具清理、窄路寻路和动作站位。新增动作必须至少增加“动作配置验证 + 动作后清理 + 接触时间窗 + 障碍/角色占位”测试。

```bash
pnpm exec vitest run apps/room3d/chibi/motionTemplates.test.ts apps/room3d/chibi/motionContactProfiles.test.ts apps/room3d/chibi/motionConstraintPipeline.test.ts apps/room3d/chibi/templateFaceContact.test.ts apps/room3d/chibi/socialPropsTemplate.test.ts
pnpm run build
```

实机最小检查：不同身高的 User/Char 手掌确实接触、两人互不穿模；角色坐起身时不突然横移；动作可取消/可重复；第三人靠近时动作不过早拒绝；短暂障碍只低频重新规划；道具结束后不留在场景。

## 参考与授权

- Three.js `AnimationMixer` / `AnimationAction`：借鉴 **Clip 与 Action 分开、动作实例复用** 的架构，但项目继续沿用现有采样器和统一场景播放器，没有再叠加第二个 Mixer。
- Three.js `CCDIKSolver`：继续调用已安装 `three` 依赖的现有求解器；不直接复制第三方动作和人物模型。
- 后续如要借鉴开源项目代码或动作数据，先核对许可证、素材来源、动作数据再分发限制，尤其避免未经许可的商业游戏动作资源。

此方案是为新动作提供可复用入口，不是宣布所有未知动作都能无需校准而自动变自然。专用动作依旧需要针对几何体、骨骼、素材做视觉测试。

### 模板道具的执行优先级与专用适配器安全阀

- 新 ID 配置 `cup(handoffAt)` 时，普通双手接触 IK 自动跳过水杯握持阶段，由 `waterGrip` 单独控制交接，避免两个求解器同时争夺手掌。
- `adapter:'legacy'` 不能让未知 ID 伪装成已实现的拥抱/托举动作。编译器只认可真正已绑定的既有专用动作，其他 ID 会明确报错。未来新增复杂动作，先完成并验证对应专用适配，再扩充允许列表。

**两种动作时间务必分清**：`pairedHands.enter/exit` 和 `faceContact` 的渐入/渐出使用接近结束后的 **actionTime**；而 `cup(handoffAt)` 控制 `socialProps.update(sourceTime,...)`，参数是素材 **sourceTime**。播放器普通动作有 0.6 秒的源帧延迟；水杯交接要按素材中的实际握手帧设定，不能直接把 actionTime 填给 `cup`。

## 实例：摸头（新增亲密动作）

- ID `home-head-pat`；名称「摸头」，`close` 分类，原 43 个动作不变；连同背后搂抱，目前总数 45。
- 使用 `motionTemplatePresets.headPat({patSide:'R',patStrokes:2,ruffleStrokes:2})`；以后同类动作只需配置手和次数，不需要新建播放器。
- `public/room3d/motions/selected/home-head-pat.json` 是双人站位与时间轴的轻量静态 clip，`headPatMotion.ts` 调用现有 idle 姿态、头顶锚点与 contactSolver，所有接近与复位仍由 `selectedSocial.ts` 管理。
- 依次是单手摸两下（约 1.10–3.10s）、双手揉两下（约 3.70–6.28s）、收手复位（约 7.18s）。两只手各自在头部左右上侧揉动、不越过头顶中央，接触位置随当前头部实时更新。
- 被摸者先顺从微低头，之后晃头、稍微后缩并露出惊讶表情，最后恢复微笑。这里的「炸毛」是演出反应，**没有改动发丝物理或发型网格**。
- 不修改拥抱、亲吻等现有专用逻辑，也不增加每帧常驻物理任务。新 `headPatMotion.test.ts` 测单/双手次数、头顶追踪、不滑动根节点和表情；Android Chrome 实机还需检查不同身高发型是否准确接触。

## 身高差自动适配（复用体系新增）

### 核心规则

- 公共实现 `standingHeightAdaptation.ts`：仅在正在执行的双人**站姿动作**使用；基于两位实际角色当前 **world-space 头顶高度**决定高矮，**不检查 User 或 Char 身份**，角色互换同样生效。
- `standingHeightPlan()` 是可测试的纯计划函数；`headReachDeficit()` 根据实际肩关节、上臂、前臂与对方实时头顶位置计算手臂长度可达性；`applyStandingHeightAdaptation()` 负责屈膝、上半身前倾、抬头与低头。
- **高的一方**：左右膝同步屈曲、躯干向互动对象前倾、头和脖子轻轻低头。用原有 `translatePose` 补偿左右脚中最低的鞋底接触高度；不会修改导航 `root.position` 或改变骨骼长度。
- **矮的一方**：原地自然抬头，与较高者建立视线，不强制漂浮、伸长骨骼或移动人物根节点。
- 先原素材/idle 姿态 → 原有躯干安全间距 → **身高差自适应** → 原有头部间距检查 → 手部/面部 IK → 表情与道具。禁止在手部 IK 之后突然再改变整个人的身高。
- `standingHeight:'gaze'` 适用需要相互望向对方的新站姿动作（小幅体态）。
- `standingHeight:'contact'` 适用手掌/身体普通接触新动作（中度体态）。`motionTemplatePresets.pairedHands()`、`bodyTouch()` 默认自动带此配置。
- `standingHeight:'headReach'` 适用摸头、抚摸高位头部等动作（允许更大范围屈膝，并参考真正手臂可达距离）。`headPat()` 默认使用。
- `standingHeight:'none'` 禁用。动作人数不是 2 或声明非站立姿态时，模板注册表直接拒绝错误配置。
- 头顶动态调整和身高差自动屈膝**不改变现有拥抱、亲吻、公主抱和坐姿专属求解器**；这些已有更复杂的站姿/落地约束。已有未经迁移的素材动作仍保持原来的动作轨道，新的通用身高差层优先为摸头和所有未来新模板服务，避免在未实机对比前重写旧动作。
- 身高差由当前世界高度重新取得，不读固定的 `rig.bodyHeight` 差。每帧只在活动期间执行两个人的有限骨骼与接触点计算；不新增全身物理、全局时钟或额外动画/模型下载。

### 摸头动作复测重点

1. User 比 Char 矮：Char 被摸时应主动屈膝弯腰，User 轻微抬头，User 的手臂不再倒向身后或者悬在半空。
2. 交换角色，由高个发起摸头：高个同样应主动弯腰、低头，矮个望向高个，不允许针对 User 身份判断。
3. 同身高：应几乎不启动身高补偿，保留原版单手两次轻摸与双手两次揉头。
4. 动作开始及收尾姿势渐入渐出；脚底无长距离滑动；相邻家具/第三人不被角色根节点穿过；中途取消后动作解除。
5. **极端身高差**：手臂与腿部角度有上限，避免反关节或让脚底悬空；超过实际骨长可达范围的情况依然需要实机观察、调整合理的接近站位，不能保证任意身高比例都能接触。

检查命令：

```bash
pnpm exec vitest run apps/room3d/chibi/standingHeightAdaptation.test.ts apps/room3d/chibi/headPatMotion.test.ts apps/room3d/chibi/motionTemplates.test.ts
```

### 摸头手掌反转、交叉与穿模修复

- **接近距离**：仅将 `home-head-pat.json` 的双人站位从素材 Z 方向 ±0.50 改为 ±0.36；移动仍需通过现有寻路和碰撞检查，不能瞬移，不改其他动作。
- **手掌坐标**：`headPatScalpSize()` 按接收者真实的头部缩放计算宽度，`headPatHandGoal()` 以摸头者的实际左右肩方向构造左右独立的头部侧面接触目标。两手分别落在头宽的约 75% 处，揉动只在对应侧面做小幅切向运动，不再落在头顶中心，也不随动作交叉换侧。
- **掌心贴头皮**：`furnitureHandRotation` 仍用于现有骨骼，手的局部 -Y 掌面朝向头皮；侧面使用椭球头皮法线，手指则沿与法线垂直的切线指向，避免原来法线与手指方向重叠导致手腕翻转。
- **避免穿模与反关节**：目标位于头部左右上侧的估算发际表面，非头顶中心；计算真实肩→肘→腕可达长度，遇到需要穿过头部中线才能到达的目标，停止那只手的错误 IK 指令，优先让身高差组件降低高个姿态。不保证超出真实骨长时一定能接触。
- 自动测试涵盖 User／Char 互换等价场景、矮摸高／高摸矮／等高、双手不交叉、掌心方向、头顶安全距离和不可达目标限幅；实机最终触摸效果仍需逐角度校准。

- 测试新增真实 `contactSolver` CCD 求解后的左右腕骨检查，以及两侧位置、头皮法线方向、矮摸高／高摸矮和大头缩放情形；这些测试不等于 Android 实机视觉验收。

## 实例：背后搂抱

- `home-rear-hug`：双人站立，新增「亲密」动作，7.5 秒是接近到位后的动作段；保留原入抱和回应节拍，只延长拥抱保持 2.5 秒。
- 使用现有 clip 懒加载/场景播放器，靠 `intimacyMotion.ts` 分派专用 `poseRearHug()`；不新增动画循环，不把复杂拥抱伪装为普通 `pairedHands` 模板。
- 运行时复用原有手部 IK、胸廓外表面约束、肘部保护、手指姿态和高方弯膝着地；保持 B 朝向并让 A 通过侧面绕到后方。
- A 的双手以被抱者实际腰部骨骼作为相对锚点，各自保留外侧通道；短手无法交叠时接近腰侧表面，不允许穿胸。
- A 高时小幅屈膝形成包裹感；A 矮时不强迫 B 弯腰，A 二次轻收紧并靠向背部，B 延迟侧头与覆手回应。
- 相关测试：`rearHugMotion.test.ts`，覆盖注册、相位、缩放/朝向、两侧接触点、人物绕路。仍需 Android Chrome 测试穿模、发型、身高差和脚步。


- 复测修复：删除背后搂抱收尾的专属退步/走路帧；普通家园寻路先行，仅当路线真的穿过 B 身体时才尝试局部绕行。B 原地不走、不参与额外路线/站位空间检查。
- 手部 IK 仍使用全局 `contactSolver`，修正的仅是背后搂抱的接触参数：手背的局部 +Y 指向腰部表面向外法线，手心的 -Y 才指向腰；不再以固定世界 +Z 让腰侧或背后目标翻掌。近距离继续使用动态骨骼表面与可达性回退。
