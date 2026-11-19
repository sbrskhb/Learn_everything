import { copyPromptText } from '../utils/clipboardFile';
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Download,
  FolderSync,
  Upload,
  X,
} from 'lucide-react';
import type { Course } from '../types';

interface AgentModeModalProps {
  isOpen: boolean;
  course: Course | null;
  onClose: () => void;
  onCourseUpdated: (course: Course) => void;
}

interface AgentWorkspaceInfo {
  prompt: string;
  agentSplitPrompt?: string;
  agentSyllabusPrompt?: string;
  workspaceDir: string;
  manifestPath: string;
  syllabusPath: string;
  sourcesDir?: string;
  segmentsDir?: string;
  lessonsDir: string;
  assetsDir: string;
  promptFilePath: string;
  materialFilePaths: string[];
  completedCount: number;
  totalDays: number;
}

export const AgentModeModal: React.FC<AgentModeModalProps> = ({
  isOpen,
  course,
  onClose,
  onCourseUpdated,
}) => {
  return (
    <AnimatePresence>
      {isOpen && course && (
        <AgentModeModalInner
          key={course.id}
          course={course}
          onClose={onClose}
          onCourseUpdated={onCourseUpdated}
        />
      )}
    </AnimatePresence>
  );
};

const AgentModeModalInner: React.FC<{
  course: Course;
  onClose: () => void;
  onCourseUpdated: (course: Course) => void;
}> = ({ course, onClose, onCourseUpdated }) => {
  const isOpen = true;
  const [info, setInfo] = useState<AgentWorkspaceInfo | null>(null);
  const [promptTab, setPromptTab] = useState<'pdf_split' | 'syllabus' | 'lessons'>('pdf_split');
  const [selectedLessonDay, setSelectedLessonDay] = useState<number | 'index'>('index');
  const [selectedLessonStage, setSelectedLessonStage] = useState<'stage1' | 'stage2'>('stage1');
  const [sectionAgentPrompts, setSectionAgentPrompts] = useState<{
    sectionId: string;
    stage1: string;
    stage2: string;
    stage1Path: string;
    stage2Path: string;
  } | null>(null);
  const [isLoadingSectionPrompt, setIsLoadingSectionPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !course) return;
    setSyncMessage(null);
    setErrorMsg(null);
    setIsLoading(true);
    const hasPdf = course.materials?.some(
      (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
    );
    if (course.outlineConfirmed) {
      setPromptTab('lessons');
    } else if (hasPdf && (!course.pdfSplitPlan || course.pdfSplitPlan.length === 0)) {
      setPromptTab('pdf_split');
    } else if (hasPdf) {
      setPromptTab('syllabus');
    } else {
      setPromptTab('syllabus');
    }
    fetch(`/api/courses/${course.id}/agent-prompt`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.prompt) {
          setInfo(data);
        }
      })
      .catch(() => {
        setErrorMsg('读取 Agent 执行提示词失败');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, course]);

  useEffect(() => {
    if (promptTab !== 'lessons' || selectedLessonDay === 'index') {
      setSectionAgentPrompts(null);
      return;
    }
    let cancelled = false;
    setIsLoadingSectionPrompt(true);
    fetch(`/api/courses/${course.id}/days/${selectedLessonDay}/chat-prompt`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data) return;
        setSectionAgentPrompts({
          sectionId: data.sectionId || `sec-${String(selectedLessonDay).padStart(2, '0')}`,
          stage1: data.agentStage1Prompt || '',
          stage2: data.agentStage2Prompt || '',
          stage1Path: data.agentStage1PromptMdRelPath || '',
          stage2Path: data.agentStage2PromptMdRelPath || '',
        });
        if (!data.agentStage2Prompt && selectedLessonStage === 'stage2') {
          setSelectedLessonStage('stage1');
        }
      })
      .catch(() => {
        if (!cancelled) setSectionAgentPrompts(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSectionPrompt(false);
      });
    return () => {
      cancelled = true;
    };
  }, [course.id, promptTab, selectedLessonDay]);

  const activePromptText =
    promptTab === 'pdf_split'
      ? info?.agentSplitPrompt || ''
      : promptTab === 'syllabus'
        ? info?.agentSyllabusPrompt || ''
        : selectedLessonDay === 'index'
          ? info?.prompt || ''
          : selectedLessonStage === 'stage2'
            ? sectionAgentPrompts?.stage2 || '当前小节暂无阶段二 SVG 规格（需先完成阶段一或本节无需配图）。'
            : sectionAgentPrompts?.stage1 || '';

  const handleCopyPrompt = async () => {
    if (!activePromptText) return;
    try {
      await copyPromptText(activePromptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
    }
  };

  const handleDownloadPrompt = () => {
    if (!activePromptText) return;
    const blob = new Blob([activePromptText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      promptTab === 'pdf_split'
        ? `${course.folderName || course.name}_AGENT_PDF_SPLIT_PROMPT.md`
        : promptTab === 'syllabus'
          ? `${course.folderName || course.name}_AGENT_SYLLABUS_PROMPT.md`
          : selectedLessonDay === 'index'
            ? `${course.folderName || course.name}_AGENT_TASK_PROMPT.md`
            : `${course.folderName || course.name}_${sectionAgentPrompts?.sectionId || `sec-${String(selectedLessonDay).padStart(2, '0')}`}_agent-${selectedLessonStage}-prompt.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSyncDirectory = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/agent-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceOverwrite }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '同步失败');
      }
      onCourseUpdated(data.course);
      const promptRes = await fetch(`/api/courses/${course.id}/agent-prompt`);
      if (promptRes.ok) {
        setInfo(await promptRes.json());
      }
      const importedCount = Array.isArray(data.importedDays) ? data.importedDays.length : 0;
      if (importedCount > 0 || data.syllabusUpdated || data.splitPlanUpdated) {
        setSyncMessage(
          `同步完成：从本地目录关联了 ${importedCount} 节课件${
            data.syllabusUpdated ? '，并同步了 outline.json' : ''
          }${data.splitPlanUpdated ? '，并更新了 segments/split-plan.json' : ''}。`
        );
      } else {
        setSyncMessage('已扫描本地课程文件夹，当前没有检测到新的待导入课件文件。');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '同步 Agent 目录失败');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBatchUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsSyncing(true);
    setSyncMessage(null);
    setErrorMsg(null);
    try {
      const uploadedFiles: Array<{ fileName: string; content: string }> = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const content = await f.text();
        uploadedFiles.push({ fileName: f.name, content });
      }

      const res = await fetch(`/api/courses/${course.id}/agent-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceOverwrite,
          uploadedFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '导入文件失败');
      }
      onCourseUpdated(data.course);
      const promptRes = await fetch(`/api/courses/${course.id}/agent-prompt`);
      if (promptRes.ok) {
        setInfo(await promptRes.json());
      }
      const importedCount = Array.isArray(data.importedDays) ? data.importedDays.length : 0;
      setSyncMessage(`成功从所选文件导入并关联了 ${importedCount} 节课件。`);
    } catch (err: any) {
      setErrorMsg(err?.message || '批量导入课件文件失败');
    } finally {
      setIsSyncing(false);
      e.target.value = '';
    }
  };

  const generatedCount = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
  const folderRel =
    info?.workspaceDir || course.courseDirPath || `courses/${course.folderName || course.id}`;

  return (
        <motion.div
          key="agent-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-modal-title"
        >
          <motion.div
            key="agent-modal-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.21, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border w-full max-w-3xl bg-black border border-neutral-800 rounded-md p-6 my-8 max-h-[92vh] overflow-y-auto space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div>
                <h2 id="agent-modal-title" className="font-display text-lg font-semibold text-white">
                  Agent 课件模式 — 《{course.name}》
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              面向 Antigravity、Codex 等具备文件操作能力的 AI Agent，支持课程目录、PDF 切分与逐节课件生成
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 Agent 模式窗口"
            className="p-1.5 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. 本地独立课程文件夹结构与进度 */}
        <div className="border border-neutral-900 rounded p-4 bg-neutral-950/50 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-white">
              一、本地独立课程文件夹结构与进度
            </span>
            <span className="font-mono text-neutral-300">
              {course.dailyPlan.length > 0
                ? `已完成课件：${generatedCount} / ${course.dailyPlan.length} 节`
                : '已完成课件：0 节（待第 2 步生成课程大纲）'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 font-mono text-neutral-400">
            <div>
              <span className="text-neutral-500">课程根目录：</span>
              <span className="text-neutral-200">{folderRel}/</span>
            </div>
            <div>
              <span className="text-neutral-500">课程配置：</span>
              <span className="text-neutral-200">{folderRel}/course.json</span>
            </div>
            <div>
              <span className="text-neutral-500">完整课程目录：</span>
              <span className="text-neutral-200">{folderRel}/outline.json</span>
            </div>
            <div>
              <span className="text-neutral-500">原始资料目录：</span>
              <span className="text-neutral-200">{folderRel}/sources/</span>
            </div>
            <div>
              <span className="text-neutral-500">切分 PDF 目录：</span>
              <span className="text-neutral-200">{folderRel}/segments/</span>
            </div>
            <div>
              <span className="text-neutral-500">已生成课件目录：</span>
              <span className="text-neutral-200">{folderRel}/lessons/</span>
            </div>
            <div className="md:col-span-2">
              <span className="text-neutral-500">单节独立提示词目录：</span>
              <span className="text-neutral-200">{folderRel}/prompts/sec-XX/</span>
              <span className="text-neutral-500 ml-2">(agent-stage1-prompt.md / agent-stage2-prompt.md)</span>
            </div>
          </div>

          <p className="text-neutral-500 leading-relaxed">
            标准三步顺序：1. 先执行「PDF 区域划分与切割」写入 <code className="text-neutral-300">segments/split-plan.json</code> 并用脚本切出 <code className="text-neutral-300">segments/region-XX.pdf</code>；2. 再执行「生成课程大纲」写入 <code className="text-neutral-300">outline.json</code>；3. 最后「逐节生成课件」写入 <code className="text-neutral-300">lessons/sec-01.json</code> ~ <code className="text-neutral-300">sec-{String(Math.max(1, course.dailyPlan.length || 1)).padStart(2, '0')}.json</code>（写完课件时评估预计学时，再按天自动排程）。
          </p>
        </div>

        {/* 2. Agent 执行提示词切换与复制 */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPromptTab('pdf_split')}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  promptTab === 'pdf_split'
                    ? 'border-white bg-neutral-900 text-white'
                    : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                1. PDF 区域划分与切割
              </button>
              <button
                type="button"
                onClick={() => setPromptTab('syllabus')}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  promptTab === 'syllabus'
                    ? 'border-white bg-neutral-900 text-white'
                    : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                2. 生成课程大纲
              </button>
              <button
                type="button"
                onClick={() => setPromptTab('lessons')}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  promptTab === 'lessons'
                    ? 'border-white bg-neutral-900 text-white'
                    : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                3. 逐节生成课件
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyPrompt}
                disabled={isLoading || !activePromptText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>已复制提示词</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>一键复制提示词</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadPrompt}
                disabled={isLoading || !activePromptText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>导出提示词 (.md)</span>
              </button>
            </div>
          </div>

          {promptTab === 'lessons' && course.dailyPlan.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950/70 border border-neutral-900 rounded px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-neutral-400">提示词粒度：</span>
                <select
                  aria-label="选择 Agent 提示词范围"
                  value={selectedLessonDay}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedLessonDay(val === 'index' ? 'index' : Number(val));
                  }}
                  className="bg-black border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none"
                >
                  <option value="index">全课程总览索引 (AGENT_TASK_PROMPT.md)</option>
                  {course.dailyPlan.map((d) => (
                    <option key={d.id || d.dayIndex} value={d.dayIndex}>
                      {d.id} · 第 {d.dayIndex} 讲：{d.title}
                    </option>
                  ))}
                </select>
                {selectedLessonDay !== 'index' && (
                  <div className="inline-flex items-center gap-1 border border-neutral-800 rounded p-0.5 bg-black">
                    <button
                      type="button"
                      onClick={() => setSelectedLessonStage('stage1')}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                        selectedLessonStage === 'stage1'
                          ? 'bg-white text-black font-medium'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      阶段一内容
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLessonStage('stage2')}
                      disabled={!sectionAgentPrompts?.stage2}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors disabled:opacity-40 ${
                        selectedLessonStage === 'stage2'
                          ? 'bg-white text-black font-medium'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      阶段二 SVG
                    </button>
                  </div>
                )}
              </div>
              {selectedLessonDay !== 'index' && sectionAgentPrompts && (
                <span className="font-mono text-[11px] text-neutral-500">
                  {selectedLessonStage === 'stage2'
                    ? sectionAgentPrompts.stage2Path || `prompts/${sectionAgentPrompts.sectionId}/agent-stage2-prompt.md`
                    : sectionAgentPrompts.stage1Path || `prompts/${sectionAgentPrompts.sectionId}/agent-stage1-prompt.md`}
                </span>
              )}
            </div>
          )}

          <textarea
            id="agent-prompt-textarea"
            readOnly
            rows={12}
            value={
              isLoading || isLoadingSectionPrompt
                ? '正在生成 Agent 执行提示词...'
                : activePromptText
            }
            className="w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-300 leading-relaxed focus:outline-none"
          />
        </div>

        {/* 3. 识别与关联 Agent 生成结果 */}
        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-white">
                三、扫描同步本地课程文件夹 (outline.json / segments/ / lessons/)
              </div>
              <div className="text-xs text-neutral-500">
                支持从 {folderRel}/ 自动扫描关联，或直接选择 Agent 生成的 sec-XX.json / day-XX.json 文件批量导入
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={forceOverwrite}
                onChange={(e) => setForceOverwrite(e.target.checked)}
                className="accent-white"
              />
              <span>覆盖已有课件（默认不勾选以保护已有内容，支持断点续写）</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSyncDirectory}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
            >
              <FolderSync className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? '正在扫描并同步...' : '扫描并同步本地课程文件夹'}</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 rounded cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>选择文件批量导入 (sec-XX.json / outline.json / split-plan.json)</span>
              <input
                type="file"
                multiple
                accept=".json,.md"
                onChange={handleBatchUploadFiles}
                className="hidden"
              />
            </label>
          </div>

          {syncMessage && (
            <div className="text-xs text-emerald-400 border border-emerald-900/60 bg-emerald-950/30 rounded px-3 py-2">
              {syncMessage}
            </div>
          )}
          {errorMsg && (
            <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-3 py-2">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-neutral-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 rounded transition-colors"
          >
            关闭
          </button>
        </div>
          </motion.div>
        </motion.div>
  );
};
