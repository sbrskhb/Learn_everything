import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  DailyPlanSlot,
  PdfDocumentMeta,
  PdfSplitPlanItem,
  PdfTocEntry,
} from '../types';
import {
  normalizePdfSplitRegionObjects,
  repairUnescapedLatexInJsonString,
  tryParseJsonWithLatexRepair,
} from './coursewareParser';
import { ensureStableSectionId } from './learningLogic';

type PdfLibModule = typeof import('pdf-lib');
let cachedPdfLib: PdfLibModule | null | undefined;

async function getPdfLib(): Promise<PdfLibModule | null> {
  if (cachedPdfLib !== undefined) return cachedPdfLib;
  try {
    const pkgName = 'pdf-lib';
    cachedPdfLib = (await import(pkgName)) as PdfLibModule;
    return cachedPdfLib;
  } catch {
    cachedPdfLib = null;
    return null;
  }
}

let cachedPdfJs: any | null | undefined;
async function getPdfJs(): Promise<any | null> {
  if (cachedPdfJs !== undefined) return cachedPdfJs;
  try {
    const modName = 'pdfjs-dist/legacy/build/pdf.mjs';
    cachedPdfJs = await import(modName);
    return cachedPdfJs;
  } catch {
    cachedPdfJs = null;
    return null;
  }
}

/**
 * Filter corrupted/control-character titles in embedded PDF Outlines (bookmarks).
 */
export function isCorruptedBookmarkTitle(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;

  const cjkMatches = trimmed.match(/[\u4e00-\u9fff]/g) || [];
  const totalNonSpace = trimmed.replace(/\s+/g, '').length;
  if (totalNonSpace === 0) return true;

  const badChars = (trimmed.match(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  if (badChars / totalNonSpace > 0.08) return true;

  const weirdSymbols = (trimmed.match(/[|\\~@{}`^]/g) || []).length;
  if (cjkMatches.length >= 4 && weirdSymbols / totalNonSpace < 0.15) {
    return false;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let gibberishTokenCount = 0;
  let realEnglishWordCount = 0;

  for (const tok of tokens) {
    const cleanTok = tok.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, '');
    if (!cleanTok) continue;
    if (/^(?:[A-Z]?[a-z]{2,}|[A-Z]{2,8})$/.test(cleanTok)) {
      realEnglishWordCount++;
      continue;
    }
    if (/^\d+(?:\.\d+)*$/.test(cleanTok)) {
      continue;
    }
    if (
      /[a-zA-Z0-9][,|\\~@{}_`^][a-zA-Z0-9]/.test(tok) ||
      (/[a-z][A-Z][a-z]/.test(cleanTok) && /[,|\\~@{}()[\]_]/.test(tok)) ||
      (weirdSymbols >= 2 && /[a-zA-Z]/.test(cleanTok))
    ) {
      gibberishTokenCount++;
    }
  }

  if (gibberishTokenCount > 0 && realEnglishWordCount <= gibberishTokenCount && cjkMatches.length < 3) {
    return true;
  }

  if (cjkMatches.length === 0 && realEnglishWordCount === 0 && weirdSymbols >= 1) {
    return true;
  }

  return false;
}

function buildMinimalPdfBufferFromPages(pageLines: string[]): Buffer {
  const safePages = pageLines.length > 0 ? pageLines : ['Empty Page'];
  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj(''); // 1
  const pagesId = addObj(''); // 2
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3

  const pageIds: number[] = [];
  for (let i = 0; i < safePages.length; i++) {
    const escapedText = safePages[i]
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r?\n/g, ' ');
    const streamContent = `BT /F1 12 Tf 50 760 Td (${escapedText}) Tj 0 -720 Td (Page ${i + 1}) Tj ET`;
    const contentId = addObj(
      `<< /Length ${Buffer.byteLength(streamContent, 'latin1')} >>\nstream\n${streamContent}\nendstream`
    );
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Resolve genuine PDF document bookmarks (Outlines) using pdfjs-dist into physical page TOC entries.
 */
async function extractBookmarksWithPdfJs(pdfDoc: any, maxPages: number): Promise<PdfTocEntry[]> {
  try {
    const outline = await pdfDoc.getOutline();
    if (!Array.isArray(outline) || outline.length === 0) return [];

    const results: PdfTocEntry[] = [];
    const resolveDestPage = async (dest: any): Promise<number | undefined> => {
      try {
        let destArray = dest;
        if (typeof dest === 'string') {
          destArray = await pdfDoc.getDestination(dest);
        }
        if (Array.isArray(destArray) && destArray[0]) {
          const pageIndex = await pdfDoc.getPageIndex(destArray[0]);
          if (typeof pageIndex === 'number' && pageIndex >= 0) {
            const p = pageIndex + 1;
            return p >= 1 && p <= maxPages ? p : undefined;
          }
        }
      } catch {
        // ignore unresolvable destination
      }
      return undefined;
    };

    const walk = async (items: any[], depth = 0) => {
      for (const item of items) {
        if (!item) continue;
        const title = String(item.title || '').replace(/\s+/g, ' ').trim();
        if (title && !isCorruptedBookmarkTitle(title)) {
          const physicalPage = item.dest ? await resolveDestPage(item.dest) : undefined;
          const prefix = depth > 0 ? '  '.repeat(Math.min(depth, 2)) : '';
          results.push({
            title: `${prefix}${title}`,
            physicalPage,
          });
        }
        if (results.length >= 160) return;
        if (Array.isArray(item.items) && item.items.length > 0 && depth < 2) {
          await walk(item.items, depth + 1);
        }
      }
    };

    await walk(outline, 0);
    return results.slice(0, 160);
  } catch {
    return [];
  }
}

/**
 * Inspect a PDF strictly for structural metadata (physical page count & embedded PDF bookmarks).
 * Does NOT run text extraction — multimodal models inspect PDF files directly.
 */
export async function analyzePdfBuffer(
  buffer: Buffer,
  fileName: string
): Promise<{
  fullText: string;
  meta: PdfDocumentMeta;
}> {
  let totalPages = 1;
  let bookmarkEntries: PdfTocEntry[] = [];

  const pdfjs = await getPdfJs();
  let pdfjsSucceeded = false;

  if (pdfjs && typeof pdfjs.getDocument === 'function') {
    try {
      const cMapDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps');
      const stdFontsDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');
      const copyBytes = new Uint8Array(buffer.byteLength);
      copyBytes.set(buffer);

      const loadOpts: Record<string, any> = {
        data: copyBytes,
        verbosity: 0,
        disableFontFace: true,
        isEvalSupported: false,
      };
      if (fs.existsSync(cMapDir)) {
        loadOpts.cMapUrl = `${pathToFileURL(cMapDir).href}/`;
        loadOpts.cMapPacked = true;
      }
      if (fs.existsSync(stdFontsDir)) {
        loadOpts.standardFontDataUrl = `${pathToFileURL(stdFontsDir).href}/`;
      }

      const loadingTask = pdfjs.getDocument(loadOpts);
      const pdfDoc = await loadingTask.promise;
      totalPages = Math.max(1, Number(pdfDoc.numPages) || 1);
      bookmarkEntries = await extractBookmarksWithPdfJs(pdfDoc, totalPages);
      pdfjsSucceeded = true;
      await pdfDoc.destroy?.();
    } catch {
      pdfjsSucceeded = false;
    }
  }

  if (!pdfjsSucceeded) {
    try {
      const pdfLib = await getPdfLib();
      if (pdfLib) {
        const pdfDoc = await pdfLib.PDFDocument.load(buffer, {
          ignoreEncryption: true,
          updateMetadata: false,
        });
        totalPages = Math.max(1, pdfDoc.getPageCount());
      } else {
        const rawLatin1 = buffer.toString('latin1');
        const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
        totalPages = pageMatches ? Math.max(1, pageMatches.length) : 1;
      }
    } catch {
      const rawLatin1 = buffer.toString('latin1');
      const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
      totalPages = pageMatches ? Math.max(1, pageMatches.length) : 1;
    }
  }

  const tocEntries = bookmarkEntries.filter(
    (b) => b.physicalPage === undefined || (b.physicalPage >= 1 && b.physicalPage <= totalPages)
  );

  return {
    fullText: '',
    meta: {
      fileName,
      totalPages,
      detectedPageOffset: 0,
      tocEntries,
      pages: [],
    },
  };
}

/**
 * Analyze a PDF stored on disk without requiring extra JSON/Base64 copies.
 */
export async function analyzePdfFile(
  filePath: string,
  fileName: string
): Promise<{
  fullText: string;
  meta: PdfDocumentMeta;
}> {
  const buf = fs.readFileSync(filePath);
  return analyzePdfBuffer(buf, fileName);
}

/**
 * Build an initial editable PDF region suggestion from embedded PDF bookmarks or page ranges.
 */
export function buildHeuristicPdfSplitPlan(params: {
  outline: DailyPlanSlot[];
  pdfMetas: PdfDocumentMeta[];
  globalPageOffset?: number;
  existingPlan?: PdfSplitPlanItem[];
}): PdfSplitPlanItem[] {
  const { outline, pdfMetas, globalPageOffset, existingPlan = [] } = params;

  const primaryPdf = pdfMetas[0] || {
    fileName: 'course_material.pdf',
    totalPages: Math.max((outline?.length || 5) * 5, 20),
    detectedPageOffset: 0,
    tocEntries: [],
    pages: [],
  };

  const totalPages = Math.max(1, primaryPdf.totalPages);
  const offset =
    globalPageOffset !== undefined ? globalPageOffset : primaryPdf.detectedPageOffset || 0;
  const contentStartPhysical = Math.min(totalPages, Math.max(1, 1 + Math.max(0, offset)));
  const usablePages = Math.max(1, totalPages - contentStartPhysical + 1);

  if (existingPlan.length > 0 && (!outline || outline.length === 0)) {
    return existingPlan;
  }

  if (!outline || outline.length === 0) {
    const cleanBookmarks = (primaryPdf.tocEntries || []).filter(
      (t) => t.title && !isCorruptedBookmarkTitle(t.title) && typeof t.physicalPage === 'number'
    );
    if (cleanBookmarks.length > 0) {
      const topBookmarks = cleanBookmarks.filter((b) => !b.title.startsWith('  ')).slice(0, 20);
      const chosen = topBookmarks.length > 0 ? topBookmarks : cleanBookmarks.slice(0, 20);
      return chosen.map((bm, idx) => {
        const regionId = `region-${String(idx + 1).padStart(2, '0')}`;
        const startP = Math.max(1, Math.min(totalPages, bm.physicalPage || 1));
        const nextBm = chosen[idx + 1];
        const endP = nextBm?.physicalPage
          ? Math.max(startP, Math.min(totalPages, nextBm.physicalPage - 1))
          : totalPages;
        return {
          sectionId: regionId,
          dayIndex: idx + 1,
          date: '',
          sectionTitle: bm.title.trim(),
          sourceFileName: primaryPdf.fileName,
          physicalStartPage: startP,
          physicalEndPage: endP,
          printedStartPage: Math.max(1, startP - offset),
          printedEndPage: Math.max(1, endP - offset),
          pageOffset: offset,
          crossRefPages: [],
          outlineMappingNote: `来自教材目录书签：${bm.title.trim()}`,
          segmentFileName: `${regionId}.pdf`,
          status: 'planned',
        };
      });
    }
    return [];
  }

  const n = outline.length;
  return outline.map((slot, idx) => {
    const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
    const existing = existingPlan.find(
      (p) => p.sectionId === slot.regionId || p.sectionId === sectionId || p.dayIndex === slot.dayIndex
    );

    if (existing) {
      const clampedStart = Math.max(1, Math.min(totalPages, existing.physicalStartPage || 1));
      const clampedEnd = Math.max(
        clampedStart,
        Math.min(totalPages, existing.physicalEndPage || clampedStart)
      );
      return {
        ...existing,
        sectionId: existing.sectionId || sectionId,
        dayIndex: existing.dayIndex || slot.dayIndex,
        date: existing.date || slot.date,
        sectionTitle: existing.sectionTitle || slot.title,
        sourceFileName: existing.sourceFileName || primaryPdf.fileName,
        physicalStartPage: clampedStart,
        physicalEndPage: clampedEnd,
        pageOffset: existing.pageOffset ?? offset,
      };
    }

    const relStart = Math.floor((idx * usablePages) / n);
    const relEnd = Math.max(relStart, Math.floor(((idx + 1) * usablePages) / n) - 1);
    const physicalStartPage = Math.min(totalPages, contentStartPhysical + relStart);
    const physicalEndPage = Math.min(totalPages, Math.max(physicalStartPage, contentStartPhysical + relEnd));
    const printedStartPage = Math.max(1, physicalStartPage - offset);
    const printedEndPage = Math.max(printedStartPage, physicalEndPage - offset);

    return {
      sectionId,
      dayIndex: slot.dayIndex,
      date: slot.date,
      sectionTitle: slot.title,
      sourceFileName: primaryPdf.fileName,
      physicalStartPage,
      physicalEndPage,
      printedStartPage,
      printedEndPage,
      pageOffset: offset,
      crossRefPages: idx > 0 && physicalStartPage > 1 ? [physicalStartPage - 1] : [],
      outlineMappingNote: `对应《${slot.title}》核心知识点：${(slot.keyTopics || []).join('、') || slot.objective}`,
      segmentFileName: `${sectionId}.pdf`,
      status: 'planned',
    };
  });
}

/**
 * Recalculate physical page numbers across a PDF split plan when adjusting page offset.
 */
export function applyPageOffsetToSplitPlan(
  splitPlan: PdfSplitPlanItem[],
  newPageOffset: number,
  maxPhysicalPages = 5000
): PdfSplitPlanItem[] {
  const safeOffset = Number(newPageOffset) || 0;
  return splitPlan.map((item) => {
    const printedStart =
      item.printedStartPage !== undefined
        ? item.printedStartPage
        : Math.max(1, item.physicalStartPage - (item.pageOffset || 0));
    const printedEnd =
      item.printedEndPage !== undefined
        ? item.printedEndPage
        : Math.max(printedStart, item.physicalEndPage - (item.pageOffset || 0));

    const physicalStartPage = Math.max(
      1,
      Math.min(maxPhysicalPages, printedStart + safeOffset)
    );
    const physicalEndPage = Math.max(
      physicalStartPage,
      Math.min(maxPhysicalPages, printedEnd + safeOffset)
    );

    return {
      ...item,
      printedStartPage: printedStart,
      printedEndPage: printedEnd,
      pageOffset: safeOffset,
      physicalStartPage,
      physicalEndPage,
    };
  });
}

/**
 * Parse and normalize a PDF Split Plan JSON imported via Chat Mode, Agent Mode, or LLM API.
 * Also reports whether the payload explicitly requested incremental merge (`incremental: true` / `regionsPatch`).
 */
export function parseImportedPdfSplitPayload(
  rawInput: string | object,
  outline: DailyPlanSlot[],
  defaultSourceFileName: string,
  totalPages = 2000,
  defaultOffset = 0
): {
  items: PdfSplitPlanItem[];
  isIncremental: boolean;
} {
  let parsed: any = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      throw new Error('切分方案内容为空，请粘贴 JSON 格式的 PDF 切分方案。');
    }
    parsed = tryParseJsonWithLatexRepair(trimmed);
    if (!parsed) {
      const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) {
        parsed = tryParseJsonWithLatexRepair(fenceMatch[1].trim());
        if (!parsed) {
          JSON.parse(repairUnescapedLatexInJsonString(fenceMatch[1].trim()));
        }
      } else {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        const firstBracket = trimmed.indexOf('[');
        const lastBracket = trimmed.lastIndexOf(']');
        if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
          const slice = trimmed.slice(firstBrace, lastBrace + 1);
          parsed = tryParseJsonWithLatexRepair(slice);
          if (!parsed) JSON.parse(repairUnescapedLatexInJsonString(slice));
        } else if (firstBracket !== -1 && lastBracket > firstBracket) {
          const slice = trimmed.slice(firstBracket, lastBracket + 1);
          parsed = tryParseJsonWithLatexRepair(slice);
          if (!parsed) JSON.parse(repairUnescapedLatexInJsonString(slice));
        } else {
          throw new Error('未能识别有效的 JSON 切分方案格式。');
        }
      }
    }
  }

  const isIncremental = Boolean(
    parsed &&
    !Array.isArray(parsed) &&
    (parsed.incremental === true ||
      parsed.patchMode === 'merge' ||
      Array.isArray(parsed.regionsPatch))
  );

  const rawItems: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.regionsPatch)
      ? parsed.regionsPatch
      : Array.isArray(parsed?.regions)
        ? parsed.regions
        : Array.isArray(parsed?.segments)
          ? parsed.segments
          : Array.isArray(parsed?.splitPlan)
            ? parsed.splitPlan
            : Array.isArray(parsed?.days)
              ? parsed.days
              : [];

  if (rawItems.length === 0) {
    throw new Error('切分方案中未包含有效的区域页码数组（regions、segments 或 splitPlan）。');
  }

  const globalOffset =
    typeof parsed?.pageOffset === 'number' ? parsed.pageOffset : defaultOffset;

  const isPlaceholderOutline =
    outline.length === 0 ||
    outline.every((s) => !s.title || s.title.includes('待第 2 步由 LLM 生成') || s.title.includes('待 LLM 生成'));

  const usesRegionIds = rawItems.some(
    (it) =>
      it &&
      (typeof it.regionId === 'string' ||
        (typeof it.sectionId === 'string' && it.sectionId.startsWith('region-')))
  );

  if (isPlaceholderOutline || usesRegionIds || isIncremental) {
    return {
      isIncremental,
      items: normalizePdfSplitRegionObjects(
        rawItems,
        defaultSourceFileName,
        totalPages,
        globalOffset
      ),
    };
  }

  const mapped = outline.map((slot, idx) => {
    const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
    const matched =
      rawItems.find(
        (it) =>
          it &&
          (it.sectionId === sectionId ||
            Boolean(slot.regionId && it.regionId === slot.regionId) ||
            Number(it.dayIndex) === slot.dayIndex ||
            Boolean(slot.title && it.sectionTitle === slot.title))
      ) ||
      rawItems[idx] ||
      rawItems[rawItems.length - 1];

    const itemOffset =
      typeof matched?.pageOffset === 'number' ? matched.pageOffset : globalOffset;

    let physicalStart = Number(matched?.physicalStartPage ?? matched?.startPage);
    let physicalEnd = Number(matched?.physicalEndPage ?? matched?.endPage);
    const printedStartRaw = matched?.printedStartPage ?? matched?.printStartPage;
    const printedEndRaw = matched?.printedEndPage ?? matched?.printEndPage;
    const printedStart = printedStartRaw !== undefined ? Number(printedStartRaw) : undefined;
    const printedEnd = printedEndRaw !== undefined ? Number(printedEndRaw) : undefined;

    if ((Number.isNaN(physicalStart) || physicalStart <= 0) && printedStart !== undefined) {
      physicalStart = printedStart + itemOffset;
    }
    if ((Number.isNaN(physicalEnd) || physicalEnd <= 0) && printedEnd !== undefined) {
      physicalEnd = printedEnd + itemOffset;
    }

    physicalStart = Math.max(1, Math.min(totalPages, physicalStart || 1));
    physicalEnd = Math.max(physicalStart, Math.min(totalPages, physicalEnd || physicalStart));

    const crossRefRaw = Array.isArray(matched?.crossRefPages)
      ? matched.crossRefPages
      : Array.isArray(matched?.additionalPages)
        ? matched.additionalPages
        : [];
    const crossRefPages = crossRefRaw
      .map(Number)
      .filter((n: number) => !Number.isNaN(n) && n >= 1 && n <= totalPages);

    const outSecId =
      typeof matched?.sectionId === 'string' && matched.sectionId.startsWith('region-')
        ? matched.sectionId
        : sectionId;

    return {
      sectionId: outSecId,
      dayIndex: slot.dayIndex,
      date: slot.date,
      sectionTitle: matched?.sectionTitle || matched?.title || slot.title,
      sourceFileName: matched?.sourceFileName || defaultSourceFileName,
      physicalStartPage: physicalStart,
      physicalEndPage: physicalEnd,
      printedStartPage: printedStart ?? Math.max(1, physicalStart - itemOffset),
      printedEndPage: printedEnd ?? Math.max(1, physicalEnd - itemOffset),
      pageOffset: itemOffset,
      crossRefPages,
      outlineMappingNote:
        matched?.outlineMappingNote ||
        matched?.rationale ||
        matched?.mappingNote ||
        `对应第 ${slot.dayIndex} 讲《${slot.title}》`,
      segmentFileName: `${outSecId}.pdf`,
      status: 'planned' as const,
    };
  });

  return {
    isIncremental,
    items: mapped,
  };
}

export function parseImportedPdfSplitPlan(
  rawInput: string | object,
  outline: DailyPlanSlot[],
  defaultSourceFileName: string,
  totalPages = 2000,
  defaultOffset = 0
): PdfSplitPlanItem[] {
  return parseImportedPdfSplitPayload(
    rawInput,
    outline,
    defaultSourceFileName,
    totalPages,
    defaultOffset
  ).items;
}

/**
 * Local PDF Processing Script Engine:
 * Slices the original PDF in `courses/<folder>/sources/` into lossless per-section PDFs in
 * `courses/<folder>/segments/<sectionId>.pdf` using `pdf-lib`.
 */
export async function executePdfSplitPlanOnDisk(params: {
  courseDir: string;
  courseRelDir: string;
  splitPlan: PdfSplitPlanItem[];
  targetSectionId?: string;
  outputDir?: string;
}): Promise<PdfSplitPlanItem[]> {
  const { courseDir, courseRelDir, splitPlan, targetSectionId, outputDir } = params;
  const sourcesDir = path.join(courseDir, 'sources');
  const courseSegmentsDir = path.join(courseDir, 'segments');
  const segmentsDir = outputDir || courseSegmentsDir;

  fs.mkdirSync(sourcesDir, { recursive: true });
  fs.mkdirSync(courseSegmentsDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  const pdfLib = await getPdfLib();

  const sourceFiles = fs.existsSync(sourcesDir)
    ? fs.readdirSync(sourcesDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
    : [];

  const docCache = new Map<
    string,
    { pdfDoc: any | null; totalPages: number }
  >();

  const loadSourcePdf = async (requestedName: string) => {
    let targetFile = requestedName;
    if (!fs.existsSync(path.join(sourcesDir, targetFile))) {
      const matched =
        sourceFiles.find((f) => f.toLowerCase() === requestedName.toLowerCase()) ||
        sourceFiles.find((f) => f.includes(requestedName)) ||
        sourceFiles[0];
      if (matched) targetFile = matched;
    }

    const absPath = path.join(sourcesDir, targetFile);
    if (!targetFile || !fs.existsSync(absPath)) {
      return null;
    }

    if (docCache.has(absPath)) {
      return { fileName: targetFile, ...docCache.get(absPath)! };
    }

    const buf = fs.readFileSync(absPath);
    const pdfDoc = pdfLib
      ? await pdfLib.PDFDocument.load(buf, { ignoreEncryption: true })
      : null;
    let totalPages = pdfDoc ? pdfDoc.getPageCount() : 1;

    const metaPath = `${absPath}.pages.json`;
    if (fs.existsSync(metaPath)) {
      try {
        const metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PdfDocumentMeta;
        if (metaObj.totalPages) totalPages = Math.max(totalPages, metaObj.totalPages);
      } catch {
        // ignore
      }
    } else if (!pdfDoc) {
      const analyzed = await analyzePdfBuffer(buf, targetFile);
      totalPages = Math.max(totalPages, analyzed.meta.totalPages);
    }

    const entry = { pdfDoc, totalPages };
    docCache.set(absPath, entry);
    return { fileName: targetFile, ...entry };
  };

  const updatedPlan: PdfSplitPlanItem[] = [];

  for (const item of splitPlan) {
    const sectionId = ensureStableSectionId(item.dayIndex, item.sectionId);
    if (targetSectionId && sectionId !== targetSectionId) {
      updatedPlan.push(item);
      continue;
    }

    try {
      const loaded = await loadSourcePdf(item.sourceFileName);
      if (!loaded) {
        updatedPlan.push({
          ...item,
          sectionId,
          status: 'error',
          errorMessage: `未在 sources/ 目录中找到原始 PDF 文件 (${item.sourceFileName})`,
        });
        continue;
      }

      const { pdfDoc, totalPages, fileName: resolvedSourceName } = loaded;
      const startPage = Math.max(1, Math.min(totalPages, Number(item.physicalStartPage) || 1));
      const endPage = Math.max(startPage, Math.min(totalPages, Number(item.physicalEndPage) || startPage));

      const orderedPhysicalPages: number[] = [];
      const seenPages = new Set<number>();

      if (Array.isArray(item.crossRefPages)) {
        for (const refP of item.crossRefPages) {
          const pNum = Math.max(1, Math.min(totalPages, Number(refP)));
          if (!Number.isNaN(pNum) && !seenPages.has(pNum)) {
            seenPages.add(pNum);
            orderedPhysicalPages.push(pNum);
          }
        }
      }

      for (let p = startPage; p <= endPage; p++) {
        if (!seenPages.has(p)) {
          seenPages.add(p);
          orderedPhysicalPages.push(p);
        }
      }

      const segmentFileName = `${sectionId}.pdf`;
      const absSegmentPdfPath = path.join(segmentsDir, segmentFileName);

      if (pdfLib && pdfDoc) {
        const subDoc = await pdfLib.PDFDocument.create();
        const zeroBasedIndices = orderedPhysicalPages.map((p) => p - 1);
        const copiedPages = await subDoc.copyPages(pdfDoc, zeroBasedIndices);
        for (const page of copiedPages) {
          subDoc.addPage(page);
        }
        const pdfBytes = await subDoc.save();
        fs.writeFileSync(absSegmentPdfPath, Buffer.from(pdfBytes));
      } else {
        const fallbackPages = orderedPhysicalPages.map(
          (pNum) => `Physical Page ${pNum}`
        );
        fs.writeFileSync(absSegmentPdfPath, buildMinimalPdfBufferFromPages(fallbackPages));
      }

      updatedPlan.push({
        ...item,
        sectionId,
        sourceFileName: resolvedSourceName,
        physicalStartPage: startPage,
        physicalEndPage: endPage,
        segmentFileName,
        segmentRelPath: `${courseRelDir}/segments/${segmentFileName}`,
        segmentPageCount: orderedPhysicalPages.length,
        extractedSegmentText: undefined,
        status: 'sliced',
        slicedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
    } catch (err: any) {
      updatedPlan.push({
        ...item,
        sectionId,
        status: 'error',
        errorMessage: err?.message || '切割小节 PDF 失败',
      });
    }
  }

  fs.writeFileSync(
    path.join(courseSegmentsDir, 'split-plan.json'),
    JSON.stringify(updatedPlan, null, 2),
    'utf-8'
  );

  return updatedPlan;
}

/**
 * Helper to create a valid multi-page PDF buffer (for testing & demos).
 */
export async function createMultiPagePdfBuffer(pageLines: string[]): Promise<Buffer> {
  const pdfLib = await getPdfLib();
  if (!pdfLib) {
    return buildMinimalPdfBufferFromPages(pageLines);
  }

  const pdfDoc = await pdfLib.PDFDocument.create();
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);

  for (let i = 0; i < pageLines.length; i++) {
    const page = pdfDoc.addPage([595, 842]);
    page.drawText(pageLines[i], {
      x: 50,
      y: 760,
      size: 13,
      font,
      color: pdfLib.rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`Page ${i + 1}`, {
      x: 270,
      y: 40,
      size: 10,
      font,
      color: pdfLib.rgb(0.3, 0.3, 0.3),
    });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
