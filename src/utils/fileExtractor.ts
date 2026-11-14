import type { PdfTocEntry, UploadedMaterial } from '../types';

const PDF_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB raw binary chunks

/**
 * Safely parse JSON from fetch Response without crashing with
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` if a server/proxy returns HTML or text errors.
 */
export async function readApiJson<T = any>(res: Response): Promise<T> {
  const rawText = await res.text();
  let parsed: any = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const snippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 140);
      if (res.status === 413) {
        throw new Error('上传数据超出单次请求体积限制（HTTP 413），已自动拦截 HTML 响应，请检查分块上传或减小附加文件体积。');
      }
      throw new Error(
        `服务端返回了非 JSON 响应 (HTTP ${res.status}): ${snippet || '空响应'}`
      );
    }
  }
  if (!res.ok) {
    throw new Error(
      parsed?.error || parsed?.message || `请求失败 (HTTP ${res.status})`
    );
  }
  return (parsed ?? {}) as T;
}

export interface UploadMaterialOptions {
  onProgress?: (percent: number, message: string) => void;
}

/**
 * Uploads and registers an input File (.pdf, .txt, .md, .csv, .json).
 * For PDF files: streams raw binary in 4 MB chunks to `/api/uploads/pdf-chunk`,
 * avoiding Base64 JSON bloat and HTTP 413 limits even for 100MB+ textbooks,
 * while computing true physical page count & embedded bookmarks on the server.
 */
export async function parseUploadedFile(
  file: File,
  options: UploadMaterialOptions = {}
): Promise<UploadedMaterial> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const { onProgress } = options;

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const uploadId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const totalChunks = Math.max(1, Math.ceil(file.size / PDF_CHUNK_BYTES));

    let finalResponse: {
      tempUploadId: string;
      fileName: string;
      fileSize: number;
      meta: {
        totalPages: number;
        detectedPageOffset: number;
        tocEntries: PdfTocEntry[];
      };
    } | null = null;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * PDF_CHUNK_BYTES;
      const end = Math.min(file.size, start + PDF_CHUNK_BYTES);
      const chunkSlice = file.slice(start, end);
      const chunkBuffer = await chunkSlice.arrayBuffer();

      const uploadPct = Math.round(((chunkIndex + 0.5) / totalChunks) * 85);
      onProgress?.(
        uploadPct,
        totalChunks > 1
          ? `正在分块上传 ${file.name} (${chunkIndex + 1}/${totalChunks})...`
          : `正在上传 ${file.name}...`
      );

      const url = `/api/uploads/pdf-chunk?uploadId=${encodeURIComponent(
        uploadId
      )}&fileName=${encodeURIComponent(file.name)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: chunkBuffer,
      });

      const data = await readApiJson<any>(res);
      if (chunkIndex === totalChunks - 1) {
        onProgress?.(95, `正在读取 ${file.name} 物理页数与内嵌书签...`);
        finalResponse = data;
      }
    }

    if (!finalResponse?.meta?.totalPages) {
      throw new Error(`上传 ${file.name} 完成但未能读取 PDF 物理页数，请检查文件是否损坏。`);
    }

    onProgress?.(100, `已就绪 (${finalResponse.meta.totalPages} 物理页)`);

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      fileSize: file.size,
      extractedText: '',
      isPdf: true,
      totalPages: finalResponse.meta.totalPages,
      detectedPageOffset: 0,
      tocEntries: finalResponse.meta.tocEntries || [],
      pages: [],
      tempUploadId: finalResponse.tempUploadId || uploadId,
    };
  }

  // Plain text / Markdown / CSV / JSON
  onProgress?.(50, `正在读取文本文件 ${file.name}...`);
  const text = await file.text();
  onProgress?.(100, `已读取 ${file.name}`);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    fileSize: file.size,
    extractedText: text.slice(0, 60000),
    isPdf: false,
  };
}
