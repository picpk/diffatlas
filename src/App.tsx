import { lazy, Suspense, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import ContextWorkspace from './ContextWorkspace';
import './context/context.css';

const ReviewWorkspace = lazy(() => import('./ReviewWorkspace'));

export default function App() {
  const [workspace, setWorkspace] = useState<'context' | 'review'>('context');
  if (workspace === 'review') return <>
    <nav className="context-return"><button onClick={() => setWorkspace('context')}><ArrowLeft size={15} /> 返回 Context 上下文工作台</button><span>原有功能 · 代码变更审查</span></nav>
    <Suspense fallback={<div className="context-loading">正在加载审查工作台…</div>}><ReviewWorkspace /></Suspense>
  </>;
  return <ContextWorkspace onOpenReview={() => setWorkspace('review')} />;
}
