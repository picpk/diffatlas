import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import {
  ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleAlert, Code2, Copy,
  FileCode2, FileUp, FolderOpen, Github, Layers3, LoaderCircle, LockKeyhole,
  Pin, RotateCcw, Scissors, SlidersHorizontal,
} from 'lucide-react';
import { sampleFiles, sampleTask } from './context/samples';
import { fileExclusionReason } from './context/policy';
import type { PackInput, PackResult, SourceFile, TokenEncoding } from './context/types';

const format = (value: number) => new Intl.NumberFormat('en-US').format(value);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const directoryInput = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;
const supportedFile = /\.(?:[cm]?[jt]sx?|json|md|mdx|txt|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|vue|svelte|css|scss|html|xml|ya?ml|toml|sql|sh|ps1)$/i;

function explainReason(reason: string): string {
  return reason
    .replace(/^Task relevance \((.*)\)\.$/, '匹配任务关键词（$1）')
    .replace(/path:/g, '路径：').replace(/symbol:/g, '符号：').replace(/text:/g, '文本：')
    .replace(/^Required support for (.*) \(imports or lexical declaration dependency\)\.$/, '必须保留的依赖：$1（导入或词法声明）')
    .replace(/^Support for (.*) \(imports or lexical declaration dependency\)\.$/, '关联依赖：$1（导入或词法声明）')
    .replace('Pinned file: every source unit is required.', '已固定文件，完整保留')
    .replace('Contains a verified added diff line.', '包含已核对的 diff 新增行')
    .replace('All accepted source files fit within the budget.', '全部可用源码都能放入当前预算')
    .replace(/^Lines ([\d–]+): /, '第 $1 行：')
    .replace('no direct task-term match and not selected as support.', '未匹配任务关键词，且未作为依赖选入。')
    .replace('complete source/dependency group did not fit the budget.', '完整源码及依赖超出剩余预算。')
    .replace('no prompt emitted because required content exceeds budget.', '必要内容超出预算，尚未生成 Prompt。');
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ContextWorkspace({ onOpenReview }: { onOpenReview: () => void }) {
  const [files, setFiles] = useState<SourceFile[]>(sampleFiles);
  const [task, setTask] = useState(sampleTask);
  const [budget, setBudget] = useState(1500);
  const [encoding, setEncoding] = useState<TokenEncoding>('o200k_base');
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [result, setResult] = useState<PackResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<'chunks' | 'omitted' | 'prompt'>('chunks');
  const [chunkId, setChunkId] = useState('');
  const [sourcePath, setSourcePath] = useState(sampleFiles[0].path);
  const [copied, setCopied] = useState(false);
  const [editError, setEditError] = useState('');
  const sequence = useRef(0);
  const importSequence = useRef(0);
  const immediate = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = ++sequence.current;
    let worker: Worker | undefined;
    setResult(null);
    setCopied(false);
    setError('');
    if (!task.trim() || files.length === 0) { setBusy(false); return; }
    setBusy(true);
    const delay = immediate.current ? 0 : 400;
    immediate.current = false;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('./context/context.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ id: number; result?: PackResult; error?: string }>) => {
          if (event.data.id !== sequence.current) return;
          setBusy(false);
          if (event.data.error) setError(event.data.error);
          else if (event.data.result) setResult(event.data.result);
          worker?.terminate();
        };
        worker.onerror = () => {
          if (id !== sequence.current) return;
          setBusy(false);
          setError('计算模块加载失败。请刷新页面后重试，或使用项目的 CLI。');
          worker?.terminate();
        };
        const input: PackInput = { files, task, budget, encoding, pinnedPaths };
        worker.postMessage({ id, input });
      } catch (cause) {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : '无法启动计算模块。');
      }
    }, delay);
    return () => { window.clearTimeout(timer); worker?.terminate(); };
  }, [files, task, budget, encoding, pinnedPaths, nonce]);

  const source = files.find(file => file.path === sourcePath) ?? files[0];
  const selectedChunk = result?.chunks.find(chunk => chunk.id === chunkId)
    ?? result?.chunks.find(chunk => chunk.kind === 'symbol' && chunk.symbols.some(symbol => task.includes(symbol)))
    ?? result?.chunks[0];
  const hasSource = !!result?.chunks.length;
  const omittedTargets = result?.warnings.filter(warning => warning.startsWith('Explicit task target omitted:')) ?? [];
  const canExport = !!result?.prompt && hasSource && !result.budgetExceeded && !busy;
  const invalidate = () => { setResult(null); setCopied(false); setBusy(true); };

  async function importFiles(list: FileList | null) {
    if (!list?.length) return;
    const id = ++importSequence.current;
    setImporting(true);
    setImportNotice('');
    try {
      const all = Array.from(list);
      const candidates = all.filter(file => supportedFile.test(file.name) && !fileExclusionReason(file.webkitRelativePath || file.name));
      if (!candidates.length) throw new Error('未找到支持的文本或代码文件。');
      if (candidates.length > 100) throw new Error('一次最多导入 100 个文本文件，请选择较小的子目录。');
      if (candidates.some(file => file.size > MAX_FILE_BYTES)) throw new Error('单文件不能超过 100 KiB，请移除过大的文件。');
      if (candidates.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('文件总大小不能超过 1 MiB，请选择较小的子目录。');
      const paths = candidates.map(file => file.webkitRelativePath || file.name);
      const commonRoot = paths[0].split('/')[0];
      const stripRoot = paths.every(path => path.includes('/') && path.startsWith(`${commonRoot}/`));
      const loaded = await Promise.all(candidates.map(async (file, index) => ({
        path: stripRoot ? paths[index].slice(commonRoot.length + 1) : paths[index],
        content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
      })));
      if (new Set(loaded.map(file => file.path)).size !== loaded.length) throw new Error('所选文件包含重名路径，请通过文件夹导入保留目录结构。');
      if (id !== importSequence.current) return;
      invalidate();
      setFiles(loaded);
      setSourcePath(loaded[0].path);
      setPinnedPaths([]);
      setEditError('');
      setImportNotice(`已载入 ${loaded.length} 个文件${all.length > candidates.length ? `，按格式与路径策略忽略 ${all.length - candidates.length} 个文件（如依赖、构建产物或凭据文件）` : ''}。请填写与项目相关的任务。`);
    } catch (cause) {
      if (id === importSequence.current) setImportNotice(cause instanceof Error ? cause.message : '导入失败，请使用 UTF-8 文本文件。');
    } finally {
      if (id === importSequence.current) setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  }

  function resetSample() {
    importSequence.current++;
    setImporting(false);
    invalidate();
    setFiles(sampleFiles);
    setTask(sampleTask);
    setBudget(1500);
    setPinnedPaths([]);
    setSourcePath(sampleFiles[0].path);
    setImportNotice('');
    setEditError('');
    setNonce(value => value + 1);
  }

  function updateSource(content: string) {
    if (!source) return;
    const size = bytes(content);
    if (size > MAX_FILE_BYTES || files.reduce((sum, file) => sum + (file.path === source.path ? size : bytes(file.content)), 0) > MAX_TOTAL_BYTES) {
      setEditError('编辑后的内容超过大小限制：单文件 100 KiB，总计 1 MiB。');
      return;
    }
    setEditError('');
    invalidate();
    setFiles(current => current.map(file => file.path === source.path ? { ...file, content } : file));
  }

  async function copyPrompt() {
    if (!canExport || !result) return;
    try { await navigator.clipboard.writeText(result.prompt); setCopied(true); }
    catch { setError('浏览器未允许复制，请使用“下载 Prompt”。'); }
  }

  return <div className="context-app">
    <header className="context-topbar">
      <a className="context-brand" href="#"><span className="context-brand-mark"><Layers3 size={22} /></span><strong>DiffAtlas<span>Context</span></strong><small>v0.3</small></a>
      <nav className="context-topnav" aria-label="工作台导航"><span className="context-topnav-active">上下文工作台</span><button onClick={onOpenReview}>代码审查 <ArrowRight size={13} /></button></nav>
      <a className="context-github" href="https://github.com/picpk/diffatlas" target="_blank" rel="noreferrer"><Github size={17} /><span>GitHub</span><span className="context-mit">MIT</span></a>
    </header>

    <main className="context-main">
      <div className="context-heading"><div><div className="context-eyebrow"><span /> LESS CONTEXT. MORE SIGNAL.</div><h1>给 AI 更少的代码，<br className="context-mobile-break" />保留任务所需的上下文<span>。</span></h1><p>按任务筛选源码与依赖，生成可直接交给 AI 的上下文包。每一处保留与省略，都可查看。</p></div><div className="context-local"><LockKeyhole size={15} /><div><strong>在你的浏览器内处理</strong><span>无需 API Key · 源码不执行、不上传</span></div></div></div>

      <div className="context-grid">
        <aside className="context-controls">
          <section className="context-panel context-task-panel"><div className="context-panel-label"><span className="context-step">01</span><h2>描述任务</h2><Code2 size={16} /></div><label className="context-field-label" htmlFor="context-task">这次要让 AI 做什么？</label><textarea id="context-task" className="context-task-input" value={task} maxLength={8000} onChange={event => { invalidate(); setTask(event.target.value); }} placeholder="例如：修复 verifyResetToken 的过期时间边界，并补充测试。" /><p className="context-help">写出函数名、文件路径或具体行为，筛选会更准确。</p></section>

          <section className="context-panel context-budget-panel"><div className="context-panel-label"><span className="context-step">02</span><h2>设置上下文预算</h2><SlidersHorizontal size={16} /></div><div className="context-budget-value"><label htmlFor="context-budget-number">输出上限</label><div><input id="context-budget-number" type="number" min={100} max={100000} step={100} value={budget} onChange={event => { invalidate(); setBudget(Math.max(100, Math.min(100000, Number(event.target.value) || 100))); }} /><span>tokens</span></div></div><input className="context-range" aria-label="Token 预算滑块" type="range" min={100} max={Math.max(8000, budget)} step={100} value={budget} onChange={event => { invalidate(); setBudget(Number(event.target.value)); }} /><div className="context-range-labels"><span>100</span><span>{format(Math.max(8000, budget))}</span></div><label className="context-encoding" htmlFor="context-encoding"><span>Token 编码</span><select id="context-encoding" value={encoding} onChange={event => { invalidate(); setEncoding(event.target.value as TokenEncoding); }}><option value="o200k_base">o200k_base</option><option value="cl100k_base">cl100k_base</option></select></label><button className="context-button context-primary context-generate" disabled={!task.trim() || !files.length || importing} onClick={() => { invalidate(); immediate.current = true; setNonce(value => value + 1); }}>{busy ? <LoaderCircle className="context-spin" size={16} /> : <Scissors size={16} />}{busy ? '正在计算上下文…' : '生成上下文包'}<ArrowRight size={15} /></button><p className="context-help context-center">调整任务或预算后自动更新</p></section>

          <section className="context-panel context-files-panel"><div className="context-panel-label"><span className="context-step">03</span><h2>项目文件</h2><span className="context-count">{files.length}</span></div><div className="context-import-actions"><button className="context-button context-secondary" disabled={importing} onClick={() => fileInput.current?.click()}><FileUp size={14} />导入文件</button><button className="context-button context-secondary" disabled={importing} onClick={() => folderInput.current?.click()}><FolderOpen size={14} />导入文件夹</button></div><input ref={fileInput} type="file" multiple className="visually-hidden" aria-label="选择代码文件" onChange={event => void importFiles(event.target.files)} /><input ref={folderInput} type="file" multiple {...directoryInput} className="visually-hidden" aria-label="选择项目文件夹" onChange={event => void importFiles(event.target.files)} /><p className="context-help">导入将替换当前文件。最多 100 个文件，单个 100 KiB，总计 1 MiB。</p>{importNotice && <p className="context-import-notice" role="status">{importNotice}</p>}<div className="context-file-list">{files.map(file => <div className={`context-file-row ${source?.path === file.path ? 'context-selected' : ''}`} key={file.path}><button className="context-file-name" title={`编辑 ${file.path}`} onClick={() => setSourcePath(file.path)}><FileCode2 size={14} /><span>{file.path}</span></button><button className={`context-pin ${pinnedPaths.includes(file.path) ? 'context-pinned' : ''}`} aria-label={`${pinnedPaths.includes(file.path) ? '取消' : ''}固定完整文件 ${file.path}`} aria-pressed={pinnedPaths.includes(file.path)} title="固定完整文件，保证放入上下文" onClick={() => { invalidate(); setPinnedPaths(current => current.includes(file.path) ? current.filter(path => path !== file.path) : [...current, file.path]); }}><Pin size={13} /></button></div>)}</div><div className="context-files-bottom"><span><Pin size={12} /> 固定需完整保留的文件</span><button onClick={resetSample} disabled={importing}><RotateCcw size={12} />恢复示例</button></div></section>
        </aside>

        <div className="context-results">
          <section className="context-metrics" aria-label="Token 统计" aria-live="polite"><div className="context-metric"><span>全量上下文</span><strong>{result ? format(result.originalTokens) : '—'}<small>tokens</small></strong><p>本次载入的可用文件</p></div><div className="context-metric-arrow"><ArrowRight size={18} /></div><div className="context-metric"><span>筛选后上下文</span><strong>{result && !result.budgetExceeded ? format(result.packedTokens) : '—'}<small>tokens</small></strong><p>{result?.budgetExceeded ? '必要内容超出预算' : `预算 ${format(budget)} tokens`}</p></div><div className="context-metric context-savings"><span><Scissors size={13} />减少输入 tokens</span><strong>{result && !result.budgetExceeded && hasSource ? `${result.savingsPercent.toFixed(1)}%` : '—'}</strong><p>{result && !result.budgetExceeded && hasSource ? `比全量少 ${format(result.savedTokens)} tokens` : '根据实际编码计算'}</p></div></section>
          <p className="context-baseline">基准：本次已载入可用文件的同格式全量 Prompt（含任务与包装）。BPE 计数不等于所有模型的账单。</p>

          {(error || result?.budgetExceeded) && <div className="context-alert" role="alert"><CircleAlert size={18} /><div><strong>{error || '预算不足，未生成可用上下文包'}</strong>{result?.budgetExceeded && <p>任务相关的必要内容至少需要 {format(result.minimumRequiredTokens)} tokens。请提高预算或取消不必要的固定文件。可在左侧检查已固定的文件。</p>}</div>{result?.budgetExceeded && <button className="context-button context-secondary" onClick={() => { invalidate(); setBudget(Math.min(100000, Math.ceil(result.minimumRequiredTokens / 100) * 100)); }}>提高预算</button>}</div>}

          {omittedTargets.length > 0 && <div className="context-alert" role="alert"><CircleAlert size={18} /><div><strong>任务中点名的代码未包含在结果中</strong>{omittedTargets.map((warning, index) => <p key={index}>{warning}</p>)}<p>建议提高预算或在左侧固定对应文件。导出前请检查保留内容。</p></div></div>}
          {result && !result.budgetExceeded && !hasSource && <div className="context-alert" role="alert"><CircleAlert size={18} /><div><strong>当前结果没有源码，尚不能作为代码上下文包</strong><p>请提高预算、写明相关函数名或路径，或固定需要的文件。当前仅包含任务文本，已暂停 Prompt 复制和下载。</p></div></div>}
          <section className="context-output-panel"><div className="context-output-heading"><div><span className="context-section-overline">CONTEXT PACKAGE</span><h2>检查你的上下文包 <span className="context-count">{result ? result.chunks.length : '—'} 个片段</span></h2></div><span className={`context-status ${busy ? 'context-status-busy' : ''}`}>{busy ? <LoaderCircle className="context-spin" size={12} /> : <span />}{busy ? '正在计算' : result?.budgetExceeded ? '需要调整预算' : result ? hasSource ? '已更新' : '未选入源码' : '等待输入'}</span></div>
            <div className="context-tabs" role="tablist" aria-label="上下文结果"><button role="tab" aria-selected={tab === 'chunks'} className={tab === 'chunks' ? 'context-tab-active' : ''} onClick={() => setTab('chunks')}><Code2 size={14} />保留内容</button><button role="tab" aria-selected={tab === 'omitted'} className={tab === 'omitted' ? 'context-tab-active' : ''} onClick={() => setTab('omitted')}>省略说明 <span>{result?.omitted.length ?? '—'}</span></button><button role="tab" aria-selected={tab === 'prompt'} className={tab === 'prompt' ? 'context-tab-active' : ''} onClick={() => setTab('prompt')}>完整 Prompt</button></div>
            <div className="context-output-body" role="tabpanel" aria-label={tab === 'chunks' ? '保留内容' : tab === 'omitted' ? '省略说明' : '完整 Prompt'}>{!result ? <div className="context-empty">{busy ? <LoaderCircle size={28} className="context-spin" /> : <Layers3 size={28} />}<strong>{busy ? '正在分析源码与依赖…' : '准备好任务和文件后即可开始'}</strong><p>{busy ? '在独立计算线程内完成，源码始终留在浏览器。' : '写明具体任务，让上下文围绕问题展开。'}</p></div> : tab === 'chunks' ? <div className="context-chunks"><div className="context-chunk-list">{result.chunks.map(chunk => <button key={chunk.id} className={`context-chunk-item ${selectedChunk?.id === chunk.id ? 'context-chunk-active' : ''}`} onClick={() => setChunkId(chunk.id)}><span><FileCode2 size={14} /><strong>{chunk.path.split('/').at(-1)}</strong><ChevronRight size={12} /></span><small>L{chunk.startLine}–{chunk.endLine} · {chunk.tokens} tokens</small><em>{chunk.required ? '必须保留' : chunk.kind === 'symbol' ? '相关符号' : '相关上下文'}</em></button>)}</div><div className="context-chunk-detail">{selectedChunk ? <><div className="context-code-path"><span>{selectedChunk.path}</span><small>L{selectedChunk.startLine}–{selectedChunk.endLine}</small></div><div className="context-reasons">{selectedChunk.reasons.map((reason, index) => <span key={index}><Check size={11} />{explainReason(reason)}</span>)}</div><div className="context-code-lines">{selectedChunk.content.split('\n').map((line, index) => <div key={index}><span>{selectedChunk.startLine + index}</span><code>{line || ' '}</code></div>)}</div></> : <div className="context-empty"><p>没有选中的源码片段，请尝试写明具体函数或路径。</p></div>}</div></div> : tab === 'omitted' ? <div className="context-omissions"><p>未放入输出的内容及原因。原始文件始终保留在左侧，可随时固定或编辑。</p>{result.omitted.length ? result.omitted.map((item, index) => <div key={`${item.path}-${index}`}><FileCode2 size={15} /><span><strong>{item.path}</strong><small>{explainReason(item.reason)}</small></span></div>) : <div className="context-empty"><Check size={24} /><p>没有省略的文件。</p></div>}</div> : result.budgetExceeded ? <div className="context-empty"><CircleAlert size={26} /><strong>提高预算后生成完整 Prompt</strong><p>必要上下文不会被静默截断。</p></div> : <pre className="context-prompt">{result.prompt}</pre>}</div>
            <div className="context-output-footer"><span><LockKeyhole size={13} />按源码原文选取 · 不改写代码</span><button className="context-button context-secondary" disabled={!canExport} onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制 Prompt'}</button></div>
          </section>

          {result && result.warnings.length > 0 && <details className="context-warnings"><summary><CircleAlert size={14} />筛选说明与限制（{result.warnings.length}）</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          <div className="context-export-row"><p>复制到你已有的 AI 工具中使用。自动筛选不保证回答质量，请检查遗漏。</p><div><button disabled={!canExport} onClick={() => result && download(result.prompt, 'diffatlas-context.md', 'text/markdown;charset=utf-8')}><ArrowDownToLine size={14} />下载 Prompt</button><button disabled={!result || busy} onClick={() => result && download(JSON.stringify(result, null, 2), 'diffatlas-context-report.json', 'application/json')}><ArrowDownToLine size={14} />JSON 报告</button></div></div>

          <details className="context-source-editor"><summary><FileCode2 size={15} /><strong>查看 / 编辑源文件</strong><span>{source?.path}</span><ChevronRight size={14} /></summary><div className="context-source-toolbar"><label htmlFor="context-source-select">当前文件</label><select id="context-source-select" value={source?.path ?? ''} onChange={event => setSourcePath(event.target.value)}>{files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select><span>仅修改浏览器内副本</span></div><textarea aria-label={`源码编辑器 ${source?.path ?? ''}`} spellCheck={false} value={source?.content ?? ''} onChange={event => updateSource(event.target.value)} />{editError && <p className="context-edit-error" role="alert">{editError}</p>}</details>
        </div>
      </div>
      <footer className="context-page-footer"><span>DiffAtlas Context · 开源 AI 上下文工具</span><span>选择相关代码 → 检查省略 → 交给你的 AI</span></footer>
    </main>
  </div>;
}
