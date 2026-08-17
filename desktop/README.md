# Windows 桌面版

Electron 外壳会把画布前端、Canvas Agent、Node 运行环境和 Windows x64 Codex 程序装进同一个桌面程序。完整便携 ZIP 还会加入本机工作台、Python 3.12、Pillow、jsonschema 和品类规则；最终用户不需要另外安装 Node、Python、Bun、npm 或 Codex CLI。

打包时直接使用仓库中已审核的 `web/dist` 网页成品，避免仅仅生成桌面安装包时改写网页版文件；Canvas Agent 会在打包前重新编译。

## 本地验证

```powershell
cd desktop
npm install
npm run smoke
```

## 生成 Windows 安装包

```powershell
cd desktop
npm install
npm run dist:win
```

安装包输出到 `desktop/release/InfiniteCanvas-Setup-0.1.0-x64.exe`。

## 生成免安装便携 ZIP

```powershell
cd desktop
npm install
npm run dist:zip
```

便携包输出到 `desktop/release/InfiniteCanvas-Portable-0.1.0-x64.zip`。发送到另一台 Windows x64 电脑后，必须先完整解压，再双击其中的 `Infinite Canvas.exe`；不需要另外安装 Node、Python、Bun、npm 或 Codex CLI。ZIP 不包含制作电脑的 Codex 登录凭据或历史批次；出图凭据按下节规则内置。

## 真实出图配置

打包时由 `package-portable.ps1` 从 `desktop/render-credentials.json` 注入便携 ZIP，压缩包完整解压后即可真实出图；源文件缺失、JSON 无法解析、`api_key` 为空或 `base_url` 不是 HTTP(S) 地址时，打包会直接失败。运行时文件不存在或内容无效时，真实渲染仍保持锁定，其他功能照常启动；如需更换或停用，请替换或删除 `Infinite Canvas.exe` 同目录的该文件后重启程序。该文件经 `.gitignore` 排除，永不进入 Git。

完整便携版使用固定本机地址 `http://127.0.0.1:3000` 承载画布，启动 `http://127.0.0.1:17371` 的内置 Canvas Agent，并自动启动 17372/17373 工作台服务。若 17371 已有可用 Agent，桌面版会复用它且退出时不会关闭它；否则退出桌面版时会一并结束自己启动的 Agent。自己启动的工作台服务也会随桌面版退出。

品类规则位于解压目录的 `workflow-runtime/categories`，保留 `_shared`、杯类、盘子、碗原目录结构。新批次和从旧电脑迁移来的批次放在同一解压目录的 `杯类` 文件夹；更新程序时请保留这个数据文件夹。

当前 Electron 外壳沿用网页里的 Codex 会话逻辑，尚未新增独立的 Codex 登录界面。Windows 安装包未做代码签名，首次运行时可能出现 SmartScreen 提示。
