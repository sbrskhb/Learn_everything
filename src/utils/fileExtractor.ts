import { UploadedMaterial } from '../types';

/**
 * Reads an uploaded File (.pdf, .txt, .md, .csv, .json) and returns an UploadedMaterial object.
 * For PDF files, sends the base64 buffer to the local server `/api/parse-pdf` for page count,
 * TOC detection, printed-vs-physical page offset analysis, and stream decompression,
 * and preserves `base64Data` so the course creation endpoint can save the original PDF intact
 * in `courses/<课程名称>/sources/`.
 */
export async function parseUploadedFile(file: File): Promise<UploadedMaterial> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    try {
      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, base64Data: base64 }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileSize: file.size,
          extractedText:
            (data.text && data.text.trim()) ||
            `[PDF 文档: ${file.name}, 大小 ${(file.size / 1024).toFixed(1)} KB]`,
          isPdf: true,
          totalPages: data.meta?.totalPages || 1,
          detectedPageOffset: data.meta?.detectedPageOffset || 0,
          tocEntries: data.meta?.tocEntries || [],
          pages: data.meta?.pages || [],
          base64Data: base64,
        };
      }
    } catch {
      // Fallback below
    }

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      fileSize: file.size,
      extractedText: `[PDF 文档: ${file.name}, 大小 ${(file.size / 1024).toFixed(1)} KB]`,
      isPdf: true,
      totalPages: 1,
      detectedPageOffset: 0,
      base64Data: base64,
    };
  }

  // Plain text / Markdown / CSV / JSON
  const text = await file.text();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    fileSize: file.size,
    extractedText: text.slice(0, 60000),
    isPdf: false,
  };
}
