export type Severity = 'high' | 'medium' | 'low';
export interface DiffLine {
  kind: 'context' | 'addition' | 'deletion';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}
export interface DiffFile {
  path: string;
  oldPath: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  isBinary: boolean;
}
export interface ParsedDiff {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  warnings: string[];
}
export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  file: string;
  line: number;
  evidence: string;
  explanation: string;
  suggestion: string;
}
export interface Review {
  summary: string;
  findings: Finding[];
  testPlan: string[];
  mode: 'demo' | 'ai';
  model?: string;
  discardedFindings: number;
}
