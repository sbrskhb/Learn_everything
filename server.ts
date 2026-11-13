import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  Course,
  CourseCategory,
  CourseGenerationMode,
  DailyLessonContent,
  DailyPlanSlot,
  EnglishArticleMode,
  KnowledgeCatalogNode,
  LearnerLevel,
  PdfDocumentMeta,
  PdfSplitPlanItem,
  PromptModuleToggles,
  SubjectProfile,
  UploadedMaterial,
  VocabItem,
} from './src/types';
import {
  addDaysToDateString,
  allocateEnglishWordsRandomly,
  computeVocabCoverageStats,
  ensureStableSectionId,
  getTodayDateString,
  sanitizeCourseFolderName,
} from './src/utils/learningLogic';
import {
  parseImportedLessonContent,
  parseImportedSyllabusContent,
  resolveLessonAssetReferences,
  sanitizeLessonCitations,
  stripAiCitationArtifacts,
} from './src/utils/coursewareParser';
import {
  analyzePdfBuffer,
  applyPageOffsetToSplitPlan,
  buildHeuristicPdfSplitPlan,
  createMultiPagePdfBuffer,
  executePdfSplitPlanOnDisk,
  parseImportedPdfSplitPlan,
} from './src/utils/pdfProcessor';
import {
  DEFAULT_PROMPT_MODULE_TOGGLES,
  buildAgentExecutionPrompt,
  buildAgentSyllabusPrompt,
  buildChatLessonPrompt,
  buildChatSyllabusPrompt,
  buildCourseLessonUserPrompt,
  buildEnglishLessonUserPrompt,
  buildPdfSplitPrompts,
  buildSyllabusUserPrompt,
  composeCoursewareSystemPrompt,
  getDefaultPromptsFromSkill,
  getPromptPresetsFromSkill,
  inferSubjectProfile,
} from './src/prompts/promptLibrary';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const PYTHON_BACKEND_PORT = Number(process.env.PYTHON_BACKEND_PORT) || 3001;
const PYTHON_BACKEND_URL =
  (process.env.PYTHON_BACKEND_URL || `http://127.0.0.1:${PYTHON_BACKEND_PORT}`).replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const COURSES_ROOT = path.resolve(process.cwd(), 'courses');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(COURSES_ROOT)) {
  fs.mkdirSync(COURSES_ROOT, { recursive: true });
}

let managedPythonProcess: ChildProcess | null = null;

async function isPythonBackendHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/py/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getVenvDir(): string {
  return path.resolve(process.cwd(), '.venv');
}

function getVenvPythonPath(): string {
  const venvDir = getVenvDir();
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function getVenvBinDir(): string {
  const venvDir = getVenvDir();
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts')
    : path.join(venvDir, 'bin');
}

function ensurePythonVenv(): string | null {
  const venvDir = getVenvDir();
  const venvPython = getVenvPythonPath();
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const baseArgs = cmd === 'py' ? ['-3'] : [];
    const check = spawnSync(cmd, [...baseArgs, '-c', 'import sys, venv; assert sys.version_info >= (3, 8)'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 5000,
    });
    if (check.status !== 0) continue;

    // 1. Try creating standard venv (includes pip on Windows/macOS/full Python)
    const createFull = spawnSync(cmd, [...baseArgs, '-m', 'venv', venvDir], {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 20000,
    });
    if (createFull.status === 0 && fs.existsSync(venvPython)) {
      console.log(`[python-backend] Created Python virtual environment at ${venvDir}`);
      return venvPython;
    }

    // 2. Fallback to --without-pip when ensurepip is unavailable (e.g. minimal Debian/Ubuntu)
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
    const createMinimal = spawnSync(cmd, [...baseArgs, '-m', 'venv', '--without-pip', venvDir], {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 15000,
    });
    if (createMinimal.status === 0 && fs.existsSync(venvPython)) {
      console.log(`[python-backend] Created minimal Python virtual environment at ${venvDir}`);
      return venvPython;
    }
  }
  return null;
}

async function ensurePythonBackend(): Promise<boolean> {
  if (await isPythonBackendHealthy()) {
    console.log(`[python-backend] Connected to existing Python backend at ${PYTHON_BACKEND_URL}`);
    return true;
  }

  const pyScript = path.resolve(process.cwd(), 'backend', 'server.py');
  if (!fs.existsSync(pyScript)) {
    console.warn(`[python-backend] Missing ${pyScript}`);
    return false;
  }

  const venvPython = ensurePythonVenv();
  const candidates: Array<{ cmd: string; args: string[]; inVenv: boolean }> = [];
  if (venvPython) {
    candidates.push({ cmd: venvPython, args: [pyScript], inVenv: true });
  }
  const sysCandidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of sysCandidates) {
    candidates.push({ cmd, args: cmd === 'py' ? ['-3', pyScript] : [pyScript], inVenv: false });
  }

  for (const candidate of candidates) {
    try {
      const envObj: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHON_BACKEND_PORT: String(PYTHON_BACKEND_PORT),
        PYTHON_BACKEND_HOST: '127.0.0.1',
        LEARN_EVERYTHING_ROOT: process.cwd(),
        PYTHONIOENCODING: 'utf-8',
      };
      if (candidate.inVenv) {
        envObj.VIRTUAL_ENV = getVenvDir();
        envObj.PATH = `${getVenvBinDir()}${path.delimiter}${process.env.PATH || ''}`;
      }

      const child = spawn(candidate.cmd, candidate.args, {
        cwd: process.cwd(),
        env: envObj,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let spawnFailed = false;
      child.on('error', () => {
        spawnFailed = true;
      });
      child.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
      });

      for (let attempt = 0; attempt < 15; attempt++) {
        if (spawnFailed) break;
        await new Promise((r) => setTimeout(r, 150));
        if (await isPythonBackendHealthy()) {
          managedPythonProcess = child;
          const cleanup = () => {
            if (managedPythonProcess && !managedPythonProcess.killed) {
              managedPythonProcess.kill();
            }
          };
          process.once('SIGINT', cleanup);
          process.once('SIGTERM', cleanup);
          return true;
        }
      }
      if (!child.killed) {
        child.kill();
      }
    } catch {
      // Try next Python executable candidate
    }
  }

  console.warn('[python-backend] Failed to start Python backend automatically.');
  return false;
}

async function callPythonJson<T = any>(
  pyPath: string,
  options: { method?: string; body?: any } = {}
): Promise<{ status: number; data: T }> {
  await ensurePythonBackendReady();
  const res = await fetch(`${PYTHON_BACKEND_URL}${pyPath}`, {
    method: options.method || 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

let pyReadyPromise: Promise<boolean> | null = null;
function ensurePythonBackendReady(): Promise<boolean> {
  if (!pyReadyPromise) {
    pyReadyPromise = ensurePythonBackend().then((ok) => {
      if (!ok) pyReadyPromise = null;
      return ok;
    });
  }
  return pyReadyPromise;
}

interface StoredSettings {
  providerMode: 'builtin_gemini' | 'openai_compatible';
  apiBaseUrl: string;
  modelName: string;
  customApiKey: string;
  defaultLearnerLevel: LearnerLevel;
  showAdvancedWorkflowDetails: boolean;
  promptModules: PromptModuleToggles;
  syllabusSystemPrompt: string;
  courseSystemPrompt: string;
  englishSystemPrompt: string;
  customTeachingSupplement: string;
}

function loadSettings(): StoredSettings {
  const skillDefaults = getDefaultPromptsFromSkill();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      const isUpgradedPrompt =
        typeof raw.courseSystemPrompt === 'string' &&
        raw.courseSystemPrompt.includes('{{heuristic:hq-1}}');
      return {
        providerMode: raw.providerMode || 'builtin_gemini',
        apiBaseUrl: raw.apiBaseUrl || 'https://api.openai.com/v1',
        modelName: raw.modelName || 'gemini-3.8-flash',
        customApiKey: raw.customApiKey || '',
        defaultLearnerLevel: raw.defaultLearnerLevel || 'intermediate',
        showAdvancedWorkflowDetails: Boolean(raw.showAdvancedWorkflowDetails),
        promptModules: {
          ...DEFAULT_PROMPT_MODULE_TOGGLES,
          ...(raw.promptModules || {}),
        },
        syllabusSystemPrompt: isUpgradedPrompt
          ? raw.syllabusSystemPrompt || skillDefaults.syllabusSystemPrompt
          : skillDefaults.syllabusSystemPrompt,
        courseSystemPrompt: isUpgradedPrompt
          ? raw.courseSystemPrompt || skillDefaults.courseSystemPrompt
          : skillDefaults.courseSystemPrompt,
        englishSystemPrompt: isUpgradedPrompt
          ? raw.englishSystemPrompt || skillDefaults.englishSystemPrompt
          : skillDefaults.englishSystemPrompt,
        customTeachingSupplement: raw.customTeachingSupplement || '',
      };
    }
  } catch (err) {
    console.error('Failed to read settings.json:', err);
  }
  return {
    providerMode: 'builtin_gemini',
    apiBaseUrl: 'https://api.openai.com/v1',
    modelName: 'gemini-3.8-flash',
    customApiKey: '',
    defaultLearnerLevel: 'intermediate',
    showAdvancedWorkflowDetails: false,
    promptModules: { ...DEFAULT_PROMPT_MODULE_TOGGLES },
    syllabusSystemPrompt: skillDefaults.syllabusSystemPrompt,
    courseSystemPrompt: skillDefaults.courseSystemPrompt,
    englishSystemPrompt: skillDefaults.englishSystemPrompt,
    customTeachingSupplement: '',
  };
}

function saveSettings(settings: StoredSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

function getEffectiveTeachingSystemPrompt(course: Course, settings: StoredSettings): string {
  if (course.category === 'english') {
    return settings.englishSystemPrompt;
  }
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const resolvedLevel = course.learnerLevel || settings.defaultLearnerLevel || 'intermediate';
  const defaultPrompts = getDefaultPromptsFromSkill();

  if (
    settings.courseSystemPrompt &&
    settings.courseSystemPrompt.trim() &&
    settings.courseSystemPrompt.trim() !== defaultPrompts.courseSystemPrompt.trim() &&
    !settings.courseSystemPrompt.includes('```text')
  ) {
    return [
      settings.courseSystemPrompt.trim(),
      settings.customTeachingSupplement ? `【补充要求】\n${settings.customTeachingSupplement}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return composeCoursewareSystemPrompt({
    subjectProfile: resolvedProfile,
    learnerLevel: resolvedLevel,
    modules: settings.promptModules,
    customSupplement: [settings.customTeachingSupplement, course.extraRequirements]
      .filter(Boolean)
      .join('\n'),
  });
}

/**
 * Resolve the absolute directory path for a course under `courses/<课程名称>/`.
 */
function getCourseDirectory(course: Course): {
  folderName: string;
  absCourseDir: string;
  relCourseDir: string;
} {
  let folderName = course.folderName;
  if (!folderName) {
    const existingDirs = fs.existsSync(COURSES_ROOT)
      ? fs.readdirSync(COURSES_ROOT).filter((d) => {
          try {
            const cJson = path.join(COURSES_ROOT, d, 'course.json');
            if (fs.existsSync(cJson)) {
              const parsed = JSON.parse(fs.readFileSync(cJson, 'utf-8'));
              if (parsed.id === course.id) return false;
            }
          } catch {
            // ignore
          }
          return true;
        })
      : [];
    folderName = sanitizeCourseFolderName(course.name, existingDirs);
    course.folderName = folderName;
  }
  const absCourseDir = path.join(COURSES_ROOT, folderName);
  const relCourseDir = `courses/${folderName}`;
  course.courseDirPath = relCourseDir;
  course.agentWorkspacePath = relCourseDir;
  return { folderName, absCourseDir, relCourseDir };
}

/**
 * Resolve the PDF region/segment bound to an outline slot via regionId, slot id, or dayIndex.
 */
function resolveSlotPdfSegment(
  slot: Pick<DailyPlanSlot, 'id' | 'dayIndex' | 'regionId' | 'pdfSegment'>,
  splitPlan?: PdfSplitPlanItem[]
): PdfSplitPlanItem | undefined {
  if (!splitPlan || splitPlan.length === 0) return slot.pdfSegment;
  if (slot.regionId) {
    const byRegion = splitPlan.find((p) => p.sectionId === slot.regionId);
    if (byRegion) return byRegion;
  }
  const bySectionId = splitPlan.find((p) => p.sectionId === slot.id);
  if (bySectionId) return bySectionId;
  const byDayIndex = splitPlan.find((p) => p.dayIndex === slot.dayIndex);
  if (byDayIndex) return byDayIndex;
  return slot.pdfSegment;
}

/**
 * Read PDF metadata objects (`sources/<fileName>.pages.json`) for a course.
 */
function loadCoursePdfMetas(course: Course): PdfDocumentMeta[] {
  const { absCourseDir } = getCourseDirectory(course);
  const sourcesDir = path.join(absCourseDir, 'sources');
  const metas: PdfDocumentMeta[] = [];

  if (fs.existsSync(sourcesDir)) {
    const files = fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.pages.json'));
    for (const f of files) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(sourcesDir, f), 'utf-8')) as PdfDocumentMeta;
        if (meta && meta.fileName) {
          metas.push(meta);
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback from course.materials if not yet on disk
  for (const m of course.materials || []) {
    if (m.isPdf && !metas.some((mt) => mt.fileName === m.fileName)) {
      metas.push({
        fileName: m.fileName,
        totalPages: m.totalPages || 1,
        detectedPageOffset: m.detectedPageOffset || 0,
        tocEntries: m.tocEntries || [],
        pages: m.pages || [],
      });
    }
  }

  return metas;
}

/**
 * Persist a Course into its independent local folder:
 * courses/<课程名称>/
 *   ├── course.json    # 课程配置、目标、期限、英语配置、练习记录等
 *   ├── outline.json   # 完整课程目录及日期安排（含稳定小节 ID、PDF 切分映射、每日词汇）
 *   ├── sources/       # 原始 PDF、词库等资料
 *   ├── segments/      # 按小节切分的 PDF 及 split-plan.json
 *   ├── lessons/       # 已生成课件（按小节 ID 保存：sec-01.json）
 *   └── assets/        # 图片及其他资源
 */
async function persistCourseToFolder(
  course: Course,
  settings: StoredSettings
): Promise<{
  workspaceRelPath: string;
  materialFilePaths: string[];
  agentPrompt: string;
}> {
  const { absCourseDir, relCourseDir } = getCourseDirectory(course);
  const sourcesDir = path.join(absCourseDir, 'sources');
  const segmentsDir = path.join(absCourseDir, 'segments');
  const lessonsDir = path.join(absCourseDir, 'lessons');
  const assetsDir = path.join(absCourseDir, 'assets');

  fs.mkdirSync(sourcesDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });
  fs.mkdirSync(lessonsDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  // Ensure every slot has a stable unique sectionId
  course.dailyPlan.forEach((slot) => {
    slot.id = ensureStableSectionId(slot.dayIndex, slot.id);
    if (slot.lesson) {
      slot.lesson.sectionId = slot.id;
    }
  });

  // 1. Save uploaded materials into `sources/`
  const materialFilePaths: string[] = [];
  for (let idx = 0; idx < course.materials.length; idx++) {
    const m = course.materials[idx];
    const safeFileName = m.fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const isPdf = Boolean(m.isPdf || safeFileName.toLowerCase().endsWith('.pdf'));
    const absSourceFile = path.join(sourcesDir, safeFileName);
    const relSourceFile = `${relCourseDir}/sources/${safeFileName}`;
    m.sourceRelPath = relSourceFile;

    if (m.base64Data) {
      const rawBuf = Buffer.from(m.base64Data, 'base64');
      fs.writeFileSync(absSourceFile, rawBuf);
      if (isPdf) {
        try {
          const analyzed = await analyzePdfBuffer(rawBuf, safeFileName);
          m.totalPages = analyzed.meta.totalPages;
          m.detectedPageOffset = analyzed.meta.detectedPageOffset;
          m.tocEntries = analyzed.meta.tocEntries;
          m.pages = analyzed.meta.pages;
          fs.writeFileSync(
            `${absSourceFile}.pages.json`,
            JSON.stringify(analyzed.meta, null, 2),
            'utf-8'
          );
        } catch {
          // ignore
        }
      }
      // Clear transient base64Data after writing to sources/
      delete m.base64Data;
    } else if (!fs.existsSync(absSourceFile)) {
      if (isPdf) {
        // Create a valid multi-page PDF from extractedText lines if raw binary wasn't attached
        const lines = (m.extractedText || safeFileName)
          .split(/\r?\n/)
          .filter(Boolean);
        const pageChunks = lines.length > 0 ? lines.slice(0, Math.max(3, m.totalPages || 6)) : [safeFileName];
        const fallbackPdfBuf = await createMultiPagePdfBuffer(
          pageChunks.map((l, i) => `Page ${i + 1}: ${l.replace(/[^\x20-\x7E]/g, ' ')}`)
        );
        fs.writeFileSync(absSourceFile, fallbackPdfBuf);
      } else {
        fs.writeFileSync(absSourceFile, m.extractedText || '', 'utf-8');
      }
    }

    // Save plain text companion only for non-PDF, non-.txt files (never write PDF OCR .txt dumps)
    if (!isPdf && !safeFileName.toLowerCase().endsWith('.txt')) {
      const txtCompanion = path.join(sourcesDir, `${safeFileName}.txt`);
      if (m.extractedText && !fs.existsSync(txtCompanion)) {
        fs.writeFileSync(txtCompanion, m.extractedText, 'utf-8');
      }
    }

    materialFilePaths.push(relSourceFile);
  }

  // Save English vocabulary banks in `sources/` if applicable
  if (course.category === 'english' && course.englishConfig) {
    const vocabSourcePath = path.join(sourcesDir, 'vocabulary-effective.json');
    fs.writeFileSync(
      vocabSourcePath,
      JSON.stringify(
        {
          targetBankName: course.englishConfig.targetBankName,
          excludedBankName: course.englishConfig.excludedBankName,
          dailyWordCount: course.englishConfig.dailyWordCount || 20,
          effectiveWords: course.englishConfig.effectiveWords,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  // 2. Save `segments/split-plan.json` if present
  if (course.pdfSplitPlan && course.pdfSplitPlan.length > 0) {
    for (const slot of course.dailyPlan) {
      const seg = resolveSlotPdfSegment(slot, course.pdfSplitPlan);
      if (seg) {
        slot.pdfSegment = seg;
        if (!slot.regionId) {
          slot.regionId = seg.sectionId;
        }
      }
    }
    fs.writeFileSync(
      path.join(segmentsDir, 'split-plan.json'),
      JSON.stringify(course.pdfSplitPlan, null, 2),
      'utf-8'
    );
  }

  // 3. Save `outline.json` (Course Outline separated from lesson contents!)
  const outlineData = {
    courseId: course.id,
    courseName: course.name,
    startDate: course.startDate,
    durationDays: course.durationDays,
    outlineConfirmed: Boolean(course.outlineConfirmed),
    outlineConfirmedAt: course.outlineConfirmedAt,
    pdfPageOffset: course.pdfPageOffset || 0,
    knowledgeCatalog: course.knowledgeCatalog || [],
    days: course.dailyPlan.map((d) => ({
      id: d.id,
      dayIndex: d.dayIndex,
      date: d.date,
      regionId: d.regionId,
      title: d.title,
      objective: d.objective,
      prerequisites: d.prerequisites || [],
      teachingScope: d.teachingScope || '',
      connectionNote: d.connectionNote || '',
      keyTopics: d.keyTopics || [],
      assignedWords: d.assignedWords,
      pdfSegment: d.pdfSegment
        ? {
            ...d.pdfSegment,
            // Keep outline.json compact by omitting full extractedSegmentText if long
            extractedSegmentText: d.pdfSegment.extractedSegmentText
              ? d.pdfSegment.extractedSegmentText.slice(0, 2000)
              : undefined,
          }
        : undefined,
      lessonFile: `lessons/${d.id}.json`,
      hasLesson: Boolean(d.lesson),
    })),
  };
  fs.writeFileSync(
    path.join(absCourseDir, 'outline.json'),
    JSON.stringify(outlineData, null, 2),
    'utf-8'
  );

  // 4. Save each generated lesson into `lessons/<sectionId>.json` (and `day-XX.json` alias)
  for (const slot of course.dailyPlan) {
    if (slot.lesson) {
      slot.lesson.sectionId = slot.id;
      const secLessonFile = path.join(lessonsDir, `${slot.id}.json`);
      fs.writeFileSync(secLessonFile, JSON.stringify(slot.lesson, null, 2), 'utf-8');
      const dayLessonFile = path.join(
        lessonsDir,
        `day-${String(slot.dayIndex).padStart(2, '0')}.json`
      );
      fs.writeFileSync(dayLessonFile, JSON.stringify(slot.lesson, null, 2), 'utf-8');
    }
  }

  // 5. Save `course.json` (Course config, goals, deadlines, materials summary, submissions)
  const courseConfigData = {
    id: course.id,
    name: course.name,
    folderName: course.folderName,
    courseDirPath: relCourseDir,
    category: course.category,
    generationMode: course.generationMode || 'api',
    subjectProfile: course.subjectProfile,
    learnerLevel: course.learnerLevel,
    goal: course.goal,
    startDate: course.startDate,
    durationDays: course.durationDays,
    extraRequirements: course.extraRequirements,
    outlineConfirmed: Boolean(course.outlineConfirmed),
    outlineConfirmedAt: course.outlineConfirmedAt,
    pdfPageOffset: course.pdfPageOffset || 0,
    materials: course.materials.map((m) => ({
      id: m.id,
      fileName: m.fileName,
      fileSize: m.fileSize,
      extractedText: m.extractedText,
      isPdf: m.isPdf,
      totalPages: m.totalPages,
      detectedPageOffset: m.detectedPageOffset,
      tocEntries: m.tocEntries,
      sourceRelPath: m.sourceRelPath,
    })),
    englishConfig: course.englishConfig,
    masteredWords: course.masteredWords || [],
    exerciseSubmissions: course.exerciseSubmissions || {},
    reverseCheckNotes: course.reverseCheckNotes || {},
    createdAt: course.createdAt,
  };
  fs.writeFileSync(
    path.join(absCourseDir, 'course.json'),
    JSON.stringify(courseConfigData, null, 2),
    'utf-8'
  );

  // 5b. Persist uploaded customAssets image data URLs as actual files inside `assets/`
  if (course.customAssets && typeof course.customAssets === 'object') {
    for (const [assetKey, dataUrl] of Object.entries(course.customAssets)) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) continue;
      const baseName = path.basename(assetKey).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!baseName) continue;
      const absAsset = path.join(assetsDir, baseName);
      if (!fs.existsSync(absAsset)) {
        try {
          fs.writeFileSync(absAsset, Buffer.from(match[2], 'base64'));
        } catch {
          // ignore invalid base64
        }
      }
    }
  }

  // 6. Save Agent task prompt
  const teachingSystemPrompt = getEffectiveTeachingSystemPrompt(course, settings);
  const agentPrompt = buildAgentExecutionPrompt({
    course,
    workspaceDir: relCourseDir,
    materialFilePaths,
    teachingSystemPrompt,
  });
  fs.writeFileSync(path.join(absCourseDir, 'AGENT_TASK_PROMPT.md'), agentPrompt, 'utf-8');

  return {
    workspaceRelPath: relCourseDir,
    materialFilePaths,
    agentPrompt,
  };
}

/**
 * Scan a course folder (`courses/<课程名称>/`) to synchronize any externally edited or Agent-generated
 * `outline.json`, `segments/split-plan.json`, `segments/*.pdf`, `lessons/*.json`, and `assets/*`.
 */
function syncCourseFolderFromDisk(
  course: Course,
  forceOverwriteLessons = false
): {
  updated: boolean;
  importedDays: number[];
  syllabusUpdated: boolean;
  splitPlanUpdated: boolean;
} {
  const { absCourseDir, relCourseDir } = getCourseDirectory(course);
  if (!fs.existsSync(absCourseDir)) {
    return {
      updated: false,
      importedDays: [],
      syllabusUpdated: false,
      splitPlanUpdated: false,
    };
  }

  let updated = false;
  let syllabusUpdated = false;
  let splitPlanUpdated = false;
  const importedDays: number[] = [];

  // 1. Scan assets/ directory for images
  const assetsDir = path.join(absCourseDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const assetFiles = fs.readdirSync(assetsDir);
    if (!course.customAssets) course.customAssets = {};
    for (const file of assetFiles) {
      const ext = path.extname(file).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };
      if (mimeMap[ext] && !course.customAssets[file]) {
        try {
          const buf = fs.readFileSync(path.join(assetsDir, file));
          const dataUrl = `data:${mimeMap[ext]};base64,${buf.toString('base64')}`;
          course.customAssets[file] = dataUrl;
          course.customAssets[`assets/${file}`] = dataUrl;
          updated = true;
        } catch {
          // ignore
        }
      }
    }
  }

  // 2. Check outline.json (or legacy syllabus.json)
  const outlinePath = fs.existsSync(path.join(absCourseDir, 'outline.json'))
    ? path.join(absCourseDir, 'outline.json')
    : path.join(absCourseDir, 'syllabus.json');

  if (fs.existsSync(outlinePath)) {
    try {
      const rawOutline = fs.readFileSync(outlinePath, 'utf-8');
      const parsedOutline = parseImportedSyllabusContent(
        rawOutline,
        course.startDate,
        course.durationDays,
        course.dailyPlan
      );
      if (parsedOutline.knowledgeCatalog.length > 0 && !course.knowledgeCatalog?.length) {
        course.knowledgeCatalog = parsedOutline.knowledgeCatalog;
        syllabusUpdated = true;
        updated = true;
      }
      for (let i = 0; i < course.dailyPlan.length; i++) {
        const currentSlot = course.dailyPlan[i];
        const nextSlot = parsedOutline.dailyPlan[i];
        if (nextSlot && nextSlot.title && nextSlot.title !== currentSlot.title) {
          currentSlot.id = ensureStableSectionId(currentSlot.dayIndex, nextSlot.id || currentSlot.id);
          currentSlot.regionId = nextSlot.regionId || currentSlot.regionId;
          currentSlot.title = nextSlot.title;
          currentSlot.objective = nextSlot.objective || currentSlot.objective;
          currentSlot.prerequisites = nextSlot.prerequisites || currentSlot.prerequisites;
          currentSlot.teachingScope = nextSlot.teachingScope || currentSlot.teachingScope;
          currentSlot.connectionNote = nextSlot.connectionNote || currentSlot.connectionNote;
          currentSlot.keyTopics = nextSlot.keyTopics || currentSlot.keyTopics;
          syllabusUpdated = true;
          updated = true;
        }
      }
    } catch {
      // ignore invalid outline
    }
  }

  // 3. Check segments/split-plan.json and sliced PDFs
  const segmentsDir = path.join(absCourseDir, 'segments');
  const splitPlanFile = path.join(segmentsDir, 'split-plan.json');
  if (fs.existsSync(splitPlanFile)) {
    try {
      const rawSplit = JSON.parse(fs.readFileSync(splitPlanFile, 'utf-8'));
      const defaultSource =
        course.materials.find((m) => m.isPdf)?.fileName || 'textbook.pdf';
      const parsedPlan = Array.isArray(rawSplit)
        ? (rawSplit as PdfSplitPlanItem[])
        : parseImportedPdfSplitPlan(rawSplit, [], defaultSource);

      for (const item of parsedPlan) {
        const secId = ensureStableSectionId(item.dayIndex, item.sectionId);
        item.sectionId = secId;
        const pdfPath = path.join(segmentsDir, `${secId}.pdf`);
        const txtPath = path.join(segmentsDir, `${secId}.txt`);
        if (fs.existsSync(pdfPath)) {
          item.status = 'sliced';
          item.segmentFileName = `${secId}.pdf`;
          item.segmentRelPath = `${relCourseDir}/segments/${secId}.pdf`;
        }
        if (fs.existsSync(txtPath) && !item.extractedSegmentText) {
          item.extractedSegmentText = fs.readFileSync(txtPath, 'utf-8');
        }
      }
      for (const slot of course.dailyPlan) {
        const seg = resolveSlotPdfSegment(slot, parsedPlan);
        if (seg) {
          slot.pdfSegment = seg;
          if (!slot.regionId) slot.regionId = seg.sectionId;
        }
      }
      course.pdfSplitPlan = parsedPlan;
      splitPlanUpdated = true;
    } catch {
      // ignore
    }
  }

  // 4. Scan lessons/ directory for sec-XX.json, day-XX.json, or YYYY-MM-DD.json
  const lessonsDir = path.join(absCourseDir, 'lessons');
  if (fs.existsSync(lessonsDir)) {
    const files = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.md'));

    for (const file of files) {
      try {
        const rawText = fs.readFileSync(path.join(lessonsDir, file), 'utf-8');
        let targetSlot: DailyPlanSlot | undefined;

        const baseNoExt = file.replace(/\.(?:json|md)$/i, '');
        // Match by stable section ID first (e.g. sec-01.json)
        targetSlot = course.dailyPlan.find((d) => d.id === baseNoExt);

        if (!targetSlot) {
          const dayMatch =
            file.match(/(?:sec|day)[-_]?0*(\d+)\.(?:json|md)$/i) ||
            file.match(/^0*(\d+)\.(?:json|md)$/);
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.(?:json|md)$/);

          if (dayMatch) {
            const dayNum = Number(dayMatch[1]);
            targetSlot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
          } else if (dateMatch) {
            targetSlot = course.dailyPlan.find((d) => d.date === dateMatch[1]);
          }
        }

        if (!targetSlot) continue;

        if (targetSlot.lesson && !forceOverwriteLessons) {
          continue;
        }

        const { lesson } = parseImportedLessonContent(
          rawText,
          targetSlot,
          course.generationMode === 'agent' ? 'agent' : 'chat',
          course.customAssets || {}
        );

        if (lesson.markdownBody || lesson.englishPayload) {
          lesson.sectionId = targetSlot.id;
          targetSlot.lesson = lesson;
          if (!importedDays.includes(targetSlot.dayIndex)) {
            importedDays.push(targetSlot.dayIndex);
          }
          updated = true;
        }
      } catch (err) {
        console.warn(`Failed to parse lesson file ${file}:`, err);
      }
    }
  }

  return { updated, importedDays, syllabusUpdated, splitPlanUpdated };
}

interface DatabaseSchema {
  courses: Course[];
}

/**
 * Load all courses from both `courses/<课程名称>/` folders on disk AND `data/db.json`,
 * keeping them synchronized so courses are always persisted as independent local folders.
 */
function loadDb(): DatabaseSchema {
  const courseMap = new Map<string, Course>();

  // 1. Scan `courses/` folders on disk first
  if (fs.existsSync(COURSES_ROOT)) {
    const entries = fs.readdirSync(COURSES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const absDir = path.join(COURSES_ROOT, folderName);
      const courseJsonPath = path.join(absDir, 'course.json');
      const outlineJsonPath = path.join(absDir, 'outline.json');

      if (!fs.existsSync(courseJsonPath)) continue;
      try {
        const courseConfig = JSON.parse(fs.readFileSync(courseJsonPath, 'utf-8'));
        if (courseConfig.archived) continue;

        let dailyPlan: DailyPlanSlot[] = [];
        let knowledgeCatalog: KnowledgeCatalogNode[] = [];

        if (fs.existsSync(outlineJsonPath)) {
          const outlineRaw = JSON.parse(fs.readFileSync(outlineJsonPath, 'utf-8'));
          knowledgeCatalog = Array.isArray(outlineRaw.knowledgeCatalog)
            ? outlineRaw.knowledgeCatalog
            : [];
          const daysArr = Array.isArray(outlineRaw.days) ? outlineRaw.days : [];
          dailyPlan = daysArr.map((d: any, idx: number) => ({
            id: ensureStableSectionId(d.dayIndex || idx + 1, d.id),
            dayIndex: d.dayIndex || idx + 1,
            date: d.date || addDaysToDateString(courseConfig.startDate || getTodayDateString(), idx),
            regionId: d.regionId,
            title: d.title || `第 ${idx + 1} 讲`,
            objective: d.objective || '',
            prerequisites: d.prerequisites || [],
            teachingScope: d.teachingScope || '',
            connectionNote: d.connectionNote || '',
            keyTopics: d.keyTopics || [],
            assignedWords: d.assignedWords,
            pdfSegment: d.pdfSegment,
          }));
        }

        const reconstructed: Course = {
          ...courseConfig,
          folderName,
          courseDirPath: `courses/${folderName}`,
          agentWorkspacePath: `courses/${folderName}`,
          knowledgeCatalog,
          dailyPlan,
          customAssets: {},
        };

        syncCourseFolderFromDisk(reconstructed, false);
        courseMap.set(reconstructed.id, reconstructed);
      } catch (err) {
        console.warn(`Failed to load course folder ${folderName}:`, err);
      }
    }
  }

  // 2. Also merge any courses from `data/db.json`
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (parsed && Array.isArray(parsed.courses)) {
        for (const c of parsed.courses as Course[]) {
          if (!c || !c.id) continue;
          // Ensure stable section IDs
          for (const slot of c.dailyPlan || []) {
            slot.id = ensureStableSectionId(slot.dayIndex, slot.id);
          }
          if (!courseMap.has(c.id)) {
            // If folderName is set, do NOT resurrect courses whose folder was deleted from disk!
            if (c.folderName) {
              const folderAbs = path.join(COURSES_ROOT, c.folderName);
              const cJsonPath = path.join(folderAbs, 'course.json');
              if (!fs.existsSync(folderAbs) || !fs.existsSync(cJsonPath)) {
                continue;
              }
              try {
                const cfg = JSON.parse(fs.readFileSync(cJsonPath, 'utf-8'));
                if (cfg.archived) continue;
              } catch {
                // ignore
              }
            }
            courseMap.set(c.id, c);
          } else {
            // Merge in-memory fields from db.json if newer
            const fromDisk = courseMap.get(c.id)!;
            fromDisk.exerciseSubmissions = {
              ...(c.exerciseSubmissions || {}),
              ...(fromDisk.exerciseSubmissions || {}),
            };
            fromDisk.reverseCheckNotes = {
              ...(c.reverseCheckNotes || {}),
              ...(fromDisk.reverseCheckNotes || {}),
            };
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to read db.json:', err);
  }

  const courses = Array.from(courseMap.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  for (const c of courses) {
    for (const s of c.dailyPlan || []) {
      if (s.lesson) {
        s.lesson = sanitizeLessonCitations(s.lesson);
      }
    }
  }

  return { courses };
}

function saveDb(db: DatabaseSchema): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function loadCoursePdfAttachments(
  course: Course,
  scope: 'sources' | 'segments' | 'slot',
  targetSectionId?: string,
  maxTotalBytes = 15 * 1024 * 1024
): Array<{ fileName: string; base64Data: string }> {
  try {
    const { absCourseDir } = getCourseDirectory(course);
    const sourcesDir = path.join(absCourseDir, 'sources');
    const segmentsDir = path.join(absCourseDir, 'segments');
    const candidateFiles: Array<{ fileName: string; absPath: string }> = [];

    if (scope === 'slot' && targetSectionId) {
      const safeId = targetSectionId.replace(/[^a-zA-Z0-9_-]/g, '');
      const segPdf = path.join(segmentsDir, `${safeId}.pdf`);
      if (safeId && fs.existsSync(segPdf)) {
        candidateFiles.push({ fileName: `${safeId}.pdf`, absPath: segPdf });
      }
    } else if (scope === 'segments' && fs.existsSync(segmentsDir)) {
      const segFiles = fs
        .readdirSync(segmentsDir)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .sort();
      for (const f of segFiles.slice(0, 12)) {
        candidateFiles.push({ fileName: f, absPath: path.join(segmentsDir, f) });
      }
    }

    if (candidateFiles.length === 0 && fs.existsSync(sourcesDir)) {
      const srcFiles = fs
        .readdirSync(sourcesDir)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .sort();
      for (const f of srcFiles.slice(0, 4)) {
        candidateFiles.push({ fileName: f, absPath: path.join(sourcesDir, f) });
      }
    }

    const attachments: Array<{ fileName: string; base64Data: string }> = [];
    let accumulatedBytes = 0;
    for (const item of candidateFiles) {
      try {
        const stat = fs.statSync(item.absPath);
        if (!stat.isFile() || stat.size <= 0) continue;
        if (accumulatedBytes + stat.size > maxTotalBytes) continue;
        const buf = fs.readFileSync(item.absPath);
        accumulatedBytes += buf.length;
        attachments.push({
          fileName: item.fileName,
          base64Data: buf.toString('base64'),
        });
      } catch {
        // ignore unreadable file
      }
    }
    return attachments;
  } catch {
    return [];
  }
}

async function callLlmJson<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  pdfAttachments?: Array<{ fileName: string; base64Data: string }>;
}): Promise<T | null> {
  const settings = loadSettings();
  const validAttachments = (params.pdfAttachments || []).filter((a) => Boolean(a?.base64Data));

  if (
    settings.providerMode === 'openai_compatible' &&
    settings.apiBaseUrl &&
    (settings.customApiKey || process.env.OPENAI_API_KEY)
  ) {
    const apiKey = settings.customApiKey || process.env.OPENAI_API_KEY || '';
    const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    try {
      const userContent: any =
        validAttachments.length > 0
          ? [
              ...validAttachments.map((att) => ({
                type: 'file',
                file: {
                  filename: att.fileName,
                  file_data: `data:application/pdf;base64,${att.base64Data}`,
                },
              })),
              { type: 'text', text: params.userPrompt },
            ]
          : params.userPrompt;

      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: settings.modelName || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: params.systemInstruction },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      // Fallback without `type: 'file'` only if the custom OpenAI-compatible server rejects file parts
      if (!response.ok && validAttachments.length > 0 && response.status >= 400 && response.status < 500) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: settings.modelName || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: params.systemInstruction },
              { role: 'user', content: params.userPrompt },
            ],
            response_format: { type: 'json_object' },
          }),
        });
      }

      if (response.ok) {
        const data = (await response.json()) as any;
        const content = data.choices?.[0]?.message?.content || '';
        const parsed = extractJsonFromText<T>(content);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.warn('OpenAI-compatible request failed, falling back to Gemini:', err);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY || settings.customApiKey;
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const requestedModel =
        settings.providerMode === 'builtin_gemini' && settings.modelName.startsWith('gemini-')
          ? settings.modelName
          : 'gemini-3.8-flash';

      const geminiContents =
        validAttachments.length > 0
          ? {
              parts: [
                ...validAttachments.map((att) => ({
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: att.base64Data,
                  },
                })),
                { text: params.userPrompt },
              ],
            }
          : params.userPrompt;

      const response = await ai.models.generateContent({
        model: requestedModel,
        contents: geminiContents,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const text = response.text || '';
      const parsed = extractJsonFromText<T>(text);
      if (parsed) return parsed;
    } catch (err) {
      console.warn('Gemini API call error:', err);
    }
  }

  return null;
}

function extractJsonFromText<T>(rawText: string): T | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch {
        // continue
      }
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue
      }
    }
  }
  return null;
}

/**
 * Build clean pending outline slots BEFORE Step 2 LLM outline generation runs.
 * Strictly NEVER scrapes raw PDF lines (which could contain garbled glyphs) into outline titles or topics.
 */
function buildPendingOutlinePlaceholders(params: {
  name: string;
  category: CourseCategory;
  goal: string;
  startDate: string;
  durationDays: number;
  wordBuckets?: VocabItem[][];
}): {
  knowledgeCatalog: KnowledgeCatalogNode[];
  dailyPlan: DailyPlanSlot[];
} {
  const { name, category, goal, startDate, durationDays, wordBuckets = [] } = params;

  const slots: DailyPlanSlot[] = [];
  for (let i = 0; i < durationDays; i++) {
    const dayIndex = i + 1;
    const sectionId = ensureStableSectionId(dayIndex);
    const date = addDaysToDateString(startDate, i);
    const assignedWords = category === 'english' ? wordBuckets[i] || [] : undefined;

    let heading = `第 ${dayIndex} 讲（待第 2 步由 LLM 生成大纲）`;
    let objective = `围绕“${goal}”规划第 ${dayIndex} 讲：请先在第 1 步确定划分区域并切割 PDF，再于第 2 步由 LLM 生成课程大纲。`;
    let keyTopics: string[] = [];

    if (category === 'english' && assignedWords && assignedWords.length > 0) {
      const sample = assignedWords
        .slice(0, 3)
        .map((w) => w.word)
        .join(', ');
      heading = `第 ${dayIndex} 讲：英语语境精读与目标词汇 (${sample} 等 ${assignedWords.length} 词)`;
      objective = `围绕“${goal}”掌握今日随机分配的 ${assignedWords.length} 个核心词汇并完成语境阅读。`;
      keyTopics = [`目标词汇 (${assignedWords.length} 词)`, '语境精读文章', '长难句与近义词辨析'];
    }

    slots.push({
      id: sectionId,
      dayIndex,
      date,
      title: heading,
      objective,
      prerequisites: dayIndex === 1 ? ['课程基础先修概念'] : [`第 ${dayIndex - 1} 讲核心内容`],
      teachingScope: category === 'english' ? `${name} 第 ${dayIndex} 讲` : '待第 2 步关联第 1 步切分区域后确定',
      connectionNote:
        dayIndex === 1
          ? '课程开篇第 1 讲，建立核心概念与分析基础'
          : `承接第 ${dayIndex - 1} 讲，推进本节原理推导与应用`,
      keyTopics,
      assignedWords,
    });
  }

  return { knowledgeCatalog: [], dailyPlan: slots };
}

async function generateCourseSyllabus(params: {
  name: string;
  category: CourseCategory;
  generationMode: CourseGenerationMode;
  subjectProfile?: SubjectProfile;
  learnerLevel?: LearnerLevel;
  goal: string;
  startDate: string;
  durationDays: number;
  extraRequirements: string;
  materials: UploadedMaterial[];
  pdfSplitPlan?: PdfSplitPlanItem[];
  effectiveWords?: VocabItem[];
  dailyWordCount?: number;
  existingSlots?: DailyPlanSlot[];
  pdfAttachments?: Array<{ fileName: string; base64Data: string }>;
  requireLlm?: boolean;
}): Promise<{
  knowledgeCatalog: KnowledgeCatalogNode[];
  dailyPlan: DailyPlanSlot[];
}> {
  const {
    name,
    category,
    generationMode,
    subjectProfile,
    learnerLevel,
    goal,
    startDate,
    durationDays,
    extraRequirements,
    materials,
    pdfSplitPlan = [],
    effectiveWords = [],
    dailyWordCount = 20,
    existingSlots = [],
    pdfAttachments = [],
    requireLlm = false,
  } = params;

  const wordBuckets =
    category === 'english'
      ? allocateEnglishWordsRandomly({
          effectiveWords,
          durationDays,
          dailyWordCount,
          existingSlots,
          preserveStartedSlots: existingSlots.length > 0,
        }).buckets
      : [];

  if (!requireLlm && (generationMode === 'agent' || generationMode === 'chat')) {
    const pending = buildPendingOutlinePlaceholders({
      name,
      category,
      goal,
      startDate,
      durationDays,
      wordBuckets,
    });
    for (let i = 0; i < pending.dailyPlan.length; i++) {
      const ex = existingSlots[i];
      if (ex) {
        pending.dailyPlan[i].id = ensureStableSectionId(i + 1, ex.id);
        pending.dailyPlan[i].regionId = ex.regionId;
        pending.dailyPlan[i].lesson = ex.lesson;
        pending.dailyPlan[i].pdfSegment = resolveSlotPdfSegment(ex, pdfSplitPlan) || ex.pdfSegment;
      }
    }
    return pending;
  }

  const settings = loadSettings();
  const prompt = buildSyllabusUserPrompt({
    name,
    category,
    subjectProfile,
    learnerLevel: learnerLevel || settings.defaultLearnerLevel,
    goal,
    durationDays,
    extraRequirements,
    materials,
    pdfSplitPlan,
    effectiveWords,
    dailyWordCount,
  });

  const llmResult = await callLlmJson<{
    knowledgeCatalog?: KnowledgeCatalogNode[];
    days: Array<{
      id?: string;
      dayIndex: number;
      regionId?: string;
      title: string;
      objective: string;
      prerequisites?: string[];
      teachingScope?: string;
      connectionNote?: string;
      keyTopics: string[];
    }>;
  }>({
    systemInstruction: settings.syllabusSystemPrompt,
    userPrompt: prompt,
    pdfAttachments,
  });

  if (llmResult && Array.isArray(llmResult.days) && llmResult.days.length > 0) {
    const slots: DailyPlanSlot[] = [];
    for (let i = 0; i < durationDays; i++) {
      const llmDay = llmResult.days[i] || llmResult.days[llmResult.days.length - 1];
      const dayNumber = i + 1;
      const existing = existingSlots[i];
      const sectionId = ensureStableSectionId(dayNumber, existing?.id || llmDay?.id);
      const dateStr = addDaysToDateString(startDate, i);
      const assignedWords = category === 'english' ? wordBuckets[i] || [] : undefined;
      const regionId = llmDay?.regionId || existing?.regionId;
      const matchedSegment = resolveSlotPdfSegment(
        { id: sectionId, dayIndex: dayNumber, regionId, pdfSegment: existing?.pdfSegment },
        pdfSplitPlan
      );

      slots.push({
        id: sectionId,
        dayIndex: dayNumber,
        date: dateStr,
        regionId: regionId || matchedSegment?.sectionId,
        title: llmDay?.title || `第 ${dayNumber} 讲：${name} (${dayNumber}/${durationDays})`,
        objective: llmDay?.objective || `${goal}（第 ${dayNumber} 阶段）`,
        prerequisites: Array.isArray(llmDay?.prerequisites) ? llmDay.prerequisites : undefined,
        teachingScope: llmDay?.teachingScope,
        connectionNote: llmDay?.connectionNote,
        keyTopics:
          Array.isArray(llmDay?.keyTopics) && llmDay.keyTopics.length > 0
            ? llmDay.keyTopics
            : [`${name} 知识点 ${dayNumber}.1`, `${name} 知识点 ${dayNumber}.2`],
        assignedWords,
        pdfSegment: matchedSegment,
        lesson: existing?.lesson,
      });
    }
    return {
      knowledgeCatalog: Array.isArray(llmResult.knowledgeCatalog) ? llmResult.knowledgeCatalog : [],
      dailyPlan: slots,
    };
  }

  if (requireLlm) {
    throw new Error(
      '未能从 LLM API 获取课程大纲（请检查 API Key 或模型配置，也可在下方使用 Agent 或 Chat 模式生成后导入目录）。'
    );
  }

  return buildPendingOutlinePlaceholders({
    name,
    category,
    goal,
    startDate,
    durationDays,
    wordBuckets,
  });
}

async function generateDailyLesson(
  course: Course,
  slot: DailyPlanSlot
): Promise<DailyLessonContent> {
  const settings = loadSettings();
  const isEnglish = course.category === 'english';
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);

  const prevSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex - 1);
  const nextSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex + 1);

  // Never inject PDF OCR text; only pass plain-text (non-PDF) supplemental materials
  const materialContext = course.materials
    .filter((m) => !m.isPdf && !m.fileName.toLowerCase().endsWith('.pdf'))
    .map((m) => `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 7000)}`)
    .join('\n\n')
    .slice(0, 18000);

  const slotSegmentId = slot.pdfSegment?.sectionId || slot.regionId || sectionId;
  const slotPdfAttachments = loadCoursePdfAttachments(course, 'slot', slotSegmentId);

  if (isEnglish) {
    const targetWords =
      slot.assignedWords && slot.assignedWords.length > 0
        ? slot.assignedWords
        : course.englishConfig?.effectiveWords.slice(0, course.englishConfig?.dailyWordCount || 15) || [];

    const articleMode: EnglishArticleMode =
      course.englishConfig?.articleMode || 'llm_original';
    const preferredSources =
      course.englishConfig?.preferredSources || 'The New Yorker, The Economist';

    const englishUserPrompt = buildEnglishLessonUserPrompt({
      course,
      slot,
      prevSlot,
      nextSlot,
      targetWords,
      articleMode,
      preferredSources,
      materialContext,
    });

    const llmLesson = await callLlmJson<Omit<DailyLessonContent, 'dayIndex' | 'date' | 'generatedAt'>>({
      systemInstruction: settings.englishSystemPrompt,
      userPrompt: englishUserPrompt,
      pdfAttachments: slotPdfAttachments,
    });

    if (
      llmLesson &&
      (llmLesson.englishPayload || (llmLesson as any).readingPassage || llmLesson.markdownBody)
    ) {
      const normalized = parseImportedLessonContent(
        JSON.stringify(llmLesson),
        slot,
        'api',
        course.customAssets || {}
      ).lesson;
      const rawPassage = (llmLesson as any).readingPassage;
      const fallbackPayload = rawPassage
        ? {
            articleTitle: rawPassage.englishTitle || normalized.title,
            sourceReference: preferredSources,
            articleMode,
            targetWords,
            paragraphs: Array.isArray(rawPassage.paragraphs) ? rawPassage.paragraphs : [],
            grammarAndUsageNotes: normalized.markdownBody || '',
          }
        : undefined;
      const mergedPayload = normalized.englishPayload || fallbackPayload;
      return {
        ...normalized,
        sectionId,
        englishPayload: mergedPayload
          ? {
              ...mergedPayload,
              articleMode,
              targetWords:
                Array.isArray(mergedPayload.targetWords) && mergedPayload.targetWords.length > 0
                  ? mergedPayload.targetWords
                  : targetWords,
            }
          : undefined,
        sourceMode: 'api',
      };
    }

    throw new Error('未能从 API 获取英语课件数据。若未配置 API Key，可切换为 Agent 课件模式或 Chat 课件模式导入。');
  }

  const effectiveSystemPrompt = getEffectiveTeachingSystemPrompt(course, settings);
  const courseUserPrompt = buildCourseLessonUserPrompt({
    course,
    slot,
    prevSlot,
    nextSlot,
    materialContext,
  });

  const llmCourseLesson = await callLlmJson<
    Omit<DailyLessonContent, 'dayIndex' | 'date' | 'generatedAt'>
  >({
    systemInstruction: effectiveSystemPrompt,
    userPrompt: courseUserPrompt,
    pdfAttachments: slotPdfAttachments,
  });

  if (llmCourseLesson && llmCourseLesson.markdownBody) {
    const normalized = parseImportedLessonContent(
      JSON.stringify(llmCourseLesson),
      slot,
      'api',
      course.customAssets || {}
    ).lesson;
    return {
      ...normalized,
      sectionId,
      sourceMode: 'api',
    };
  }

  throw new Error('未能从 API 获取课件数据。若未配置 API Key，可切换为 Agent 课件模式或 Chat 课件模式导入。');
}

function formatPublicSettings(settings: StoredSettings) {
  const hasBuiltinGeminiKey = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  return {
    providerMode: settings.providerMode,
    apiBaseUrl: settings.apiBaseUrl,
    modelName: settings.modelName,
    hasCustomApiKey: Boolean(settings.customApiKey),
    hasBuiltinGeminiKey,
    defaultLearnerLevel: settings.defaultLearnerLevel,
    showAdvancedWorkflowDetails: Boolean(settings.showAdvancedWorkflowDetails),
    promptModules: settings.promptModules,
    syllabusSystemPrompt: settings.syllabusSystemPrompt,
    courseSystemPrompt: settings.courseSystemPrompt,
    englishSystemPrompt: settings.englishSystemPrompt,
    customTeachingSupplement: settings.customTeachingSupplement,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  // 1. Get application state (auto-syncs any local `courses/<课程名称>/` folders)
  app.get('/api/state', async (_req, res) => {
    const db = loadDb();
    const settings = loadSettings();
    let anyUpdated = false;

    for (const course of db.courses) {
      const syncResult = syncCourseFolderFromDisk(course, false);
      if (syncResult.updated || !course.folderName) {
        await persistCourseToFolder(course, settings);
        anyUpdated = true;
      }
    }
    if (anyUpdated) {
      saveDb(db);
    }

    res.json({
      courses: db.courses,
      settings: formatPublicSettings(settings),
      promptPresets: getPromptPresetsFromSkill(),
    });
  });

  // 2. Compose prompt dynamically from skill files
  app.post('/api/compose-prompt', (req, res) => {
    const { subjectProfile, learnerLevel, promptModules, customSupplement } = req.body || {};
    const composed = composeCoursewareSystemPrompt({
      subjectProfile,
      learnerLevel,
      modules: promptModules,
      customSupplement,
    });
    res.json({ prompt: composed });
  });

  // 3. Update settings
  app.put('/api/settings', (req, res) => {
    const current = loadSettings();
    const skillDefaults = getDefaultPromptsFromSkill();
    const {
      providerMode,
      apiBaseUrl,
      modelName,
      newApiKey,
      clearApiKey,
      defaultLearnerLevel,
      showAdvancedWorkflowDetails,
      promptModules,
      syllabusSystemPrompt,
      courseSystemPrompt,
      englishSystemPrompt,
      customTeachingSupplement,
    } = req.body || {};

    const updated: StoredSettings = {
      providerMode:
        providerMode === 'openai_compatible' ? 'openai_compatible' : 'builtin_gemini',
      apiBaseUrl: typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : current.apiBaseUrl,
      modelName: typeof modelName === 'string' ? modelName.trim() : current.modelName,
      customApiKey: clearApiKey
        ? ''
        : typeof newApiKey === 'string' && newApiKey.trim() !== ''
          ? newApiKey.trim()
          : current.customApiKey,
      defaultLearnerLevel:
        defaultLearnerLevel === 'beginner' ||
        defaultLearnerLevel === 'intermediate' ||
        defaultLearnerLevel === 'advanced'
          ? defaultLearnerLevel
          : current.defaultLearnerLevel,
      showAdvancedWorkflowDetails:
        typeof showAdvancedWorkflowDetails === 'boolean'
          ? showAdvancedWorkflowDetails
          : current.showAdvancedWorkflowDetails,
      promptModules: {
        ...current.promptModules,
        ...(promptModules || {}),
      },
      syllabusSystemPrompt:
        typeof syllabusSystemPrompt === 'string' && syllabusSystemPrompt.trim()
          ? syllabusSystemPrompt
          : skillDefaults.syllabusSystemPrompt,
      courseSystemPrompt:
        typeof courseSystemPrompt === 'string' && courseSystemPrompt.trim()
          ? courseSystemPrompt
          : skillDefaults.courseSystemPrompt,
      englishSystemPrompt:
        typeof englishSystemPrompt === 'string' && englishSystemPrompt.trim()
          ? englishSystemPrompt
          : skillDefaults.englishSystemPrompt,
      customTeachingSupplement:
        typeof customTeachingSupplement === 'string'
          ? customTeachingSupplement
          : current.customTeachingSupplement,
    };

    saveSettings(updated);
    res.json({
      settings: formatPublicSettings(updated),
      promptPresets: getPromptPresetsFromSkill(),
    });
  });

  // 4. Parse PDF file buffer on server (extracts TOC, physical page count, page offset, and per-page text)
  app.post('/api/parse-pdf', async (req, res) => {
    try {
      const { fileName, base64Data } = req.body || {};
      if (!base64Data) {
        res.status(400).json({ error: '缺少 PDF 数据' });
        return;
      }
      const buffer = Buffer.from(base64Data, 'base64');
      const analyzed = await analyzePdfBuffer(buffer, fileName || 'document.pdf');
      res.json({
        fileName,
        text: analyzed.fullText,
        meta: analyzed.meta,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '解析 PDF 失败' });
    }
  });

  // 5. Create a new course:
  // Unified pipeline:
  //   Step 1: Save sources & determine PDF split regions via LLM (or clean bookmark scaffold)
  //   Step 2: Generate complete course outline (`outline.json`) via LLM based on requirements + Step 1 split regions
  //   Step 3: Generate each lesson (`lessons/sec-XX.json`) via LLM
  app.post('/api/courses', async (req, res) => {
    try {
      const {
        name,
        category = 'general',
        generationMode = 'api',
        subjectProfile,
        learnerLevel,
        goal,
        startDate = getTodayDateString(),
        durationDays = 15,
        extraRequirements = '',
        materials = [],
        englishConfig,
      } = req.body || {};

      if (!name || !String(name).trim()) {
        res.status(400).json({ error: '请输入课程名称' });
        return;
      }
      if (!goal || !String(goal).trim()) {
        res.status(400).json({ error: '请输入学习目标' });
        return;
      }

      const mode: CourseGenerationMode =
        generationMode === 'agent' || generationMode === 'chat' ? generationMode : 'api';
      const days = Math.max(1, Math.min(180, Number(durationDays) || 15));
      const trimmedName = String(name).trim();
      const trimmedGoal = String(goal).trim();
      const trimmedExtra = String(extraRequirements || '').trim();
      const resolvedProfile: SubjectProfile =
        subjectProfile || inferSubjectProfile(category, trimmedName, trimmedExtra);
      const rawMaterials: UploadedMaterial[] = Array.isArray(materials) ? materials : [];
      const hasPdfMaterials = rawMaterials.some(
        (m) => Boolean(m?.isPdf) || (m?.fileName || '').toLowerCase().endsWith('.pdf')
      );

      const dailyWordCount =
        category === 'english'
          ? Math.max(1, Math.min(200, Number(englishConfig?.dailyWordCount) || 20))
          : 20;

      const wordBuckets =
        category === 'english'
          ? allocateEnglishWordsRandomly({
              effectiveWords: englishConfig?.effectiveWords || [],
              durationDays: days,
              dailyWordCount,
            }).buckets
          : [];

      // Initialize clean pending outline placeholders (Step 2 generates the real outline after Step 1 PDF split)
      const pendingSchedule = buildPendingOutlinePlaceholders({
        name: trimmedName,
        category,
        goal: trimmedGoal,
        startDate,
        durationDays: days,
        wordBuckets,
      });

      const existingDirs = fs.existsSync(COURSES_ROOT) ? fs.readdirSync(COURSES_ROOT) : [];
      const folderName = sanitizeCourseFolderName(trimmedName, existingDirs);
      const courseId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const newCourse: Course = {
        id: courseId,
        name: trimmedName,
        folderName,
        courseDirPath: `courses/${folderName}`,
        category,
        generationMode: mode,
        subjectProfile: resolvedProfile,
        learnerLevel: learnerLevel || 'intermediate',
        goal: trimmedGoal,
        startDate,
        durationDays: days,
        extraRequirements: trimmedExtra,
        outlineConfirmed: false,
        pdfPageOffset: 0,
        materials: rawMaterials,
        knowledgeCatalog: pendingSchedule.knowledgeCatalog,
        agentWorkspacePath: `courses/${folderName}`,
        customAssets: {},
        englishConfig:
          category === 'english' && englishConfig
            ? {
                ...englishConfig,
                dailyWordCount,
                lastAllocatedAt: new Date().toISOString(),
              }
            : undefined,
        dailyPlan: pendingSchedule.dailyPlan,
        masteredWords: [],
        exerciseSubmissions: {},
        reverseCheckNotes: {},
        createdAt: new Date().toISOString(),
      };

      const settings = loadSettings();
      // Persist raw files into `courses/<课程名称>/sources/` and extract clean PDF metadata/bookmarks via pdfjs-dist
      await persistCourseToFolder(newCourse, settings);

      const { absCourseDir, relCourseDir } = getCourseDirectory(newCourse);
      const pdfMetas = loadCoursePdfMetas(newCourse);

      if (pdfMetas.length > 0) {
        // Default offset is 0; never auto-infer pageOffset from OCR text guesses
        newCourse.pdfPageOffset = 0;
        const defaultSource = pdfMetas[0].fileName || 'textbook.pdf';
        const totalPages = pdfMetas[0].totalPages || 500;

        // Step 1: If API mode & PDF present, send actual PDF + optional OCR reference to LLM
        if (mode === 'api') {
          try {
            const splitPrompts = buildPdfSplitPrompts({
              course: newCourse,
              pdfMetas,
              courseRelDir: relCourseDir,
            });
            const sourcePdfAttachments = loadCoursePdfAttachments(newCourse, 'sources');
            const llmSplit = await callLlmJson<{
              pageOffset?: number;
              regions?: any[];
              segments?: any[];
            }>({
              systemInstruction: splitPrompts.systemPrompt,
              userPrompt: splitPrompts.apiUserPrompt,
              pdfAttachments: sourcePdfAttachments,
            });
            if (
              llmSplit &&
              ((Array.isArray(llmSplit.regions) && llmSplit.regions.length > 0) ||
                (Array.isArray(llmSplit.segments) && llmSplit.segments.length > 0))
            ) {
              newCourse.pdfSplitPlan = parseImportedPdfSplitPlan(
                llmSplit,
                [],
                defaultSource,
                totalPages,
                newCourse.pdfPageOffset || 0
              );
              // Automatically execute lossless script slice if regions were planned
              newCourse.pdfSplitPlan = await executePdfSplitPlanOnDisk({
                courseDir: absCourseDir,
                courseRelDir: relCourseDir,
                splitPlan: newCourse.pdfSplitPlan,
              });
            }
          } catch {
            // Leave cleanly for Step 1 UI inspection
          }
        }

        // If no LLM regions yet, scaffold from clean PDF bookmarks only (never garbled lines)
        if (!newCourse.pdfSplitPlan || newCourse.pdfSplitPlan.length === 0) {
          newCourse.pdfSplitPlan = buildHeuristicPdfSplitPlan({
            outline: [],
            pdfMetas,
            globalPageOffset: newCourse.pdfPageOffset,
          });
        }
      } else if (mode === 'api' && !hasPdfMaterials) {
        // No PDF to split: can immediately try Step 2 LLM syllabus generation in API mode
        const generated = await generateCourseSyllabus({
          name: trimmedName,
          category,
          generationMode: mode,
          subjectProfile: resolvedProfile,
          learnerLevel: newCourse.learnerLevel,
          goal: trimmedGoal,
          startDate,
          durationDays: days,
          extraRequirements: trimmedExtra,
          materials: newCourse.materials,
          effectiveWords: englishConfig?.effectiveWords || [],
          dailyWordCount,
          existingSlots: newCourse.dailyPlan,
          requireLlm: false,
        });
        newCourse.knowledgeCatalog = generated.knowledgeCatalog;
        newCourse.dailyPlan = generated.dailyPlan;
      }

      const { agentPrompt } = await persistCourseToFolder(newCourse, settings);

      const db = loadDb();
      db.courses.unshift(newCourse);
      saveDb(db);

      res.status(201).json({ course: newCourse, agentPrompt });
    } catch (err: any) {
      console.error('Error creating course:', err);
      res.status(500).json({ error: err?.message || '创建课程失败' });
    }
  });

  // 6. Update / Edit / Confirm Course Outline (`outline.json`) without deleting existing lessons
  app.put('/api/courses/:courseId/outline', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { dailyPlan, startDate, confirmOutline } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        course.startDate = startDate;
      }

      if (Array.isArray(dailyPlan) && dailyPlan.length > 0) {
        // Map existing lessons, assignedWords, and pdfSegments by stable `id` (fallback `dayIndex`)
        const existingById = new Map<string, DailyPlanSlot>();
        const existingByDay = new Map<number, DailyPlanSlot>();
        for (const oldSlot of course.dailyPlan) {
          if (oldSlot.id) existingById.set(oldSlot.id, oldSlot);
          existingByDay.set(oldSlot.dayIndex, oldSlot);
        }

        const updatedSlots: DailyPlanSlot[] = dailyPlan.map((item: any, idx: number) => {
          const dayIndex = idx + 1;
          const prev =
            (item.id && existingById.get(item.id)) || existingByDay.get(item.dayIndex || dayIndex);
          const stableId = ensureStableSectionId(dayIndex, item.id || prev?.id);
          const date = item.date || addDaysToDateString(course.startDate, idx);
          const nextRegionId =
            item.regionId !== undefined ? item.regionId || undefined : prev?.regionId;
          const matchedSeg =
            resolveSlotPdfSegment(
              { id: stableId, dayIndex, regionId: nextRegionId, pdfSegment: item.pdfSegment || prev?.pdfSegment },
              course.pdfSplitPlan
            ) || item.pdfSegment || prev?.pdfSegment;

          return {
            id: stableId,
            dayIndex,
            date,
            regionId: nextRegionId,
            title: String(item.title || prev?.title || `第 ${dayIndex} 讲`).trim(),
            objective: String(item.objective ?? prev?.objective ?? '').trim(),
            prerequisites: Array.isArray(item.prerequisites)
              ? item.prerequisites.map(String).filter(Boolean)
              : prev?.prerequisites || [],
            teachingScope: String(item.teachingScope ?? prev?.teachingScope ?? '').trim(),
            connectionNote: String(item.connectionNote ?? prev?.connectionNote ?? '').trim(),
            keyTopics: Array.isArray(item.keyTopics)
              ? item.keyTopics.map(String).filter(Boolean)
              : prev?.keyTopics || [],
            assignedWords: Array.isArray(item.assignedWords)
              ? item.assignedWords
              : prev?.assignedWords,
            pdfSegment: matchedSeg,
            // Never delete already-generated lessons when editing outline!
            lesson: prev?.lesson,
          };
        });

        course.dailyPlan = updatedSlots;
        course.durationDays = updatedSlots.length;
      }

      if (confirmOutline) {
        course.outlineConfirmed = true;
        course.outlineConfirmedAt = new Date().toISOString();
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({ course });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '保存课程目录失败' });
    }
  });

  // 6b. Step 2: Generate / Regenerate Course Outline via LLM (using Step 1 divided/sliced regions)
  app.post('/api/courses/:courseId/outline/regenerate', async (req, res) => {
    try {
      const { courseId } = req.params;
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const syllabusPdfAttachments = loadCoursePdfAttachments(course, 'segments');
      const { knowledgeCatalog, dailyPlan } = await generateCourseSyllabus({
        name: course.name,
        category: course.category,
        generationMode: 'api',
        subjectProfile: course.subjectProfile,
        learnerLevel: course.learnerLevel,
        goal: course.goal,
        startDate: course.startDate,
        durationDays: course.durationDays,
        extraRequirements: course.extraRequirements,
        materials: course.materials,
        pdfSplitPlan: course.pdfSplitPlan,
        effectiveWords: course.englishConfig?.effectiveWords || [],
        dailyWordCount: course.englishConfig?.dailyWordCount || 20,
        existingSlots: course.dailyPlan,
        pdfAttachments: syllabusPdfAttachments,
        requireLlm: true,
      });

      course.knowledgeCatalog = knowledgeCatalog;
      course.dailyPlan = dailyPlan;

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({ course });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'LLM 生成课程大纲失败' });
    }
  });

  // 7. PDF Smart Splitting Endpoints (Step 1: API / Agent / Chat + Local Script Execution)
  app.get('/api/courses/:courseId/pdf-split/info', async (req, res) => {
    const { courseId } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }

    const { relCourseDir } = getCourseDirectory(course);
    const pdfMetas = loadCoursePdfMetas(course);
    if ((!course.pdfSplitPlan || course.pdfSplitPlan.length === 0) && pdfMetas.length > 0) {
      course.pdfSplitPlan = buildHeuristicPdfSplitPlan({
        outline: [],
        pdfMetas,
        globalPageOffset: course.pdfPageOffset,
      });
    }

    const prompts = buildPdfSplitPrompts({
      course,
      pdfMetas,
      courseRelDir: relCourseDir,
    });

    res.json({
      courseRelDir: relCourseDir,
      pdfMetas,
      splitPlan: course.pdfSplitPlan || [],
      pageOffset: course.pdfPageOffset || 0,
      agentSplitPrompt: prompts.agentSplitPrompt,
      chatSplitPrompt: prompts.chatSplitPrompt,
    });
  });

  // 7b. Step 1: Plan PDF Split Regions via LLM (API Mode)
  app.post('/api/courses/:courseId/pdf-split/plan', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { pageOffset } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      if (typeof pageOffset === 'number') {
        course.pdfPageOffset = pageOffset;
      }

      const { relCourseDir } = getCourseDirectory(course);
      const pdfMetas = loadCoursePdfMetas(course);
      const primaryPdf = pdfMetas[0];
      const defaultSource =
        primaryPdf?.fileName || course.materials.find((m) => m.isPdf)?.fileName || 'textbook.pdf';
      const totalPages = primaryPdf?.totalPages || 2000;

      const prompts = buildPdfSplitPrompts({
        course,
        pdfMetas,
        courseRelDir: relCourseDir,
      });

      const sourcePdfAttachments = loadCoursePdfAttachments(course, 'sources');
      const llmPlan = await callLlmJson<{
        pageOffset?: number;
        regions?: any[];
        segments?: any[];
      }>({
        systemInstruction: prompts.systemPrompt,
        userPrompt: prompts.apiUserPrompt,
        pdfAttachments: sourcePdfAttachments,
      });

      const rawList = Array.isArray(llmPlan?.regions)
        ? llmPlan.regions
        : Array.isArray(llmPlan?.segments)
          ? llmPlan.segments
          : null;

      if (!llmPlan || !rawList || rawList.length === 0) {
        res.status(400).json({
          error:
            '未能从 LLM API 获取 PDF 区域划分方案。请检查设置中的 API Key，或切换下方的 Agent / Chat 划分提示词在外部 AI 生成后导入，或手动新增区域后点击切割。',
        });
        return;
      }

      course.pdfSplitPlan = parseImportedPdfSplitPlan(
        llmPlan,
        [],
        defaultSource,
        totalPages,
        course.pdfPageOffset || 0
      );

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({
        course,
        splitPlan: course.pdfSplitPlan,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'LLM 规划 PDF 划分区域失败' });
    }
  });

  // 7c. Import / Update PDF Split Regions (Chat Mode paste, manual page range edit, or pageOffset shift)
  app.post('/api/courses/:courseId/pdf-split/import', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { rawContent, splitPlan, pageOffset, applyOffsetToAll } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const pdfMetas = loadCoursePdfMetas(course);
      const primaryPdf = pdfMetas[0];
      const defaultSource =
        primaryPdf?.fileName || course.materials.find((m) => m.isPdf)?.fileName || 'textbook.pdf';
      const totalPages = primaryPdf?.totalPages || 2000;

      if (typeof pageOffset === 'number') {
        course.pdfPageOffset = pageOffset;
      }

      let nextPlan: PdfSplitPlanItem[] = [];
      if (typeof rawContent === 'string' && rawContent.trim()) {
        nextPlan = parseImportedPdfSplitPlan(
          rawContent,
          [],
          defaultSource,
          totalPages,
          course.pdfPageOffset || 0
        );
      } else if (Array.isArray(splitPlan)) {
        nextPlan = parseImportedPdfSplitPlan(
          { regions: splitPlan, pageOffset: course.pdfPageOffset },
          [],
          defaultSource,
          totalPages,
          course.pdfPageOffset || 0
        );
      } else if (course.pdfSplitPlan) {
        nextPlan = course.pdfSplitPlan;
      }

      if (applyOffsetToAll && typeof pageOffset === 'number') {
        nextPlan = applyPageOffsetToSplitPlan(nextPlan, pageOffset, totalPages);
      }

      const prevSectionIds = new Set(
        (course.pdfSplitPlan || []).map((item) => item.sectionId).filter(Boolean)
      );
      const nextSectionIds = new Set(nextPlan.map((item) => item.sectionId).filter(Boolean));
      const { folderName, absCourseDir } = getCourseDirectory(course);

      // Delete orphan segment files on disk when a split region was removed
      for (const removedId of prevSectionIds) {
        if (!nextSectionIds.has(removedId)) {
          const safeId = removedId.replace(/[^a-zA-Z0-9_-]/g, '');
          if (safeId) {
            try {
              await callPythonJson(
                `/api/py/courses/files?folder=${encodeURIComponent(folderName)}&path=${encodeURIComponent(`segments/${safeId}.pdf`)}`,
                { method: 'DELETE' }
              );
            } catch {
              const orphanPdf = path.join(absCourseDir, 'segments', `${safeId}.pdf`);
              const orphanTxt = path.join(absCourseDir, 'segments', `${safeId}.txt`);
              if (fs.existsSync(orphanPdf)) fs.rmSync(orphanPdf, { force: true });
              if (fs.existsSync(orphanTxt)) fs.rmSync(orphanTxt, { force: true });
            }
          }
        }
      }

      course.pdfSplitPlan = nextPlan;
      for (const slot of course.dailyPlan) {
        if (slot.regionId && !nextSectionIds.has(slot.regionId)) {
          slot.regionId = undefined;
          slot.pdfSegment = undefined;
          continue;
        }
        const seg = resolveSlotPdfSegment(slot, course.pdfSplitPlan);
        if (seg) {
          slot.pdfSegment = seg;
        }
      }
      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({
        course,
        splitPlan: course.pdfSplitPlan,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || '导入或更新 PDF 区域划分方案失败' });
    }
  });

  // 7d. Execute Local PDF Splitting Script (`executePdfSplitPlanOnDisk`)
  app.post('/api/courses/:courseId/pdf-split/execute', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { sectionId, splitPlan } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);

      if (Array.isArray(splitPlan) && splitPlan.length > 0) {
        course.pdfSplitPlan = splitPlan;
      } else if (!course.pdfSplitPlan || course.pdfSplitPlan.length === 0) {
        const pdfMetas = loadCoursePdfMetas(course);
        course.pdfSplitPlan = buildHeuristicPdfSplitPlan({
          outline: [],
          pdfMetas,
          globalPageOffset: course.pdfPageOffset,
        });
      }

      if (!course.pdfSplitPlan || course.pdfSplitPlan.length === 0) {
        res.status(400).json({ error: '请先规划或添加至少一个 PDF 划分区域（如 region-01），再执行本地切割。' });
        return;
      }

      const { absCourseDir, relCourseDir } = getCourseDirectory(course);
      const executedPlan = await executePdfSplitPlanOnDisk({
        courseDir: absCourseDir,
        courseRelDir: relCourseDir,
        splitPlan: course.pdfSplitPlan,
        targetSectionId: typeof sectionId === 'string' ? sectionId : undefined,
      });

      course.pdfSplitPlan = executedPlan;
      for (const slot of course.dailyPlan) {
        const seg = resolveSlotPdfSegment(slot, executedPlan);
        if (seg) {
          slot.pdfSegment = seg;
          if (!slot.regionId) {
            slot.regionId = seg.sectionId;
          }
        }
      }

      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({
        course,
        splitPlan: executedPlan,
      });
    } catch (err: any) {
      console.error('Error executing PDF split:', err);
      res.status(500).json({ error: err?.message || '执行本地 PDF 切割脚本失败' });
    }
  });

  // 7e. Serve or download a sliced section PDF (`courses/<课程名称>/segments/<sectionId>.pdf`)
  app.get('/api/courses/:courseId/segments/:sectionId/pdf', (req, res) => {
    const { courseId, sectionId } = req.params;
    const download = req.query.download === '1';
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }

    const { absCourseDir } = getCourseDirectory(course);
    const safeSecId = sectionId.replace(/[^a-zA-Z0-9_-]/g, '');
    const pdfPath = path.join(absCourseDir, 'segments', `${safeSecId}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      res.status(404).json({ error: '该小节尚未生成切分 PDF，请先执行本地切割。' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    if (download) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(`${course.folderName || 'course'}_${safeSecId}.pdf`)}"`
      );
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${safeSecId}.pdf"`);
    }
    res.sendFile(pdfPath);
  });

  // 8. English Course Vocabulary Re-allocation (random non-repeating, preserving started sections)
  app.post('/api/courses/:courseId/vocab/reallocate', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { dailyWordCount, preserveStartedSlots = true } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course || !course.englishConfig) {
        res.status(404).json({ error: '未找到该英语课程配置' });
        return;
      }

      const nextDailyCount =
        typeof dailyWordCount === 'number' && dailyWordCount > 0
          ? Math.min(200, Math.floor(dailyWordCount))
          : course.englishConfig.dailyWordCount || 20;

      course.englishConfig.dailyWordCount = nextDailyCount;
      course.englishConfig.lastAllocatedAt = new Date().toISOString();

      const { buckets, coverageStats } = allocateEnglishWordsRandomly({
        effectiveWords: course.englishConfig.effectiveWords || [],
        durationDays: course.durationDays,
        dailyWordCount: nextDailyCount,
        existingSlots: course.dailyPlan,
        masteredWords: course.masteredWords || [],
        preserveStartedSlots: Boolean(preserveStartedSlots),
      });

      for (let i = 0; i < course.dailyPlan.length; i++) {
        const slot = course.dailyPlan[i];
        slot.assignedWords = buckets[i] || [];
        // Update unstarted slot titles to reflect new sample words
        if (!slot.lesson && slot.assignedWords.length > 0) {
          const sample = slot.assignedWords
            .slice(0, 3)
            .map((w) => w.word)
            .join(', ');
          slot.title = `第 ${slot.dayIndex} 讲：英语语境精读与目标词汇 (${sample} 等 ${slot.assignedWords.length} 词)`;
        }
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({
        course,
        coverageStats,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '重新随机分配词汇失败' });
    }
  });

  // 9. Switch course generation mode ('api' | 'agent' | 'chat') without affecting existing lessons
  app.patch('/api/courses/:courseId/mode', async (req, res) => {
    const { courseId } = req.params;
    const { generationMode } = req.body || {};
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    if (generationMode === 'api' || generationMode === 'agent' || generationMode === 'chat') {
      course.generationMode = generationMode;
      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);
    }
    res.json({ course });
  });

  // 10. Get Agent Execution Prompt & Workspace Info for a course
  app.get('/api/courses/:courseId/agent-prompt', async (req, res) => {
    const { courseId } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const settings = loadSettings();
    const { workspaceRelPath, materialFilePaths, agentPrompt } = await persistCourseToFolder(
      course,
      settings
    );
    const pdfMetas = loadCoursePdfMetas(course);
    const splitPrompts = buildPdfSplitPrompts({
      course,
      pdfMetas,
      courseRelDir: workspaceRelPath,
    });
    const agentSyllabusPrompt = buildAgentSyllabusPrompt({
      course,
      workspaceDir: workspaceRelPath,
    });
    const completedCount = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
    res.json({
      prompt: agentPrompt,
      agentSplitPrompt: splitPrompts.agentSplitPrompt,
      agentSyllabusPrompt,
      workspaceDir: workspaceRelPath,
      manifestPath: `${workspaceRelPath}/course.json`,
      syllabusPath: `${workspaceRelPath}/outline.json`,
      sourcesDir: `${workspaceRelPath}/sources/`,
      segmentsDir: `${workspaceRelPath}/segments/`,
      lessonsDir: `${workspaceRelPath}/lessons/`,
      assetsDir: `${workspaceRelPath}/assets/`,
      promptFilePath: `${workspaceRelPath}/AGENT_TASK_PROMPT.md`,
      materialFilePaths,
      completedCount,
      totalDays: course.durationDays,
    });
  });

  // 11. Sync Agent workspace files (or batch-uploaded JSON lesson/outline/split files) into course
  app.post('/api/courses/:courseId/agent-sync', async (req, res) => {
    const { courseId } = req.params;
    const { forceOverwrite = false, uploadedFiles = [] } = req.body || {};
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }

    const settings = loadSettings();
    await persistCourseToFolder(course, settings);

    if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
      const { absCourseDir } = getCourseDirectory(course);
      const lessonsDir = path.join(absCourseDir, 'lessons');
      const segmentsDir = path.join(absCourseDir, 'segments');
      for (const item of uploadedFiles) {
        if (!item || !item.fileName || typeof item.content !== 'string') continue;
        const baseName = path.basename(item.fileName);
        if (baseName === 'outline.json' || baseName === 'syllabus.json') {
          fs.writeFileSync(path.join(absCourseDir, 'outline.json'), item.content, 'utf-8');
        } else if (baseName === 'split-plan.json') {
          fs.writeFileSync(path.join(segmentsDir, 'split-plan.json'), item.content, 'utf-8');
        } else {
          fs.writeFileSync(path.join(lessonsDir, baseName), item.content, 'utf-8');
        }
      }
    }

    const syncResult = syncCourseFolderFromDisk(course, Boolean(forceOverwrite));
    await persistCourseToFolder(course, settings);
    saveDb(db);

    res.json({
      course,
      importedDays: syncResult.importedDays,
      syllabusUpdated: syncResult.syllabusUpdated,
      splitPlanUpdated: syncResult.splitPlanUpdated,
    });
  });

  // 12. Get Chat Mode single-lesson prompt, syllabus prompt, PDF split prompt & section quick materials
  app.get('/api/courses/:courseId/days/:dayIndex/chat-prompt', (req, res) => {
    const { courseId, dayIndex } = req.params;
    const dayNum = Number(dayIndex);
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const slot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
    if (!slot) {
      res.status(404).json({ error: '未找到指定日期的学习计划' });
      return;
    }

    const settings = loadSettings();
    const teachingSystemPrompt = getEffectiveTeachingSystemPrompt(course, settings);
    const lessonPrompt = buildChatLessonPrompt({
      course,
      slot,
      teachingSystemPrompt,
    });
    const syllabusPrompt = buildChatSyllabusPrompt({ course });
    const { relCourseDir } = getCourseDirectory(course);
    const pdfMetas = loadCoursePdfMetas(course);
    const splitPrompts = buildPdfSplitPrompts({
      course,
      pdfMetas,
      courseRelDir: relCourseDir,
    });

    const nonPdfExtractedText = course.materials
      .filter((m) => !m.isPdf && !m.fileName.toLowerCase().endsWith('.pdf'))
      .map((m) => `【${m.fileName}】\n${m.extractedText}`)
      .join('\n\n');

    res.json({
      lessonPrompt,
      syllabusPrompt,
      chatSplitPrompt: splitPrompts.chatSplitPrompt,
      sectionId: slot.id,
      dayIndex: slot.dayIndex,
      date: slot.date,
      title: slot.title,
      pdfSegment: slot.pdfSegment,
      sectionExtractedText: nonPdfExtractedText,
      sourcePdfFiles: pdfMetas.map((pm) => pm.fileName),
    });
  });

  // 13. Import single-lesson content from Chat Mode (or file import) with supplemental assets
  app.post('/api/courses/:courseId/days/:dayIndex/import', async (req, res) => {
    try {
      const { courseId, dayIndex } = req.params;
      const dayNum = Number(dayIndex);
      const { rawContent, lessonData, uploadedAssets = {}, sourceMode = 'chat' } = req.body || {};

      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }
      const slot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
      if (!slot) {
        res.status(404).json({ error: '未找到指定日期的学习计划' });
        return;
      }

      if (!course.customAssets) {
        course.customAssets = {};
      }
      for (const [k, v] of Object.entries(uploadedAssets)) {
        if (typeof v === 'string' && v) {
          course.customAssets[k] = v;
        }
      }

      let finalLesson: DailyLessonContent;
      if (lessonData && typeof lessonData === 'object') {
        finalLesson = resolveLessonAssetReferences(
          sanitizeLessonCitations({
            ...lessonData,
            sectionId: slot.id,
            dayIndex: slot.dayIndex,
            date: slot.date,
            sourceMode: sourceMode === 'agent' ? 'agent' : 'chat',
            generatedAt: new Date().toISOString(),
          }),
          course.customAssets
        );
      } else {
        const parsed = parseImportedLessonContent(
          String(rawContent || ''),
          slot,
          sourceMode === 'agent' ? 'agent' : 'chat',
          course.customAssets
        );
        finalLesson = parsed.lesson;
      }

      slot.lesson = sanitizeLessonCitations(finalLesson);
      slot.title = slot.lesson.title || slot.title;

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);
      res.json({ course, lesson: finalLesson });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || '解析导入课件失败' });
    }
  });

  // 14. Import Chat/Agent Syllabus JSON into course without overwriting existing lessons
  app.post('/api/courses/:courseId/import-syllabus', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { rawContent, confirmOutline } = req.body || {};
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const parsed = parseImportedSyllabusContent(
        String(rawContent || ''),
        course.startDate,
        course.durationDays,
        course.dailyPlan
      );
      if (parsed.knowledgeCatalog.length > 0) {
        course.knowledgeCatalog = parsed.knowledgeCatalog;
      }
      course.dailyPlan = parsed.dailyPlan.map((slot) => ({
        ...slot,
        pdfSegment: resolveSlotPdfSegment(slot, course.pdfSplitPlan) || slot.pdfSegment,
      }));
      if (confirmOutline) {
        course.outlineConfirmed = true;
        course.outlineConfirmedAt = new Date().toISOString();
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({ course });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || '导入课程目录失败' });
    }
  });

  // 15. Update / edit an existing lesson or upload supplemental images
  app.put('/api/courses/:courseId/days/:dayIndex/lesson', async (req, res) => {
    const { courseId, dayIndex } = req.params;
    const dayNum = Number(dayIndex);
    const { title, summary, markdownBody, uploadedAssets = {} } = req.body || {};

    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const slot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
    if (!slot || !slot.lesson) {
      res.status(404).json({ error: '未找到该节课件' });
      return;
    }

    if (!course.customAssets) course.customAssets = {};
    for (const [k, v] of Object.entries(uploadedAssets)) {
      if (typeof v === 'string' && v) {
        course.customAssets[k] = v;
      }
    }

    if (typeof title === 'string' && title.trim()) {
      const cleanTitle = stripAiCitationArtifacts(title.trim());
      slot.lesson.title = cleanTitle;
      slot.title = cleanTitle;
    }
    if (typeof summary === 'string') {
      slot.lesson.summary = stripAiCitationArtifacts(summary);
    }
    if (typeof markdownBody === 'string') {
      slot.lesson.markdownBody = stripAiCitationArtifacts(markdownBody);
    }

    slot.lesson = resolveLessonAssetReferences(
      sanitizeLessonCitations(slot.lesson),
      course.customAssets
    );
    const settings = loadSettings();
    await persistCourseToFolder(course, settings);
    saveDb(db);
    res.json({ course, lesson: slot.lesson });
  });

  // 16. Delete a course (explicitly supports deleting or preserving the local `courses/<课程名称>/` folder via Python backend)
  app.delete('/api/courses/:courseId', async (req, res) => {
    const { courseId } = req.params;
    const deleteFolder = req.query.deleteFolder !== 'false';
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);

    if (course) {
      const { folderName, absCourseDir } = getCourseDirectory(course);
      if (deleteFolder) {
        let deletedViaPython = false;
        try {
          const pyRes = await callPythonJson(
            `/api/py/courses/folder?folder=${encodeURIComponent(folderName)}`,
            { method: 'DELETE' }
          );
          if (pyRes.status >= 200 && pyRes.status < 300) {
            deletedViaPython = true;
          }
        } catch {
          // Fallback to Node fs below
        }
        if (!deletedViaPython && fs.existsSync(absCourseDir)) {
          fs.rmSync(absCourseDir, { recursive: true, force: true });
        }
        if (fs.existsSync(absCourseDir)) {
          res.status(500).json({ error: `未能彻底删除课程文件夹 courses/${folderName}，请检查文件是否被其他程序占用。` });
          return;
        }
      } else {
        // Keep folder on disk for backup/migration, mark archived in course.json
        const cJsonPath = path.join(absCourseDir, 'course.json');
        if (fs.existsSync(cJsonPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(cJsonPath, 'utf-8'));
            raw.archived = true;
            fs.writeFileSync(cJsonPath, JSON.stringify(raw, null, 2), 'utf-8');
          } catch {
            // ignore
          }
        }
      }
    }

    db.courses = db.courses.filter((c) => c.id !== courseId);
    saveDb(db);
    res.json({ ok: true, deletedFolder: deleteFolder });
  });

  // 17. Generate or regenerate the lesson for a specific dayIndex via API Mode
  app.post('/api/courses/:courseId/days/:dayIndex/generate', async (req, res) => {
    try {
      const { courseId, dayIndex } = req.params;
      const dayNum = Number(dayIndex);
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }
      const slot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
      if (!slot) {
        res.status(404).json({ error: '未找到指定日期的学习计划' });
        return;
      }

      const lesson = await generateDailyLesson(course, slot);
      slot.lesson = lesson;
      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({ course, lesson });
    } catch (err: any) {
      console.error('Error generating daily lesson:', err);
      res.status(500).json({ error: err?.message || '生成课件失败' });
    }
  });

  // 18. Save offline-graded exercise submission
  app.post('/api/courses/:courseId/exercises', async (req, res) => {
    const { courseId } = req.params;
    const { date, userAnswers, score, total } = req.body || {};
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    course.exerciseSubmissions[date] = {
      userAnswers: userAnswers || {},
      score: Number(score) || 0,
      total: Number(total) || 0,
      submittedAt: new Date().toISOString(),
    };
    const settings = loadSettings();
    await persistCourseToFolder(course, settings);
    saveDb(db);
    res.json({ course });
  });

  // 19. Save user's reverse-explanation self-check notes
  app.post('/api/courses/:courseId/reverse-checks', async (req, res) => {
    const { courseId } = req.params;
    const { date, checkId, userExplanation } = req.body || {};
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    if (!course.reverseCheckNotes) {
      course.reverseCheckNotes = {};
    }
    if (!course.reverseCheckNotes[date]) {
      course.reverseCheckNotes[date] = {};
    }
    course.reverseCheckNotes[date][checkId] = String(userExplanation || '');
    const settings = loadSettings();
    await persistCourseToFolder(course, settings);
    saveDb(db);
    res.json({ course });
  });

  // 20. Toggle vocabulary mastery status
  app.post('/api/courses/:courseId/vocab-mastery', async (req, res) => {
    const { courseId } = req.params;
    const { word } = req.body || {};
    if (!word) {
      res.status(400).json({ error: '缺少单词参数' });
      return;
    }
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const normalized = String(word).trim().toLowerCase();
    const idx = course.masteredWords.indexOf(normalized);
    if (idx >= 0) {
      course.masteredWords.splice(idx, 1);
    } else {
      course.masteredWords.push(normalized);
    }
    const settings = loadSettings();
    await persistCourseToFolder(course, settings);
    saveDb(db);
    res.json({ masteredWords: course.masteredWords });
  });

  // 21. Scan and restore any backed-up or migrated folders inside `courses/`
  app.post('/api/courses/scan-disk', (_req, res) => {
    if (fs.existsSync(COURSES_ROOT)) {
      const entries = fs.readdirSync(COURSES_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const cJsonPath = path.join(COURSES_ROOT, entry.name, 'course.json');
        if (fs.existsSync(cJsonPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(cJsonPath, 'utf-8'));
            if (raw.archived) {
              delete raw.archived;
              fs.writeFileSync(cJsonPath, JSON.stringify(raw, null, 2), 'utf-8');
            }
          } catch {
            // ignore
          }
        }
      }
    }
    const db = loadDb();
    saveDb(db);
    res.json({ courses: db.courses });
  });

  // 22. Python Backend Health & Proxy Endpoints
  app.get('/api/backend/health', async (_req, res) => {
    const ready = await ensurePythonBackendReady();
    if (!ready) {
      res.status(503).json({ ok: false, engine: 'node-only', error: 'Python 后端未就绪' });
      return;
    }
    try {
      const pyRes = await callPythonJson('/api/py/health');
      res.status(pyRes.status).json(pyRes.data);
    } catch (err: any) {
      res.status(503).json({ ok: false, error: err?.message || 'Python 后端连接失败' });
    }
  });

  // 23. List real files inside a course folder (delegated to Python backend)
  app.get('/api/courses/:courseId/files', async (req, res) => {
    const { courseId } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { folderName } = getCourseDirectory(course);
    try {
      const pyRes = await callPythonJson(
        `/api/py/courses/files?folder=${encodeURIComponent(folderName)}`
      );
      res.status(pyRes.status).json({
        ...pyRes.data,
        backendEngine: 'python',
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '获取本地文件列表失败' });
    }
  });

  // 24. Preview or download any file inside a course folder (via Python backend)
  app.get('/api/courses/:courseId/files/download', async (req, res) => {
    const { courseId } = req.params;
    const relPath = String(req.query.path || '');
    const download = req.query.download === '1' ? '1' : '0';
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { folderName } = getCourseDirectory(course);
    try {
      await ensurePythonBackendReady();
      const upstream = await fetch(
        `${PYTHON_BACKEND_URL}/api/py/courses/files/download?folder=${encodeURIComponent(folderName)}&path=${encodeURIComponent(relPath)}&download=${download}`
      );
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type');
      const disp = upstream.headers.get('content-disposition');
      if (contentType) res.setHeader('Content-Type', contentType);
      if (disp) res.setHeader('Content-Disposition', disp);
      res.status(upstream.status).send(buf);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '读取本地文件失败' });
    }
  });

  // 25. Upload additional file into course `sources/` or `assets/` via Python backend
  app.post('/api/courses/:courseId/files/upload', async (req, res) => {
    try {
      const { courseId } = req.params;
      const { category = 'sources', fileName, base64Data, textContent } = req.body || {};
      if (!fileName || typeof fileName !== 'string') {
        res.status(400).json({ error: '缺少文件名' });
        return;
      }
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const { folderName, absCourseDir, relCourseDir } = getCourseDirectory(course);
      const pyRes = await callPythonJson('/api/py/courses/files/upload', {
        method: 'POST',
        body: {
          folder: folderName,
          category,
          fileName,
          base64Data,
          textContent,
        },
      });
      if (pyRes.status >= 400) {
        res.status(pyRes.status).json(pyRes.data);
        return;
      }

      const savedName = pyRes.data.fileName as string;
      const savedRelPath = `${relCourseDir}/${category}/${savedName}`;

      if (category === 'sources') {
        const isPdf = savedName.toLowerCase().endsWith('.pdf');
        let extractedText = typeof textContent === 'string' ? textContent.slice(0, 60000) : '';
        let pdfMeta: PdfDocumentMeta | undefined;

        if (isPdf && typeof base64Data === 'string' && base64Data) {
          try {
            const rawPayload = base64Data.includes(',') ? base64Data.split(',', 1)[1] : base64Data;
            const buf = Buffer.from(rawPayload, 'base64');
            const analyzed = await analyzePdfBuffer(buf, savedName);
            pdfMeta = analyzed.meta;
            extractedText = `[PDF 原文件: ${savedName}, 共 ${analyzed.meta.totalPages} 页]`;
            const absSourceFile = path.join(absCourseDir, 'sources', savedName);
            fs.writeFileSync(`${absSourceFile}.pages.json`, JSON.stringify(analyzed.meta, null, 2), 'utf-8');
          } catch {
            // ignore PDF analysis errors
          }
        } else if (!isPdf && extractedText) {
          const absTxt = path.join(absCourseDir, 'sources', `${savedName}.txt`);
          if (!savedName.endsWith('.txt') && !fs.existsSync(absTxt)) {
            fs.writeFileSync(absTxt, extractedText, 'utf-8');
          }
        }

        const existingIdx = course.materials.findIndex((m) => m.fileName === savedName);
        const newMaterial: UploadedMaterial = {
          id: existingIdx >= 0 ? course.materials[existingIdx].id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: savedName,
          fileSize: Number(pyRes.data.size) || 0,
          extractedText: extractedText || `[资料文件: ${savedName}]`,
          isPdf,
          totalPages: pdfMeta?.totalPages,
          detectedPageOffset: pdfMeta?.detectedPageOffset,
          tocEntries: pdfMeta?.tocEntries,
          pages: pdfMeta?.pages,
          sourceRelPath: savedRelPath,
        };
        if (existingIdx >= 0) {
          course.materials[existingIdx] = newMaterial;
        } else {
          course.materials.push(newMaterial);
        }
      } else if (category === 'assets' && typeof base64Data === 'string' && base64Data) {
        if (!course.customAssets) course.customAssets = {};
        const dataUrl = base64Data.startsWith('data:')
          ? base64Data
          : `data:image/png;base64,${base64Data}`;
        course.customAssets[savedName] = dataUrl;
        course.customAssets[`assets/${savedName}`] = dataUrl;
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      const listRes = await callPythonJson(
        `/api/py/courses/files?folder=${encodeURIComponent(folderName)}`
      );
      res.json({
        ok: true,
        course,
        uploaded: pyRes.data,
        files: listRes.data?.files || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '上传课程文件失败' });
    }
  });

  // 26. Delete a single file inside a course folder (delegated to Python backend + full metadata sync)
  app.delete('/api/courses/:courseId/files', async (req, res) => {
    try {
      const { courseId } = req.params;
      const relPath = String(req.query.path || '');
      if (!relPath) {
        res.status(400).json({ error: '缺少要删除的文件路径 path 参数' });
        return;
      }
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }

      const { folderName } = getCourseDirectory(course);
      const pyRes = await callPythonJson(
        `/api/py/courses/files?folder=${encodeURIComponent(folderName)}&path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      if (pyRes.status >= 400) {
        res.status(pyRes.status).json(pyRes.data);
        return;
      }

      const deletedList: string[] = Array.isArray(pyRes.data?.deleted)
        ? pyRes.data.deleted
        : [relPath];
      const deletedSet = new Set(deletedList.map((p) => p.replace(/\\/g, '/')));

      // Synchronize course state with deleted files
      for (const delRel of deletedSet) {
        if (delRel.startsWith('sources/')) {
          const baseName = path.basename(delRel);
          course.materials = (course.materials || []).filter(
            (m) => m.fileName !== baseName && m.sourceRelPath !== `courses/${folderName}/${delRel}`
          );
        } else if (delRel.startsWith('segments/')) {
          const baseName = path.basename(delRel);
          const stem = baseName.replace(/\.(pdf|txt)$/i, '');
          if (Array.isArray(course.pdfSplitPlan)) {
            for (const item of course.pdfSplitPlan) {
              if (item.sectionId === stem || item.segmentFileName === baseName) {
                item.status = 'planned';
                item.slicedAt = undefined;
                item.segmentPageCount = undefined;
                item.extractedSegmentText = undefined;
              }
            }
          }
          for (const slot of course.dailyPlan) {
            if (slot.pdfSegment && (slot.pdfSegment.sectionId === stem || slot.pdfSegment.segmentFileName === baseName)) {
              slot.pdfSegment.status = 'planned';
              slot.pdfSegment.slicedAt = undefined;
              slot.pdfSegment.segmentPageCount = undefined;
              slot.pdfSegment.extractedSegmentText = undefined;
            }
          }
        } else if (delRel.startsWith('lessons/')) {
          const stem = path.basename(delRel).replace(/\.(json|md)$/i, '');
          const dayMatch = stem.match(/^(?:sec|day)-0*(\d+)$/i);
          const dayNum = dayMatch ? Number(dayMatch[1]) : NaN;
          for (const slot of course.dailyPlan) {
            if (slot.id === stem || (!Number.isNaN(dayNum) && slot.dayIndex === dayNum)) {
              slot.lesson = undefined;
            }
          }
        } else if (delRel.startsWith('assets/')) {
          const baseName = path.basename(delRel);
          if (course.customAssets) {
            delete course.customAssets[baseName];
            delete course.customAssets[`assets/${baseName}`];
          }
        }
      }

      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      const listRes = await callPythonJson(
        `/api/py/courses/files?folder=${encodeURIComponent(folderName)}`
      );
      res.json({
        ok: true,
        deleted: deletedList,
        course,
        files: listRes.data?.files || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '删除本地文件失败' });
    }
  });

  // 27. Delete a single generated lesson (`lessons/sec-XX.json` & `day-XX.json`) via Python backend
  app.delete('/api/courses/:courseId/days/:dayIndex/lesson', async (req, res) => {
    try {
      const { courseId, dayIndex } = req.params;
      const dayNum = Number(dayIndex);
      const db = loadDb();
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) {
        res.status(404).json({ error: '未找到该课程' });
        return;
      }
      const slot = course.dailyPlan.find((d) => d.dayIndex === dayNum);
      if (!slot) {
        res.status(404).json({ error: '未找到指定小节' });
        return;
      }

      const { folderName } = getCourseDirectory(course);
      const secId = ensureStableSectionId(slot.dayIndex, slot.id);
      await callPythonJson(
        `/api/py/courses/files?folder=${encodeURIComponent(folderName)}&path=${encodeURIComponent(`lessons/${secId}.json`)}`,
        { method: 'DELETE' }
      ).catch(() => null);

      slot.lesson = undefined;
      const settings = loadSettings();
      await persistCourseToFolder(course, settings);
      saveDb(db);

      res.json({ ok: true, course });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '删除小节课件失败' });
    }
  });

  // 28. Serve an asset image directly from `courses/<课程名称>/assets/<fileName>`
  app.get('/api/courses/:courseId/assets/:fileName', (req, res) => {
    const { courseId, fileName } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { absCourseDir } = getCourseDirectory(course);
    const safeName = path.basename(fileName);
    const absFile = path.join(absCourseDir, 'assets', safeName);
    if (!fs.existsSync(absFile)) {
      res.status(404).json({ error: '未找到该资源文件' });
      return;
    }
    res.sendFile(absFile);
  });

  // 29. Export entire course directory as ZIP backup (via Python backend)
  app.get('/api/courses/:courseId/backup', async (req, res) => {
    const { courseId } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { folderName } = getCourseDirectory(course);
    try {
      await ensurePythonBackendReady();
      const upstream = await fetch(
        `${PYTHON_BACKEND_URL}/api/py/courses/backup?folder=${encodeURIComponent(folderName)}`
      );
      if (!upstream.ok) {
        const errText = await upstream.text();
        res.status(upstream.status).send(errText);
        return;
      }
      const zipBuf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', 'application/zip');
      const disp = upstream.headers.get('content-disposition');
      if (disp) res.setHeader('Content-Disposition', disp);
      res.send(zipBuf);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '打包课程备份失败' });
    }
  });

  // 30. Restore / Import course backup ZIP into `courses/` (via Python backend)
  app.post('/api/courses/restore-backup', async (req, res) => {
    try {
      const { fileName, base64Zip } = req.body || {};
      if (!base64Zip || typeof base64Zip !== 'string') {
        res.status(400).json({ error: '缺少 ZIP 备份数据' });
        return;
      }
      const pyRes = await callPythonJson('/api/py/courses/restore', {
        method: 'POST',
        body: { fileName, base64Zip },
      });
      if (pyRes.status >= 400) {
        res.status(pyRes.status).json(pyRes.data);
        return;
      }
      const db = loadDb();
      saveDb(db);
      res.json({
        ok: true,
        restored: pyRes.data,
        courses: db.courses,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '导入课程备份失败' });
    }
  });

  // 31. Open course local folder in OS file explorer (Windows/macOS/Desktop Linux via Python backend)
  app.post('/api/courses/:courseId/open-folder', async (req, res) => {
    const { courseId } = req.params;
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { folderName } = getCourseDirectory(course);
    try {
      const pyRes = await callPythonJson('/api/py/courses/open-folder', {
        method: 'POST',
        body: { folder: folderName },
      });
      res.status(pyRes.status).json(pyRes.data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '打开本地目录失败' });
    }
  });

  // 31b. Copy a course disk file (e.g. segment PDF / source PDF) to OS file clipboard (Ctrl+V ready)
  app.post('/api/courses/:courseId/files/copy-clipboard', async (req, res) => {
    const { courseId } = req.params;
    const rawRelPath = String(req.body?.path || '').trim();
    if (!rawRelPath) {
      res.status(400).json({ error: '缺少文件相对路径 path' });
      return;
    }
    const db = loadDb();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: '未找到该课程' });
      return;
    }
    const { folderName, relCourseDir } = getCourseDirectory(course);
    let normalizedRel = rawRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalizedRel.startsWith(`${relCourseDir}/`)) {
      normalizedRel = normalizedRel.slice(relCourseDir.length + 1);
    }
    try {
      const pyRes = await callPythonJson('/api/py/courses/files/copy-clipboard', {
        method: 'POST',
        body: { folder: folderName, path: normalizedRel },
      });
      res.status(pyRes.status).json({
        ...pyRes.data,
        downloadUrl: `/api/courses/${courseId}/files/download?path=${encodeURIComponent(normalizedRel)}&download=1`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || '复制文件到系统剪贴板失败' });
    }
  });

  // 32. Test LLM API connectivity server-side (via Python backend)
  app.post('/api/settings/test', async (req, res) => {
    try {
      const current = loadSettings();
      const body = req.body || {};
      const pyRes = await callPythonJson('/api/py/settings/test-llm', {
        method: 'POST',
        body: {
          providerMode: body.providerMode || current.providerMode,
          apiBaseUrl: body.apiBaseUrl || current.apiBaseUrl,
          modelName: body.modelName || current.modelName,
          apiKey: body.newApiKey || current.customApiKey,
        },
      });
      res.status(pyRes.status).json(pyRes.data);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '测试接口连通性失败' });
    }
  });

  await ensurePythonBackendReady();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Learn_everything server listening on http://localhost:${PORT}`);
  });
}

startServer();
