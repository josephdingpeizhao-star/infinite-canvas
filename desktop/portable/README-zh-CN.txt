首次部署请先阅读 FIRST-DEPLOY-CHECKLIST-zh-CN.txt。

Infinite Canvas Windows 便携版 0.1.0

使用方法
1. 右键 ZIP 压缩包，选择“全部解压”。
2. 打开解压后的 InfiniteCanvas-Portable-0.1.0-x64 文件夹。
3. 双击“Infinite Canvas.exe”。

请勿直接在压缩包预览窗口中运行程序，也不要只复制其中一个 exe；程序必须和 resources、python-runtime、workflow-runtime、杯类等文件夹放在一起。

本便携版已包含画布、Canvas Agent、工作台服务、Python 3.12 运行环境、品类规则和 Windows x64 Codex CLI，无需另外安装 Node、Python、Bun、npm 或 Codex CLI。

品类与数据位置
- 品类规则在 workflow-runtime\categories，已包含 _shared、杯类、盘子、碗；请保持原目录结构，不要只移动其中单个文件。
- 新建批次和原有批次数据放在本程序目录内的“杯类”文件夹。换电脑时，如需继续使用旧批次，请把原“杯类”文件夹中的各批次目录复制到这里。
- 启动后会自动运行本机工作台。信息卡读取到 3 个品类后，“单品/套装”即可正常选择。

真实出图配置
- 压缩包已内置 render-credentials.json，完整解压后即可真实出图，无需另放凭据文件。
- 文件不存在或内容无效时，真实渲染保持锁定，其他功能照常启动。
- 如需更换或停用出图凭据，请替换或删除 Infinite Canvas.exe 同目录的 render-credentials.json 后重启程序；该文件已排除在 Git 之外。

账号说明
- 为保护账号安全，压缩包不会携带制作电脑上的 Codex 登录凭据。
- 新电脑首次使用 Codex 功能时，需要使用该电脑自己的官方 Codex 账号完成授权。
- 出图凭据随便携 ZIP 一并交付；除更换或停用外，无需在新电脑上另行配置图片渠道 API Key。

Windows 若提示“已保护你的电脑”，请先确认压缩包来源和文件校验值，再选择“更多信息”继续运行。本版本尚未购买代码签名证书。
