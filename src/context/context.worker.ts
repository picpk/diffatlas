import { packContext } from './engine';
import type { PackInput } from './types';

self.onmessage = (event: MessageEvent<{ id: number; input: PackInput }>) => {
  const { id, input } = event.data;
  try {
    const result = packContext(input);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '无法生成上下文，请检查输入。' });
  }
};
