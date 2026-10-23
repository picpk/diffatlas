export type TokenEncoding = 'o200k_base' | 'cl100k_base';
export interface SourceFile { path: string; content: string }
export interface PackInput {
  task: string;
  files: SourceFile[];
  budget: number;
  encoding?: TokenEncoding;
  diff?: string;
  pinnedPaths?: string[];
}
export interface ContextChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  kind: 'symbol' | 'file' | 'imports';
  symbols: string[];
  reasons: string[];
  required: boolean;
  tokens: number;
}
export interface OmittedFile { path: string; reason: string }
export interface PackResult {
  prompt: string;
  baselinePrompt: string;
  originalTokens: number;
  packedTokens: number;
  savedTokens: number;
  savingsPercent: number;
  budget: number;
  budgetExceeded: boolean;
  minimumRequiredTokens: number;
  encoding: TokenEncoding;
  chunks: ContextChunk[];
  omitted: OmittedFile[];
  warnings: string[];
  stats: { filesTotal: number; filesSelected: number; unitsTotal: number; unitsSelected: number };
}
