# Fork Notes（workflow-editor 分支）

本 fork 服务于「水壶工作流仓库」的画布化项目。硬性纪律：**只允许新增文件和本表登记的锚点行**；一切能放进主仓库 `canvas-bridge/` 的逻辑禁止写进本 fork。每次同步上游后逐条复核本表。

## 锚点登记

| # | 文件 | 位置/符号 | 改动 | 原因 | 登记日期 |
|---|---|---|---|---|---|
| 1 | `canvas-agent/src/tools.ts` | `compactNode()` 内容截断条件 | `length > 240` 追加 `&& startsWith("data:")`（单行） | 画布编辑回读需要完整文本内容；原截断意图是防 base64 大图撑爆响应，收窄到仅 `data:` URL 后意图保留、普通文本不再截断 | 2026-07-11 |
| 2 | `web/src/components/canvas/canvas-local-agent-panel.tsx` | `toggleAgentConnection()` 成功分支 | 新增 2 行：把 endpoint/token 写入 localStorage（键与 use-agent-store.ts:103 一致） | 上游不一致：面板连接不持久化，导致刷新/agent 重启后 app-top-nav.tsx:29 的自动重连因 token 为空而失效；本改动可直接 PR 上游 | 2026-07-11 |
| 3 | `web/src/stores/use-agent-store.ts` + `web/src/components/agent/agent-panel.tsx` | `confirmTools` 初始值 + 面板 Switch onChange | 各 1 处：初始值读 localStorage（键 `canvas-agent-confirm-tools`，缺省仍为开启），开关切换时写入 | 上游每次刷新把"工具确认"复位为开启，桥接批量推送会被待确认卡片阻塞超时；持久化后用户选择跨会话生效 | 2026-07-11 |

## 新增文件

（暂无——工作流语义全部位于主仓库 canvas-bridge/）

## 上游同步纪律

- 基线：ebd8ae2（2026-07-09 origin/main）
- 锁定 tag / 手动有意识合并；合并后运行主仓库 `python -m unittest discover -s tests` 与桥接冒烟（`spike_canvas_push.py --health --push-live ...`）。
