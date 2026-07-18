const TEMPLATE_MASK_URL = '/assets/showcase/peter-template.png';
const MAX_CHARACTER_HEIGHT = 1200;
const preparedImages = new Map<string, Promise<PreparedCharacterImage>>();

export interface PreparedCharacterImage {
  characterUrl: string;
  nicknameUrl: string | null;
}

interface Point {
  x: number;
  y: number;
}

interface MarkerDefinition {
  hue: number;
  xRange: readonly [number, number];
  yRange: readonly [number, number];
}

const CAPTURE_MARKERS: readonly MarkerDefinition[] = [
  { hue: 0, xRange: [0, 0.2], yRange: [0, 0.18] },
  { hue: 215, xRange: [0.8, 1], yRange: [0, 0.18] },
  { hue: 132, xRange: [0.8, 1], yRange: [0.82, 1] },
  { hue: 45, xRange: [0, 0.2], yRange: [0.82, 1] },
] as const;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`캐릭터 이미지를 불러오지 못했습니다: ${source}`));
    image.src = source;
  });
}

function hueDistance(first: number, second: number) {
  const distance = Math.abs(first - second);
  return Math.min(distance, 360 - distance);
}

function pixelHue(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue) / 255;
  const min = Math.min(red, green, blue) / 255;
  const delta = max - min;
  if (delta === 0 || max === 0) return { hue: 0, saturation: 0, value: max };
  let hue = 0;
  if (max === red / 255) hue = 60 * (((green - blue) / 255 / delta) % 6);
  else if (max === green / 255) hue = 60 * (((blue - red) / 255 / delta) + 2);
  else hue = 60 * (((red - green) / 255 / delta) + 4);
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: delta / max,
    value: max,
  };
}

function findCaptureMarker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  marker: MarkerDefinition,
) {
  const startX = Math.floor(width * marker.xRange[0]);
  const endX = Math.ceil(width * marker.xRange[1]);
  const startY = Math.floor(height * marker.yRange[0]);
  const endY = Math.ceil(height * marker.yRange[1]);
  let totalX = 0;
  let totalY = 0;
  let totalWeight = 0;
  let matches = 0;

  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < 120) continue;
      const color = pixelHue(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      const distance = hueDistance(color.hue, marker.hue);
      if (color.saturation < 0.42 || color.value < 0.28 || distance > 24) continue;
      const weight = color.saturation * color.value * (1 - distance / 32);
      totalX += x * weight;
      totalY += y * weight;
      totalWeight += weight;
      matches += 1;
    }
  }

  const requiredMatches = Math.max(12, Math.round((endX - startX) * (endY - startY) * 0.00025));
  if (matches < requiredMatches || totalWeight <= 0) return null;
  return { x: totalX / totalWeight, y: totalY / totalWeight };
}

function affineTransform(source: readonly Point[], target: readonly Point[]) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const denominator = s0.x * (s1.y - s2.y)
    + s1.x * (s2.y - s0.y)
    + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.001) return null;
  const matrixValue = (v0: number, v1: number, v2: number) => ({
    x: (
      v0 * (s1.y - s2.y)
      + v1 * (s2.y - s0.y)
      + v2 * (s0.y - s1.y)
    ) / denominator,
    y: (
      v0 * (s2.x - s1.x)
      + v1 * (s0.x - s2.x)
      + v2 * (s1.x - s0.x)
    ) / denominator,
    offset: (
      v0 * (s1.x * s2.y - s2.x * s1.y)
      + v1 * (s2.x * s0.y - s0.x * s2.y)
      + v2 * (s0.x * s1.y - s1.x * s0.y)
    ) / denominator,
  });
  const horizontal = matrixValue(t0.x, t1.x, t2.x);
  const vertical = matrixValue(t0.y, t1.y, t2.y);
  return {
    a: horizontal.x,
    b: vertical.x,
    c: horizontal.y,
    d: vertical.y,
    e: horizontal.offset,
    f: vertical.offset,
  };
}

function drawWarpTriangle(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  source: readonly [Point, Point, Point],
  target: readonly [Point, Point, Point],
) {
  const transform = affineTransform(source, target);
  if (!transform) return;
  context.save();
  context.beginPath();
  context.moveTo(target[0].x, target[0].y);
  context.lineTo(target[1].x, target[1].y);
  context.lineTo(target[2].x, target[2].y);
  context.closePath();
  context.clip();
  context.setTransform(
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f,
  );
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
}

function normalizeCapture(
  character: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
) {
  const detectionScale = Math.min(1, 1400 / Math.max(character.naturalWidth, character.naturalHeight));
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(character.naturalWidth * detectionScale));
  source.height = Math.max(1, Math.round(character.naturalHeight * detectionScale));
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('촬영판 기준점을 읽을 수 없습니다');
  sourceContext.drawImage(character, 0, 0, source.width, source.height);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const markers = CAPTURE_MARKERS.map((marker) => (
    findCaptureMarker(pixels, source.width, source.height, marker)
  ));

  const normalized = document.createElement('canvas');
  normalized.width = targetWidth;
  normalized.height = targetHeight;
  const context = normalized.getContext('2d');
  if (!context) throw new Error('캐릭터 사진을 정렬할 수 없습니다');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  if (markers.every((marker): marker is Point => marker !== null)) {
    const target: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: targetWidth, y: 0 },
      { x: targetWidth, y: targetHeight },
      { x: 0, y: targetHeight },
    ];
    drawWarpTriangle(context, source, [markers[0], markers[1], markers[2]], [target[0], target[1], target[2]]);
    drawWarpTriangle(context, source, [markers[0], markers[2], markers[3]], [target[0], target[2], target[3]]);
  } else {
    context.drawImage(character, 0, 0, targetWidth, targetHeight);
  }
  return normalized;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('캐릭터 이미지를 만들지 못했습니다')),
      'image/png',
    );
  });
}

function alphaBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (pixels[(y * width + x) * 4 + 3] < 20) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const padding = Math.max(6, Math.round(height * 0.008));
  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(width, maxX + padding) - Math.max(0, minX - padding),
    height: Math.min(height, maxY + padding) - Math.max(0, minY - padding),
  };
}

function nicknameHasArtwork(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const samplePoints = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ];
  const opaqueSamples = samplePoints
    .map(([x, y]) => {
      const offset = (y * width + x) * 4;
      return [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
      ];
    })
    .filter((sample) => sample[3] > 20);
  if (!opaqueSamples.length) {
    let opaquePixels = 0;
    for (let offset = 3; offset < pixels.length; offset += 16) {
      if (pixels[offset] > 20) opaquePixels += 1;
    }
    return opaquePixels / (pixels.length / 16) > 0.02;
  }

  const background = [0, 1, 2].map((channel) => (
    opaqueSamples.reduce((sum, sample) => sum + sample[channel], 0) / opaqueSamples.length
  ));
  let detailedPixels = 0;
  let opaquePixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 16) {
    if (pixels[offset + 3] <= 20) continue;
    opaquePixels += 1;
    const distance = Math.hypot(
      pixels[offset] - background[0],
      pixels[offset + 1] - background[1],
      pixels[offset + 2] - background[2],
    );
    if (distance > 42) detailedPixels += 1;
  }
  return opaquePixels > 0 && detailedPixels / opaquePixels > 0.008;
}

async function extractNickname(normalized: HTMLCanvasElement) {
  const sourceX = Math.round(normalized.width * 0.16);
  const sourceY = Math.round(normalized.height * 0.81);
  const sourceWidth = Math.round(normalized.width * 0.68);
  const sourceHeight = Math.round(normalized.height * 0.16);
  const nickname = document.createElement('canvas');
  nickname.width = sourceWidth;
  nickname.height = sourceHeight;
  const context = nickname.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    normalized,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
  return nicknameHasArtwork(pixels, sourceWidth, sourceHeight)
    ? URL.createObjectURL(await canvasBlob(nickname))
    : null;
}

async function buildMaskedCharacter(source: string) {
  const [character, mask] = await Promise.all([
    loadImage(source),
    loadImage(TEMPLATE_MASK_URL),
  ]);
  const scale = Math.min(1, MAX_CHARACTER_HEIGHT / mask.naturalHeight);
  const width = Math.max(1, Math.round(mask.naturalWidth * scale));
  const height = Math.max(1, Math.round(mask.naturalHeight * scale));
  const normalized = normalizeCapture(character, width, height);

  const working = document.createElement('canvas');
  working.width = width;
  working.height = height;
  const context = working.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 캐릭터 사진을 처리할 수 없습니다');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(normalized, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask, 0, 0, width, height);
  context.globalCompositeOperation = 'source-over';

  const bounds = alphaBounds(context.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) throw new Error('베드로 실루엣을 찾지 못했습니다');

  const cropped = document.createElement('canvas');
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  const croppedContext = cropped.getContext('2d');
  if (!croppedContext) throw new Error('캐릭터 사진을 자를 수 없습니다');
  croppedContext.drawImage(
    working,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  const [characterUrl, nicknameUrl] = await Promise.all([
    canvasBlob(cropped).then((blob) => URL.createObjectURL(blob)),
    extractNickname(normalized),
  ]);
  return { characterUrl, nicknameUrl };
}

export function prepareCharacterImage(source: string) {
  const cached = preparedImages.get(source);
  if (cached) return cached;
  const prepared = buildMaskedCharacter(source).catch((error) => {
    console.warn('고정 베드로 마스크를 적용하지 못해 원본 이미지를 사용합니다.', error);
    return { characterUrl: source, nicknameUrl: null };
  });
  preparedImages.set(source, prepared);
  return prepared;
}
