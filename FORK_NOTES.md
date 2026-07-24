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

## 新增文件

- `canvas-agent/src/agents.test.ts`：覆盖可选模型/档位 thread 参数、档位白名单与脱敏拒绝、异常重建保留、completed / failed / interrupted 状态、非空助手答复要求及错误通知脱敏；只测试通用 canvas-agent 边界，不含工作流语义。
- `web/src/lib/canvas/canvas-workflow-demo.ts`：M1-a 演示合同与既有回归保留；M1-b 新增唯一命令、排队确认和后台停顿超时合同，浏览器本地绘图序列不再由页面控制器调用。
- `web/src/components/canvas/canvas-workflow-node.tsx`：工作流机器卡、排队/制作/完成/失败等人话状态及只读演示信息面板。
- `web/src/components/canvas/canvas-workflow-cost-card.tsx`：每次演示开始前不可跳过的 0 元费用确认卡。
- `web/src/pages/canvas/use-canvas-workflow-demo.ts`：页面私有的 0 元确认门；确认后只把 `run/retry: renders` 命令写入画布状态，并负责未接单/进度停顿的人话降级，不再生成图片。
- `web/tests/canvas-workflow-demo.test.ts`：保留原 7 项断言，并新增后台命令、重跑、未接单和中断状态合同。
- `web/src/lib/canvas/canvas-batch-intake.ts`：M2-a 七项事实、连线门禁、中文路由、磁盘原图 SHA-256 证据和回环 raw POST 合同；任何哈希异常硬停止且不重试。
- `web/src/components/canvas/canvas-batch-info-node.tsx`：画布原生信息卡，直接填写品类、高度和三个开关，并显示固定张数、人话状态及成功回执。
- `web/src/pages/canvas/use-canvas-batch-intake.ts`：页面私有建批控制器；只写 `build: batch` 命令，服务接单后从 localforage 取原始 Blob 并逐图交付。
- `web/tests/canvas-batch-intake.test.ts`：覆盖七项事实、单卡单机原图连线、中文编码、首次 File 与浏览器 Blob 哈希、回环鉴权、硬停止和无自动重试。
- `web/src/lib/canvas/canvas-workflow-production.ts`：M2-b 真实模式选择、17373 只读费用估算、确认后 `run: next` / 既有 `retry: renders` 命令、中断状态和同页单次提交合同；不实现后台工序路由。
- `web/src/components/canvas/canvas-workflow-production-cost-card.tsx`：真实费用唯一确认卡，显示剩余张数、约计美元金额和约计时长；取消不写画布状态。
- `web/src/pages/canvas/use-canvas-workflow-production.ts`：页面私有真实费用控制器；只在确认后写生产命令，同一页面内同一机器/批次只允许一次提交；无信息卡时明确把开始动作交还 M1 演示。
- `web/src/lib/canvas/canvas-workflow-output-import.ts`：正式 PNG 的 17373 地址、服务端 SHA、浏览器 Blob SHA 与字节数合同；通过后转存现有 localforage 图片库，拒绝 data URI。
- `web/src/pages/canvas/use-canvas-workflow-output-import.ts`：页面私有正式图片接收器；每张只尝试一次，失败停机，不自动重试。
- `web/src/lib/canvas/canvas-style-reference-intake.ts`：信息卡直连风格图的磁盘凭证、整批浏览器预检、17373 原字节上传和硬停止合同。
- `web/src/pages/canvas/use-canvas-style-reference-intake.ts`：页面私有风格补登控制器；服务接单后从 localforage 取原 Blob，刷新中断不自动恢复。
- `web/tests/canvas-workflow-production.test.ts`：覆盖演示/真实模式隔离、单卡单机素材门、费用估算鉴权、确认命令、同页单次提交和续跑/超时。
- `web/tests/canvas-workflow-output-import.test.ts`：覆盖正式图片原字节转存、无 data URI、地址/哈希/字节拒绝与防重复导入。
- `web/tests/canvas-style-reference-intake.test.ts`：覆盖信息卡直连、精确凭证、整批预检、单次上传、硬停止和刷新不续传。

## 上游同步纪律

- 基线：ebd8ae2（2026-07-09 origin/main）
- 锁定 tag / 手动有意识合并；合并后运行主仓库 `python -m unittest discover -s tests` 与桥接冒烟（`spike_canvas_push.py --health --push-live ...`）。
