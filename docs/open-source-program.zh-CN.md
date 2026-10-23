# OpenAI 开源支持计划：官方条件与材料准备

查证日期：**2026 年 10 月 23 日**。本页依据实际打开的 OpenAI 官方说明、申请表和项目条款整理。计划可能调整，提交申请前应重新阅读官方页面。

DiffAtlas 是独立开源项目。本仓库不声称获得 OpenAI 认可、资助或计划录取，也不承诺通过申请。

## 对应哪个计划

用户常说的“OpenAI 开源项目支持计划”当前对应 **Codex for Open Source**：

- [官方计划说明](https://developers.openai.com/community/codex-for-oss)
- [官方中文申请表](https://openai.com/zh-Hans-CN/form/codex-for-oss/)
- [Codex for Open Source Program Terms](https://developers.openai.com/codex/codex-for-oss-terms)

官方列出的支持包括六个月 ChatGPT Pro（含 Codex）、有条件的 Codex Security 访问，以及用于开源维护工作流的 API 额度。API 额度与 Security 属于可能另行审核的支持；实际权益、时长、范围和提供时间由 OpenAI 决定。官方没有在这些页面公布统一的 API 额度金额。

## 评估什么

官方计划说明写道：

> “If you're a core maintainer or run a widely used public project, apply.”

官方中文申请表 FAQ 写道：

> “活跃开源项目的维护者可以提交申请。”
>
> “我们会寻找具有实质性使用量、广泛采用度或对软件生态系统有明确重要性的项目。”

审核指标包括仓库使用情况、生态重要性、活跃维护证据，以及维护者身份和权限。活跃维护证据包括 PR 评审、问题分类处理、版本发布管理等持续性职责。

当前查证的官方页面**没有给出固定 stars 下限、下载量下限或仓库年龄门槛**。不完全符合常规条件、但对生态有重要作用的项目也可解释理由申请。这不等于新建一个仓库就能获批。

项目条款明确：

> “Submission of an application does not guarantee selection, funding, or access.”

申请需要有效 ChatGPT 账户，信息必须准确完整；OpenAI 可以核实身份、维护者角色和仓库控制权。官方按申请顺序滚动审核，并通过邮件通知入选申请者。

## 准备哪些材料

以下来自实际申请表，最终以提交时显示的字段和必填条件为准：

| 材料 | 应准备的真实信息 |
| --- | --- |
| 姓名和邮箱 | 申请人的真实信息；邮箱与 ChatGPT 账户关联 |
| GitHub 用户名 | 可公开访问的个人资料 |
| GitHub 仓库 URL | 可公开访问的项目仓库 |
| 维护者角色 | 主要维护者或核心维护者，与真实权限一致 |
| 为什么符合要求 | stars、每月下载量，或者生态重要性；最多 500 字符 |
| 感兴趣的支持 | Codex Security、项目 API 额度等适用选项 |
| OpenAI 组织 ID | 在平台组织设置中核对，不要公开 API Key |
| API 额度用途 | 项目如何用于代码、维护自动化、发布或核心开源工作；最多 500 字符 |
| 其他说明 | 补充材料；最多 500 字符 |

不要填写虚构用户、下载量、企业采用情况、社区反馈、维护历史、支持计划关系或测试结果。刚发布时应如实描述项目阶段，引用可核实的代码、发布记录和使用证据。

## DiffAtlas 可以怎样准备

先让工具解决真实问题，再根据实际进展决定申请时机：

1. 发布可运行版本：README、MIT 许可证、演示、安装步骤、测试和贡献入口应可用。
2. 验证实际价值：用有权限使用的代码任务比较完整上下文与筛选后上下文，记录 token、必要证据遗漏和实际任务完成情况。合成基准的省量不等于模型质量提升。
3. 持续维护：处理真实 issues、评审贡献、记录发布变化。不要为申请伪造活动。
4. 收集可核实的使用证据：采用者自愿公开的反馈、包下载、真实 stars 或集成。没有的数据不填。
5. 提出具体支持用途：例如上下文筛选的模型效果评估、独立任务集建设、发布前回归验证，说明可交付成果及成本估算依据。

## 可改写的申请草稿

以下是写作框架，**不是已提交材料**。申请人应逐项核实，并在网页的字符限制内改写。

**为什么项目符合要求：**

> DiffAtlas Context is an early open-source tool that packs code context within a token budget, locally and without model calls. It preserves complete JS/TS declarations, reports omissions, and provides reproducible evidence-retention benchmarks. I maintain its code, tests, docs, and releases. Current adoption: [insert only verified metrics or explain a concrete ecosystem need].

**API 额度用途：**

> We would use API credits to compare full and packed context on authorized coding tasks, measuring executable task success and input/output token usage under fixed model settings. We would publish the method and reproducible results, including failures. Requested scope and usage estimates: [fill in an actual plan and measured estimate].

草稿中的计划应与实际能完成的工作一致。提交申请意味着接受项目条款；由申请人核对身份、数据和条款后决定是否提交。
