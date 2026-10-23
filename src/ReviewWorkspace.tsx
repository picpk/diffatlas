import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowDownToLine, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight,
  CircleAlert, Code2, FileCode2, FileDiff, FileUp, FlaskConical, GitBranch,
  Github, HelpCircle, ListChecks, LoaderCircle, LockKeyhole, PanelLeftClose,
  Play, RotateCcw, ScanLine, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { MAX_DIFF_BYTES, parseDiff } from './core/diff';
import { analyzeDemo } from './core/demo';
import { sampleDiff } from './core/sample';
import { toMarkdown } from './core/format';
import type { Finding, ParsedDiff, Review, Severity } from './core/types';

type Mode = 'demo' | 'ai';
type ApiStatus = { aiEnabled: boolean; model?: string; requiresToken: boolean; demoOnly: boolean };
const severityLabels: Record<Severity, string> = { high: '高风险', medium: '中风险', low: '低风险' };
const initialParsed = parseDiff(sampleDiff);
const initialReview = analyzeDemo(initialParsed);

function navigateTabs(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

function getReview(value: unknown): Review {
  if (!value || typeof value !== 'object') throw new Error('服务返回了无法识别的审查结果，请重试。');
  const data = value as Record<string, unknown>;
  if (typeof data.summary !== 'string' || !Array.isArray(data.findings) || !Array.isArray(data.testPlan)
    || !['demo', 'ai'].includes(String(data.mode)) || data.findings.length > 100 || data.testPlan.length > 100) {
    throw new Error('服务返回的审查结果格式有误，请检查部署版本。');
  }
  const findings = data.findings.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('审查建议格式有误，请重试。');
    const f = item as Record<string, unknown>;
    if (!['id', 'title', 'file', 'evidence', 'explanation', 'suggestion'].every(key => typeof f[key] === 'string')
      || !['high', 'medium', 'low'].includes(String(f.severity)) || typeof f.line !== 'number' || !Number.isInteger(f.line) || f.line < 1) {
      throw new Error('审查建议缺少有效的代码位置，请重试。');
    }
    return f as unknown as Finding;
  });
  if (!data.testPlan.every(item => typeof item === 'string')) throw new Error('测试建议格式有误，请重试。');
  return {
    summary: data.summary, findings, testPlan: data.testPlan as string[], mode: data.mode as Mode,
    model: typeof data.model === 'string' ? data.model : undefined,
    discardedFindings: typeof data.discardedFindings === 'number' && Number.isFinite(data.discardedFindings) ? data.discardedFindings : 0,
  };
}

function downloadReview(review: Review) {
  const blob = new Blob([toMarkdown(review)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'diffatlas-review.md';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReviewWorkspace() {
  const [diff, setDiff] = useState(sampleDiff);
  const [review, setReview] = useState<Review | null>(initialReview);
  const [selectedPath, setSelectedPath] = useState(initialParsed.files[0]?.path ?? '');
  const [activeFinding, setActiveFinding] = useState<string | null>(initialReview.findings[0]?.id ?? null);
  const [editorTab, setEditorTab] = useState<'preview' | 'source'>('preview');
  const [reportTab, setReportTab] = useState<'findings' | 'tests'>('findings');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [mode, setMode] = useState<Mode>('demo');
  const [status, setStatus] = useState<ApiStatus>({ aiEnabled: false, requiresToken: false, demoOnly: true });
  const [statusLoading, setStatusLoading] = useState(true);
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sourceRevision = useRef(0);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const helpOpenRef = useRef<HTMLButtonElement>(null);
  const parsed = useMemo<{ data: ParsedDiff; error: string }>(() => {
    try {
      if (!diff.trim()) return { data: { files: [], totalAdditions: 0, totalDeletions: 0, warnings: [] }, error: '' };
      if (new TextEncoder().encode(diff).length > MAX_DIFF_BYTES) throw new Error('Diff 超过 100 KiB，请缩小变更范围后重试。');
      return { data: parseDiff(diff), error: '' };
    } catch (e) {
      return { data: { files: [], totalAdditions: 0, totalDeletions: 0, warnings: [] }, error: e instanceof Error ? e.message : '无法解析 diff。' };
    }
  }, [diff]);
  const selectedFile = parsed.data.files.find(file => file.path === selectedPath) ?? parsed.data.files[0];
  const filteredFindings = review?.findings.filter(finding => severity === 'all' || finding.severity === severity) ?? [];
  const selectedFinding = review?.findings.find(finding => finding.id === activeFinding);
  const canRun = parsed.data.files.length > 0 && !parsed.error && !loading && (mode === 'demo' || (status.aiEnabled && (!status.requiresToken || accessToken.trim().length > 0)));

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch('/api/status', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
        const data: unknown = await response.json();
        if (data && typeof data === 'object') {
          const info = data as Record<string, unknown>;
          setStatus({ aiEnabled: info.aiEnabled === true, requiresToken: info.requiresToken === true, demoOnly: info.demoOnly !== false, model: typeof info.model === 'string' ? info.model : undefined });
        }
      })
      .catch(() => { /* Static deployments intentionally run the local demo. */ })
      .finally(() => { window.clearTimeout(timeout); setStatusLoading(false); });
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (!selectedFinding) return;
    document.getElementById(`diff-line-${selectedFinding.line}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [selectedFinding, selectedPath, editorTab]);

  useEffect(() => {
    if (!showHelp) return;
    helpCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowHelp(false); helpOpenRef.current?.focus(); }
      if (event.key === 'Tab') { event.preventDefault(); helpCloseRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showHelp]);

  function updateDiff(next: string) {
    sourceRevision.current += 1;
    requestRef.current?.abort();
    setLoading(false);
    setDiff(next);
    setReview(null);
    setActiveFinding(null);
    setError('');
    setNotice('变更内容已更新，请重新运行审查。');
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    sourceRevision.current += 1;
    requestRef.current?.abort();
    setLoading(false);
    setMode(next);
    setReview(null);
    setActiveFinding(null);
    setError('');
    setNotice('审查模式已切换，请运行审查。');
  }

  async function uploadFile(file?: File) {
    if (!file) return;
    if (!/\.(patch|diff)$/i.test(file.name)) { setError('请选择 .patch 或 .diff 文件。'); return; }
    if (file.size > MAX_DIFF_BYTES) { setError('文件超过 100 KiB，请缩小变更范围后上传。'); return; }
    try {
      const content = await file.text();
      updateDiff(content);
      setEditorTab('preview');
      setNotice(`已载入 ${file.name}，请运行审查。`);
    } catch { setError('无法读取文件，请重新选择。'); }
  }

  async function runReview() {
    if (!canRun) return;
    setError('');
    setNotice('');
    setActiveFinding(null);
    setReportTab('findings');
    setSeverity('all');
    if (mode === 'demo') {
      try { setReview(analyzeDemo(parsed.data)); setNotice('本地规则检查已完成。'); }
      catch (e) { setError(e instanceof Error ? e.message : '规则检查失败，请检查 diff 内容。'); }
      return;
    }
    const revision = sourceRevision.current;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setReview(null);
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('/api/review', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken.trim()}` } : {}) },
        body: JSON.stringify({ diff }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `审查请求失败（${response.status}），请稍后重试。`;
        throw new Error(message);
      }
      const nextReview = getReview(data);
      if (revision === sourceRevision.current) { setReview(nextReview); setNotice('AI 审查已完成。请结合完整上下文确认建议。'); }
    } catch (e) {
      if (revision === sourceRevision.current) setError(controller.signal.aborted ? '审查等待超时，请缩小 diff 或稍后重试。' : e instanceof Error ? e.message : '连接失败，请检查服务器后重试。');
    } finally {
      window.clearTimeout(timeout);
      if (revision === sourceRevision.current) setLoading(false);
    }
  }

  function resetExample() {
    updateDiff(sampleDiff);
    setMode('demo');
    setReview(analyzeDemo(initialParsed));
    setActiveFinding(initialReview.findings[0]?.id ?? null);
    setSelectedPath(initialParsed.files[0]?.path ?? '');
    setEditorTab('preview');
    setSeverity('all');
    setNotice('已恢复示例与本地规则审查结果。');
  }

  function locateFinding(finding: Finding) {
    setSelectedPath(finding.file);
    setEditorTab('preview');
    setActiveFinding(finding.id);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="DiffAtlas 主页">
          <span className="brand-mark"><GitBranch size={23} strokeWidth={1.8} /></span>
          <span>DiffAtlas<span className="brand-version">v0.1</span></span>
        </a>
        <span className="topbar-divider" />
        <span className="topbar-caption">让代码审查，有据可循。</span>
        <div className="topbar-actions">
          <span className="open-source"><span /> 开源开发者工具</span>
          <a className="github-link" href="https://github.com/picpk/diffatlas" target="_blank" rel="noreferrer"><Github size={16} /><span>GitHub</span><ArrowUpRight size={13} /></a>
        </div>
      </header>

      <div className="app-body">
        <nav className="activity-rail" aria-label="工作台导航">
          <a className="rail-item selected" href="#main" aria-label="变更审查" title="变更审查"><FileDiff size={23} /><span className="rail-indicator" /></a>
          <button className="rail-item" onClick={() => { setReportTab('tests'); document.getElementById('review-panel')?.scrollIntoView({ block: 'nearest' }); }} aria-label="查看测试建议" title="测试建议"><FlaskConical size={22} /></button>
          <span className="rail-spacer" />
          <button ref={helpOpenRef} className="rail-item" onClick={() => setShowHelp(true)} aria-label="使用说明" title="使用说明"><HelpCircle size={22} /></button>
          <div className="rail-avatar" title="本地工作区">D</div>
        </nav>

        <main id="main" className="main-workspace">
          <section className="workspace-heading" aria-labelledby="page-title">
            <div><div className="breadcrumb"><span>工作区</span><ChevronRight size={13} /><span>变更审查</span></div><h1 id="page-title">读懂变更，找到真正的风险<span className="heading-dot">.</span></h1><p>从 Git diff 出发，把每条建议定位到具体代码。</p></div>
            <button className="button button-subtle reset-button" onClick={resetExample}><RotateCcw size={14} />重置示例</button>
          </section>

          <section className="review-toolbar" aria-label="审查设置">
            <div className="mode-switch" role="group" aria-label="审查模式">
              <button className={mode === 'demo' ? 'active' : ''} onClick={() => changeMode('demo')} aria-pressed={mode === 'demo'}><Code2 size={15} />规则演示<span className="local-tag">本地</span></button>
              <button className={mode === 'ai' ? 'active' : ''} onClick={() => changeMode('ai')} aria-pressed={mode === 'ai'}><Sparkles size={15} />AI 审查</button>
            </div>
            <div className="toolbar-description"><span className={`connection-dot ${mode === 'ai' && !status.aiEnabled ? 'inactive' : ''}`} />{mode === 'demo' ? '本地运行，无需 API Key' : statusLoading ? '正在连接审查服务' : status.aiEnabled ? `${status.model || 'OpenAI'} 已连接` : 'AI 服务未配置'}</div>
            <div className="toolbar-actions">
              <input ref={uploadRef} className="visually-hidden" type="file" accept=".patch,.diff" tabIndex={-1} aria-label="上传 diff 文件" onChange={event => { void uploadFile(event.target.files?.[0]); event.target.value = ''; }} />
              <button className="button button-secondary upload-button" onClick={() => uploadRef.current?.click()}><FileUp size={15} /><span>上传 Diff</span></button>
              <button className="button button-primary" onClick={() => void runReview()} disabled={!canRun}>{loading ? <LoaderCircle className="spin" size={15} /> : <Play size={14} fill="currentColor" />}<span>{loading ? '审查中…' : '运行审查'}</span></button>
            </div>
          </section>

          {mode === 'ai' && <div className="ai-configuration">
            <div><LockKeyhole size={16} /><p>{status.aiEnabled ? 'AI 审查会将 diff 发送到部署服务器与 OpenAI。请先移除密钥和敏感内容。' : '此部署提供本地规则演示。启用 AI 审查，请自托管并在服务器配置 OpenAI API Key。'}{!status.aiEnabled && <a href="https://github.com/picpk/diffatlas/blob/main/docs/deployment.md" target="_blank" rel="noreferrer">查看部署说明 <ArrowUpRight size={12} /></a>}</p></div>
            {status.aiEnabled && status.requiresToken && <label className="token-input">服务器访问令牌<input type="password" value={accessToken} onChange={event => setAccessToken(event.target.value)} autoComplete="off" placeholder="输入部署者提供的令牌" spellCheck={false} /><span>仅保存在当前页面内存中</span></label>}
          </div>}

          {(error || parsed.error) && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error || parsed.error}</span>{error && <button aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button>}</div>}
          <div className="visually-hidden" role="status" aria-live="polite">{notice}</div>

          <section className="workbench" aria-label="Diff 审查工作台">
            <aside className="file-sidebar" aria-label="变更文件">
              <div className="pane-title"><span>变更文件</span><span className="count-chip">{parsed.data.files.length}</span><PanelLeftClose className="pane-icon" size={15} /></div>
              <div className="change-summary"><GitBranch size={14} /><span>当前变更</span><span className="added">+{parsed.data.totalAdditions}</span><span className="deleted">−{parsed.data.totalDeletions}</span></div>
              <div className="file-list">{parsed.data.files.map(file => {
                const pathParts = file.path.split('/');
                const name = pathParts.pop();
                const findingCount = review?.findings.filter(finding => finding.file === file.path).length ?? 0;
                return <button key={file.path} className={`file-item ${selectedFile?.path === file.path ? 'active' : ''}`} onClick={() => { setSelectedPath(file.path); setEditorTab('preview'); setActiveFinding(null); }} aria-current={selectedFile?.path === file.path ? 'true' : undefined} title={file.path}><FileCode2 size={16} /><span className="file-item-text"><span>{name}</span>{pathParts.length > 0 && <small>{pathParts.join('/')}/</small>}</span>{findingCount > 0 && <span className="file-finding-count" aria-label={`${findingCount} 条审查建议`}>{findingCount}</span>}</button>;
              })}</div>
              {!parsed.data.files.length && <p className="file-empty">粘贴或上传 diff 后，变更文件会显示在这里。</p>}
              <div className="sidebar-note"><ShieldCheck size={17} /><strong>{mode === 'demo' ? '你的代码，留在本地' : '按需发送代码'}</strong><p>{mode === 'demo' ? '规则演示在浏览器中完成，diff 内容不会上传。' : '点击运行后，仅发送当前 diff 进行审查。'}</p></div>
            </aside>

            <section className="code-pane" aria-label="Diff 内容">
              <div className="code-tabs"><div role="tablist" aria-label="Diff 视图" onKeyDown={navigateTabs}><button id="preview-tab" className={editorTab === 'preview' ? 'active' : ''} role="tab" tabIndex={editorTab === 'preview' ? 0 : -1} aria-selected={editorTab === 'preview'} aria-controls="diff-content" onClick={() => setEditorTab('preview')}><FileDiff size={14} />代码变更</button><button id="source-tab" className={editorTab === 'source' ? 'active' : ''} role="tab" tabIndex={editorTab === 'source' ? 0 : -1} aria-selected={editorTab === 'source'} aria-controls="diff-content" onClick={() => setEditorTab('source')}><Code2 size={14} />粘贴 Diff</button></div><span className="diff-format">Unified diff</span></div>
              <div className="file-location"><span><FileCode2 size={14} />{editorTab === 'source' ? '编辑原始 diff' : selectedFile?.path ?? '尚未载入文件'}</span><span>{editorTab === 'source' ? `${(new TextEncoder().encode(diff).length / 1024).toFixed(1)} / 100 KiB` : selectedFile ? <><b className="added">+{selectedFile.additions}</b><b className="deleted">−{selectedFile.deletions}</b></> : '—'}</span></div>
              <div id="diff-content" className={`diff-content ${editorTab === 'source' ? 'source-view' : ''}`} role="tabpanel" aria-labelledby={editorTab === 'source' ? 'source-tab' : 'preview-tab'}>
                {editorTab === 'source' ? <><label className="visually-hidden" htmlFor="diff-input">粘贴 Git diff 内容</label><textarea id="diff-input" value={diff} onChange={event => updateDiff(event.target.value)} spellCheck={false} wrap="off" placeholder={'将 git diff 的输出粘贴到这里…\n\ndiff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-const before = true;\n+const after = true;'} /><span className="editor-hint">支持 git diff 与 .patch 文件。修改后需重新审查。</span></> : selectedFile ? <>
                  <div className="diff-hunk"><span>@@</span><span>{selectedFile.isBinary ? '二进制文件变更，无法显示文本差异' : `${selectedFile.lines.length} 行变更上下文`}</span></div>
                  <div className="diff-lines">{selectedFile.lines.map((line, index) => {
                    const isEvidence = selectedFinding?.file === selectedFile.path && selectedFinding.line === line.newLine;
                    const sign = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' ';
                    return <div key={`${index}-${line.newLine}`} id={line.newLine !== null ? `diff-line-${line.newLine}` : undefined} className={`diff-line ${line.kind} ${isEvidence ? 'evidence-line' : ''}`}><span className="line-number" aria-hidden="true">{line.oldLine ?? ''}</span><span className="line-number" aria-hidden="true">{line.newLine ?? ''}</span><span className="line-sign" aria-label={line.kind === 'addition' ? '新增' : line.kind === 'deletion' ? '删除' : '上下文'}>{sign}</span><code>{line.content || ' '}</code>{isEvidence && <span className="evidence-label"><ScanLine size={11} />证据</span>}</div>;
                  })}</div>
                </> : <div className="empty-state code-empty"><FileDiff size={35} strokeWidth={1.3} /><h3>从一段变更开始</h3><p>粘贴 Git diff，或上传不超过 100 KiB 的 .patch / .diff 文件。</p><button className="button button-secondary" onClick={() => setEditorTab('source')}><Code2 size={14} />粘贴 Diff</button></div>}
              </div>
              <div className="code-status"><span><span className="connection-dot" />{parsed.error ? '待修正' : selectedFile ? 'Diff 已解析' : '等待输入'}</span><span>UTF-8<span className="status-separator">/</span>{mode === 'demo' ? '浏览器本地' : 'AI 模式'}</span></div>
            </section>

            <aside id="review-panel" className="review-pane" aria-label="审查结果" aria-busy={loading}>
              <div className="pane-title review-title"><span className="review-title-text"><ScanLine size={17} />审查结果</span><span className={`review-mode-badge ${review?.mode === 'ai' ? 'ai' : ''}`}>{review?.mode === 'ai' ? 'AI 审查' : mode === 'ai' ? 'AI 模式' : '规则演示 · 非 AI'}</span></div>
              {loading ? <div className="empty-state review-empty"><LoaderCircle className="spin" size={30} /><h3>正在分析代码变更</h3><p>逐条核对代码位置与引用证据。复杂变更可能需要一分钟。</p></div> : review ? <>
                <div className="review-overview"><div className="review-headline"><span className="review-complete-icon"><CheckCheck size={20} /></span><div><h2>变更审查已完成</h2><p>{review.findings.length ? <>发现 <strong>{review.findings.length}</strong> 个值得关注的问题</> : review.mode === 'demo' ? '当前规则未发现可定位的问题' : '本次 AI 审查未发现可定位的问题'}</p></div></div><div className="risk-summary">{(['high', 'medium', 'low'] as Severity[]).map(level => <button key={level} onClick={() => { setSeverity(severity === level ? 'all' : level); setReportTab('findings'); }} className={`risk-summary-item ${level} ${severity === level ? 'selected' : ''}`} aria-pressed={severity === level}><span className="severity-dot" /><span>{severityLabels[level]}</span><b>{review.findings.filter(f => f.severity === level).length}</b></button>)}</div><p className="review-summary">{review.summary}</p></div>
                <div className="report-tabs" role="tablist" aria-label="审查内容" onKeyDown={navigateTabs}><button id="findings-tab" role="tab" tabIndex={reportTab === 'findings' ? 0 : -1} aria-controls="report-content" aria-selected={reportTab === 'findings'} className={reportTab === 'findings' ? 'active' : ''} onClick={() => setReportTab('findings')}><CircleAlert size={14} />风险发现<span>{review.findings.length}</span></button><button id="tests-tab" role="tab" tabIndex={reportTab === 'tests' ? 0 : -1} aria-controls="report-content" aria-selected={reportTab === 'tests'} className={reportTab === 'tests' ? 'active' : ''} onClick={() => setReportTab('tests')}><FlaskConical size={14} />测试建议<span>{review.testPlan.length}</span></button></div>
                <div id="report-content" className="report-content" role="tabpanel" aria-labelledby={reportTab === 'findings' ? 'findings-tab' : 'tests-tab'}>
                  {reportTab === 'findings' ? <><div className="findings-filter"><span>点击建议，定位代码证据</span><label><span className="visually-hidden">风险筛选</span><select value={severity} onChange={event => setSeverity(event.target.value as Severity | 'all')}><option value="all">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option></select><ChevronDown size={11} /></label></div>
                    {filteredFindings.length ? filteredFindings.map((finding, index) => <article className={`finding ${activeFinding === finding.id ? 'active' : ''}`} key={`${finding.id}-${index}`}><button className="finding-trigger" onClick={() => locateFinding(finding)} aria-label={`${finding.title}，定位 ${finding.file} 第 ${finding.line} 行`} aria-pressed={activeFinding === finding.id}><span className={`severity-label ${finding.severity}`}><span className="severity-dot" />{severityLabels[finding.severity]}</span><h3>{finding.title}</h3><span className="finding-location"><FileCode2 size={12} /><span>{finding.file}</span><b>L{finding.line}</b><ArrowUpRight size={13} /></span></button><p>{finding.explanation}</p><button className="evidence-snippet" onClick={() => locateFinding(finding)} aria-label={`查看第 ${finding.line} 行代码证据`}><span>L{finding.line}</span><code>{finding.evidence}</code><ScanLine size={13} /></button><div className="finding-suggestion"><Check size={13} /><p>{finding.suggestion}</p></div></article>) : <div className="empty-state small-empty"><ShieldCheck size={27} /><h3>{severity === 'all' ? '未发现可定位的问题' : '没有此级别的风险'}</h3><p>{severity === 'all' ? '这不代表代码没有问题。请结合测试和完整上下文继续检查。' : '切换风险筛选查看其他建议。'}</p></div>}
                  </> : <div className="test-plan"><div className="test-plan-intro"><ListChecks size={17} /><p>把这些场景加入测试，验证变更的实际行为。</p></div>{review.testPlan.map((item, index) => <div className="test-plan-item" key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></div>)}{review.testPlan.length === 0 && <p className="no-tests">本次审查没有额外的测试建议。</p>}</div>}
                  {review.discardedFindings > 0 && <p className="discarded-note"><ShieldCheck size={13} />已过滤 {review.discardedFindings} 条无法与 diff 证据对应的建议。</p>}
                </div>
                <div className="report-footer"><span><ShieldCheck size={13} />建议须结合上下文确认</span><button onClick={() => downloadReview(review)} className="export-button"><ArrowDownToLine size={14} />导出 Markdown</button></div>
              </> : <div className="empty-state review-empty"><ScanLine size={32} strokeWidth={1.4} /><h3>{mode === 'ai' && !status.aiEnabled ? '连接你的 AI 审查服务' : '等待一次新的审查'}</h3><p>{mode === 'ai' && !status.aiEnabled ? '完成自托管配置后，即可使用 OpenAI 分析变更。现在也可以切换到规则演示体验。' : '内容或模式已更新。点击「运行审查」，生成与当前 diff 对应的结果。'}</p>{mode === 'ai' && !status.aiEnabled && <button className="button button-secondary" onClick={() => changeMode('demo')}>切换规则演示</button>}</div>}
            </aside>
          </section>

          <footer className="workspace-footer"><span><LockKeyhole size={12} />{mode === 'demo' ? '规则演示完全本地运行。示例结果由规则生成，不调用 AI。' : 'AI 仅审查当前提供的 diff，不读取完整仓库。'}</span><span>更少猜测，更多代码依据。</span></footer>
          {parsed.data.warnings.length > 0 && <div className="parser-warnings" role="status">{parsed.data.warnings.map((warning, index) => <p key={index}><CircleAlert size={13} />{warning}</p>)}</div>}
        </main>
      </div>

      {showHelp && <div className="modal-backdrop" onClick={() => { setShowHelp(false); helpOpenRef.current?.focus(); }}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button ref={helpCloseRef} className="modal-close" onClick={() => { setShowHelp(false); helpOpenRef.current?.focus(); }} aria-label="关闭使用说明"><X size={20} /></button><div className="help-mark"><GitBranch size={24} /></div><h2 id="help-title">从变更到可验证的建议</h2><p>DiffAtlas 为 Git diff 提供带代码位置和引用证据的审查建议。</p><ol><li><strong>载入变更</strong><span>在终端运行 git diff，复制输出到「粘贴 Diff」，或上传 .diff / .patch 文件。</span></li><li><strong>选择审查方式</strong><span>规则演示完全本地运行；AI 模式需要自托管 OpenAI 服务。</span></li><li><strong>核对证据与测试</strong><span>点击审查建议定位代码，查看测试建议，再导出 Markdown 报告。</span></li></ol><p className="help-note">证据校验确认引用的代码存在于 diff 中，不保证建议本身正确。请结合完整代码上下文与测试判断。</p></section></div>}
    </div>
  );
}

