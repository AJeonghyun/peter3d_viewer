import { toJpeg, toPng } from 'html-to-image';
import type { ExportFormat } from './types';

export interface ExportImageOptions {
  format: ExportFormat;
  width: number;
  height: number;
  quality?: number;
  filename: string;
}

async function waitForAssets(root: HTMLElement) {
  await document.fonts.ready;
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;
    await new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

export async function exportStageImage(
  root: HTMLElement,
  options: ExportImageOptions,
) {
  await waitForAssets(root);
  const bounds = root.getBoundingClientRect();
  const pixelRatio = Math.max(
    options.width / Math.max(1, bounds.width),
    options.height / Math.max(1, bounds.height),
  );
  const common = {
    cacheBust: true,
    pixelRatio,
    width: bounds.width,
    height: bounds.height,
    canvasWidth: options.width,
    canvasHeight: options.height,
    backgroundColor: '#dcebf4',
    filter: (node: HTMLElement) => node.dataset?.exportIgnore !== 'true',
  };
  const dataUrl = options.format === 'png'
    ? await toPng(root, common)
    : await toJpeg(root, { ...common, quality: options.quality ?? 0.92 });
  const link = document.createElement('a');
  link.download = options.filename;
  link.href = dataUrl;
  link.click();
}

export function defaultExportFilename(page: string, format: ExportFormat) {
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return `${date}-${page}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}
