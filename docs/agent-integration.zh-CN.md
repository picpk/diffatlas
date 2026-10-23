# 让本地 Agent 调用 DiffAtlas Context

DiffAtlas Context 提供可安装的 Skill 和可被终端工具调用的本地程序。Agent 先把任务交给程序，程序在本机筛选源码并写出上下文文件，Agent 再读取选中的代码。无需 API Key，也不用启动网页或服务。

这能减少一次代码上下文输入的 token；Skill 指令、工具调用和报告本身也会消耗 token，因此不承诺整个对话的总 token 必然减少。已知只需读取一个小函数时，直接读代码通常更合适。

## 安装到 Codex

也可以下载 [v0.3.0 独立 Skill ZIP](https://github.com/picpk/diffatlas/releases/download/v0.3.0/diffatlas-context-skill-v0.3.0.zip)，把其中整个 `diffatlas-context` 文件夹解压到 Agent 的技能目录。该方式无需克隆仓库或执行 `npm ci`，仍需 Node.js 22.12+ 和 Git。请保留运行文件与许可证；仓库内 `skills/` 是源码模板，单独复制模板或 `SKILL.md` 不包含运行时。

先安装 Node.js 22.12 或更新版本，以及 Git。在本仓库根目录执行：

```sh
npm ci
npm run install:skill
```

安装命令会构建独立运行包并复制到 Codex 的技能目录。默认位置是 `~/.codex/skills/diffatlas-context`；如果设置了 `CODEX_HOME`，则使用其下的 `skills/diffatlas-context`。安装完成后，以命令输出的实际路径为准。安装包已包含运行依赖，之后调用只需要 Node.js 和 Git。

目标技能目录已存在时，安装会停止并提示，不覆盖本地修改。更新前先把已有目录改名或备份到其他位置，再执行安装。

在新对话中可以直接说：

```text
使用 $diffatlas-context，先为当前仓库的“修复密码重置过期判断”任务
生成不超过 4000 tokens 的代码上下文，然后继续排查和修复。
```

Skill 允许自动发现。是否自动选中取决于 Agent 宿主；显式写 `$diffatlas-context` 更直接。如果当前对话尚未发现新技能，请开启新对话或重新加载宿主的技能列表。

## 安装到其他支持 Skill 的 Agent

`--dest` 指定的是完整目标技能文件夹，需要使用绝对路径。例如在 PowerShell 中安装到 Claude Code 用户技能目录：

```powershell
npm run install:skill -- --dest "$env:USERPROFILE/.claude/skills/diffatlas-context"
```

macOS / Linux：

```sh
npm run install:skill -- --dest "$HOME/.claude/skills/diffatlas-context"
```

该目录里的 `SKILL.md` 是可移植的操作说明；`agents/openai.yaml` 提供 Codex 的界面元数据。不同宿主的技能发现方式可能不同，可以让 Agent 读取已安装目录中的 `SKILL.md` 后执行。现有集成通过本地命令运行，没有要求配置 MCP 服务。

只想制作可复制的技能包时：

```sh
npm run build:skill
```

产物位于 `.local/skill-package/diffatlas-context`。复制整个目录，保留 `SKILL.md`、`agents/`、`scripts/pack.mjs` 和许可证文件。

## 终端接口

任何能执行本地命令并读取文件的 Agent 都可以直接调用运行包。下面的路径是占位符，使用时替换为实际绝对路径：

```sh
node "<skill-dir>/scripts/pack.mjs" --repo "<absolute-repository>" --task "修复密码重置 token 的过期判断，检查调用方和测试" --budget 4000 --encoding o200k_base
```

`--repo` 可以是 Git 仓库内的子目录。`--pin` 接收相对于这个目录的文件路径，可重复传入或用逗号分隔。`--diff` 可以传入已有的 unified diff 文件；`--output-dir` 可以指定产物父目录，每次调用会创建新的子目录，避免覆盖上一次结果。

程序的标准输出只有紧凑 JSON 摘要，不把整份源码塞进工具响应：

- `schemaVersion`：当前为 `1`。
- `status`：`ready`、`needs_attention`、`empty`、`budget_exceeded` 或 `error`。
- `promptPath`、`reportPath`：生成文件的路径；没有对应文件时为 `null`。
- `tokens`、选择数量和 `alerts`：输入计数、覆盖范围和需要处理的问题。

| 状态 | 退出码 | Agent 应如何处理 |
| --- | --- | --- |
| `ready` | 0 | 读取 `promptPath` 对应的 `context.md`，继续用户的任务。 |
| `needs_attention` | 3 | 先读提醒和省略报告，确认任务中点名的文件或符号是否保留，再决定读取上下文或补充目标文件。 |
| `empty` | 3 | 没有选中可用源码，不生成上下文；缩小范围、改写任务或直接读取已知目标。 |
| `budget_exceeded` | 2 | 必需代码放不下，不生成上下文；按最低预算调整，或缩小扫描范围。 |
| `error` | 1 | 按错误信息修正输入或运行环境。 |

报告包含选中位置、选择原因、省略范围和依赖提醒，不重复完整源码或基线。先检查摘要，仅在需要判断覆盖范围时读取报告。不要先读完整仓库再压缩，那些已读入对话的 token 不会因此消失。

## 覆盖范围与计数

JS/TS 按完整顶层声明选择代码，并补充有限的本地依赖。其他支持的文本文件按整文件选择。它无法保证理解动态导入、路径别名或所有跨文件调用；Agent 仍应根据实际任务补充关键调用方和测试。任务点名的目标遗漏时，优先固定该文件、缩小范围或做定向读取，避免反复调整预算。

计数使用 `o200k_base` 或 `cl100k_base`，覆盖生成的完整代码提示词。它不包含工具对话、Skill 指令、额外报告、模型输出和供应商封装；其他本地模型的 tokenizer 可能给出不同结果。减少输入 token 也不等于已经证明回答更准确。

扫描遵循 Git 忽略规则，并跳过常见凭证文件名、生成文件、二进制和不支持的文件类型。它不是源码内容脱敏器；生成文件仍应按项目的源码隐私规则处理。完整选择规则见 [上下文打包说明](context-packing.md)。
