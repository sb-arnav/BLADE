import { useState, useCallback } from "react";

/**
 * Image Tools — resize, crop, convert, compress images.
 * Uses Canvas API — no external dependencies.
 */

export interface ImageInfo {
  width: number;
  height: number;
  aspectRatio: string;
  size: number;
  type: string;
  name: string;
}

export interface ProcessedImage {
  id: string;
  originalName: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
  format: string;
  blobUrl: string;
  operations: string[];
  timestamp: number;
}

type ImageFormat = "png" | "jpeg" | "webp";

function getAspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
      `image/${format}`,
      quality,
    );
  });
}

async function resizeImage(
  src: string,
  maxWidth: number,
  maxHeight: number,
  format: ImageFormat = "png",
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  let { width, height } = img;

  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, format, quality);
  return { blob, width, height };
}

async function cropImage(
  src: string,
  x: number,
  y: number,
  cropWidth: number,
  cropHeight: number,
  format: ImageFormat = "png",
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const blob = await canvasToBlob(canvas, format, quality);
  return { blob, width: cropWidth, height: cropHeight };
}

async function rotateImage(
  src: string,
  degrees: number,
  format: ImageFormat = "png",
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = Math.round(img.width * cos + img.height * sin);
  const height = Math.round(img.width * sin + img.height * cos);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const blob = await canvasToBlob(canvas, format);
  return { blob, width, height };
}

async function flipImage(
  src: string,
  horizontal: boolean,
  format: ImageFormat = "png",
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;

  if (horizontal) {
    ctx.translate(img.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, img.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(img, 0, 0);

  const blob = await canvasToBlob(canvas, format);
  return { blob, width: img.width, height: img.height };
}

async function convertFormat(
  src: string,
  format: ImageFormat,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const blob = await canvasToBlob(canvas, format, quality);
  return { blob, width: img.width, height: img.height };
}

async function compressImage(
  src: string,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  return convertFormat(src, "jpeg", quality);
}

async function grayscale(
  src: string,
  format: ImageFormat = "png",
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i] = data[i + 1] = data[i + 2] = avg;
  }
  ctx.putImageData(imageData, 0, 0);

  const blob = await canvasToBlob(canvas, format);
  return { blob, width: img.width, height: img.height };
}

async function blur(
  src: string,
  radius: number,
  format: ImageFormat = "png",
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(img, 0, 0);

  const blob = await canvasToBlob(canvas, format);
  return { blob, width: img.width, height: img.height };
}

async function getImageInfo(file: File): Promise<ImageInfo> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  return {
    width: img.width,
    height: img.height,
    aspectRatio: getAspectRatio(img.width, img.height),
    size: file.size,
    type: file.type,
    name: file.name,
  };
}

export function useImageTools() {
  const [processed, setProcessed] = useState<ProcessedImage[]>([]);
  const [loading, setLoading] = useState(false);

  const processImage = useCallback(async (
    _src: string,
    originalName: string,
    originalSize: number,
    operation: string,
    processFn: () => Promise<{ blob: Blob; width: number; height: number }>,
  ): Promise<ProcessedImage | null> => {
    setLoading(true);
    try {
      const result = await processFn();
      const blobUrl = URL.createObjectURL(result.blob);
      const entry: ProcessedImage = {
        id: crypto.randomUUID(),
        originalName,
        originalSize,
        processedSize: result.blob.size,
        width: result.width,
        height: result.height,
        format: result.blob.type.split("/")[1] || "png",
        blobUrl,
        operations: [operation],
        timestamp: Date.now(),
      };
      setProcessed((prev) => [...prev, entry]);
      setLoading(false);
      return entry;
    } catch (e) {
      console.error("[Blade] Image processing failed:", e);
      setLoading(false);
      return null;
    }
  }, []);

  const resize = useCallback((src: string, name: string, size: number, maxW: number, maxH: number, fmt?: ImageFormat, q?: number) =>
    processImage(src, name, size, `resize ${maxW}x${maxH}`, () => resizeImage(src, maxW, maxH, fmt, q)), [processImage]);

  const crop = useCallback((src: string, name: string, size: number, x: number, y: number, w: number, h: number) =>
    processImage(src, name, size, `crop ${w}x${h}`, () => cropImage(src, x, y, w, h)), [processImage]);

  const rotate = useCallback((src: string, name: string, size: number, deg: number) =>
    processImage(src, name, size, `rotate ${deg}°`, () => rotateImage(src, deg)), [processImage]);

  const flip = useCallback((src: string, name: string, size: number, horizontal: boolean) =>
    processImage(src, name, size, horizontal ? "flip-h" : "flip-v", () => flipImage(src, horizontal)), [processImage]);

  const convert = useCallback((src: string, name: string, size: number, fmt: ImageFormat, q?: number) =>
    processImage(src, name, size, `convert to ${fmt}`, () => convertFormat(src, fmt, q)), [processImage]);

  const compress = useCallback((src: string, name: string, size: number, quality: number) =>
    processImage(src, name, size, `compress q=${quality}`, () => compressImage(src, quality)), [processImage]);

  const toGrayscale = useCallback((src: string, name: string, size: number) =>
    processImage(src, name, size, "grayscale", () => grayscale(src)), [processImage]);

  const applyBlur = useCallback((src: string, name: string, size: number, radius: number) =>
    processImage(src, name, size, `blur r=${radius}`, () => blur(src, radius)), [processImage]);

  const download = useCallback((id: string) => {
    const img = processed.find((p) => p.id === id);
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.blobUrl;
    a.download = `${img.originalName.replace(/\.[^.]+$/, "")}_processed.${img.format}`;
    a.click();
  }, [processed]);

  const clear = useCallback(() => {
    processed.forEach((p) => URL.revokeObjectURL(p.blobUrl));
    setProcessed([]);
  }, [processed]);

  return {
    processed,
    loading,
    resize,
    crop,
    rotate,
    flip,
    convert,
    compress,
    toGrayscale,
    applyBlur,
    download,
    clear,
    getImageInfo,
  };
}
