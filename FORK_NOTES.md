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

## 新增文件

- `canvas-agent/src/agents.test.ts`：覆盖可选模型 thread 参数及 completed / failed / interrupted 状态判定；只测试通用 canvas-agent 边界，不含工作流语义。
- `web/src/lib/canvas/canvas-workflow-demo.ts`：M1-a 演示合同与既有回归保留；M1-b 新增唯一命令、排队确认和后台停顿超时合同，浏览器本地绘图序列不再由页面控制器调用。
- `web/src/components/canvas/canvas-workflow-node.tsx`：工作流机器卡、排队/制作/完成/失败等人话状态及只读演示信息面板。
- `web/src/components/canvas/canvas-workflow-cost-card.tsx`：每次演示开始前不可跳过的 0 元费用确认卡。
- `web/src/pages/canvas/use-canvas-workflow-demo.ts`：页面私有的 0 元确认门；确认后只把 `run/retry: renders` 命令写入画布状态，并负责未接单/进度停顿的人话降级，不再生成图片。
- `web/tests/canvas-workflow-demo.test.ts`：保留原 7 项断言，并新增后台命令、重跑、未接单和中断状态合同。

## 上游同步纪律

- 基线：ebd8ae2（2026-07-09 origin/main）
- 锁定 tag / 手动有意识合并；合并后运行主仓库 `python -m unittest discover -s tests` 与桥接冒烟（`spike_canvas_push.py --health --push-live ...`）。
