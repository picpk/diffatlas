import type { Finding, ParsedDiff, Review } from './types';

interface Rule {
  pattern: RegExp;
  title: string;
  severity: Finding['severity'];
  explanation: string;
  suggestion: string;
}

const rules: Rule[] = [
  {
    pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*(?:\+\s*\w|\$\{)/i,
    title: 'SQL 查询直接拼接动态值', severity: 'high',
    explanation: '这条新增代码将动态值拼接进 SQL。如果该值来自不可信输入，可能改变查询含义。这条规则无法判断输入是否已经过验证。',
    suggestion: '使用参数化查询，将用户输入作为独立参数传入，不要直接拼接到 SQL 文本中。',
  },
  {
    pattern: /\.(?:innerHTML|outerHTML)\s*=/,
    title: '直接写入动态 HTML', severity: 'high',
    explanation: '这条代码直接写入 HTML。不可信内容可能在页面中执行脚本。这条规则无法判断内容是否已经过安全净化。',
    suggestion: '展示纯文本时优先使用 textContent。确实需要 HTML 时，先通过持续维护的 HTML 净化库处理内容。',
  },
  {
    pattern: /\beval\s*\(/,
    title: '动态执行字符串代码', severity: 'high',
    explanation: 'eval 会将字符串作为代码执行。如果攻击者能够影响参数，就可能执行任意代码。仅匹配到这个模式，不能证明参数可被攻击者控制。',
    suggestion: '用明确的解析器替代 eval，或仅允许执行预先定义的操作。',
  },
  {
    pattern: /\b(?:api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*['"][^'"]{12,}['"]/i,
    title: '疑似硬编码凭据', severity: 'medium',
    explanation: '一个类似凭据的字段被赋予较长的字符串常量。它也可能只是测试占位符，需要人工检查后才能判断是否是真实密钥。',
    suggestion: '从环境变量或密钥管理服务读取真实凭据。如果真实密钥已被提交，应立即轮换。',
  },
];

/** Deterministic, local pattern matching. No model or network is involved. */
export function analyzeDemo(parsed: ParsedDiff): Review {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    for (const line of file.lines) {
      if (line.kind !== 'addition' || line.newLine === null) continue;
      for (const rule of rules) {
        if (!rule.pattern.test(line.content)) continue;
        findings.push({
          id: `demo-${findings.length + 1}`, title: rule.title, severity: rule.severity,
          file: file.path, line: line.newLine, evidence: line.content,
          explanation: rule.explanation, suggestion: rule.suggestion,
        });
      }
    }
  }
  return {
    mode: 'demo', discardedFindings: 0, findings,
    summary: findings.length
      ? `本地规则匹配到 ${findings.length} 个待确认问题。当前运行的是有限的模式检查演示，不是 AI 审查或安全审计。`
      : '本地规则没有匹配到问题模式。这组有限的检查无法证明补丁正确或安全。',
    testPlan: findings.length ? [
      '逐项检查被标记的值，追踪不可信输入是否能够到达这条代码。',
      '为已确认的问题补充回归测试，覆盖触发故障的输入。',
      '运行项目现有测试，并人工审查这四类规则未覆盖的行为变化。',
    ] : ['运行项目现有测试，并人工审查变更后的行为。'],
  };
}
