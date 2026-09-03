# Fork Notes（workflow-editor 分支）

本 fork 服务于「水壶工作流仓库」的画布化项目。硬性纪律：**只允许新增文件和本表登记的锚点行**；一切能放进主仓库 `canvas-bridge/` 的逻辑禁止写进本 fork。每次同步上游后逐条复核本表。

## 锚点登记

| # | 文件 | 位置/符号 | 改动 | 原因 | 登记日期 |
|---|---|---|---|---|---|
| 1 | `canvas-agent/src/tools.ts` | `compactNode()` 内容截断条件 | `length > 240` 追加 `&& startsWith("data:")`（单行） | 画布编辑回读需要完整文本内容；原截断意图是防 base64 大图撑爆响应，收窄到仅 `data:` URL 后意图保留、普通文本不再截断 | 2026-07-11 |
| 2 | `web/src/components/canvas/canvas-local-agent-panel.tsx` | `toggleAgentConnection()` 成功分支 | 新增 2 行：把 endpoint/token 写入 localStorage（键与 use-agent-store.ts:103 一致） | 上游不一致：面板连接不持久化，导致刷新/agent 重启后 app-top-nav.tsx:29 的自动重连因 token 为空而失效；本改动可直接 PR 上游 | 2026-07-11 |
| 3 | `web/src/stores/use-agent-store.ts` + `web/src/components/agent/agent-panel.tsx` | `confirmTools` 初始值 + 面板 Switch onChange | 各 1 处：初始值读 localStorage（键 `canvas-agent-confirm-tools`，缺省仍为开启），开关切换时写入 | 上游每次刷新把"工具确认"复位为开启，桥接批量推送会被待确认卡片阻塞超时；持久化后用户选择跨会话生效 | 2026-07-11 |
| 4 | `AGENTS.md` | 文件顶部 | 新增 1 段引用块：指向本登记册的 fork 纪律提示 | 智能体（Codex 等）在 fork 内工作时自动读 AGENTS.md，不加指针就看不到锚点纪律；上游合并冲突时保留本行并复核 | 2026-07-11 |
| 5 | `canvas-agent/src/agents.ts` | Codex thread 参数与 `turn/completed` 处理 | 新线程支持可选 `model`；`agent_done` 保留真实 turn status，`failed` / `interrupted` 即使无 error 正文也按失败处理 | canvas-agent 内置 Codex 版本可能与全局模型配置不兼容；不能把失败回合投影成空的成功回复 | 2026-07-13 |
| 6 | `canvas-agent/src/http-server.ts` | `POST /agent/codex/threads/new` | 接收并清理可选 `model` 字符串，传给通用 Codex 新线程入口 | 允许开发适配器选择已验证兼容的模型，不把模型选择写进工作流业务路由 | 2026-07-13 |
| 7 | `canvas-agent/package.json` | `scripts.test` | 使用 Node 内置测试运行器和现有 `tsx` 执行 `src/*.test.ts` | 为上述低侵入锚点提供无需新增依赖的回归测试 | 2026-07-13 |
| 8 | `canvas-agent/src/agents.ts` + `canvas-agent/src/agents.test.ts` | Codex app-server stdout UTF-8 分块解码 | 同一输出流使用 Node `StringDecoder` 连续解码，并覆盖中文 JSON 在多字节字符内切块的回归测试 | 避免每个 Buffer 单独转字符串时把跨块中文字符替换为 U+FFFD；不改变协议或业务语义 | 2026-07-14 |
| 9 | `web/src/pages/canvas/project.tsx` | `createConnectedNode()` 的面板打开条件 | 删除输入类型中不可能出现的 `Group` 重复判断（单行） | 恢复现有 TypeScript 基线检查；连接创建菜单本就不允许创建组节点，因此用户行为不变 | 2026-07-18 |
| 10 | `web/src/types/canvas.ts` | `CanvasNodeType` 与 `CanvasNodeMetadata` | 新增 `Workflow` 节点类型、演示状态和演示图片来源元数据 | 让纯前端工作流机器及其演示产物有明确且可持久化的类型合同 | 2026-07-18 |
| 11 | `web/src/constant/canvas.ts` | `NODE_DEFAULT_SIZE` 与 `NODE_SPECS` | 登记工作流演示节点的默认尺寸、标题和待机状态 | 让工具栏可按现有节点工厂创建一台状态完整的演示机器 | 2026-07-18 |
| 12 | `web/src/components/canvas/canvas-node.tsx` | `NodeContent()` 与 `nodeContentRenderers` | 新工作流类型走专用富内容渲染分支，并补齐穷举回退 | 复用 Config 节点的低侵入注入先例，不改变既有类型渲染或连接点 | 2026-07-18 |
| 13 | `web/src/components/canvas/canvas-toolbar.tsx` | `CanvasToolbar` 参数、节点工具区与 `toolLabel()` | 新增“工作流”创建按钮及提示 | 用户可从现有底部工具栏直接放置演示机器 | 2026-07-18 |
| 14 | `web/src/pages/canvas/project.tsx` | 工作流控制器接入、节点/面板渲染、工具栏创建、删除/清空清理、刷新恢复、费用卡与 `normalizeConnection()` | 接入纯前端确认门和流式上桌，工作流左输入点按输入方向连线，删除或离开时取消计时器 | 完成 M1-a 交互闭环，同时不改既有生成函数、后台请求或普通节点连接规则 | 2026-07-18 |
| 15 | `web/src/components/canvas/canvas-node-hover-toolbar.tsx` | `CanvasNodeInfoModal` 类型名称 | 新类型显示为“工作流” | 避免节点信息把演示机器误标成“生成配置” | 2026-07-18 |
| 16 | `CHANGELOG.md` | `Unreleased` | 新增一条 M1-a 版本级记录 | 让 fork 的用户可感知变化进入既有发布记录 | 2026-07-18 |
| 17 | `docs/content/docs/progress/pending-test.mdx` | “待测试”清单 | 新增工作流演示人工验收项 | 按 fork 文档纪律记录尚待用户亲手确认的真实交互 | 2026-07-18 |
| 18 | `web/src/types/canvas.ts` | `CanvasWorkflowDemoStatus` / `CanvasWorkflowDemoMetadata` | 新增后台排队状态及请求/进度时间戳 | M1-b 由桥接常驻服务接管后，前端只写命令并显示排队、进度与离线超时，不再把浏览器计时器当执行事实 | 2026-07-18 |
| 19 | `CHANGELOG.md` | `Unreleased` | 新增 M1-b 后台接管的用户可感知记录 | 说明占位图已由本机 demo 服务真实落盘后流式上桌，仍为零模型/零费用 | 2026-07-18 |
| 20 | `web/src/types/canvas.ts` | `CanvasNodeType.BatchInfo`、批次登记及 `sourceFile` 元数据 | 新增信息卡、七项事实、独立登记状态、回执和磁盘原图 SHA-256 凭证类型 | 让 M2-a 信息卡与无损原图通道有可持久化合同，同时不改变现有 manifest 字段 | 2026-07-18 |
| 21 | `web/src/constant/canvas.ts` | `NODE_DEFAULT_SIZE` 与 `NODE_SPECS` | 登记信息卡默认尺寸、固定 6+8 / 手持 2+1 和初始开关 | 让工具栏按现有节点工厂创建一张完整但尚未登记的信息卡 | 2026-07-18 |
| 22 | `web/src/components/canvas/canvas-node.tsx` | `NodeContent()` 与 `nodeContentRenderers` | 新信息卡类型走专用富内容渲染分支并保留兜底 | 不改变既有节点渲染和连接点，只为 M2-a 注入原生画布卡片 | 2026-07-18 |
| 23 | `web/src/components/canvas/canvas-toolbar.tsx` | `CanvasToolbar` 参数、节点工具区与 `toolLabel()` | 新增“信息卡”创建按钮及提示 | 用户可从现有底部工具栏直接放置批次信息卡 | 2026-07-18 |
| 24 | `web/src/pages/canvas/project.tsx` | 信息卡控制器接入、原始 File 凭证、节点渲染、工具栏创建、删除/清空和刷新恢复 | 磁盘图片首次入画保存原字节 SHA-256，派生图清除原图标记；信息卡只写 `build: batch` 并在本机服务接单后逐图无损上传 | 完成 M2-a 画布内登记闭环，不把 M1“开始”按钮变成真实生产 | 2026-07-18 |
| 25 | `web/src/components/canvas/canvas-node-hover-toolbar.tsx` | `CanvasNodeInfoModal` 类型名称 | 新类型显示为“信息卡” | 避免节点信息把批次卡误标成生成配置 | 2026-07-18 |
| 26 | `CHANGELOG.md` | `Unreleased` | 新增 M2-a 信息卡与无损登记的用户可感知记录 | 明确登记不生图、不收费，SHA-256 不一致时硬停止且不重试 | 2026-07-18 |
| 27 | `web/src/types/canvas.ts` | `CanvasNodeMetadata` 与 M2-b 类型合同 | 新增真实制作、正式图片、风格补登状态与回执字段 | 让费用确认后的生产状态、浏览器持久化证明和信息卡补登可随画布保存，不复用 M1 演示状态 | 2026-07-20 |
| 28 | `web/src/pages/canvas/project.tsx` | M2-b 控制器接入、刷新恢复、删除/清空取消、节点/费用卡渲染与信息卡目标连线方向 | 连接已登记信息卡时进入真实费用门和后台命令；正式图片转存 localforage，风格图可直接连入信息卡；无信息卡仍走 M1 演示 | 保持画布原生产品面，不加入九工序或前端业务路由 | 2026-07-20 |
| 29 | `web/src/components/canvas/canvas-workflow-node.tsx` | 机器卡状态与详情面板 | 按信息卡连线显示“真实”批次、人话进度、暂停续跑和 QC 前完成状态 | 用户只看到机器行为与结果，不看到后台工序或日志 | 2026-07-20 |
| 30 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 登记完成回执区域 | 增加风格参考直连数量、补登按钮、人话状态和独立回执摘要 | 落实用户选择的“画布补登 A”，旧建批字段和原图回执保持不变 | 2026-07-20 |
| 31 | `CHANGELOG.md` | `Unreleased` | 新增一条 M2-b 真实费用、流式真图与风格补登的版本级记录 | 让用户可感知变化进入既有发布记录 | 2026-07-20 |
| 32 | `docs/content/docs/progress/pending-test.mdx` | “待测试”清单 | 新增 M2-b 阶段 E 真实费用、逐张上桌、持久化、续跑与补登验收项 | 纯离线实现已完成，但真实调用仍须逐闸门批准并由用户验收 | 2026-07-20 |
| 33 | `web/src/lib/canvas/canvas-style-reference-intake.ts` + `web/src/pages/canvas/use-canvas-style-reference-intake.ts` | 风格补登命令前健康预检与四级人话降级 | 先读取 17373 工作台健康状态；服务未开、工人已停或画布重连时不生成请求编号、不启动 8 秒计时，恢复后仍须用户重新点击 | 修复僵尸工作台让画布误以为已发单的问题，不自动重试、不改变补登字节通道 | 2026-07-20 |
| 34 | `CHANGELOG.md` | `Unreleased` | 新增一条风格补登健康预检的用户可感知修复记录 | 让服务、工人、重连与未确认的分级提示进入既有发布记录 | 2026-07-20 |
| 35 | `docs/content/docs/progress/pending-test.mdx` | M2-b 待验收项 | 补记四级提示、发号前阻断和恢复后手动重试的现场验收点 | 自动测试通过后仍需用户在真实画布亲手验收 | 2026-07-20 |
| 36 | `canvas-agent/src/agents.ts` + `canvas-agent/src/agents.test.ts` | Codex 回合完成判定与脱敏失败码 | `turn.completed` 只有在本轮出现非空助手答复时才成功；空答复或错误通知返回固定安全码，原始异常不进入完成事件 | 防止本地 Codex 静默完成却被 Canvas Agent 宣布成功 | 2026-07-21 |
| 37 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/tests/canvas-workflow-production.test.ts` | 真实费用确认后的单页闸门锁 | 同一页面内同一机器/批次只允许一次费用确认提交；再次执行须另获批准并重新打开画布后由用户亲手开始 | 防止一次阶段 E 闸门在首次失败后收到第二条制作命令，不引入自动重试 | 2026-07-21 |
| 38 | `canvas-agent/src/agents.ts` + `canvas-agent/src/agents.test.ts` | Codex 备用失败事件、附件协议与线程状态摘要 | 回合异常回收时只发送白名单失败码；0/1/2 张本地图片继续使用既有 `localImage` 输入；对象状态显示稳定状态名 | 防止主仓只收到备用 `agent_error` 时丢失 `empty_assistant_response`，同时消除 `[object Object]`，不改变模型或附件协议 | 2026-07-21 |
| 39 | `canvas-agent/src/http-server.ts` | Codex 新线程与回合入口的可选档位参数 | 接收 `effort` 后按内嵌 Codex 0.139.0 合法值校验并传给通用线程入口；非法值固定返回 400，且不回显原值 | 让主仓可显式固定生产档位，同时避免未知值进入 Codex 线程 | 2026-07-21 |
| 40 | `canvas-agent/src/agents.ts` | Codex 模型与档位线程参数及异常重建 | `thread/start` 可选携带 `model + effort`；可恢复线程异常重建时两项设置继续保留，未提供档位的普通回合仍省略 | 消除生产图文回合对外部档位的被动继承，不改变普通画布会话 | 2026-07-21 |
| 41 | `canvas-agent/src/agents.test.ts` | Codex 档位显式传递与隔离回归 | 覆盖 `gpt-5.5 + xhigh`、合法值白名单、非法值脱敏拒绝、异常重建保留和普通回合不受影响 | 锁定生产确定性，并保护既有 0/1/2 图和普通线程行为 | 2026-07-21 |
| 42 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/src/components/canvas/canvas-workflow-node.tsx` | completed 机器继续入口、生产命令与完成态文案 | completed 不再在费用确认前被拦截，确认后固定发送 `run: next`；paused/部分失败仍用 `retry: renders`；状态行优先显示后端 message，无 message 时使用路由中性文案，按钮改为“继续/质检” | 已出齐 14 张的机器可由后端按现场路由进入 QC 或幂等完成，不会误发重渲染命令，也不再显示“停在质检前/制作完成”误导表述 | 2026-07-24 |
| 43 | `web/tests/canvas-workflow-production.test.ts` | completed 继续、文案与单页提交锁回归 | 新增 3 项测试，覆盖 completed 可发起且恰为 `run: next`、paused/失败续跑不变、后端 message 优先与中性兜底，以及同机器/批次单页一次提交 | 防止后续改动重新拦截 completed、误发 `retry: renders` 或绕过既有费用闸门锁 | 2026-07-24 |
| 44 | `web/dist/` | 最新生产构建运行副本 | 提交前按本次源代码重新执行生产构建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 避免启动器继续加载陈旧前端，确保 completed 放行与新文案在下次画布启动时生效 | 2026-07-24 |
| 45 | `web/src/types/canvas.ts` | 正式图片来源、QC 角标与返修投影状态 | 增加显式 renders/repaired 来源、三态角标和纯投影请求类型；旧节点来源保持可选以便安全补证 | 图位身份不再依赖文件名，补证失败节点可保持无角标且不进入后续收货 | 2026-07-24 |
| 46 | `web/src/lib/canvas/canvas-workflow-output-import.ts` | `validDownloadUrl()` | 在保留旧 renders 地址的同时接受显式 renders/repaired 白名单地址，原 SHA/Blob/字节数合同不变 | 8 张返修图复用现有 localforage 接收器，不另建低安全通道 | 2026-07-24 |
| 47 | `web/src/lib/canvas/canvas-workflow-delivery.ts` | QC 摘要、三态角标与返修纯投影合同 | 新增回环摘要读取、严格 14 图位校验、只给已持久化 renders 节点挂角标及不含命令的返修请求 | 前后端统一执行 issues 优先、needs_review 次之、通过兜底的固定规则 | 2026-07-24 |
| 48 | `web/src/pages/canvas/use-canvas-workflow-qc-badges.ts` | 单页批次缓存 | 每批每页只请求一次 QC 摘要，缓存后给后续出现的正式节点补角标；404 和不可用静默 | 避免轮询与每帧请求，报告缺失不打扰用户 | 2026-07-24 |
| 49 | `web/src/pages/canvas/use-canvas-workflow-repaired-projection.ts` | `requestProjection()` | completed 真实机器可提交一次独立返修投影状态，不经过费用卡、不写 content 或工作流命令 | 上桌既有磁盘成品是零费用纯投影，不能触发执行器或重做 | 2026-07-24 |
| 50 | `web/src/components/canvas/canvas-node.tsx` | 图片节点 QC 角标 | 图片右上角显示通过、问题数或待核对三态小标，保持原图片点击、拖拽和缩放行为 | 让 QC 结论成为图片节点视觉附属而非新节点或遮挡层 | 2026-07-24 |
| 51 | `web/src/components/canvas/canvas-workflow-node.tsx` + `web/src/pages/canvas/project.tsx` | “上桌返修图”入口与控制器接入 | completed 真实机器显示独立按钮并接入纯投影、QC 缓存控制器 | 用户无需手写命令，且入口与收费制作按钮明确分离 | 2026-07-24 |
| 52 | `web/tests/canvas-workflow-delivery.test.ts` | QC 与返修投影回归 | 新增 8 项覆盖安全端点、404 静默、三态、来源隔离、无命令投影和 repaired SHA 接收 | 锁定角标不落到 repaired/补证失败节点及纯投影边界 | 2026-07-24 |
| 53 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-workflow-receiving.ts` + `web/src/pages/canvas/use-canvas-workflow-receiving.ts` | 已收货框状态、图位选择与关账通道 | 新增稳定组节点、显式元数据图位识别、14 项载荷、状态恢复和回环鉴权 POST；同图位后拖入者替换前者 | 不靠文件名猜测，收货过程可撤销，只有用户确认才进入不可逆关账 | 2026-07-24 |
| 54 | `web/src/components/canvas/canvas-node.tsx` + `web/src/components/canvas/canvas-workflow-node.tsx` + `web/src/pages/canvas/project.tsx` | 收货框机器入口、拖入/替换/拖出与确认按钮 | completed 机器可创建唯一收货框；复用组拖拽并只接纳有来源和 SHA 的持久化图片，收满才显示确认 | 保持底层拖拽引擎不变，同时让错误补证节点无法计数 | 2026-07-24 |
| 55 | `web/tests/canvas-workflow-receiving.test.ts` + `web/dist/` | 收货关账回归与最新运行副本 | 新增 8 项覆盖计数、替换、拖出、确认门、载荷、鉴权提交和关账恢复；提交前重建 dist | 锁定 NC-03 交互并避免启动器加载旧前端 | 2026-07-24 |
| 56 | `web/src/lib/canvas/canvas-workflow-delivery.ts` + `web/src/pages/canvas/use-canvas-workflow-qc-badges.ts` + `web/tests/canvas-workflow-delivery.test.ts` | QC 角标引用稳定与缓存命中守卫 | 相同角标保留原节点和原数组引用；缓存仅在角标确有差异时写回节点，并补充连续应用、单节点引用和守卫回归 | 切断 `nodes` effect 的重复状态写回，避免打开画布触发 React 无限更新 | 2026-07-24 |
| 57 | `web/src/components/agent/agent-panel.tsx` | 原面板内容入口 | 仅替换 1 个导入和 1 个渲染锚点，接入只读批次问答外壳 | 在同一右侧栏提供“批次问答（只读）/通用 Agent（原有）”切换；原通用 Agent 组件保持不变并持续挂载 | 2026-07-25 |
| 58 | `CHANGELOG.md` | `Unreleased` | 新增一条 M3-a 只读批次问答的用户可感知记录 | 让只读范围、单问限制和超时行为进入既有发布记录 | 2026-07-25 |
| 59 | `docs/content/docs/progress/pending-test.mdx` | “待测试”清单 | 新增只读问答切换、三问、重复拒绝和超时终止人工验收项 | 自动测试和真实问答后仍保留界面切换的用户亲手验收入口 | 2026-07-25 |
| 60 | `web/src/types/canvas.ts` | `CanvasBatchIntakeRoleMetadata` 与 `CanvasNodeMetadata.batchIntakeRole` | 新增 1 个三态角色类型和 1 个可选元数据字段 | 让角标角色可随画布节点表达，既有 QC 元数据字段零改动 | 2026-07-25 |
| 61 | `web/src/components/canvas/canvas-node.tsx` | 图片右上角既有 QC 角标挂点 | 新增 1 个组件导入，以 1 行角标栈组件替换原 QC 单角标块 | 复用原挂点让角色与 QC 共存；QC 文案、颜色和判定移入新增组件后保持不变 | 2026-07-25 |
| 62 | `web/src/pages/canvas/project.tsx` | 角色 hook 接入与信息卡文件名参数 | 新增 1 个 hook 调用、2 个文件名参数及对应导入 | 连线变化即时刷新角标，并把现有选择器看到的文件名交给信息卡展示 | 2026-07-25 |
| 63 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 建批与风格补登按钮区域 | 新增常驻文件名清单并把按钮文案改为“数量 + 角色” | 用户点击前即可看清本次登记对象，不增加确认弹窗 | 2026-07-25 |
| 64 | `web/src/lib/canvas/canvas-batch-intake.ts` | 建批选择器与文件名投影 | 新增同哈希前置拒绝、共享全文文案和产品原图文件名读取 | 同一图片以不同节点重复连入时在发号前停止 | 2026-07-25 |
| 65 | `web/src/lib/canvas/canvas-style-reference-intake.ts` | 风格补登选择器与文件名投影 | 新增已登记产品哈希交叉检查和风格文件名读取 | 接反时在发号前以与后端相同全文停止 | 2026-07-25 |
| 66 | `CHANGELOG.md` | `Unreleased` | 新增一条 NC-01 用户可感知记录 | 让角色透明、同哈希拒绝和 fail-closed 行为进入版本记录 | 2026-07-25 |
| 67 | `docs/content/docs/progress/pending-test.mdx` | “待测试/已完成”清单 | 标记 M3-a 真人验收完成，并新增 NC-01 三条人工验收项 | 区分已发生验收与仍需用户亲手检查的角标、拦截和正常链路 | 2026-07-25 |
| 68 | `web/dist/` | 最新生产构建运行副本 | 提交前按 NC-01 源代码重新执行生产构建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 避免启动器加载旧前端，确保角色角标、文件清单与前置拒绝生效 | 2026-07-25 |
| 69 | `web/src/components/canvas/canvas-readonly-assistant-panel.tsx` | M3-a 外壳中的批次助手页签与消息列表 | 页签改名“批次助手”，先辨认指令意图；问题仍交回原只读问答，命令显示新增草稿卡，原通用 Agent 持续挂载 | 在同一入口完成问答与起草，不把草稿当执行，也不改变原通用 Agent | 2026-07-25 |
| 70 | `web/src/pages/canvas/project.tsx` | `requestWorkflowStart` 与当前工作流机器桥 | 原机器按钮回调增加可选封闭命令参数，并把同一回调和零/一/多机器摘要登记到临时 store；按钮调用仍不传参数 | 草稿卡调用的就是机器按钮同款函数，演示/真实分流和费用卡只有一套 | 2026-07-25 |
| 71 | `web/src/lib/canvas/canvas-workflow-demo.ts` + `web/src/pages/canvas/use-canvas-workflow-demo.ts` | 0 元确认后的命令构造与待确认状态 | 待确认状态可携带已验证草稿；只有用户确认 0 元卡后才写该命令，请求编号、连图复核、默认 `run/retry: renders` 不变 | 让 `run: next` 等闭集命令复用 demo 原门禁，同时保护机器按钮原行为 | 2026-07-25 |
| 72 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` | 真实费用确认后的命令构造与待确认状态 | 待确认状态可携带已验证草稿；只有用户确认原费用卡并通过单页提交锁后才写入，未传草稿时原续跑策略不变 | 不新增报价、收费、写入或放行通道，关账及其他业务状态继续交给后端门禁 | 2026-07-25 |
| 73 | `CHANGELOG.md` | `Unreleased` | 新增 M3-b 用户可感知记录 | 说明说人话只生成草稿，仍经目标机器原费用卡和门禁 | 2026-07-25 |
| 74 | `docs/content/docs/progress/pending-test.mdx` | “待测试/已完成”清单 | NC-01 三项按 2026-07-25 真人结果标记完成；新增 M3-b 草稿卡、0 元全链、关账拒绝和解析边界人工验收 | 区分已完成防呆验收与仍需顾问现场复核的蓝图收官交互 | 2026-07-25 |
| 75 | `web/dist/` | 最新生产构建运行副本 | 提交前按 M3-b 源代码重新执行生产构建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 避免启动器加载旧面板，确保草稿卡和同一按钮接线在下次启动时生效 | 2026-07-25 |
| 81 | `web/src/lib/canvas/canvas-material-upload.ts` | MU-02 素材批量上传合同 | 新增一次最多 20 个、按选择顺序逐个上传、第 k 个失败即停并保留先前成功节点、多选按最新画布节点避让的纯函数合同；不自动连线、不登记，也不新增 SHA 查重门禁 | 把既有单文件图片/视频/音频上传行为安全放大为 ×N，同时保持素材角色仍由用户连线决定 | 2026-07-26 |
| 82 | `web/src/pages/canvas/project.tsx` | 三个上传入口、隐藏选择器与拖拽接线 | 底部“上传素材”启用多选；顶部导入和节点替换在打开选择器前切回单选，异常收到多文件时整批人话拒绝；逐个沿用 `uploadImage` / `uploadMediaFile`，多文件拖拽复用同一批量合同 | 任何入口都不得静默只取第一张，节点替换的既有单张行为保持不变 | 2026-07-26 |
| 83 | `web/tests/canvas-material-upload.test.ts` | MU-02 上传、避让与接线回归 | 新增 10 项测试，覆盖 20/21 上限、混合媒体顺序、失败停步、单张兼容、拖拽/入口接线及三条引用稳定断言：写回时读最新节点、无变化保留原数组、追加后保留全部旧节点对象引用 | 锁定零静默丢弃、零旁路副作用和 React 状态引用稳定，不修改既有测试正文 | 2026-07-26 |
| 84 | `CHANGELOG.md` | `Unreleased` | 新增一条 MU-02 用户可感知记录 | 归纳底部素材多选、失败停步保留成功及零自动连线/登记行为 | 2026-07-26 |
| 85 | `docs/content/docs/progress/pending-test.mdx` | “MU-02 工具栏上传素材多选”待测试小节 | 新增 1/20/21、混合媒体顺序与错位、失败停步、零连线登记、两个单选入口异常整批拒绝及拖拽多选人工验收点 | 自动检查通过后仍如实保留真人现场验收入口 | 2026-07-26 |
| 86 | `web/dist/` | 最新生产构建运行副本 | 提交前已按 MU-02 源代码重新执行生产构建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 避免启动器加载旧前端，确保素材多选与防静默拒绝在下次启动时生效 | 2026-07-26 |
| 87 | `web/src/lib/canvas/canvas-project-delete.ts` | 项目删除计划、17373 请求合同与结果归类 | 新增信息卡批次收集、幸存项目共享引用拦截、严格预检/执行回执、确认文字及前端删除提交纯函数 | 先锁定删除范围和后端结果，任一不确定或失败都保留项目；浏览器只传批次号和请求编号，不自报路径 | 2026-07-26 |
| 88 | `web/src/hooks/use-canvas-project-delete.ts` | 项目删除预检、确认、执行与续做状态机 | 新增四入口共用控制器；后端全部成功后才等待项目持久化删除与素材清理，失败只显示已删/失败/未开始并由用户手动续做 | 统一“先后端、后前端、画布最后删”，不新增自动重试或旁路执行通道 | 2026-07-26 |
| 89 | `web/src/components/canvas/canvas-delete-projects-dialog.tsx` | 项目级删除确认对话框 | 原项目删除对话框升级为批次清单、第一段确认、关账/交付加重确认、删除全部文字确认及停步结果展示；仍兼容画布单卡原入口 | 让四个删除入口共用同一套可见风险提示，空画布也必须确认 | 2026-07-26 |
| 90 | `web/src/stores/canvas/use-canvas-store.ts` | `deleteProjects()` 持久化时序 | 保留普通编辑 400ms 防抖，项目删除改为可等待的串行落盘；落盘失败恢复原项目并人话拒绝 | 防止界面先消失但本地项目数据尚未安全保存，同时保持其他画布节点引用不变 | 2026-07-26 |
| 91 | `web/src/pages/canvas/index.tsx` | 画布库“单卡/删除选中/删除全部”对话框接线 | 选中删除与全部删除补充模式标记，三入口继续复用原 `deleteProjectIds`，统一交给项目级删除对话框 | 删除全部始终要求输入“删除全部”，单卡和选中删除保持原入口位置 | 2026-07-26 |
| 92 | `web/src/pages/canvas/project.tsx` | 左上菜单当前项目删除接线与文案 | “删除当前画布”改为“删除当前项目”，点击后只打开共用删除对话框；删除成功回调才离开当前项目 | 当前画布不再绕过后端批次删除，失败时仍留在原项目继续查看和续做 | 2026-07-26 |
| 93 | `web/tests/canvas-project-delete.test.ts` | DL-01 项目级删除合同回归 | 新增批次收集、100/120 上限、共享引用拦截、状态与标志一致性、两段确认、删除全部加重警告、同步防连击、失败停步、空画布、400ms 节流不回归、持久化恢复、信息卡按钮移除和接线检查 | 锁定四入口行为与 fail-closed 边界，不修改其他既有测试正文 | 2026-07-26 |
| 94 | `CHANGELOG.md` | `Unreleased` | 新增一条 DL-01 用户可感知记录 | 说明项目级后端清理、确认门、失败保留项目，以及仅移除 RC-01 前端按钮 | 2026-07-26 |
| 95 | `docs/content/docs/progress/pending-test.mdx` | “DL-01 项目级删除”待测试小节 | 登记一次性新批次的四入口、Windows 回收站、共享引用、失败续做、空画布与 RC-01 保留边界真人验收 | 自动测试不触碰真实批次，最终文件送达和项目隔离仍须真人核对 | 2026-07-26 |
| 96 | `web/dist/` | 最新生产构建运行副本 | 提交前已按 DL-01 源代码重新执行生产构建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 避免启动器加载旧前端，确保项目级删除、加重确认与信息卡按钮移除在下次启动时生效 | 2026-07-26 |
| 97 | `canvas-agent/src/http-server.ts` + `canvas-agent/src/http-server.test.ts` | 启动横幅令牌行的 TTY 门控与两态回归 | 仅在 stdout 为交互终端时显示连接令牌；重定向或管道下保留其他横幅行但不输出令牌，并新增独立测试锁定两态 | 让无窗启动器可完整记录 agent stdout/stderr 而不把令牌写入日志，同时保持人工终端配对体验 | 2026-07-27 |
| 98 | `web/src/types/canvas.ts` | 批次信息、品类元数据与九字段载荷类型 | 增加 category、长宽高、可变手持、契约摘要和端点表单结构；14 张总数类型保持不变 | 让卡片、登记载荷和主仓品类端点使用同一字段语义 | 2026-07-27 |
| 99 | `web/src/constant/canvas.ts` | 新建信息卡默认元数据 | 移除前端自带的品类、手持和高级开关默认值，只保留草稿状态与固定 6+8 总数 | 默认值必须实时来自主仓配方，不能在 dist 中复制第二份 | 2026-07-27 |
| 100 | `web/src/lib/canvas/canvas-batch-intake.ts` | 品类端点、摘要门禁、配方驱动校验与九字段命令 | 鉴权读取 17373 `/batch-categories`，严格校验字段契约摘要；按端点元数据生成默认值、尺寸/手持校验和 category + 九字段载荷 | 元数据不可用或双端摘要不一致时在发号前 fail-closed，不回退自由文本 | 2026-07-27 |
| 101 | `web/src/pages/canvas/use-canvas-batch-intake.ts` | 品类目录加载、草稿初始化与登记入口 | 令牌变化时读取品类；新卡/旧草稿按已装配方初始化，切换品类重置为该配方默认；登记复用同一目录做最终校验 | 让渲染与提交共用一次实时元数据，避免组件复制业务规则 | 2026-07-27 |
| 102 | `web/src/components/canvas/canvas-batch-advanced-options.tsx` | 高级选项折叠区 | 新增默认收起的受控折叠区，逐项渲染端点下发的人话标题、说明和原字段方向开关 | 日常隐藏工程开关，特殊批次仍可覆盖且落盘语义不变 | 2026-07-27 |
| 103 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 品类下拉、三维、手持输入、动态摘要及完成回执 | 自由文本改为已安装品类下拉；显示配方必填维度与范围、0 起手持输入、默认收起高级项和动态“共 14 张”行；元数据失败禁用登记 | 完成品类友好表单，保持一个信息卡和一个工作流按钮 | 2026-07-27 |
| 104 | `web/src/pages/canvas/project.tsx` | 信息卡渲染接线 | 向原信息卡挂点传入批次 hook 的实时品类目录和加载状态 | 只增加两项状态接线，不改变其他节点、工具栏或工作流入口 | 2026-07-27 |
| 105 | `web/tests/canvas-batch-intake.test.ts` | CAT-01 品类表单与载荷回归 | 将七字段/固定手持断言升级为九字段，新增端点鉴权/失败、双端摘要、盘子三维、0/6/8 边界、下拉、折叠、动态汇总和开关双向映射测试 | 锁定单一事实源与 fail-closed 行为，原图 SHA、连线和零费用演示断言不放宽 | 2026-07-27 |
| 106 | `web/dist/` | CAT-01 最新生产运行副本 | 提交前按本次源码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 重启工作台并刷新画布后加载新品类信息卡；端点文案/默认值/范围更新本身无需再次构建 | 2026-07-27 |
| 107 | `web/src/types/canvas.ts` | CNT-01 批次事实、品类张数元数据与真实生产投影类型 | 新增主图/详情图张数字段、品类 `image_counts` 元数据，以及后端返回的 `totalCount` / `expectedConfigIds`；旧持久化对象允许字段缺失以便显示明确升级提示 | 类型只承载批次事实，不复制 6/8/14 业务默认值 | 2026-07-27 |
| 108 | `web/src/constant/canvas.ts` | 新建信息卡空草稿 | 移除新卡元数据中的 6/8 默认值，只保留草稿状态 | 新卡默认值必须在品类目录读取成功后从配方写入 | 2026-07-27 |
| 109 | `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/pages/canvas/use-canvas-batch-intake.ts` | 张数目录、动态门禁、品类切换与十一字段登记 | 同步新契约摘要；从品类元数据读取默认/范围，校验 1–30、手持不超过对应张数；切换品类时保留已填长宽高，张数、手持和高级选项按新品类默认重置，登记载荷带两项张数 | 卡片与登记共用同一校验，尺寸只按新品类必填集重校验，契约不一致继续在发号前关闭 | 2026-07-28 |
| 110 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 顶部张数输入与动态汇总 | 固定主/详展示改为数字输入，动态显示总数与手持上限；张数调小导致手持越界时提示先改手持，不静默截断 | 用户逐批改数的唯一画布入口，比例与高级选项不变 | 2026-07-27 |
| 111 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` | 报价、命令与真实进度张数事实 | 费用响应必须携带有序实际编号集；确认费用后把该事实写入生产状态，进度/续跑按实际总数读取；缺数时要求重启工作台并刷新画布 | 不重算费用、不改变确认卡与单页提交锁，只移除前端 14 张回退 | 2026-07-27 |
| 112 | `web/src/components/canvas/canvas-workflow-node.tsx` + `web/src/pages/canvas/project.tsx` | 真实机器动态摘要与缺数提示接线 | 真实模式显示信息卡事实和后端实际进度，详情面板不再展示演示 6/8；QC 缺数警告复用页面原消息入口 | 演示模式的固定 6/8/14 与原按钮入口保持不变 | 2026-07-27 |
| 113 | `web/src/lib/canvas/canvas-workflow-delivery.ts` + `web/src/pages/canvas/use-canvas-workflow-qc-badges.ts` | QC 摘要实际编号集与角标关闭策略 | QC 图片必须与响应中的实际编号集逐项一致；缺张数事实时移除该批旧角标并提示重启刷新 | 不改变 pass/fail/待核对判定或返修执行语义 | 2026-07-27 |
| 114 | `web/src/lib/canvas/canvas-workflow-receiving.ts` + `web/src/pages/canvas/use-canvas-workflow-receiving.ts` + `web/src/components/canvas/canvas-node.tsx` | 已收货框实际图位与动态关账 | 收货框复制后端实际编号集，只接受该集合的正式/返修图；收满实际总数才放行，GET/POST 回执缺数或不一致时关闭 | 不从标题猜图位，不生成真实编号，也不改变关账请求字段 | 2026-07-27 |
| 115 | `web/tests/canvas-batch-intake.test.ts` | 信息卡张数、尺寸切换与登记有限例外回归 | 更新品类夹具与字段集断言，新增 1/30、0/31/小数/字符串、动态手持上限、3+2 汇总、品类默认重置，以及杯→盘缺长宽拒绝、盘→杯保留长宽且不再必填覆盖 | 原图 SHA、连线、契约关闭及零费用演示断言不放宽 | 2026-07-28 |
| 116 | `web/tests/canvas-workflow-production.test.ts` + `web/tests/canvas-command-assistant.test.ts` | 真实报价/进度与助手原门禁回归 | 生产夹具补实际编号集，覆盖 1+1、30+30、有序唯一编号和缺数关闭；助手测试只补后端张数事实，原封闭命令与确认语义不变 | 既有测试仅因固定总数改为批次事实而调整 | 2026-07-27 |
| 117 | `web/tests/canvas-workflow-delivery.test.ts` + `web/tests/canvas-workflow-receiving.test.ts` | 非 14 张 QC/收货与缺数关闭回归 | 新增 3+2 QC、收满 5 图位关账、缺 `totalCount` / `expectedConfigIds` 拒绝；默认 14 张夹具仍保留兼容回归 | QC 判定与正式/返修 SHA 证据断言不放宽 | 2026-07-27 |
| 118 | `CHANGELOG.md` | `Unreleased` | 新增 CNT-01 用户可感知记录 | 归纳逐批自由张数、全链联动与混跑缺数关闭 | 2026-07-27 |
| 119 | `docs/content/docs/progress/pending-test.mdx` | “CNT-01 每批自由设置主图/详情图张数”待测试小节 | 登记默认/边界/切换/手持、3+2 全链、混跑防呆及演示保留的真人验收点 | 自动检查不替代首个非默认真实批次的费用、QC 与关账验收 | 2026-07-27 |
| 120 | `web/dist/` | CNT-01 最新生产运行副本 | 尺寸切换修正后按最终 CNT-01 源代码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 重启工作台并刷新画布后加载可编辑张数、尺寸保留与全链缺数防呆 | 2026-07-28 |

| 121 | `web/src/types/canvas.ts` | 风格移除独立元数据类型 | 新增 idle/queued/completed/failed 状态、请求时间、批次号、错误和移除回执；不覆盖既有补登状态 | 让补登与移除在同一信息卡上独立确认、独立失败 | 2026-07-28 |
| 122 | `web/src/lib/canvas/canvas-style-reference-intake.ts` | SR-01 单张规则与移除命令合同 | 0/1/2 张前置裁决、已有回执拦截、`# style-reference-remove` 命令、同一健康工人预检和 8 秒确认超时 | 每批只登记 1 张，移除不新增工人或旁路接口 | 2026-07-28 |
| 123 | `web/src/pages/canvas/use-canvas-style-reference-intake.ts` | 补登与移除前端互斥 | 移除排队时拒绝补登；移除完成后新补登发号时重置旧移除状态 | 防止同卡两类命令并发，同时恢复重新补登 | 2026-07-28 |
| 124 | `web/src/pages/canvas/use-canvas-style-reference-removal.ts` | 信息卡移除控制器 | 复用现有风格工人健康预检，只写独立移除命令和超时状态，不直接访问磁盘或删除节点 | 用户确认后才发命令，失败不自动重试 | 2026-07-28 |
| 125 | `web/src/lib/canvas/canvas-intake-role-visibility.ts` | 移除按钮人话状态 | 在既有登记/补登按钮文案旁新增移除空闲与忙碌标签 | 卡面不复制状态判断文案 | 2026-07-28 |
| 126 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 登记前只读区块与登记后移除状态 | 草稿态显示置灰风格区块；完成态显示移除按钮、忙碌互斥、失败信息和“已移除，可重新补登” | 连线可见但登记顺序不变，移除不绑定节点删除 | 2026-07-28 |
| 127 | `web/src/pages/canvas/project.tsx` | 风格移除二次确认与页面接线 | 明示全部已登记文件进入 Windows 回收站、重新补登前不能制作且不删连线，确认后调用独立移除 hook | 移除动作只有一次清晰确认，取消零副作用 | 2026-07-28 |
| 128 | `web/tests/canvas-style-reference-governance.test.ts` + `web/tests/canvas-style-reference-intake.test.ts` | SR-01 前端合同回归 | 新增单张、回执拦截、独立命令、同工人健康键、超时、草稿卡、忙碌互斥、移除完成和确认接线测试；既有测试只改 0 张提示 | 锁定用户可见流程，不放宽完整性和 fail-closed 断言 | 2026-07-28 |
| 129 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | SR-01 版本归纳与真人待测清单 | Unreleased 记录用户可感知变更，待测试页登记一次性批次的单张、确认、门禁、回收站与重新补登走查；todo 经检查无对应条目，无需改动 | 功能先进入待测试，不提前写入正式 features | 2026-07-28 |
| 130 | `web/src/lib/canvas/canvas-workflow-production.ts` | `readProductionState()` 与 `applyProductionQuote()` | 缺数和真实失败同时存在时保留真实 `errorMessage`；新增用后端报价完整替换张数与编号的纯函数 | 真实原因不再被错误的“重启刷新”提示遮住，残留缺数可由权威报价自愈 | 2026-07-28 |
| 131 | `web/src/pages/canvas/use-canvas-workflow-production.ts` | `requestStart()` 与确认写回 | 删除缺数失败态在报价前的本地拦截；费用确认后统一用报价补齐计数再构建生产命令 | “开始/重新开始”先向后端取可信报价，自愈失败时才提示重启刷新 | 2026-07-28 |
| 132 | `web/tests/canvas-workflow-production.test.ts` | 失败真因优先与报价自愈回归 | 新增真实原因优先、缺数状态可重新报价、报价补齐后可排队三组断言；报价仍缺字段的 fail-closed 断言保留 | 防止以后再次用本地残留状态永久卡死生产机器 | 2026-07-28 |
| 133 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | HF-01 版本归纳与真人待测清单 | 记录失败原因优先、重新报价自愈及报价仍不完整时才提示重启刷新；todo 经检查无对应条目，无需改动 | 自动测试通过后仍如实保留真实工作台重启与重新开始验收 | 2026-07-28 |
| 134 | `web/src/lib/canvas/canvas-workflow-receiving.ts` | `ACCEPTANCE_ENTRY_ENABLED` | 新增默认 `false` 的 AC-01 单点休眠开关；接回时改为 `true` 并同步合同测试 | 只休眠新建收货框入口，保留既有收货框、关账提交与后端能力 | 2026-07-31 |
| 135 | `web/src/components/canvas/canvas-workflow-node.tsx` | completed 辅助按钮区 | 以 AC-01 开关门控“已收货框”；关闭时“上桌返修图”独占单列，打开时恢复双列 | 默认批次不再新建收货框，同时保持返修图上桌入口和未来接回接线 | 2026-07-31 |
| 136 | `web/src/lib/canvas/canvas-workflow-production.ts` | `COMPLETED_PRODUCTION_ACTION_LABEL` | completed 主按钮由“继续/质检”改为“继续” | QC 与收货关账均退出默认批次流程后，按钮只表达幂等继续语义 | 2026-07-31 |
| 137 | `web/tests/canvas-workflow-production.test.ts` | completed 标签合同 | 既有唯一断言机械同步为“继续” | 防止默认完成按钮重新暴露已休眠流程名称 | 2026-07-31 |
| 138 | `web/tests/canvas-workflow-acceptance-dormancy.test.ts` | AC-01 休眠合同 | 新增单点开关严格为 `false` 的合同测试；不新造组件模块模拟设施 | 锁定默认入口休眠，同时避免复制既有 receiving 能力测试 | 2026-07-31 |
| 139 | `web/dist/` | AC-01 最新本机运行副本 | 提交前按最终源码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 让下次画布启动加载入口休眠、单列布局与“继续”文案 | 2026-07-31 |
| 140 | `web/src/lib/canvas/canvas-workflow-image-export.ts` | EX-01 下载判据、计划与执行薄壳 | 只收当前机器批次、实际图位白名单和浏览器持久化证据完整的正式/返修图；支持选中/全部、规定排序命名、同名副本防撞、缺失 Blob 清单、ZIP 与逐张下载 | 无关图片和跨批图片 fail-closed，下载副作用与可测纯逻辑分层且不新增依赖 | 2026-07-31 |
| 141 | `web/src/components/canvas/canvas-workflow-download-card.tsx` | “选择下载方式”弹窗 | 显示批次号、本次张数、ZIP/逐张两个动作与浏览器多文件授权说明 | 用户每次下载前明确选择落盘方式，取消零副作用 | 2026-07-31 |
| 142 | `web/src/lib/canvas/canvas-workflow-delivery.ts` | `REPAIR_PROJECTION_ENTRY_ENABLED` | 新增默认 `false` 的 EX-01 单点休眠开关；接回时改为 `true` 并同步合同测试 | 只休眠“上桌返修图”入口，保留既有返修投影函数、页面接线和后端能力 | 2026-07-31 |
| 143 | `web/src/components/canvas/canvas-workflow-node.tsx` | completed 下载与休眠动作区 | 默认以两列显示“下载选中的图片/下载所有图片”，按可下载数量置灰；返修与收货开关恢复时以紧凑网格自然回排 | 完成机器直接下载本批成图，demo、继续按钮及未来接回能力不变 | 2026-07-31 |
| 144 | `web/src/pages/canvas/project.tsx` | 下载计划、弹窗与结果提示接线 | 页面按机器与当前选区计算数量，保存本次计划并执行用户选定方式；缺失时提示已下载数和图位，零缺失不提示 | 哑组件不复制归属判据，storageKey 失效不静默 | 2026-07-31 |
| 145 | `web/tests/canvas-workflow-image-export.test.ts` | EX-01 下载纯函数合同 | 覆盖六类拒绝、选中/全部、节点与同名副本去重、图位与来源排序、防撞命名、缺失 Blob 和 disabled 判定 | 零网络、零真实存储与零浏览器下载锁定下载边界 | 2026-07-31 |
| 146 | `web/tests/canvas-workflow-repair-projection-dormancy.test.ts` | EX-01 返修入口休眠合同 | 新增单点开关严格为 `false` 的 9 行级合同测试 | 锁定默认入口休眠，不复制返修投影组件或后端测试 | 2026-07-31 |
| 147 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | EX-01/AC-01 版本归纳与真人待测清单 | Unreleased 归纳下载双模式、返修入口休眠并补记 AC-01；待测试页登记下载、缺失提示、开关布局与继续文案；todo 经检查无对应条目，无需改动 | 自动检查不替代真人下载与完成态入口验收，两份正文不写具体日期 | 2026-07-31 |
| 148 | `web/dist/` | EX-01 最新本机运行副本 | 按最终源码重建并记录输出与产物时间戳；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 下次重启工作台后加载下载双模式与两个默认休眠入口 | 2026-07-31 |
| 149 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-batch-intake.ts` | CFG-01 新建批次载荷合同、品类校验与摘要常量 | 确认事实由 11 项收紧为 10 项，高级选项固定为剩余两项并同步新摘要；旧信息卡元数据中的可选清水值继续只读解析 | 作废新批次的清水配置权，同时保留历史画布读取通道与摘要混跑硬停止 | — |
| 150 | `web/src/components/canvas/canvas-batch-advanced-options.tsx` + `web/src/components/canvas/canvas-batch-info-node.tsx` + `web/src/pages/canvas/use-canvas-batch-intake.ts` | CFG-01 信息卡高级选项、可编辑事实与完整性判断 | 从新建信息卡默认值、编辑入口和完整性判断中移除清水开关，只保留其余两项及原严格校验 | 用户不再看到或提交已作废开关，其他尺寸、张数、手持及高级选项行为不变 | — |
| 151 | `web/tests/canvas-batch-intake.test.ts` + `web/tests/cfg01-clear-water-retirement.test.ts` | CFG-01 既有回归机械同步与三项合同门 | 现行夹具同步为两项高级选项和 10 项载荷；新增摘要互锚、两项键集与退役键拒绝、载荷无退役字段测试 | 锁定新契约，同时不削弱原连线、原图完整性、失败关闭或历史 completed 覆盖 | — |
| 152 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | CFG-01 版本归纳与真人待测清单 | Unreleased 记录清水开关退出新建批次；待测试页登记信息卡、10 项载荷、历史画布兼容与混跑防呆走查；todo 经检查无对应条目，无需改动 | 自动合同不替代真人确认，文档不写具体日期 | — |
| 153 | `web/dist/` | CFG-01 最新本机运行副本 | 已按最终源码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 下次重启工作台后加载 10 项载荷与两项高级选项 | — |
| 154 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` | QC-02c 报价剩余数与生产命令选择 | `buildProductionCommand()` 接收不持久化的可选报价上下文；显式指令与 completed 优先，随后仅在 `remainingCount === 0` 时发送 `run: next`，确认调用传入本次已验证报价 | 已全部出图但状态失败时不再误发必被真实路由拒绝的渲染重试；正数或缺省报价仍保持原续跑语义 | — |
| 155 | `web/tests/canvas-workflow-production.test.ts` | QC-02c 五项指令矩阵 | 追加失败零剩余、失败仍有剩余、暂停零剩余、缺省报价和显式指令优先回归；既有测试正文不改 | 锁定严格零值判据、旧调用兼容与批次助手优先级 | — |
| 156 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | QC-02c 版本归纳与真人待测清单 | Unreleased 记录全部出图但显示失败时可继续走完；待测试页登记五项行为边界；todo 经检查无对应条目，无需改动 | 自动合同不替代真实失败卡、费用确认和后端路由验收，文档不写具体日期 | — |
| 157 | `web/dist/` | QC-02c 最新本机运行副本 | 按最终源码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 下次重启工作台后加载零剩余时的中性继续命令 | — |
| 158 | `canvas-agent/src/agents.ts` | CX-01 `runCodexTurnNow()`、`startTurn()` 与 `codexTurnStartParams()` | 正常与恢复路径把已选 `model + effort` 传到 `turn/start`；请求体仅在显式提供时追加两字段 | 让真实制作的模型与档位在 Codex 权威 turn 层生效，同时保持普通画布会话缺省语义不变 | — |
| 159 | `canvas-agent/src/agents.test.ts` | CX-01 turn 载荷双锚 | 仅追加生产 `gpt-5.5 + xhigh` 完整载荷与缺省省略两项纯内存测试，既有测试正文不改 | 锁定生产档位穿透和普通会话隔离；移除 effort 展开时回归必须失败 | — |
| 160 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | CX-01 版本归纳与真人待测清单 | Unreleased 记录真实制作不再受个人 Codex 配置影响；待测试页登记生产钉死、缺省边界、恢复路径与真机 rollout 验收；todo 经检查无对应条目，无需改动 | 离线载荷合同不替代真实批次重启与 rollout 档位验收，文档不写具体日期 | — |
| 161 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/tests/canvas-workflow-production.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | RS-01 终态后免刷新重新提交 | 删除 #37 的页面会话锁；终态重新报价并亲手确认后可再次写入，最终写入时仍按最新状态拦截飞行中命令；同步版本说明与真人待验项 | GT-01 已使阶段 E 逐闸门批准协议作废，故 #37 的单页仪式退役；提交资格自此唯一判定为飞行中互斥（`queued` / `running`） | — |
| 162 | `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` + `web/tests/canvas-batch-intake.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | CAT-08 详情图模块05手持防呆 | 详情手持上限统一为本批详情张数减一，1 张详情时上限为 0；载荷校验、输入框范围、人话提示和边界测试共用同一规则 | 为恒定承载模块05的尺寸标注图位预留非手持名额；主图上限、载荷结构、契约摘要和 `web/dist` 保持不变 | — |
| 163 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-workflow-production.ts` | RB-01 恢复元数据、端点合同与主按钮判据 | 对 `recovery` 做严格嵌套解析；新增固定回环 rebind URL、POST 响应校验、可见性与标签纯函数，排队命令清除旧恢复状态 | 只有服务端明确判定的个别白底图缺失可进入重排；不可信字段失败关闭，既有封闭命令选择不变 | — |
| 164 | `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/src/components/canvas/canvas-workflow-node.tsx` | RB-01 报价前重排与失败卡按钮 | eligible 失败主按钮先 POST 重排，成功后继续既有报价和人工费用确认；三类终态拒绝清除过期恢复资格，其他失败保留原入口 | 防止已恢复、已有成图或目录整体不可用时重复请求；非 eligible 点击仍完全沿用原报价路径 | — |
| 165 | `web/tests/canvas-workflow-production.test.ts` | RB-01 追加回归合同 | 文件末尾追加恢复解析矩阵、按钮资格、URL/POST 成功与拒绝校验、非 eligible 零 POST 和旧命令回归 | 锁定失败关闭与用户修正 C，不修改任何既有测试正文 | — |
| 166 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | RB-01 版本归纳与真人待测清单 | Unreleased 归纳缺失分级处置；待测试页登记个别缺失、目录不可用、已有成图、旧行为和失败关闭验收点；todo 经检查无对应条目，无需改动 | 自动合同不替代真实失败卡、归档重排、报价与费用确认验收，文档不写具体日期 | — |
| 167 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/src/components/canvas/canvas-workflow-node.tsx` + `web/tests/canvas-workflow-production.test.ts` | RB-01 批次对账、命令隔离与异步竞态复检 | 特殊按钮与 POST 同时核对机器批次和当前信息卡批次；显式闭集命令不触发重排；POST 返回后重新核对 cardId/batchId，路径型拒绝文案失败关闭，EOF 追加对应回归 | 防止过期 recovery 归档错批、批次助手意外触发重排或异步连线变化污染新状态，同时保留批准的 `inputs/white_bg` 指引 | — |
| 168 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/tests/canvas-workflow-production.test.ts` | RB-01 敏感词矩阵对齐 | recovery 文件名与拒绝文案补拒 `authorization`、`password` 和任意 `sk-` 片段，EOF 追加双通道回归 | 与主仓净化器保持同一失败关闭边界，防止敏感字段名通过前端可读通道 | — |
| 169 | `web/dist/` | RB-01 最新本机运行副本 | 按当前 HEAD 源码重建；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | `dd045f1` 当时未重建部署产物，导致白底原图缺失的分级处置界面从未上线；本次补齐后用户硬刷新画布页即可加载 | — |
| 170 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/components/canvas/canvas-workflow-node.tsx` + `web/tests/canvas-workflow-production.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | ER-02f 图片服务失败归因与回归登记 | 严格读取可选 `failureSource: "image_service"`；确认为图片服务失败时由纯函数追加固定说明并把生产主按钮改为“再次尝试”，EOF 追加解析、非失败态、RB-01 优先级、命令零漂移与正文回归 | 让用户分清外部图片服务异常与工作流问题，同时保持断点续跑、重新报价、人工费用确认及其他失败行为不变 | — |
| 171 | `web/dist/` | ER-02f 最新本机运行副本 | 按最终源码重建并完成静态资源、关键文案与树指纹核验；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 用户硬刷新画布页即可加载图片服务归因与“再次尝试”文案，无需重启未改动的后端工作台 | — |
| 172 | `web/src/lib/canvas/canvas-batch-connect.ts` + `web/src/pages/canvas/project.tsx` + `web/tests/canvas-batch-connect.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | BC-01 多选节点批量连线、回归与真人待测登记 | 由纯函数逐条复用既有方向、隐藏和合法性判据，统一去重、跳过分类、汇总文案及唯一连线编号；页面唯一入口只注入宿主能力并一次写入，新增单条兼容、混选、方向、去重与编号测试 | 多选后可从任意选中节点拖到同一目标并连接全部有效项，重复与拒绝项明确汇总；单条合同、一次撤销和纯前端零费用边界保持不变 | — |
| 173 | `web/dist/` | BC-01 最新本机运行副本 | 按最终源码重建并统计文件数与总字节数；dist 继续作为 Git 忽略的本机运行产物，不进入提交 | 用户硬刷新画布页即可加载多选批量连线交互，无需触发生产、模型或图片服务 | — |
| 174 | `.gitignore` + `web/dist/` | 成品随仓分发（用户拍板） | 删除 `.gitignore` 的 `web/dist` 一行，当前 dist（12 文件 / 2,763,680 字节，与 #173 重建结果逐字节同批）进入提交；自本锚点起"dist 不入提交"的旧约定作废，#169/#171/#173 中的相应表述保留为历史记录 | 同事克隆或拉取后无需本机构建即可直接运行画布界面；此后每次前端源码改动必须重建 dist 并随同提交，纪律同主仓教训㊱ | — |
| 175 | `web/src/types/canvas.ts` | ST-01 商品类型与套装图片登记元数据 | 新增 `single/set` 商品类型、三类图片类别及信息卡两组套装图片节点 ID | 让商品类型声明和套装图片归属随画布保存，既有十项商品事实结构不变 | — |
| 176 | `web/src/lib/canvas/canvas-batch-intake.ts` | ST-01 v3 摘要、声明校验、数量门与三类来源合并 | 契约哈希更新为 v3；新卡默认单品，缺失或非法声明失败关闭；套装按 1–3/2–8 校验并把两组节点 ID 合入既有上传清单，切回单品清空套装选择 | 未授权的登记 hook 继续复用原 Blob/SHA 上传通道，单品命令与十项事实不漂移 | — |
| 177 | `web/src/components/canvas/canvas-batch-info-node.tsx` | ST-01 商品类型单选、套装上传区与回执 | 草稿/可修正状态可选单品或套装；套装联动显示两个多选上传区，登记后锁定，完成回执显示类型和套装图片数量 | 用户在原信息卡内完成声明与必传图片选择，不增加新页面或费用入口 | — |
| 178 | `web/src/pages/canvas/project.tsx` | ST-01 套装图片本地持久化与信息卡接线 | 两类上传复用 `uploadImage + createBatchSourceFile` 生成原字节 SHA 凭证和图片节点；只把节点 ID 写回信息卡并交给既有登记控制器上传 | 保持原素材上传、白底图连线和未授权 hook 不变 | — |
| 179 | `web/tests/st01-set-batch-declaration.test.ts` | ST-01 离线合同回归 | 新增 v3 哈希、声明矩阵、数量门、单品清空、品类切换、三类合并、单品零回归、卡面锁定和页面接线测试 | 用纯函数、内存节点和静态渲染锁定第一期边界，零端口、零网络、零费用 | — |
| 180 | `web/tests/cfg01-clear-water-retirement.test.ts` | v3 契约摘要机械同步 | 仅把旧哈希字面量替换为 ST-01 新哈希，测试结构与其他正文逐字不动 | 契约根层新增 `batch_type` 后保持跨仓摘要互锚 | — |
| 181 | `CHANGELOG.md` | Unreleased | 新增一条 ST-01 用户可感知记录 | 归纳单品默认、套装联动上传与单品零漂移 | — |
| 182 | `docs/content/docs/progress/pending-test.mdx` | ST-01 真人待验清单 | 登记单品默认、套装数量门、切换清理、登记锁定、回执与零费用制作闸门验收项 | 自动合同不替代真实画布和工作台联动验收，文档不写具体日期 | — |
| 183 | `web/src/lib/canvas/canvas-batch-intake.ts` + `web/tests/st01-set-batch-declaration.test.ts` | ST-01 登记校验层次修正与 G 发白盒回归 | `resolveBatchIntakeSelection` 只负责接线、原图凭证及跨类别节点 ID/SHA 重复检查，不再提前解析商品类型；`validateBatchIntakeFacts` 与信息卡登记入口的载荷双闸门继续保留；新增回归钉死重复 SHA 文案优先级，G 发在隔离副本重加提前闸门后 NC-01 与 ST-01 同时变红，复原后两文件 19 项全绿 | 保持涉费登记载荷失败关闭，同时让旧重复图守卫不被新声明校验遮蔽；既有 NC-01 测试正文未改 | — |
| 184 | `web/dist/` | ST-01 最新本机运行副本 | 按最终源码隔离重建为 12 文件 / 2,788,788 字节；树 SHA-256 `65321d6b18b249ac7e5774234655cb503a9cfa3e856b4f14d4d8f87c986a7bad`（相对路径统一 `/`、`StringComparer.Ordinal`、每行 `relative\|length\|sha256`、UTF-8 无 BOM、LF 且无尾换行）；新哈希 `266f01ac2532a334e8b4378ee369d49a9a6f97cbe256fbce8daef06b357b9a61` 及 `batch_type`、两组节点 ID、商品类型、两类上传区、1–3/2–8 必传和非法声明文案探针均命中，旧哈希零命中 | dist 与源码同窗交付并保持未暂存，用户硬刷新即可加载 ST-01 声明界面；未启动服务或触发生产/费用 | — |
| 185 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` | ST-03b 套装尺寸选填与 v4 合同 | `height_cm` 与长宽对齐允许空值；套装留空时统一提交 JSON `null`、回执元数据归一为 `undefined`，三维输入保留但显示选填；单品仍按品类必填尺寸校验 | 套装尺寸语义交由套装及各单件身份档案承接，同时保持单品登记、已填写套装尺寸和既有回执行为不变 | — |
| 186 | `web/tests/st01-set-batch-declaration.test.ts` + `web/tests/cfg01-clear-water-retirement.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | ST-03b 离线合同与真人验收登记 | 契约摘要更新为 `a030df8d0aa9c96d9275d7c6f463fbc9d8f10af57e8c4539c2cb9d0d903456d3`；新增套装三维全空、单品缺高度、套装填值、回执归一和卡面选填回归，并登记画布/工作台真人走查 | 用离线测试锁定“套装放行、单品不放宽”，真实联动仍由用户验收 | — |
| 187 | `web/dist/` | ST-03b 最新本机运行副本 | 按当前源码重建，运行副本包含 v4 新哈希及套装尺寸选填界面，旧合同哈希零残留 | 源码与运行成品同窗交付，用户硬刷新即可加载；未启动服务、未联网或触发生产费用 | — |
| 188 | `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` | ST-03c 套装手持建批入口禁用 | 选择套装时主图/详情图手持立即归零并置灰，套装切换品类和旧画布读取继续保持 0；切回单品按当前品类恢复两项默认值，提交前仍以同一事实校验拒绝非零套装载荷 | 只收紧建批入口，单品合法手持与后续运行时接口保持原样 | — |
| 189 | `web/tests/st01-set-batch-declaration.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | ST-03c 第一段离线合同与真人验收登记 | 覆盖套装 0 放行、非零拒绝、旧值归零、品类切换、卡面置灰、切回单品恢复默认和单品合法值；登记真人走查“变灰、不可选、归零、切回恢复” | 自动检查锁定入口防呆，真实画布交互仍由用户验收 | — |
| 190 | `web/dist/` | ST-03c 第一段最新本机运行副本 | 按最终源码离线重建为 12 文件 / 2,790,067 字节；树 SHA-256 `ccda981e320d7eb8c38a515cc22f6f804aeb892729bbe0e48a74e72f9daaf20e`，入口引用文件全部存在，套装手持拒绝文案、两项手持标签、零值汇总及 Unreleased 用户文案探针均命中 | 源码与运行成品同窗交付，用户硬刷新即可验收套装手持入口；未启动服务、未联网或触发生产费用 | — |
| 191 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` + `web/src/pages/canvas/project.tsx` + `web/tests/st01-set-batch-declaration.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | ST-05 连线全集与卡面合影勾选 | 退役套装二次上传管道；套装只从工作流机器连线全集选图，信息卡勾选 1–3 张合影并按连线顺序派生 2–8 张单件，断线勾选失败关闭，登记载荷显式携带派生划分；单品路径和重复 SHA 优先级保持不变 | 让套装建批回到与单品一致的唯一素材入口，角色分配集中在批次卡且不放宽任何重复图门禁 | — |
| 192 | `web/dist/` | ST-05 最新本机运行副本 | 按最终源码同盘隔离重建为 12 文件 / 2,789,276 字节；树 SHA-256 `1d9f570932f3895c9f662a8b923c5a4331dbdf3f8f12a70dca62c470aabef5d4`（相对路径统一 `/`、`StringComparer.Ordinal`、每行 `relative\|length\|sha256`、UTF-8 无 BOM、LF 且无尾换行）；入口引用全部存在，角色分配与三条失败关闭文案均命中，六条退役上传文案均为零命中 | 源码与运行成品同窗交付，用户硬刷新即可验收连线全集与卡面合影勾选；未启动服务、未联网或触发生产费用 | — |
| 193 | `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` | ST-09 套装尺寸状态、提交门与卡面禁填 | 旧套装画布读取和切换套装都把长宽高归一为空，切回单品不复活旧值；篡改套装尺寸载荷以固定人话拒绝，合法套装 facts 三项恒为 `null`；卡面显示“套装不填”并清空置灰 | 新建批次不再收集套装整体尺寸，避免把编译链不会产出的高度字面带入末端检查；单品必填与存量运行时解析保持不变 | — |
| 194 | `web/tests/st01-set-batch-declaration.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | ST-09 离线合同、版本归纳与真人待验 | 覆盖旧画布清空、单品填值后切套装清空、切回单品仍为空、篡改拒绝、三框置灰与新文案；同步替换 ST-03b 未发布的旧“选填”说明 | 以 1 项新增测试和既有批准断言同步锁定入口规则，真人只需验证信息卡交互，自动检查保持零网络、零模型、零费用 | — |
| 195 | `web/dist/` | ST-09 最新本机运行副本 | 按最终源码同盘隔离重建为 12 文件 / 2,789,742 字节；树 SHA-256 `20b55d1bd03d2a5993673021ecd9b7347f43d375c2c072315cdebae2552ac367`；入口引用全部存在，新尺寸拒绝文案与“套装不填”各命中主 bundle 1 次，旧“（选填）”零命中 | 源码与运行成品同窗交付，用户硬刷新即可验收套装尺寸禁填；未启动服务、未联网或触发生产费用 | — |
| 196 | `web/src/components/canvas/canvas-batch-info-node.tsx` | 根滚动容器 wheel 交互 | 追加 data-canvas-no-zoom 与捕获段 stopPropagation，滚轮悬停时滚动卡内内容 | 滚轮不再被画布缩放与全局默认滚动拦截抢占，照抄 prompt-select-dialog 既有模式 | — |
| 197 | `web/src/components/canvas/canvas-node.tsx` + `web/src/pages/canvas/project.tsx` + `web/src/lib/canvas/canvas-resource-references.ts` | 资源编号角标双轨显示 | 全局灰编号常驻左上、激活蓝编号保持右上，新增全局编号独立数据源 | 灰编号不再被激活编号覆盖，左上/右上各司其职，@ 与生成行为零变化 | — |
| 198 | `web/src/lib/canvas/canvas-resource-references.ts` + `web/src/components/canvas/canvas-node-generation.ts` + `web/src/components/canvas/canvas-node.tsx` + `web/src/components/canvas/canvas-config-composer.tsx` + `web/src/pages/canvas/project.tsx` + `web/src/lib/image-reference-prompt.ts` + `web/src/lib/seedance-video.ts` + `web/src/types/image.ts` + `web/src/types/media.ts` | 资源编号单轨化 | 全局编号成为唯一编号语言：角标单枚左上激活变色，@ 候选与配置节点胶囊统一全局编号（候选仍限已连线素材），Config 连线图默认全送，图片自身生成自身置前并入连线图，注入编号带 label 回落 | 消除双编号并存的杂乱、@ 所见即所得；免连线引用经真实试用后撤除，独立图片/视频页与批次链路零变化 | — |
| 199 | `web/src/components/canvas/canvas-resource-mention-textarea.tsx` | mention 输入框光标与 @ 触发 | textarea 提升为定位元素使光标不再被高亮层遮挡；@ 触发正则去掉行首/空白前置，与配置节点一致 | 有连线素材的输入框光标可见；已有文字后输入 @ 也能弹出引用菜单 | — |
| 200 | `web/src/components/canvas/canvas-resource-mention-textarea.tsx` | mention 高亮胶囊文字度量 | 胶囊去掉水平内边距与字重变化，高亮只用背景/颜色/圆角/描边 | 高亮层与 textarea 逐像素对齐，插入引用后光标、点击定位与换行不再错位 | — |
| 201 | `desktop/` | Electron 主进程、预加载、运行副本同步与 Windows x64 NSIS 配置 | 新增独立桌面壳；固定本机画布端口，启动或复用 Canvas Agent，注入既有连接信息，退出时只回收自身进程；安装包携带生产依赖和 Codex Windows 程序 | 不改网页业务与 Agent 接口，让无开发环境的 Windows 电脑可安装运行，并为后续官方 Codex 登录界面留出边界 | — |
| 202 | `README.md` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | 桌面版入口、版本归纳与真人待测清单 | 增加桌面构建入口、用户可感知说明，以及无开发环境安装、服务回收、存储和登录边界验收项 | 自动构建与冒烟不替代干净 Windows 电脑上的真人安装验收 | — |
| 203 | `desktop/package.json` + `desktop/scripts/package-portable.ps1` + `desktop/portable/README-zh-CN.txt` + 桌面说明 | Windows x64 免安装便携 ZIP | 从已构建的 `win-unpacked` 生成带单一顶层目录的 ZIP，并附完整解压、启动和账号安全说明 | 另一台电脑无需开发环境即可启动；不打包个人 Codex 凭据，官方账号授权边界不变 | — |
| 204 | `desktop/main.cjs` + `desktop/scripts/prepare-python-runtime.ps1` + `desktop/scripts/package-portable.ps1` + `desktop/package.json` + 便携/桌面说明 | 完整便携工作台与品类解锁 | 画布端口对齐 3000；自动启停 17372/17373；ZIP 加入 Python 3.12、Pillow、jsonschema、工作台运行文件、完整 `.agents/skills`、`categories` 与空白批次目录；冒烟真实读取 3 类品类 | 信息卡草稿恢复“单品/套装”可选，旧批次放入解压目录 `杯类`；不携带历史批次、Codex 凭据或图片渠道 API Key，网页版源码与 `web/dist` 不改 | — |
| 205 | `desktop/credentials.cjs` + `desktop/credentials.test.cjs` + `desktop/main.cjs` + `desktop/package.json` + `desktop/.gitignore` + `desktop/README.md` + `desktop/portable/README-zh-CN.txt` + `web/src/lib/canvas/canvas-workflow-production.ts` + `web/tests/canvas-workflow-production.test.ts` + `web/dist/` + 变更说明 | DESKTOP-02 便携版真实出图与渲染闸门续跑 | 从 EXE 同目录的同构凭据文件失败关闭地加载三项渲染环境变量，外部环境保留优先级；未出图的暂停/失败状态发送 `run: next`，已出图仍发送 `retry: renders`；补离线测试、说明与运行副本 | 制作机无需外部脚本即可在界面内通过费用确认进入真实渲染；无凭据电脑保持渲染锁定，既有工作流和费用确认不变 | — |
| 206 | `canvas-agent/src/canvas-session.ts` + `canvas-agent/src/canvas-session.test.ts` | CONN-01 多客户端会话与活跃画布路由 | 以每客户端 session 隔离状态；只在推过 state 的连接中选择最近活跃者，排除纯监听连接，并覆盖同 ID 重连和活跃连接断开转移；Canvas Agent 23 项通过（既有 14 + 新增 9） | 多客户端不再互相覆盖或随机回落，单客户端链路与原错误文案保持不变 | — |
| 207 | `web/src/lib/canvas/agent-connection.ts` + `web/src/components/canvas/canvas-local-agent-panel.tsx` + `web/tests/agent-connection.test.ts` | CONN-01 断线自愈 | 连接失败按 1 / 2 / 4 / 8 / 15 秒退避；有成功史时无限重试、冷启动最多 3 次，页面恢复可见时立即补连，hello 后重推画布状态，并以连接实例与生命周期双门拦截迟到事件；Web 240 项 / 1120 次断言通过（既有 236 / 1110 + 新增 4 / 10） | 用户未显式断开时可持续自愈，配置错误仍快速反馈，既有画布状态推送语义不变 | — |
| 208 | `desktop/shortcuts.cjs` + `desktop/shortcuts.test.cjs` + `desktop/main.cjs` + `desktop/package.json` + `desktop/scripts/package-portable.ps1` | CONN-01 桌面刷新与便携归档卫生 | 在菜单保持关闭的前提下支持五种普通/强制刷新键位；桌面测试 9 项通过（既有 6 + 新增 3）；便携归档仅按文件名过滤 `*.test.*` 文件，不改目录或其他打包行为 | 桌面断线后可直接刷新自救，交付包不携带测试文件，且不新增依赖 | — |
| 209 | `web/dist/` + `canvas-agent/dist/` + `desktop/runtime/` + `desktop/release/` | CONN-01 最终运行副本与便携 ZIP | `web/dist` 12 个文件、2,793,049 字节，树 SHA-256 `9ddaa078f5b1bbd44d45dcf4b82fe856bbc18f6c6cea076ec3a99deb3e53f002`；Agent dist/runtime 24 个文件、139,139 字节；`InfiniteCanvas-Portable-0.1.0-x64.zip` 270,569,806 字节，SHA-256 `04FDBDDC9D494BFFB248536E51D06BCDD3665B5416D48075159F1A68BE5A105C` | ZIP 内 `*.test.*`、`render-credentials.json`、`*.bat` 均为 0，`shortcuts.cjs` 与新 Agent dist 均存在；全程零联网、零费用 | — |
| 210 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | CONN-01 版本归纳与真人待测清单 | 归纳多客户端路由、断线自愈、桌面刷新和便携归档卫生，并登记四项真人验收 | 自动测试、构建与冒烟已通过；功能仍需用户按清单终验 | — |
| 211 | `canvas-agent/src/codex-auth.ts` + `canvas-agent/src/codex-auth.test.ts` + `canvas-agent/src/agents.ts` + `canvas-agent/src/http-server.ts` | DESKTOP-03 Codex 官方登录状态与授权入口 | 复用内置 Codex CLI 提供失败关闭的登录状态查询、单例浏览器授权进程及两条令牌保护端点；真实未登录测试只使用预建空临时 `CODEX_HOME` | 不读取或迁移账号凭据，不提供 API Key 登录，不改变既有回合错误映射和测试正文 | — |
| 212 | `web/src/lib/agent/agent-codex-auth.ts` + `web/tests/agent-codex-auth.test.ts` + `web/src/components/canvas/canvas-local-agent-panel.tsx` | DESKTOP-03 Agent 面板 Codex 账号卡片 | 连接后自动检测账号；未登录可发起官方浏览器授权并按 3 秒、最多 100 次轮询自动翻转，断开或卸载立即清理 | 状态只留在组件内，原连接、对话、历史、日志和错误归因保持不变 | — |
| 213 | `desktop/portable/FIRST-DEPLOY-CHECKLIST-zh-CN.txt` + `desktop/portable/README-zh-CN.txt` + `desktop/scripts/package-portable.ps1` | DESKTOP-03 首次部署检查单 | 便携包新增中文完整解压、可选渲染凭据、Codex 授权、SmartScreen、旧批次迁移与部署自检步骤；README 开头指向检查单并沿用单文件归档 | 不携带任何登录状态、渲染凭据、图片渠道 Key 或历史批次，不改 NSIS | — |
| 214 | `web/dist/` + `canvas-agent/dist/` + `desktop/runtime/` + `desktop/release/` | DESKTOP-03 最终运行副本与便携 ZIP | Web dist/runtime 均为 12 文件、2,797,216 字节；Agent dist/runtime 均为 28 文件、149,676 字节；`InfiniteCanvas-Portable-0.1.0-x64.zip` 270,574,080 字节，SHA-256 `50C62FFE738AE4890F99AE5AD0BD9172A51244A4DE28CDBD01F77889D5F43A43` | ZIP 内检查单和 `codex-auth.js` 各 1，`*.test.*`、`render-credentials.json`、`*.bat` 均为 0；Electron 缓存失效后 electron-builder 从官方源重新取得并解压 43.4.0 分发包 | — |
| 215 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DESKTOP-03 版本归纳与真人待测清单 | 归纳官方登录入口与首次部署检查单，并登记本机已登录态和美工机未登录全流程真人验收 | 自动检查不替代干净 Windows 目标电脑上的浏览器授权与部署自检 | — |
| 216 | `desktop/scripts/package-portable.ps1` + 三份桌面说明 | DESKTOP-04 便携 ZIP 内置渲染凭据 | 打包前失败关闭地校验本机忽略文件的存在性、JSON、非空 `api_key` 与 HTTP(S) `base_url`，仅由便携脚本注入 ZIP 根；说明同步为完整解压即出图及替换/删除后重启 | 杜绝产出无法真实出图的便携包；不改 `build.files`、运行时凭据路径、Codex 账号边界或 Git 排除规则 | — |
| 217 | `docs/content/docs/progress/pending-test.mdx` | DESKTOP-04 真人待测清单 | 登记新 ZIP 在干净目录完整解压、不另放文件并经费用卡批准后完成一次真实出图闭环 | 自动离线校验不产生费用，真实扣费闭环必须由用户明确批准并验收 | — |
| 218 | `desktop/release/` | DESKTOP-04 最终便携 ZIP | 重建 `win-unpacked` 并生成 270,574,411 字节、2,922 条目（文件 2,920＋目录 2）的 `InfiniteCanvas-Portable-0.1.0-x64.zip`，SHA-256 `14BDF9BE8136A709DE902DD4A2452E94082524CEF66890B5555237ADF5D6B37F`（顾问终验以带写入断言的三发变异复验后重新打包，内容与执行方产物等价，仅凭据条目时间戳致哈希不同） | ZIP 根内渲染凭据恰 1 条且与本机忽略源文件逐字节一致；`*.test.*`、`*.bat`、`auth.json` 均为 0；Electron 43.4.0 由构建链从官方源取得 | — |
| 219 | `canvas-agent/src/codex-command.ts` + `canvas-agent/src/codex-command.test.ts` | DESKTOP-05 Codex 启动命令解析模块 | 新增 `resolveCodexCommand(platform?, arch?)`：win32 经平台包定位直连原生 `codex.exe`（baseArgs 空，env 注入包装器同款 `CODEX_MANAGED_BY_NPM` 与 `CODEX_MANAGED_PACKAGE_ROOT`）；非 win32 或定位/存在性失败回退 `process.execPath + codexBin()` 且回退带 `fallback.reason` 标记；`codexBin()` 自 agents.ts 原样移入 | 官方 JS 包装器 spawn 原生程序时无 `windowsHide`，Electron 无控制台进程链下 Windows 必为其新开可见黑色控制台窗口；直连后由调用点既有 `windowsHide: true` 隐藏，异常时逐字节回落现状仅观感退化 | — |
| 220 | `canvas-agent/src/agents.ts` + `canvas-agent/src/codex-auth.ts` | Codex app-server 常驻会话与 login / login status 三处 spawn 实参 | 三处统一改为 `resolveCodexCommand()` 三元形态（各自 stdio 与 `windowsHide: true` 原样不动，env 仅原生直连时传入），app-server 与一键登录两处回退时经既有 agent_log 登记原因；`codexBin` 定义与 `createRequire` 一并移出 agents.ts，codex-auth 改从新模块 import 并为注入式 spawn 类型补可选 env | 黑窗主源是 app-server 常驻进程；三处统一形态保证行为一致，login status 入口无 emit 通道故回退不落日志（行为仍与现状等价） | — |
| 221 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DESKTOP-05 版本归纳与真人待测清单 | 归纳黑窗消除、直连原生程序与自动回退，并登记黑窗肉眼消失、助手/建批链路、账号检测与一键登录四项真人验收 | 自动测试只锚定命令形态与调用点合同，窗口可见性必须真人在桌面验收 | — |
| 222 | `canvas-agent/dist/` + `desktop/runtime/` + `desktop/release/` | DESKTOP-05 最终运行副本与便携 ZIP | Agent dist/runtime 均为 32 文件、158,329 字节（新增 codex-command 4 产物）；Web dist/runtime 保持 12 文件、2,797,216 字节零改动；重建 `win-unpacked` 并生成 270,575,804 字节、2,923 条目（文件 2,921＋目录 2）的 `InfiniteCanvas-Portable-0.1.0-x64.zip`，SHA-256 `F8C5A0E804F46139FE7F8C419980B1455DD65FA7F2987C07DB76A479A41AA73F`；包内 runtime dist 口径＝electron-builder 默认剥 `*.d.ts`、打包脚本剥 `*.test.*`，故相对旧包净增 `codex-command.js` 1 条 | ZIP 根内渲染凭据恰 1 条且与本机忽略源文件逐字节一致；`*.test.*`、`*.bat`、`auth.json` 均为 0；正向新增判据通过＝包内 `@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` 存在；包内 runtime dist 11 个非测试 .js 与本仓新 dist 逐一哈希一致；零费用冒烟＝包内 EXE 三次 login status 全 ok，codex.exe 存活期 504 次采样 MainWindowHandle 全为 0；Electron 43.4.0 由构建链从官方源取得 | — |
| 223 | `canvas-agent/src/codex-isolated.ts` | P2-b 独立 Codex app-server 会话与最小协议客户端 | 新建或续接回合时各自启动独立原生 Codex 进程，完成后即回收；只实现 initialize、thread start/resume、turn start 与通知解析，限制最多 4 个并发会话并在超限时失败关闭，所有事件附 `threadId`，完成事件附本轮 `assistantText`，正常、失败和 660 秒硬超时均进入进程清理 | 拆除真实制作上游受全局队列和无归属广播限制的两道并发闸门，同时不改 `agents.ts` 单例或既有画布助手会话 | — |
| 224 | `canvas-agent/src/http-server.ts` | `POST /agent/codex/isolated/turn` 与 `/agent/codex/isolated/continue` | 在既有 token 中间件之后注册隔离新建与续接入口，立即返回 `{ok, threadId}`；并发上限返回明确 503，其他错误按隔离模块的固定响应映射，旧 `/agent/codex/*` 路由原样保留 | 给主仓 transport 提供可按线程归属等待的 fire-and-forget 接口，不静默回退全局串行路径 | — |
| 225 | `canvas-agent/src/codex-isolated.test.ts` | P2-b 隔离会话与路由离线回归 | 通过注入式 fake 进程和路由调用覆盖带线程归属及助手文本的完成事件、第 5 个并发请求拒绝且前 4 个不受影响、正常/失败/硬超时三路进程回收、两条新路由存在及旧路由保持可用 | 在零真实网络、零真实 Codex 进程下锁定并发上限、事件归属、资源回收与向后兼容边界 | — |
| 226 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | P2-b 版本归纳与待联调清单 | Unreleased 归纳隔离会话、4 路上限、线程归属、进程清理、新入口与离线回归；待测试页登记真实 main/detail 并发、事件串扰、容量上限、660 秒清理和既有画布助手兼容验证 | 离线用例不替代真实 Codex、主仓工作台与长超时现场联调，文档不提前宣称联调通过 | — |
| 227 | `canvas-agent/src/codex-isolated.ts` + `canvas-agent/src/codex-isolated.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | P2-c `final_prompts` 墙钟 rider | 隔离会话硬超时由 `660_000` 延长为 `1_260_000` 毫秒，新增 `1_260_000` 字面锚并继续用生产常量驱动离线硬超时清理；版本记录与待测试清单同步登记 1200/1260 秒联动 | 给主仓仅 `final_prompts` 的 1200 秒回合保留 60 秒清理余量；4 路上限、其他步骤 600 秒墙钟及既有画布助手路径不变，编译运行副本留待 v12 重打包 | — |
| 228 | `web/src/lib/canvas/agent-connection.ts` + `web/src/components/canvas/canvas-local-agent-panel.tsx` + `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/tests/dc01-agent-reconnect-watchdog.test.ts` | DC-01 W0/W1/W3 断链取证、SSE 死链检测与看门狗真话化 | W0 只读取证未坐实依赖抖动，画布快照约 10.1 KB 且无 `data:` 图片，断链触发原因仍未定位；W1 以 45 秒字面锚消费 ping 与业务事件，静默超时复用既有退避重连；W3 仅在明确断链时保持过期 running 卡锁定并显示自动重连真话，连接态缺席、连接正常和 8 秒接单超时保持原行为 | 半开 EventSource 不触发 `onerror` 时也能自愈，且不把“页面听不见”误报为后台制作死亡；Canvas Agent 服务端与既有阈值不改 | — |
| 229 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/project.tsx` + `web/tests/dc01-workflow-production-reconcile.test.ts` | DC-01 W2 真实制作状态回补 | 新增 17373 状态摘要严格读取与 metadata 纯映射；仅在页面加载和 SSE 由断开转为连接时，对真实 queued/running 卡按 project、machine、card、batch 四维键执行 30 秒节流回补；请求失败使用批准文案失败关闭，并以对象身份和当前目标复核拒绝迟到响应 | 页面刷新或断链期间丢失推送后可恢复后台真实进度/终态；不重放事件、不装离线队列、不改变制作命令与费用门禁 | — |
| 230 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DC-01 版本归纳与真人待测清单 | Unreleased 归纳半开死链自动重连、在途状态回补和断链真话文案；待测试页登记半开静默、在途刷新/重连、卡片锁定及回补失败现场验收 | 离线测试不替代真实浏览器半开连接与在途批次现场验证；验收不得点击费用确认或“重新开始” | — |
| 231 | `web/dist/` | DC-01 最新随仓运行副本 | 按最终源码与更新后的 CHANGELOG 离线重建；入口与主 bundle 使用同次构建产物并随仓交付 | 用户硬刷新即可加载死链检测、状态回补与真话文案；不改 Canvas Agent、桌面 runtime 或便携 ZIP | — |
| 232 | `desktop/main.cjs` + `desktop/data-root.test.cjs` + `desktop/package.json` + `desktop/scripts/package-portable.ps1` + `desktop/portable/README-zh-CN.txt` + `desktop/portable/FIRST-DEPLOY-CHECKLIST-zh-CN.txt` + `desktop/README.md` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DATA-01 程序根与用户数据根分离 | 桌面启动的工作台与演示初始化统一注入当前系统 Documents 下的品牌数据根，删除程序旁“杯类”创建逻辑；新增离线回归覆盖 Documents 拼接、两类 Python 子进程环境保留与注入、程序侧“杯类”零创建；便携 ZIP 不再携带空 `reports` 或空“杯类”，说明与真人验收清单同步记录数据位置、首启、重定向 Documents 和升级保留 | 程序目录可整体替换而不迁移批次数据；同一 ZIP 在不同电脑使用各自的 Documents 数据根，同时保留程序资产、凭据、静态服务和 demo userData 既有位置 | — |
| 233 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/project.tsx` + `web/tests/canvas-workflow-production.test.ts` + `web/tests/dc01-agent-reconnect-watchdog.test.ts` + `web/tests/dc01-workflow-production-reconcile.test.ts` + `web/dist/` | OR-01 前端超时阈值对齐与恒等清理 | 真实制作进度静默阈值由 12 分钟调整为 22 分钟，覆盖 final_prompts 1200 秒回合、VD-01 回合结束心跳和传输余量；保留精确 `>=` 到期边界，并删除恢复链中已退化的恒等包装 | 合法长回合不再被 12 分钟旧阈值误判；进程重启孤儿由主仓启动回补接管，本阈值仅作进程存活但长期无声时的最终兜底 | — |
| 234 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production-status-polling.ts` + `web/src/pages/canvas/project.tsx` + `web/tests/dc04-workflow-production-status-polling.test.ts` + `web/dist/` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DC-04 真实制作权威状态轮询、页面接线与离线回归 | 新增 running 且有批次号时每 30 秒读取 17373 权威状态的页面私有 hook；按机器与批次单飞，响应只向 running/paused/completed/failed 推进，迟到 queued、非 running 本地状态及 requestId 代际不匹配响应丢弃，running 状态合并保留本地阶段 message、终态采用权威结果，请求失败静默并保留既有 22 分钟兜底；新增纯函数、接线合同与墙钟联动测试，版本记录和真人验收清单同步登记 | SSE 断链但工作台仍健康时，阶段人话不被轮询抹除，进度与精确失败原因继续回补且不会误报服务中断；重新开始后的新一代不会接收旧代迟到响应，17373 持续不可达时仍由原墙钟最终兜底，排队接单、一次性页面回补、费用门和后端均不改 | — |
| 235 | `web/src/lib/agent/agent-chat-view.ts` + `web/src/components/canvas/canvas-agent-chat-ui.tsx` + `web/src/components/canvas/canvas-local-agent-panel.tsx` + `web/tests/agent-chat-view.test.ts` + `web/dist/` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | P1 Agent 对话面板长消息渲染治理 | 集中定义 4000 字符折叠阈值、1500 字符预览、最近 30 条窗口和 20000 字符详情上限；消息组件 memo 化，附件转换按原消息引用缓存，长回复与工具正文按需展开，详情首次展开才序列化；新增 15 项纯函数与源码接线离线回归并重建运行副本 | 避免含 2–9 万字符生产消息的历史线程反复执行全量 Markdown 与详情渲染而拖死 UI 线程；消息全文、顺序、流式、工具卡、附件、store、事件协议、回填与轮询语义均不改 | — |
| 236 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/lib/canvas/canvas-workflow-production-observations.ts` + `web/src/components/canvas/canvas-workflow-node.tsx` + `web/tests/canvas-workflow-production.test.ts` + `web/tests/dc01-workflow-production-reconcile.test.ts` + `web/tests/dc04-workflow-production-status-polling.test.ts` + `web/tests/an01-workflow-production-observations.test.ts` + `CHANGELOG.md` | AN-01 入库结果与绑定分布非阻断告知 | 严格解析 17373 status 的可选角度入库摘要与绑定分布，纯函数派生被拒图片、单源生产和完成态分布人话；真实 production 卡最小接线并为多条提示保留限高滚动，新增纯函数与源码调用/渲染锚定回归 | 用户无需翻账本即可知道哪些上传图未进入生产、是否退化为单源及最终绑定分布；历史批次字段缺省时不显示，费用卡、30 秒轮询节奏、流程停点和 React 测试基础设施均不改 | — |
| 237 | `web/dist/` | AN-01 最新随仓运行副本 | 按 #236 的最终源码与 CHANGELOG 离线重建，入口与哈希资源使用同次构建产物 | 用户硬刷新即可加载非阻断入库结果提示；不改 Canvas Agent、desktop runtime、费用卡或便携 ZIP | — |
| 238 | `desktop/background-policy.cjs` + `desktop/background-policy.test.cjs` + `desktop/main.cjs` + `desktop/package.json` | BG-01 Electron 后台保活策略、生命周期接线与离线回归 | 独立无 Electron 依赖的模块集中三条 Chromium 后台开关和 `prevent-app-suspension` 幂等状态机；主实例在 ready 前追加开关，窗口禁用后台节流，应用启动即阻止挂起、退出即安全停止；源码锚定测试钉住四处接线并把模块加入桌面测试与打包清单 | 画布在最小化、被遮挡或系统锁屏时继续处理后端指令，显示器仍可正常息屏；不改 web、Canvas Agent、工作台后端、窗口安全项或便携运行副本 | — |
| 239 | `desktop/background-policy.cjs` + `desktop/background-policy.test.cjs` + `desktop/main.cjs` | BG-01 保活启动失败安全降级 | 保留 blocker ID、非负整数与 `isStarted` 三重校验；Electron 启动或校验失败时由注入的 `console.warn` 记录原因并返回未启动状态，主启动流程继续执行；start/stop 统一为空值安全调用并新增降级与接线回归 | 电源策略、RDP 或虚拟机环境不支持 blocker 时仍可正常打开画布，仅退回无系统挂起保护的旧行为；stop 幂等语义和既有后台开关不变 | — |
| 240 | `desktop/process-output-log.cjs` + `desktop/process-output-log.test.cjs` + `desktop/main.cjs` + `desktop/package.json` | LOG-01 工作台子进程输出双流轮转落盘 | 独立无 Electron 依赖的模块把工作台 stdout/stderr 原始字节分别追加到数据根 `workflow-runtime/logs`，每流 5 MiB、保留 2 份轮转；主进程继续逐字转发原输出并安全降级，源码锚定测试钉住双流接线、数据根路径、测试脚本与打包清单 | GUI 便携版下工作台进程输出不再永久丢失；不改 Canvas Agent 输出、web、BG-01、工作台状态机或便携运行副本 | — |
| 241 | `desktop/main.cjs` + `desktop/main-window-foreground-policy.test.cjs` + `desktop/package.json` | FG-01 重复启动静默与主窗口前台策略契约 | 删除重复启动时还原、聚焦主窗口的处理器，保留防端口冲突的单实例锁；新增无 Electron 依赖的源码负向契约并纳入桌面测试清单 | 应用运行期间再次启动只让第二实例退出，老窗口不自行还原、夺焦或闪烁；首次启动显示、后台保活、窗口安全项与运行副本均不改 | — |
| 242 | `web/src/components/canvas/canvas-agent-connection-host.tsx` + `web/src/components/canvas/canvas-local-agent-panel.tsx` + `web/src/lib/canvas/canvas-agent-client.ts` + `web/src/layouts/user-layout.tsx` + `web/src/components/layout/app-top-nav.tsx` + `web/src/stores/use-agent-store.ts` + `web/tests/agent-connection.test.ts` + `web/tests/dc01-agent-reconnect-watchdog.test.ts` + `web/tests/dc05-agent-connection-host.test.ts` + `web/dist/` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | DC-05 画布 Agent 连接会话应用级常驻 | 把唯一 SSE、死链检测、退避重连、事件/工具处理、URL 注入与已存 token 自动连接迁入 UserLayout 唯一无界面宿主；面板经现有 store 命令调用启停、失败重试、确认/拒绝与撤销，并删除未使用的 headless/autoConnect props；新增源码唯一性、挂载、URL 注入与 token 自动连接双路径和显式停用保护契约，既有连接测试与 DC-01 均只改源码锚点指向并重建运行副本 | 收起 Agent 面板、切页或最小化不再拆除画布会话，真实制作投影可持续上桌；协议、45 秒死链阈值、退避参数、30 秒工具超时、confirmTools 语义、toast 文案和 Canvas Agent/desktop/主仓均不改 | — |
| 243 | `web/src/types/canvas.ts` | `CanvasNodeMetadata.pairedNodeId` | 仅新增可选字符串成对标识，卡与机器互指 | 未识别 metadata 键继续按既有 JSON 透传/忽略；节点类型、连线结构及后端合同均不改 | — |
| 244 | `web/src/lib/canvas/canvas-docked-pair.ts` | MG-01 成对纯函数合同 | 集中成对创建计划、含内部线的合体判定、内部线隐藏、拖删级联、复制重映射/剥离与文案分流 | 合体渲染、内部线隐藏和缩放抑制共用 `dockedPairVariant` 四条件状态源；拖删仍只按存在的配对标识级联 | — |
| 245 | `web/src/components/canvas/canvas-toolbar.tsx` + `web/src/pages/canvas/project.tsx` | “生图工作流”单入口与 `createDockedWorkflow()` | 合并原两个工具栏按钮，一次追加同宽相邻卡、机器及卡到机器内部线 | Agent/拖放等裸节点路径不扩权，旧形态依靠统一回退规则共存 | — |
| 246 | `web/src/pages/canvas/project.tsx` | 合体变体映射与连线渲染过滤 | 每次从节点和完整连线集计算上下盒变体，仅对完整合体的内部线追加渲染隐藏 | 内部线数据永久保留供快照、导出和后端按原协议读取；条件破坏时连线恢复可见 | — |
| 247 | `web/src/pages/canvas/project.tsx` | `deleteNodes`、`handleNodeMouseDown`、`pasteCopiedNodes`、`duplicateNode` | 删除/拖动把存在的 partner 纳入既有集合；成对粘贴重映射，半对粘贴和单节点复制剥离标识 | 沿用 `deleteNodes` 现有端点过滤清线与 BN-02 删除预检，不新增旁路清理 | — |
| 248 | `web/src/components/canvas/canvas-node.tsx` | docked-top/bottom 外框、接入口装饰与 A3 手柄门 | 合体上盒只圆上角、下盒只圆下角并去掉顶边；两盒左侧显示角色接入口；仅当前四条件合体变体不渲染四角缩放手柄 | 缺内部线、几何失配或普通节点均恢复四角手柄；默认 prop 路径保持原标题、圆角和连接点行为 | — |
| 249 | `web/src/components/canvas/canvas-batch-info-node.tsx` + `web/src/components/canvas/canvas-workflow-node.tsx` | `docked` 可选变体 | 上盒承载合体标题/模式/批次副标，下盒隐藏重复头部并启用产品原图接入口引导；登记表单、回执、按钮和生产状态主体复用原组件 | 默认不传时逐字沿用独立节点；草稿全部输入控件和登记后只读切换不分叉 | — |
| 250 | `web/tests/canvas-docked-pair.test.ts` | MG-01/A1/A2 离线回归与变异防线 | 覆盖创建几何、四条件判定、隐藏不过度、旧画布、复制、拖删、文案、默认组件、缩放手柄和页面接线 | 零网络、零真实画布、零工作台、零费用；视觉拼缝与吸附手感仍留真人验收 | — |
| 251 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | MG-01 版本归纳与真人待测清单 | 记录单入口合体及协议不变，并登记创建、两口吸附、整体拖删、旧画布、演示与自然真实批次验收 | 自动测试不代替真实浏览器交互和自然付费批次，文档不提前宣称真人通过 | — |
| 252 | `web/dist/` | MG-01 最新随仓运行副本 | 按最终源码与版本记录离线重建入口和哈希资源 | 源码与运行副本同次交付；不改 Canvas Agent、desktop runtime、主仓或后端 | — |
| 253 | `canvas-agent/src/codex-isolated.ts` + `canvas-agent/src/codex-isolated.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | SLIM-03 生产隔离会话提示词直通 | 隔离新建与续接会话直接传递生产 prompt，不再附加画布助手工具教学；新增源码负向锚与续轮原文正负断言，并登记真实批次头部复核欠账 | 生产隔离会话本就不挂画布工具，去除无效前缀不改变空串拒绝、线程归属、模型档位、4 路并发或两个助手面板入口；不重建 `dist` | — |
| 254 | `canvas-agent/src/agents.ts` | AG-01 Codex delta 全量快照节流与回合级身份 | 首个 delta 立即广播，持续流按每消息 100ms 至多一次发送最新全量快照；`item/completed`、错误和 turn 完结强制冲刷，键改为 `turnId:itemId`，turn 完结清理累积文本与定时器，真实 delta 计数口径不变 | 切断逐字符累积全文广播与跨回合裸 itemId 串接，同时保持 `item.updated` 全量快照、`stream.summary`、SSE 事件名和 payload 结构不变 | 2026-08-27 |
| 255 | `canvas-agent/src/agents-delta.test.ts` | AG-01 可控时钟节流回归与变异防线 | 新增 5 项假时钟测试，覆盖 100ms 上限、最新快照、item/错误/turn 冲刷、定时器与累积表清理、跨 turn 复用 itemId 及真实 delta 计数 | 零墙钟睡眠、零真实 Codex、零网络；M1/M3/M4 行为回退均可稳定引红 | 2026-08-27 |
| 256 | `web/src/lib/canvas/canvas-agent-client.ts` | AG-01 `agentStreamId()` 与 `upsertAgentMessage()` 纯函数 | 集中组合身份、文本规整、同键快照覆盖、新键追加、无身份旧行为与 `slice(-120)`；流式路径不再调用 merge，保留的无身份助手合并删除 O(n²) 重叠扫描 | 两组件共享单一消息决策，带身份消息绝不并入上一条或丢失 streamId，普通 user/tool/error/提示保持原行为 | 2026-08-27 |
| 257 | `web/src/components/canvas/canvas-agent-connection-host.tsx` + `web/src/components/canvas/canvas-local-agent-panel.tsx` | AG-01 两处 `addMessage` 薄包装与流式身份接线 | 删除两份重复决策，统一调用纯 upsert；SSE 助手消息优先使用实际 turn 字段与 item id 组成身份，并兼容已组合或仅有旧 item id 的事件 | 常驻 SSE 与面板内本地提示使用同一有界写入规则；连接、工具、历史、渲染与 store 文件均不改 | 2026-08-27 |
| 258 | `web/tests/agent-message-upsert.test.ts` | AG-01 双消息复现、upsert 矩阵与组件接线 | 新增 10 项覆盖同 turn 两条 agent_message 交错快照、同键稳定 id、新键、跨 turn 同 itemId、无身份消息、尾部上限、trim/空文本及两组件唯一接线 | T1 在修前稳定复现消息并吞与全文膨胀；M2/M4 退回旧合并时稳定引红 | 2026-08-27 |
| 259 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | AG-01 版本归纳与真人待测清单 | 记录长配置阶段 Agent 面板流畅性与重复巨字消息治理，并登记真实批次开面板验收项 | 自动测试不替代约 26 分钟真实配置阶段的浏览器交互验收，费用与批次数据不受影响 | 2026-08-27 |
| 260 | `web/dist/` | AG-01 最新随仓运行副本 | 按最终源码与版本记录重建入口和哈希资源 | 用户硬刷新即可加载严格消息身份更新；不改 Canvas Agent 运行副本、desktop runtime、主仓或后端 | 2026-08-27 |
| 261 | `web/src/types/canvas.ts` + `web/src/lib/canvas/canvas-batch-intake.ts` + `web/src/pages/canvas/use-canvas-batch-intake.ts` + `web/src/components/canvas/canvas-batch-info-node.tsx` + 建批契约测试 | QL-01 批次生图质量声明 | 元数据新增 `renderQuality`，排队载荷新增顶层 `render_quality`；新卡默认自动，旧值缺失或非法归一自动，换品类保留选择，完成回执只读展示；四档按钮由批次卡本地维护 | 不引用上游生图面板，不改品类表单、事实十字段、教学正文、canvas-agent 或 desktop | 2026-08-28 |
| 262 | `web/src/lib/canvas/canvas-workflow-production.ts` + `web/src/pages/canvas/use-canvas-workflow-production.ts` + `web/src/components/canvas/canvas-workflow-production-cost-card.tsx` + `web/tests/ql01-render-quality.test.ts` + `web/tests/canvas-workflow-production.test.ts` + 版本记录 | QL-01 制作确认卡与报价合同 | 报价类型删除单价/金额并严格读取 `renderQuality`；纯函数固定剩余张数、中文质量、时长、服务商费用口径、标题与按钮文案，离线测试覆盖载荷、兼容和金额负向合同 | 人工确认卡点、取消零副作用、失败即停、无自动重试及既有生产命令不变；真实档位和账单留待真人核对 | 2026-08-28 |
| 263 | `web/dist/` | QL-01 最新随仓运行副本 | 按最终源码、契约哈希与确认卡文案重建入口和哈希资源 | 用户硬刷新即可加载四档质量和无金额确认卡；不改 Canvas Agent 或 desktop runtime | 2026-08-28 |
| 264 | `web/src/lib/gpt-image-size.ts` + `web/src/services/api/image.ts` + `web/tests/gsz01-gpt-image-size.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | GSZ-01 gpt-image 官方尺寸档位吸附 | 新增纯函数按已解析模型名识别 gpt-image；空值/auto 继续省略 size，其余比例或像素按对数阈值吸附横、方、竖三档；生成与编辑两入口仅对该模型族接线，quality 独立原样透传，并新增吸附矩阵、阈值边界、非法格式、3:4 跨仓一致性、非目标模型保持及源码负向锚定回归 | 画布原生生图与独立图片页不再发出 `1760x2352` 等非三档大尺寸，降低服务端已生成计费但前端网关超时的风险；Gemini、非 gpt-image 的 OpenAI 模型、主仓批次链路、重试与错误覆盖逻辑均不改 | 2026-08-30 |
| 265 | `web/dist/` | GSZ-01 最新随仓运行副本 | 按最终源码、测试与版本记录重建入口和哈希资源 | 用户硬刷新即可加载 gpt-image 三档尺寸吸附；不改 Canvas Agent、desktop runtime 或主仓批次运行副本 | 2026-08-30 |
| 266 | `web/src/lib/reference-image-compression.ts` + `web/src/services/api/image.ts` + `web/tests/gsz02-reference-image-compression.test.ts` + `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | GSZ-02 gpt-image 参考图发送前压缩 | 新增纯决策与浏览器重编码两层：仅对超过 256KB、无 mask、已解析为 gpt-image 的参考图执行白底 JPEG 0.85 / 长边 1280 重编码，候选为空或不更小时原图放行；`requestEdit` 单点接线，并新增阈值、mask、模型、常量单点、fail-open 与源码边界回归 | 缩短 medium 拉线改图的请求在网时间；带 mask、Gemini、`requestGeneration`、quality 现有行为、GSZ-01 尺寸吸附、失败即停和无自动重试均不改；high 仍受外部超时约束 | 2026-08-30 |
| 267 | `web/dist/` | GSZ-02 最新随仓运行副本 | 按最终源码、测试与版本记录重建为 12 个文件 / 2,822,200 字节，入口与哈希资源来自同次构建 | 用户硬刷新即可加载 gpt-image 参考图发送前压缩；不改 Canvas Agent、desktop runtime、主仓批次运行副本或 Gemini 链路 | 2026-08-30 |
| 268 | `web/src/components/layout/app-config-modal.tsx` | “模型”页签第二个模型网格之后 | 仅新增 1 个导入与 1 个 `<WorkflowTextModelConfig />` 渲染锚点 | 在既有配置页提供批次识图模型选择与同步状态，不改原四类默认模型和可选项 | 2026-09-03 |
| 269 | `web/src/layouts/user-layout.tsx` | `<CanvasAgentConnectionHost />` 之后、`<AgentPanel />` 之前 | 仅新增 1 个导入与 1 个 `<WorkflowTextModelSyncHost />` 应用级无界面宿主 | 让已选模型在页面切换和面板收起时仍随渠道或连接令牌变化同步；现有 Agent SSE 宿主原行与协议不改 | 2026-09-03 |
| 270 | `web/dist/` | TMS-01 最新随仓运行副本 | 按最终源码与版本记录重建为 12 个文件 / 2,827,447 字节，入口与哈希资源来自同次构建 | 用户硬刷新即可加载识图模型配置、应用级同步与确认卡模型标签；不改 Canvas Agent、desktop runtime、主仓批次运行副本或生图链路 | 2026-09-03 |
| 271 | `web/src/stores/use-config-store.ts` | TMS-02 通用配置默认与一次性迁移 | 内置 default 渠道和三处默认文本引用改为 `gpt-5.6-sol`；persist v1 只识别 default 渠道原始 `gpt-5.5` 与 `default::gpt-5.5` 引用 | 自定义渠道、Key、URL、名称、顺序、其它模型和选择逐项保持；迁移可重复运行且不扩大到用户渠道 | 2026-09-03 |
| 272 | `web/src/stores/use-workflow-text-model-store.ts` + `web/tests/tms01-workflow-text-model.test.ts` | TMS-02 工作流默认、一次性迁移与离线合同 | 新安装默认改为 `gpt-5.6-sol / medium`；persist v1 只迁移 `kind=codex && model=gpt-5.5` 并保留 effort；现有测试锁定两份 migrate 接线、幂等性、保护边界和双客户端精确版本 | OpenAI-compatible 渠道选择原样保留；不引入模型禁用名单，不阻断用户手工切回旧型号 | 2026-09-03 |
| 273 | `canvas-agent/package.json` + `canvas-agent/bun.lock` + `desktop/package.json` + `desktop/package-lock.json` + `desktop/portable/README-zh-CN.txt` + `desktop/portable/FIRST-DEPLOY-CHECKLIST-zh-CN.txt` | TMS-02 双份内置 Codex 与便携当前口径 | Canvas Agent 与 Desktop 的 `@openai/codex` 均精确固定为 `0.153.0` 并机械更新双 lock；便携说明登记 Sol 默认、精确迁移边界与真人账号验证 | Windows 原生程序布局和现有 resolver 不改；不打包、不部署、不切快捷方式 | 2026-09-03 |
| 274 | `CHANGELOG.md` + `docs/content/docs/progress/pending-test.mdx` | TMS-02 版本归纳与真人待验清单 | 记录 Sol 默认、精确迁移、双客户端版本及真实账号/质量对照验收项目 | 离线 bundled catalog 和测试不替代付费或真实模型验收，不提前宣称质量提升 | 2026-09-03 |
| 275 | `web/dist/` | TMS-02 最终随仓运行副本 | 按最终源码与 CHANGELOG 同次构建为 12 个文件 / 2,828,820 字节；入口引用 `index-yGYWzLf5.js` 与 `index-D__p4lJ3.css`，主 JS SHA-256 `92A5C6CA38840EA4EA9984C6EBF8AADA0F3E4C740CF7CCF56AD69EA6C2665F37` | 用户后续部署并硬刷新后可加载 Sol 默认与精确迁移；本任务不改 Canvas Agent/desktop runtime、不生成 ZIP、不部署 | 2026-09-03 |
| 276 | `docs/content/docs/progress/pending-test.mdx` | TMS-02 从待测试移除并归入“已完成” | 登记 v59 已部署，配置、同步与真实生成经用户真人验收通过；成图“非常不错”且比以前更好仅为用户主观反馈，不作独立盲测或客观量化结论 | 仅归档验收状态；不改运行代码或合同，不改 `CHANGELOG.md`、`web/dist/`，不重建、不打包、不部署 | 2026-09-03 |

## 退役锚点（编号不复用）

- `#76`：信息卡“移入回收站”挂点已按 DL-01 产品裁决移除；信息卡其余登记、补登和展示行为保持不变。
- `#77`：`web/src/lib/canvas/canvas-batch-recycle.ts` 已随前端入口整体移除；主仓 17373 回收端点、CLI、`_回收站`、状态机和共享锁不动。
- `#78`：`web/src/components/canvas/canvas-batch-recycle-button.tsx` 已随前端入口整体移除。
- `#79`：`web/tests/canvas-batch-recycle.test.ts` 6 项专属测试已随功能整体移除；其他既有测试正文未修改。
- `#80`：RC-01 前端运行副本锚点退役；编号保留且不得复用。

## 新增文件

- `canvas-agent/src/agents-delta.test.ts`：AG-01 100ms 全量快照节流、强制冲刷、跨 turn 身份、清理与真实 delta 计数的可控时钟回归。
- `web/tests/agent-message-upsert.test.ts`：AG-01 两条交错助手消息复现、严格 upsert 矩阵与两组件共用接线回归。
- `web/tests/ql01-render-quality.test.ts`：QL-01 旧元数据归一、四档闭集、建批载荷、批次卡本地选项和无金额确认文案纯函数回归。
- `web/src/lib/canvas/canvas-docked-pair.ts`：MG-01 成对创建、合体/隐藏单一状态源、复制/级联/文案与缩放抑制纯函数。
- `web/tests/canvas-docked-pair.test.ts`：MG-01、A1、A2 的纯函数、组件默认路径、旧画布及页面接线离线回归。
- `web/tests/dc01-agent-reconnect-watchdog.test.ts`：覆盖 45 秒死链字面锚、ping/业务事件接线、断链与连接正常两类进度超时文案、8 秒接单超时零回归及非响应式连接态读取。
- `web/tests/dc01-workflow-production-reconcile.test.ts`：覆盖状态端点/token/失败关闭、五态 metadata 映射、30 秒四维节流键、queued 回补与普通接单超时分离、刷新保持及页面两触发/迟到响应守卫。
- `canvas-agent/src/codex-isolated.ts`：P2-b 独立 Codex app-server 会话模块；每回合独立进程、4 路失败关闭上限、按线程归属事件、本轮助手文本和三路进程清理均封装在此，不改既有画布助手单例。
- `canvas-agent/src/codex-isolated.test.ts`：使用注入式 fake 进程与路由覆盖 P2-b 事件、并发上限、完成/失败/硬超时清理和新旧路由兼容边界，不启动真实 Codex 或联网。
- `canvas-agent/src/codex-auth.ts`：独立封装 Codex CLI 登录状态查询、十秒超时和单例官方浏览器授权进程。
- `canvas-agent/src/codex-auth.test.ts`：覆盖状态解析、隔离未登录实测、授权防抖及令牌保护端点响应形状。
- `web/src/lib/agent/agent-codex-auth.ts`：提供账号响应规整、轮询边界与状态文案纯函数。
- `web/tests/agent-codex-auth.test.ts`：覆盖三秒间隔、百次上限、成功即停、响应失败关闭与全部状态文案。
- `desktop/portable/FIRST-DEPLOY-CHECKLIST-zh-CN.txt`：随便携包交付的新电脑首次部署、授权、迁移与自检中文检查单。
- `desktop/package.json`：Windows x64 Electron/NSIS 构建配置，生产包内置 Canvas Agent 依赖和 Codex Windows 程序。
- `desktop/package-lock.json`：锁定桌面构建与生产依赖版本，保证后续机器使用同一套打包环境。
- `desktop/.gitignore`：排除桌面依赖、运行副本和安装包输出，避免把本机大文件误纳入源码。
- `desktop/main.cjs`：桌面窗口、固定本机静态站点、Agent 启停/复用、外链隔离与单实例生命周期。
- `desktop/credentials.cjs`：从调用方指定的 JSON 文件失败关闭地加载真实渲染环境变量，不依赖 Electron 或全局路径。
- `desktop/credentials.test.cjs`：使用 Node 内置测试运行器覆盖合法、缺失、损坏和字段校验等凭据加载边界。
- `desktop/preload.cjs`：只把既有本机 Agent 地址和连接令牌写入桌面页面原有本地连接键，不暴露 Node API。
- `desktop/scripts/sync-runtime.mjs`：在严格校验的 `desktop/runtime` 范围内同步最新 `web/dist` 与 `canvas-agent/dist`，供开发冒烟和安装包共用。
- `desktop/scripts/prepare-python-runtime.ps1`：从 Python 官方地址准备固定 3.12.10 x64 便携环境，并装入工作台所需的 Pillow 与 jsonschema 依赖。
- `desktop/scripts/package-portable.ps1`：读取已构建的 `win-unpacked`、独立 Python 和主仓只读运行切片，在已校验的 `desktop/release` 范围内生成单目录完整便携 ZIP。
- `desktop/portable/README-zh-CN.txt`：随便携 ZIP 交付的中文解压、启动、环境与账号安全说明；使用 ASCII 文件名兼容旧版 Windows 解压工具。
- `desktop/README.md`：桌面版构建、安装包位置、固定端口、登录阶段与未签名提示。
- `canvas-agent/src/agents.test.ts`：覆盖可选模型/档位 thread 参数、档位白名单与脱敏拒绝、异常重建保留、completed / failed / interrupted 状态、非空助手答复要求及错误通知脱敏；只测试通用 canvas-agent 边界，不含工作流语义。
- `web/src/lib/canvas/canvas-workflow-demo.ts`：M1-a 演示合同与既有回归保留；M1-b 新增唯一命令、排队确认和后台停顿超时合同，浏览器本地绘图序列不再由页面控制器调用。
- `web/src/components/canvas/canvas-workflow-node.tsx`：工作流机器卡、排队/制作/完成/失败等人话状态及只读演示信息面板。
- `web/src/components/canvas/canvas-workflow-cost-card.tsx`：每次演示开始前不可跳过的 0 元费用确认卡。
- `web/src/pages/canvas/use-canvas-workflow-demo.ts`：页面私有的 0 元确认门；确认后只把 `run/retry: renders` 命令写入画布状态，并负责未接单/进度停顿的人话降级，不再生成图片。
- `web/tests/canvas-workflow-demo.test.ts`：保留原 7 项断言，并新增后台命令、重跑、未接单和中断状态合同。
- `web/src/lib/canvas/canvas-batch-intake.ts`：M2-a/CAT-01 十项事实、17373 品类目录、载荷摘要、配方驱动尺寸/手持校验、连线门禁、磁盘原图 SHA-256 证据和 17372 raw POST 合同；品类或哈希异常都在发号前硬停止且不重试。
- `web/src/components/canvas/canvas-batch-info-node.tsx`：画布原生信息卡，通过已安装品类下拉填写长宽高和两项手持数量，高级选项默认收起；元数据不可用时禁用下拉与登记。
- `web/src/components/canvas/canvas-batch-advanced-options.tsx`：只渲染品类端点下发的人话标题、说明与默认方向，不持有任何业务文案或默认值。
- `web/src/pages/canvas/use-canvas-batch-intake.ts`：页面私有建批控制器；加载并复用品类目录，只写 `build: batch` 命令，服务接单后从 localforage 取原始 Blob 并逐图交付。
- `web/tests/canvas-batch-intake.test.ts`：覆盖十项事实、品类目录与摘要、三维/手持边界、下拉/折叠/失败态、单卡单机原图连线、中文编码、浏览器 Blob 哈希、回环鉴权、硬停止和无自动重试。
- `web/tests/st01-set-batch-declaration.test.ts`：覆盖 v3 契约哈希、商品类型失败关闭、套装 1–3/2–8 数量门、单品清空、品类切换保留、三类图片 ID 合并、单品命令零回归、信息卡联动锁定及页面 SHA 上传接线。
- `web/tests/cfg01-clear-water-retirement.test.ts`：覆盖新契约摘要互锚、两项高级选项严格键集与退役键拒绝，以及 10 项载荷不含清水字段。
- `web/src/lib/canvas/canvas-workflow-production.ts`：M2-b 真实模式选择、17373 只读费用估算、确认后 `run: next` / 既有 `retry: renders` 命令、中断状态和 `queued` / `running` 飞行中互斥合同；不实现后台工序路由。
- `web/tests/canvas-workflow-acceptance-dormancy.test.ts`：AC-01 单点休眠合同，锁定“已收货框”新建入口默认关闭；不重复既有收货框、关账或交付能力测试。
- `web/src/lib/canvas/canvas-workflow-image-export.ts`：EX-01 当前批次正式/返修成图的选中/全部收集、排序命名、缺失分类及 ZIP/逐张下载薄壳。
- `web/src/components/canvas/canvas-workflow-download-card.tsx`：EX-01 下载方式选择弹窗，显示批次、张数和浏览器多文件授权说明。
- `web/tests/canvas-workflow-image-export.test.ts`：EX-01 下载归属、收集、命名、缺失与置灰纯函数合同。
- `web/tests/canvas-workflow-repair-projection-dormancy.test.ts`：EX-01 单点休眠合同，锁定“上桌返修图”入口默认关闭。
- `web/src/components/canvas/canvas-workflow-production-cost-card.tsx`：真实费用唯一确认卡，显示剩余张数、约计美元金额和约计时长；取消不写画布状态。
- `web/src/pages/canvas/use-canvas-workflow-production.ts`：页面私有真实费用控制器；只在确认后写生产命令，终态可重新报价确认，最终写入按最新 `queued` / `running` 状态互斥；无信息卡时明确把开始动作交还 M1 演示。
- `web/src/lib/canvas/canvas-workflow-output-import.ts`：正式 PNG 的 17373 地址、服务端 SHA、浏览器 Blob SHA 与字节数合同；通过后转存现有 localforage 图片库，拒绝 data URI。
- `web/src/pages/canvas/use-canvas-workflow-output-import.ts`：页面私有正式图片接收器；每张只尝试一次，失败停机，不自动重试。
- `web/src/lib/canvas/canvas-style-reference-intake.ts`：信息卡直连风格图的磁盘凭证、整批浏览器预检、17373 原字节上传和硬停止合同。
- `web/src/pages/canvas/use-canvas-style-reference-intake.ts`：页面私有风格补登控制器；服务接单后从 localforage 取原 Blob，刷新中断不自动恢复。
- `web/src/pages/canvas/use-canvas-style-reference-removal.ts`：页面私有风格移除控制器；复用现有风格工人健康预检，只写独立移除命令与 8 秒确认超时状态。
- `web/tests/canvas-workflow-production.test.ts`：覆盖演示/真实模式隔离、单卡单机素材门、费用估算鉴权、确认命令、终态重提、飞行中互斥和续跑/超时。
- `web/tests/canvas-workflow-output-import.test.ts`：覆盖正式图片原字节转存、无 data URI、地址/哈希/字节拒绝与防重复导入。
- `web/tests/canvas-style-reference-intake.test.ts`：覆盖信息卡直连、精确凭证、整批预检、单次上传、硬停止和刷新不续传。
- `web/tests/canvas-style-reference-governance.test.ts`：覆盖每批 1 张、已有回执拦截、独立移除命令、同工人健康键、卡面状态与一次明确确认。
- `web/src/lib/canvas/canvas-readonly-assistant.ts`：M3-a 固定 17373 问答端点、现有令牌鉴权、8 条/8 KiB 历史、300 秒轮询终止与相同进度引用稳定合同。
- `web/src/components/canvas/canvas-readonly-assistant-panel.tsx`：M3-a 只读批次问答界面与原通用 Agent 切换外壳；M3-b 在同一页签增加意图辨认和命令草稿卡渲染，问题仍调用原只读函数，原通用 Agent 不改。
- `web/tests/canvas-readonly-assistant.test.ts`：覆盖固定回环端点、令牌、终态轮询、300 秒硬上限、引用稳定、历史容量和重复提交人话拒绝。
- `web/src/lib/canvas/canvas-command-assistant.ts`：M3-b 固定 17373 草稿端点、19 条前端闭集复核、300 秒终止、引用稳定，以及命令/问题/越范围三路编排；问题路由明确复用 M3-a 原提交和轮询函数。
- `web/src/components/canvas/canvas-command-draft-card.tsx`：显示命令原文、人话说明、费用与门禁提醒；一台机器默认、多台必选、零台提示，按钮只调用当前画布登记的机器回调。
- `web/src/stores/canvas/use-canvas-workflow-command-store.ts`：页面存活期临时保存工作流机器摘要和机器按钮同款回调；按画布 owner 清理、不持久化，并对等价目标保持引用稳定。
- `web/tests/canvas-command-assistant.test.ts`：独立覆盖 19 条闭集、固定端点、300 秒、问答零回归、草稿卡、零/一/多机器、同一按钮 mock、引用稳定、确认后命令与机器按钮默认行为。
- `web/src/lib/canvas/canvas-intake-role-visibility.ts`：NC-01 角色推导、断线清理、引用稳定、角标文案栈和数量按钮文案的纯函数合同。
- `web/src/pages/canvas/use-canvas-intake-role-visibility.ts`：页面私有角色同步 hook；仅在角色确有变化时写回节点，避免重复渲染。
- `web/src/components/canvas/canvas-image-badge-stack.tsx`：复用图片右上角挂点同时渲染角色与既有 QC 角标，QC 文案和三色映射保持原样。
- `web/tests/canvas-intake-role-guardrails.test.ts`：覆盖前端全文文案、重复/跨角色哈希拒绝、角色序号与断线、引用稳定、文件清单及角色/QC 角标栈共存。
- `web/src/lib/canvas/canvas-material-upload.ts`：MU-02 素材批量上传纯函数合同；限制 20 个、按选择顺序上传、失败停步保留成功节点，并在多选时避开现有与本批节点，不负责连线、登记或 SHA 查重。
- `web/tests/canvas-material-upload.test.ts`：新增 10 项覆盖批量上限、媒体类型与顺序、失败停步、单张兼容、节点避让、入口/拖拽接线及三条引用稳定断言。
- `web/src/lib/canvas/canvas-project-delete.ts`：DL-01 项目删除计划、批次号收集、幸存项目共享引用拦截、17373 严格预检/执行合同、确认文字与结果归类纯函数。
- `web/src/hooks/use-canvas-project-delete.ts`：DL-01 四入口共用状态机；只在后端全成功后等待前端项目落盘并清理素材，停步后不自动重试。
- `web/tests/canvas-project-delete.test.ts`：覆盖信息卡收集边界、共享批次 fail-closed、固定请求合同、两段确认、删除全部、空画布、失败停步、持久化顺序和回收按钮移除。
- `canvas-agent/src/canvas-session.test.ts`：覆盖多客户端状态隔离、活跃者路由与转移、纯监听排除、同 ID 重连和单客户端完整回执链路。
- `web/src/lib/canvas/agent-connection.ts`：提供无依赖的重连退避与继续重试纯函数，不感知组件或画布状态。
- `web/tests/agent-connection.test.ts`：锁定 1 / 2 / 4 / 8 / 15 秒退避、成功史无限重试和冷启动 3 次边界。
- `desktop/shortcuts.cjs`：把桌面普通刷新与强制刷新键位判定收敛为无 Electron 依赖的纯函数。
- `desktop/shortcuts.test.cjs`：覆盖五个刷新键位及 Alt、keyUp 和其他按键的负例矩阵。
- `desktop/background-policy.cjs`：集中声明三条 Chromium 后台开关与 `prevent-app-suspension` 的幂等启停状态机；Electron 对象由主进程注入。
- `desktop/background-policy.test.cjs`：覆盖开关、blocker 类型、启停全部分支、主进程接线顺序与桌面打包清单。
- `desktop/main-window-foreground-policy.test.cjs`：以源码负向契约锁定重复启动静默、主窗口不被程序性置前，并保护单实例锁继续存在。
- `desktop/process-output-log.cjs`：把工作台 stdout/stderr 原始字节分别写入带上限的轮转文件；只接收调用方给定的日志目录，不依赖 Electron 或自行解析数据根。
- `desktop/process-output-log.test.cjs`：覆盖双流落盘、轮转上限、失败降级、注入调用、主进程双流接线与桌面打包清单。
- `web/src/stores/use-workflow-text-model-store.ts`：持久化批次识图模型选择，并在内存中记录本机工作台同步状态；持久化切片不含渠道 Key。
- `web/src/lib/canvas/canvas-workflow-text-model.ts`：提供 Codex／OpenAI 兼容渠道选项、请求载荷解析、17373 同步与选择标签纯函数。
- `web/src/components/layout/workflow-text-model-config.tsx`：在配置页展示批次识图模型、Codex 型号／推理档位和同步状态。
- `web/src/components/canvas/workflow-text-model-sync-host.tsx`：应用级无界面 300ms 防抖同步宿主；不建立 SSE、不轮询、不自动重试。
- `web/tests/tms01-workflow-text-model.test.ts`：覆盖选项过滤、载荷、Base URL、同步脱敏、报价标签、确认行、持久化切片与两处源码锚点。

## 上游同步纪律

- 基线：ebd8ae2（2026-07-09 origin/main）
- 锁定 tag / 手动有意识合并；合并后运行主仓库 `python -m unittest discover -s tests` 与桥接冒烟（`spike_canvas_push.py --health --push-live ...`）。
- CAT-01 载荷摘要只覆盖字段名、类型和必填结构语义。品类表单文案、默认值与手持范围实时来自 17373，不进入摘要，也不要求重建 `web/dist`；只有真正新增、删除或改变载荷字段结构时，才同步主仓 `categories/_shared/batch-intake-contract.json` 与 `BATCH_INTAKE_CONTRACT_SHA256` 并重建 dist。
