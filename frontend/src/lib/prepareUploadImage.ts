const SAFE_UPLOAD_BYTES = 3_800_000;
const MAX_IMAGE_EDGE = 2048;

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('이미지를 압축하지 못했습니다')),
      'image/jpeg',
      quality,
    );
  });
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('PNG 이미지를 만들지 못했습니다')),
      'image/png',
    );
  });
}

export interface PreparedUploadImage {
  file: File;
  optimized: boolean;
}

export async function prepareUploadImage(file: File): Promise<PreparedUploadImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('PNG 또는 JPG 이미지만 등록할 수 있습니다');
  }
  if (file.size <= SAFE_UPLOAD_BYTES) return { file, optimized: false };

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const baseScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('이 브라우저에서 사진을 처리할 수 없습니다');

    const attempts = [
      { scale: baseScale, quality: 0.86 },
      { scale: baseScale * 0.85, quality: 0.76 },
      { scale: baseScale * 0.7, quality: 0.68 },
    ];

    let compressed: Blob | null = null;
    for (const attempt of attempts) {
      canvas.width = Math.max(1, Math.round(bitmap.width * attempt.scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * attempt.scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      compressed = await canvasBlob(canvas, attempt.quality);
      if (compressed.size <= SAFE_UPLOAD_BYTES) break;
    }

    if (!compressed || compressed.size > SAFE_UPLOAD_BYTES) {
      throw new Error('사진 용량을 줄이지 못했습니다. 카메라 해상도를 낮춰 다시 촬영해주세요');
    }
    const outputName = file.name.replace(/\.[^.]+$/, '') || 'peter';
    return {
      file: new File([compressed], `${outputName}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }),
      optimized: true,
    };
  } finally {
    bitmap.close();
  }
}

export async function prepareCharacterUploadImage(file: File): Promise<PreparedUploadImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('PNG 또는 JPG 이미지만 등록할 수 있습니다');
  }
  if (file.size <= SAFE_UPLOAD_BYTES) return { file, optimized: false };

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('이 브라우저에서 사진을 처리할 수 없습니다');
    const scales = [1, 0.82, 0.68, 0.54]
      .map((scale) => Math.min(scale, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)));
    let output: Blob | null = null;

    for (const scale of scales) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      output = await pngBlob(canvas);
      if (output.size <= SAFE_UPLOAD_BYTES) break;
    }

    if (!output || output.size > SAFE_UPLOAD_BYTES) {
      throw new Error('사진 용량을 줄이지 못했습니다. 카메라 해상도를 낮춰 다시 촬영해주세요');
    }
    const outputName = file.name.replace(/\.[^.]+$/, '') || 'peter';
    return {
      file: new File([output], `${outputName}.png`, {
        type: 'image/png',
        lastModified: Date.now(),
      }),
      optimized: true,
    };
  } finally {
    bitmap.close();
  }
}
