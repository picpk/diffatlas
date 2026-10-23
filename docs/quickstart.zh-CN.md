# DiffAtlas 中文上手指南

DiffAtlas 帮助开发者审查 Git diff。每个问题包含文件、行号、代码证据和修改建议；审查结果还提供测试计划。它会验证文件、新行号和完整证据是否与 diff 中的新增行精确对应，最终仍由你判断问题是否成立。

## 1. 安装并启动

准备 Git 和 Node.js **22.12 或以上版本**，然后运行：

```bash
git clone https://github.com/picpk/diffatlas.git
cd diffatlas
npm ci
npm run dev
```

打开终端里 Vite 输出的本地地址。开发环境中，网页请求会转发到 `127.0.0.1:8787` 的后端。先加载示例 diff，选择规则演示运行，无需注册或配置 API Key。

规则演示使用本地规则，适合体验报告和导出流程；它不调用模型，也不能代表 AI 模式的审查能力。

## 2. 生成自己的 diff

在需要审查的 Git 仓库中执行：

```bash
# 工作区中尚未暂存的改动
git diff --output=changes.diff

# 已暂存、准备提交的改动
git diff --cached --output=staged.diff

# 当前分支相对 main 的改动
git diff main...HEAD --output=branch.diff
```

使用 `--output` 可以避免不同终端对输出重定向编码的处理差异。把生成的文件上传到 DiffAtlas，或将内容粘贴到输入框。新建但未被 Git 跟踪的文件不会出现在普通 `git diff` 中，按你自己的提交流程暂存后再导出。

## 3. 启用真实 AI 审查

复制配置文件：

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

编辑 `.env`：

```dotenv
OPENAI_API_KEY=你的OpenAI_API_Key
OPENAI_MODEL=gpt-4.1-mini
REVIEW_ACCESS_TOKEN=你生成的长随机访问令牌
PORT=8787
HOST=127.0.0.1
```

可以用 Node.js 生成访问令牌：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

修改后重启开发服务。在界面的访问令牌字段填入 `REVIEW_ACCESS_TOKEN`，再选择 AI 审查。API Key 只放在服务端 `.env`，不要填进网页代码、公开仓库或 `VITE_*` 配置。

AI 模式会把提交的 diff 发给 OpenAI，并使用该 API 账户的计费额度。ChatGPT 订阅和 API 计费是不同的产品。第一次使用前，检查 diff 是否包含密钥、隐私或未经授权的代码。

## 4. 使用命令行

在 DiffAtlas 目录中执行：

```bash
# 无密钥规则演示
npm run review -- --demo --file examples/sample.diff --format markdown --output report.md

# AI 审查：配置 OPENAI_API_KEY 后，省略 --demo
npm run review -- --file /path/to/changes.diff --format json --output review.json

# 导出 SARIF
npm run review -- --demo --file examples/sample.diff --format sarif --output review.sarif
```

Windows 可传入带引号的绝对路径，例如 `--file "D:\code\changes.diff"`。不传 `--output` 时，报告输出到终端。CLI 直接调用 API，不经过网页后端，所以不需要网页的访问令牌。

需要在 CI 中按严重性判断时，使用 `--fail-on high`、`medium` 或 `low`；达到阈值时退出码为 `2`，输入或服务错误为 `1`。默认 `--fail-on none` 不会因发现问题而失败。

`npm run review` 使用开发依赖 `tsx`。只安装生产依赖的部署中，使用构建后的 CLI：

```bash
node --env-file-if-exists=.env dist-server/cli.js --demo --file examples/sample.diff --format json
```

## 5. 生产运行与检查

```bash
npm run check
npm start
```

`check` 包含类型检查、测试和生产构建。`npm start` 启动构建后的服务，默认地址为 `http://127.0.0.1:8787`。只需要重新构建时可用 `npm run build`。

更多部署方式见[部署指南](deployment.md)。需要申请 OpenAI 开源支持时，先阅读[官方条件与材料准备](open-source-program.zh-CN.md)。

## 常见问题

**GitHub Pages 上为什么没有真实 AI 后端？** Pages 只能托管静态文件。它提供规则演示；真实 AI 审查需要本地或独立托管的 Node.js 服务。

**为什么某些模型问题没有显示？** 文件、行号或引用证据无法通过校验的模型输出会被丢弃。这降低了无依据引用的影响，但也可能丢弃表达不准确的有效问题。

**为什么没有发现问题？** 工具只能检查提供的 diff，规则和模型都可能漏报或误报。结合调用方、完整文件、测试和人工审查判断。

**只有删除操作的 diff 怎么处理？** 当前 AI 问题必须引用新增行。仅删除的补丁会返回需要人工审查的说明，不发起模型请求；请重点检查被删除行为的调用方和回归测试。

**请求被拒绝或模型不可用？** 检查服务端 API Key、访问令牌以及账户是否有对应模型权限；可以通过 `OPENAI_MODEL` 配置账户可用且支持所需结构化输出的模型。不要把完整密钥或私有代码贴到公开 issue。
