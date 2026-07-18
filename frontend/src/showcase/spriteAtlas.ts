const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 3;
const processedAtlases = new Map<string, Promise<PreparedSpriteAtlas>>();

export interface PreparedSpriteAtlas {
  url: string;
  cellAspect: number;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('AI 캐릭터 스프라이트를 불러오지 못했습니다'));
    image.src = source;
  });
}

function colorDistance(
  pixels: Uint8ClampedArray,
  offset: number,
  background: readonly [number, number, number],
) {
  const red = pixels[offset] - background[0];
  const green = pixels[offset + 1] - background[1];
  const blue = pixels[offset + 2] - background[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

function estimateBackground(
  pixels: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  const samples: Array<[number, number, number]> = [];
  const inset = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) * 0.018));
  const points = [
    [x0 + inset, y0 + inset],
    [x1 - inset - 1, y0 + inset],
    [x0 + inset, y1 - inset - 1],
    [x1 - inset - 1, y1 - inset - 1],
    [Math.round((x0 + x1) / 2), y0 + inset],
    [Math.round((x0 + x1) / 2), y1 - inset - 1],
  ];
  points.forEach(([x, y]) => {
    const offset = (y * width + x) * 4;
    samples.push([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
  });
  samples.sort((first, second) => (
    first[0] + first[1] + first[2] - second[0] - second[1] - second[2]
  ));
  const middle = samples.slice(1, -1);
  const divisor = Math.max(1, middle.length);
  return [
    Math.round(middle.reduce((sum, sample) => sum + sample[0], 0) / divisor),
    Math.round(middle.reduce((sum, sample) => sum + sample[1], 0) / divisor),
    Math.round(middle.reduce((sum, sample) => sum + sample[2], 0) / divisor),
  ];
}

function clearConnectedBackground(
  pixels: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const cellWidth = x1 - x0;
  const cellHeight = y1 - y0;
  const background = estimateBackground(pixels, width, x0, y0, x1, y1);
  const visited = new Uint8Array(cellWidth * cellHeight);
  const queue = new Int32Array(cellWidth * cellHeight);
  let head = 0;
  let tail = 0;

  const enqueue = (x: number, y: number) => {
    const localIndex = (y - y0) * cellWidth + (x - x0);
    if (visited[localIndex]) return;
    const offset = (y * width + x) * 4;
    if (colorDistance(pixels, offset, background) > 72) return;
    visited[localIndex] = 1;
    queue[tail] = localIndex;
    tail += 1;
  };

  for (let x = x0; x < x1; x += 1) {
    enqueue(x, y0);
    enqueue(x, y1 - 1);
  }
  for (let y = y0 + 1; y < y1 - 1; y += 1) {
    enqueue(x0, y);
    enqueue(x1 - 1, y);
  }

  while (head < tail) {
    const localIndex = queue[head];
    head += 1;
    const localX = localIndex % cellWidth;
    const localY = Math.floor(localIndex / cellWidth);
    const x = x0 + localX;
    const y = y0 + localY;
    const offset = (y * width + x) * 4;
    const distance = colorDistance(pixels, offset, background);
    pixels[offset + 3] = distance <= 38
      ? 0
      : Math.min(pixels[offset + 3], Math.round(((distance - 38) / 34) * 255));

    if (localX > 0) enqueue(x - 1, y);
    if (localX + 1 < cellWidth) enqueue(x + 1, y);
    if (localY > 0) enqueue(x, y - 1);
    if (localY + 1 < cellHeight) enqueue(x, y + 1);
  }
}

async function processAtlas(source: string) {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('AI 캐릭터 배경을 분리하지 못했습니다');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < ATLAS_ROWS; row += 1) {
    const y0 = Math.round((canvas.height * row) / ATLAS_ROWS);
    const y1 = Math.round((canvas.height * (row + 1)) / ATLAS_ROWS);
    for (let column = 0; column < ATLAS_COLUMNS; column += 1) {
      const x0 = Math.round((canvas.width * column) / ATLAS_COLUMNS);
      const x1 = Math.round((canvas.width * (column + 1)) / ATLAS_COLUMNS);
      clearConnectedBackground(imageData.data, canvas.width, x0, y0, x1, y1);
    }
  }

  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('AI 캐릭터를 준비하지 못했습니다')),
      'image/png',
    );
  });
  return {
    url: URL.createObjectURL(blob),
    cellAspect: (canvas.width / ATLAS_COLUMNS) / (canvas.height / ATLAS_ROWS),
  };
}

export function prepareSpriteAtlas(source: string) {
  if (!processedAtlases.has(source)) {
    processedAtlases.set(
      source,
      processAtlas(source).catch((error) => {
        console.warn('스프라이트 배경 제거에 실패해 원본을 사용합니다.', error);
        return { url: source, cellAspect: 1 };
      }),
    );
  }
  return processedAtlases.get(source) as Promise<PreparedSpriteAtlas>;
}
