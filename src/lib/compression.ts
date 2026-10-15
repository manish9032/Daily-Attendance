import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker using CDN matching installed version or fallback
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;

export const MAX_LOCKER_FILE_BYTES = 200 * 1024; // Strictly 200 KB (204,800 bytes)

export interface CompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  mimeType: string;
  extension: 'jpg' | 'pdf';
  qualityUsed: number;
}

/**
 * Helper to load a File or Blob into an HTMLImageElement
 */
function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image file for compression.'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas compression failed.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

/**
 * Compresses any JPEG/PNG image strictly below 200 KB using iterative
 * resolution and quality scaling.
 */
export async function compressImageUnder200KB(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<CompressionResult> {
  onProgress?.(15, 'Decoding image dimensions...');
  const img = await loadImageFromFile(file);

  const scaleSteps = [1.0, 0.85, 0.72, 0.6, 0.48, 0.36, 0.25];
  const qualitySteps = [0.82, 0.7, 0.58, 0.46, 0.35, 0.25];

  const maxInitialDimension = 1800;
  const baseScale =
    Math.max(img.width, img.height) > maxInitialDimension
      ? maxInitialDimension / Math.max(img.width, img.height)
      : 1;

  let attempt = 0;
  const totalAttempts = scaleSteps.length * qualitySteps.length;

  for (const scaleFactor of scaleSteps) {
    const targetWidth = Math.max(240, Math.round(img.width * baseScale * scaleFactor));
    const targetHeight = Math.max(240, Math.round(img.height * baseScale * scaleFactor));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser 2D canvas context unavailable.');
    }

    // Fill white background for transparent PNGs converted to JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    for (const quality of qualitySteps) {
      attempt++;
      const progress = Math.min(90, 20 + Math.round((attempt / totalAttempts) * 70));
      onProgress?.(
        progress,
        `Optimizing JPEG (${targetWidth}×${targetHeight} @ ${Math.round(quality * 100)}%)...`
      );

      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (blob.size <= MAX_LOCKER_FILE_BYTES) {
        onProgress?.(100, `Compressed to ${(blob.size / 1024).toFixed(1)} KB`);
        return {
          blob,
          originalSize: file.size,
          compressedSize: blob.size,
          mimeType: 'image/jpeg',
          extension: 'jpg',
          qualityUsed: quality,
        };
      }
    }
  }

  throw new Error(
    'Unable to compress this image below the 200 KB limit. Please crop or try a simpler image.'
  );
}

/**
 * Compresses a PDF file under 200 KB.
 * - If the PDF is already <= 200 KB, preserves the original PDF binary.
 * - Otherwise renders pages to optimized JPEG canvases via PDF.js and
 *   rebuilds a compact PDF with jsPDF under 200 KB.
 */
export async function compressPdfUnder200KB(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<CompressionResult> {
  if (file.size <= MAX_LOCKER_FILE_BYTES) {
    onProgress?.(100, `PDF already optimized (${(file.size / 1024).toFixed(1)} KB)`);
    return {
      blob: file,
      originalSize: file.size,
      compressedSize: file.size,
      mimeType: 'application/pdf',
      extension: 'pdf',
      qualityUsed: 1,
    };
  }

  onProgress?.(15, 'Reading PDF pages...');
  const arrayBuffer = await file.arrayBuffer();

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
  } catch {
    throw new Error(
      'This PDF is over 200 KB and could not be parsed for page recompression. Please upload a smaller PDF or a JPEG scan of the document.'
    );
  }

  const numPages = pdfDoc.numPages;
  if (numPages > 8) {
    throw new Error(
      `This PDF has ${numPages} pages and cannot be reduced below 200 KB without losing legibility. Please upload only the relevant 1–5 pages.`
    );
  }

  const configs = [
    { scale: 1.15, quality: 0.62 },
    { scale: 0.95, quality: 0.5 },
    { scale: 0.8, quality: 0.4 },
    { scale: 0.65, quality: 0.32 },
    { scale: 0.52, quality: 0.25 },
  ];

  for (let cIdx = 0; cIdx < configs.length; cIdx++) {
    const { scale, quality } = configs[cIdx];
    const progress = 25 + Math.round(((cIdx + 1) / configs.length) * 65);
    onProgress?.(
      progress,
      `Compressing ${numPages} page(s) (pass ${cIdx + 1}/${configs.length})...`
    );

    const outPdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
      compress: true,
    });

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(200, Math.floor(viewport.width));
      canvas.height = Math.max(260, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (pageNum > 1) {
        outPdf.addPage('a4', 'portrait');
      }

      const pageWidth = outPdf.internal.pageSize.getWidth();
      const pageHeight = outPdf.internal.pageSize.getHeight();
      outPdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    }

    const pdfBlob = outPdf.output('blob');
    if (pdfBlob.size <= MAX_LOCKER_FILE_BYTES) {
      onProgress?.(100, `PDF compressed to ${(pdfBlob.size / 1024).toFixed(1)} KB`);
      return {
        blob: pdfBlob,
        originalSize: file.size,
        compressedSize: pdfBlob.size,
        mimeType: 'application/pdf',
        extension: 'pdf',
        qualityUsed: quality,
      };
    }
  }

  throw new Error(
    'Could not reduce this PDF under the strict 200 KB limit. Try uploading fewer pages or a single-page JPEG scan.'
  );
}

/**
 * Unified compression entry point for the Free Cloud Document Locker
 */
export async function compressDocumentForLocker(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<CompressionResult> {
  const mime = file.type.toLowerCase();
  if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return compressPdfUnder200KB(file, onProgress);
  }
  if (
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/png' ||
    mime === 'image/webp'
  ) {
    return compressImageUnder200KB(file, onProgress);
  }
  throw new Error('Only PDF and JPEG/PNG image files are supported in the Document Locker.');
}

export function formatBytesKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
