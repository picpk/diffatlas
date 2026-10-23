# DiffAtlas Context 中文上手

DiffAtlas v0.2 把代码整理成符合 token 预算的 AI 上下文。输入任务、代码文件和预算，得到可复制给本地 AI、编辑器助手或在线模型的文本。选择和计数在本地完成，无需调用模型或配置 API Key。

它解决的是“给 AI 看哪些代码、能否放进预算、为了省 token 丢了什么”。减少输入不代表回答一定更好；请同时检查被选代码、遗漏内容和警告。

## 网页使用

打开[在线工具](https://picpk.github.io/diffatlas/)，选择代码文件或使用示例，填写具体任务，再设置预算和编码。运行后检查代码选择结果，复制或下载上下文，交给你已经在用的 AI。

代码选择和 token 计数在浏览器中运行。这是实际的本地工具，不是等待接入 API 的演示。`o200k_base` 和 `cl100k_base` 是可选编码；你的本地模型如果使用另一种 tokenizer，实际 token 数可能不同。

## 本地安装

准备 Git 与 Node.js **22.12 或以上**：

```bash
git clone https://github.com/picpk/diffatlas.git
cd diffatlas
npm ci
npm run dev
```

打开 Vite 输出的地址。上下文打包不需要 `.env`；也可以直接使用 CLI，不启动网页。

## 给本地 AI 准备上下文

在 DiffAtlas 目录执行，把 `--repo` 换成你的代码仓库：

```bash
npm run pack -- --repo /path/to/project --task "检查 getCachedUser 缓存 null 时是否重复查询" --budget 4000 --format prompt --output context.md
```

Windows 可写成 `--repo "D:\code\my-project"`。打开 `context.md`，确认关键函数、调用方和测试是否保留，然后粘贴给本地 AI。如果缺少必要文件，用 `--pin` 固定文件，或提高预算重新生成。

先在本仓库试一次：

```bash
npm run pack -- --repo src/context --task "检查 countTextTokens 的 encoding 校验" --budget 4000 --format prompt --output context.md
```

`--format json` 导出包含 token 数、选中理由、遗漏和警告的报告；`--format prompt` 只导出用于交给模型的文本。

## 指定变更与必需文件

```bash
git diff --output=changes.diff
npm run pack -- --repo . --task "检查变更对调用方的影响" --diff changes.diff --pin src/context/types.ts --budget 6000 --encoding o200k_base --format json --output context-report.json
```

`--diff` 使用与当前源码对应的 Git diff。`--pin` 使用相对 `--repo` 的路径，可以重复传入或用逗号分隔。固定文件和变更涉及的语句会成为必需内容。

如果必需内容超出预算，结果返回 `budgetExceeded: true`、空 prompt 和 `minimumRequiredTokens`。提高预算或缩小固定范围后重试；工具不会截断函数后声称成功。

CLI 默认读取 Git 跟踪及未跟踪但未被忽略的文件，过滤已知敏感文件名。它不能识别所有写在代码内部的密钥，分享导出文本前应检查内容。用管道传输原始文本时，使用 `npm run --silent pack`，避免 npm 的日志前缀混入上下文。

当前限制为最多 100 个符合条件的文件、每个 100 KiB、总计 1 MiB。大仓库可以把 `--repo` 指向相关的 Git 子目录。CLI 成功退出码为 `0`，输入或读取错误为 `1`，必需内容超预算为 `2`。

## 验证省量与证据

完整输入和打包输入采用相同任务和包装，只比较接受的候选文件。高省量可能只是输入里有很多无关代码，因此还要看必需证据是否保留。

```bash
npm run benchmark -- --format markdown --output benchmark.md
npm run benchmark -- --format json --output benchmark.json
```

基准包含 8 个人工合成任务，每个运行 128、256、512、1,024、2,048 的预算，展示逐例省量、证据保留、预算失败和遗漏内容。它不调用模型，也不衡量回答准确率。详见[基准方法](context-benchmark.md)与[选择算法](context-packing.md)。

## 保留的 diff 审查工具

原有审查 CLI 和 HTTP API 仍可使用：

```bash
npm run review -- --demo --file examples/sample.diff --format markdown --output review.md
```

这是本地规则审查。要调用 OpenAI，复制 `.env.example` 为 `.env`，设置 `OPENAI_API_KEY`，并省略 `--demo`；HTTP API 还需要 `REVIEW_ACCESS_TOKEN`。API 模式会发送提供的 diff，计费独立于 ChatGPT 订阅。证据校验只确认引用来自给定代码，不保证判断正确。

CLI 支持 `markdown`、`json`、`sarif`，以及 `--fail-on high|medium|low` 严重性退出码检查。更多配置见[部署指南](deployment.md)。

## 构建检查

```bash
npm run check
npm start
```

`check` 包含类型检查、测试和生产构建。`npm start` 启动构建后的服务。上下文网页可直接托管到 GitHub Pages，无需 AI 后端。
