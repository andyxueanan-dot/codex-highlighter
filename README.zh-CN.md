# Codex Highlighter

[English](README.md) | 简体中文

<p align="center">
  <img src="assets/hero.png" alt="Codex Highlighter 五色高亮宣传图" width="100%">
</p>

<p align="center"><strong>让 Codex 桌面端的重要文字真正留在视线里。</strong></p>

<p align="center">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows">
  <img alt="Version" src="https://img.shields.io/badge/version-1.2.10-ffca28">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
</p>

> 非官方社区项目，与 OpenAI 无隶属或背书关系。Codex 更新可能改变内部页面结构并暂时影响兼容性。

Codex Highlighter 为 Windows 版 Codex 桌面应用增加一个功能：在聊天正文中选中文字，选择颜色，保留高亮。

它不包含翻译、解释、总结、AI 提示词或全局屏幕标记。

托盘菜单提供原生数据管理窗口，可以搜索、删除、清空、导入和导出高亮记录。

目前支持普通聊天正文、侧边对话、纯文本框、代码块、KaTeX 数学公式，以及原生表格、ARIA 网格和 CSS `div/grid` 表格；重复内容会按原公式或表格位置恢复。

## 功能演示

<p align="center">
  <img src="assets/demo-palette.png" alt="主对话与侧边聊天中的五色高亮调色板" width="100%">
</p>

<details>
  <summary><strong>查看鼠标悬停删除</strong></summary>
  <br>
  <img src="assets/demo-hover-delete.png" alt="鼠标悬停高亮后显示删除按钮" width="100%">
</details>

> 演示截图由仓库中的真实注入脚本在隐私安全的本地测试页面上自动生成，不包含个人 Codex 对话。

## 快速开始

需要 Windows 10/11 和 Codex 桌面应用。

### 安装发布版

1. 从 [GitHub Releases](https://github.com/andyxueanan-dot/codex-highlighter/releases/latest) 下载最新发布包。
2. 解压后在 PowerShell 中运行 `install.ps1`。
3. 安装器使用当前用户目录，不需要管理员权限。
4. 以后从桌面或开始菜单的 **Codex（带高亮）** 打开。Codex 关闭时会一次性启动应用并启用高亮，无需先打开 Codex 再重启。

高亮器已在托盘运行也可以直接点这个入口，它会复用已有程序。Codex 更新后会自动查找新版安装位置。

### 从源码构建

```powershell
git clone https://github.com/andyxueanan-dot/codex-highlighter.git
cd codex-highlighter
.\build.ps1
.\Start-Codex-Highlighter.cmd
```

1. 运行启动入口；Codex 关闭时会直接带高亮启动，已打开时会复用当前窗口。
2. 在 Codex 主对话或右侧对话中选中文字。
3. 在选区下方选择黄、绿、青、粉、紫任一颜色。
4. 鼠标悬停高亮文字，点击垃圾桶即可删除。

重新框选已有高亮时，也可以直接改色或点击垃圾桶删除。

也可以在选中文字后按 `Ctrl+Shift+H` 添加或取消高亮。

右键黄色托盘图标并选择“管理高亮数据”，可以搜索记录、删除选中、清空全部以及导入/导出 JSON 备份。

安装器还会创建当前用户的开机启动快捷方式。Windows 登录时只启动托盘监控，不会主动弹出 Codex。Codex 仍带有高亮器的本机调试端口时会自动重连；如果端口不存在，则等待你从托盘明确操作。

安装器会通过 Windows 独立启动托盘监控。后台监控不会自行关闭或重启 Codex。如果先从官方原入口打开，当前窗口可能没有高亮所需的连接：下次正常退出后，改用 **Codex（带高亮）** 即可。需要立即恢复时，也可从托盘选择“连接或重启 Codex（需确认）”；即使已确认，Codex 未正常退出时也会取消，不强制结束进程。

颜色工具条会优先显示在选区下方，并避开 Codex 自带的“添加到对话”“更多”和“在侧边聊天中提问”菜单。程序运行后位于 Windows 系统托盘。退出托盘程序会立即撤掉当前页面上的高亮，但保留数据；下次启动后会恢复。

## 为什么需要专用启动入口

Codex 没有向普通插件开放聊天正文的选区和样式接口。本工具让 Codex 以仅绑定 `127.0.0.1` 的 Chrome DevTools Protocol 端口启动，再把高亮脚本注入真实的 Chromium 文本页面。

该端口需要在 Codex 启动时开启，无法通过本工具给已经启动的普通窗口补上。专用入口让它从第一次打开就具备连接条件；官方原入口和任务栏图标不会被自动替换。安装时可用 `-NoDesktopShortcut` 跳过桌面图标。

它不会修改：

- Codex 官方安装目录或 `app.asar`
- Codex 代码签名
- 登录状态、API 配置或任务数据
- 注册表或计划任务（只创建本工具的桌面、开始菜单和登录启动快捷方式）

## 持久化与稳定性

采用滚动清理：新增高亮使总数达到 2,000 条时，自动备份并删除创建时间最早的 1,000 条。已满 2,000 条的旧数据会在下一次新增时清理，留下 1,001 条；启动、导入、改色和手动删除不触发清理。备份或保存失败时保留原数据。

清理备份存放在 `%LOCALAPPDATA%\CodexHighlighter\backups\auto-prune`，不会参与页面扫描。备份文件会累计保留，不自动删除。

v1.2.10 起直接由本机程序把备份写到硬盘，确认成功后才清理，不再向页面存储塞入额外备份。首次清理需要等一个监控周期（通常约15秒）。完成前关闭窗口不会删除旧记录，重新划选即可重试；期间修改记录会取消过期清理请求。大文件以小块同步。

高亮数据保存在：

```text
%LOCALAPPDATA%\CodexHighlighter\highlights.json
```

每条高亮保存任务地址、消息指纹、原文、前后文和文字位置。页面滚动、React 重新渲染或重新打开任务时，脚本会重新定位文字。显示使用 Chromium CSS Highlights API，不修改 React 管理的聊天 DOM。

当前已验证 Codex `26.818.5229.0`、Chromium 151。Codex 更新如果改变内部页面结构，托盘会显示连接异常；重新加载失败时可退出工具，Codex 本身仍可正常使用。日志位于：

```text
%LOCALAPPDATA%\CodexHighlighter\CodexHighlighter.log
```

## 构建和测试

项目使用 Windows 自带的 .NET Framework C# 编译器，不需要安装 .NET SDK：

```powershell
.\build.ps1
```

输出文件：

```text
dist\CodexHighlighter.exe
```

完整自动测试：

```powershell
.\tests\run-tests.ps1
```

测试覆盖 JavaScript 语法、嵌入资源、数据格式、Codex 安装定位、本机端口，以及真实 Chromium 中的主/侧对话选区、五色高亮、原生菜单避让、DOM 重建后重新锚定、相邻选区、改色和悬停删除。

## 删除

1. 从系统托盘退出 Codex Highlighter。
2. 删除本项目目录。
3. 如果也要删除所有高亮记录，再删除 `%LOCALAPPDATA%\CodexHighlighter`。

没有其他安装项需要清理。

## 安全提示

工具运行期间，Codex 会开放一个仅绑定 `127.0.0.1` 的调试端口。同一 Windows 账户下的其他本地进程理论上也可能访问它。不要在不可信的共享账户中使用；不需要高亮时可退出托盘工具并正常重启 Codex。详见 [SECURITY.md](SECURITY.md)。

已验证的 Windows、Codex 与 Chromium 版本见[兼容性矩阵](docs/COMPATIBILITY.md)。

## 开源许可

本项目采用 [MIT License](LICENSE)。这是非官方社区工具；Codex、ChatGPT 和 OpenAI 是其各自权利人的商标。

## 第三方参考

Windows Codex 发现、仅回环 CDP 启动和运行时恢复设计参考了 MIT 许可的 [CodeFace](https://github.com/sundy-li/CodeFace)。文字锚定策略参考了 BSD-2-Clause 许可的 [Hypothesis client](https://github.com/hypothesis/client)。详见 `licenses/THIRD_PARTY_NOTICES.md`。
