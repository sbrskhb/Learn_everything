import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bot, Cpu, Layers, MessageSquare, Sparkles, X } from 'lucide-react';
import type { CourseGenerationMode } from '../types';

interface WelcomeModalProps {
  isOpen: boolean;
  initialMode: CourseGenerationMode;
  onClose: (chosenMode: CourseGenerationMode, openCreateCourse: boolean) => void;
}

const MODE_OPTIONS: Array<{
  id: CourseGenerationMode;
  code: string;
  title: string;
  subtitle: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'agent',
    code: 'AGENT // WORKSPACE',
    title: 'Agent 课件模式',
    subtitle: '配合 Cursor / Codex / Claude Code 本地工作区协同',
    desc: '零 API 额度消耗。系统导出结构化提示词，由本地 Agent 直接读写 courses/ 文件夹、切分 PDF 并同步生成课件。',
    icon: Bot,
  },
  {
    id: 'chat',
    code: 'CHAT // PROMPT',
    title: 'Chat 课件模式',
    subtitle: '配合任意网页 AI 对话（Gemini / ChatGPT / Claude）',
    desc: '无需配置 Key。按步骤复制结构化提示词与无损切分的小节 PDF 发送给网页 AI，粘贴回传内容即可预览保存。',
    icon: MessageSquare,
  },
  {
    id: 'api',
    code: 'API // STREAM',
    title: 'API 自动生成',
    subtitle: '服务端多模态模型直连，一键全自动流式构建',
    desc: '配置内置 Gemini 或 OpenAI 兼容端点后，全自动完成 PDF 物理页切分、课程大纲规划与实时流式课件输出。',
    icon: Cpu,
  },
];

const WORKFLOW_STEPS = [
  {
    num: '01',
    title: '提交资料与目标',
    desc: '设定课程目标与天数，支持百兆级教材 PDF 分块上传或英语词库集合分配。',
  },
  {
    num: '02',
    title: '智能切片与大纲确认',
    desc: '多模态 AI 按章节确定 PDF 物理页区间并无损切片，生成可微调的每日课程目录。',
  },
  {
    num: '03',
    title: '按日历沉浸学习',
    desc: '进入每日课件阅读完整公式推导、可缩放电路/几何图示，并完成离线自测批改。',
  },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  initialMode,
  onClose,
}) => {
  const [selectedMode, setSelectedMode] = useState<CourseGenerationMode>(initialMode || 'chat');

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="welcome-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-modal-title"
        >
          <motion.div
            key="welcome-panel"
            initial={{ opacity: 0, y: 12, scale: 0.965 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 1.015 }}
            transition={{ duration: 0.28, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border relative w-full max-w-3xl obsidian-surface obsidian-grid-bg border border-neutral-800 rounded-md overflow-hidden shadow-2xl my-6"
          >
            {/* Subtle top luminous hairline */}
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-sky-400/60 to-transparent futuristic-scanline" />

            <div className="p-6 sm:p-8 space-y-7">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.18em] uppercase text-sky-400/90">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>LOCAL-FIRST CURRICULUM ENGINE</span>
                  </div>
                  <h2
                    id="welcome-modal-title"
                    className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight"
                  >
                    Learn_everything
                  </h2>
                  <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-2xl">
                    将整本教材 PDF、讲义或词汇库按你的目标与期限拆解为每日课程时间轴——自动生成含无跳步推导、交互式图示与离线批改练习的本地精讲课件。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onClose(selectedMode, false)}
                  aria-label="关闭欢迎引导"
                  className="p-1.5 text-neutral-500 hover:text-white border border-transparent hover:border-neutral-800 rounded transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 1. Mode Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-neutral-200">
                    选择你的主要协作模式（后续可随时为每门课程单独切换）
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    STEP 00 / MODE
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {MODE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = selectedMode === opt.id;
                    return (
                      <motion.button
                        key={opt.id}
                        type="button"
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => setSelectedMode(opt.id)}
                        className={`glow-border relative text-left p-4 rounded border transition-colors flex flex-col justify-between gap-3 ${
                          active
                            ? 'bg-neutral-950/90 border-sky-400/70 text-white shadow-[0_0_24px_-12px_rgba(56,189,248,0.45)]'
                            : 'bg-black/70 border-neutral-800/90 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono tracking-wider text-neutral-500">
                              {opt.code}
                            </span>
                            <Icon
                              className={`w-4 h-4 ${
                                active ? 'text-sky-400' : 'text-neutral-500'
                              }`}
                            />
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {opt.title}
                          </div>
                          <div className="text-[11px] text-neutral-400 leading-snug">
                            {opt.subtitle}
                          </div>
                        </div>
                        <p className="text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-900 pt-2.5">
                          {opt.desc}
                        </p>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Concise Workflow */}
              <div className="space-y-3 border-t border-neutral-900 pt-5">
                <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
                  <Layers className="w-3.5 h-3.5 text-neutral-400" />
                  <span>三步完成一门课程构建</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {WORKFLOW_STEPS.map((st, i) => (
                    <motion.div
                      key={st.num}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.04 + i * 0.03,
                        duration: 0.2,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="glow-border border border-neutral-900 bg-black/60 rounded p-3.5 space-y-1.5"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-sm font-bold text-sky-400">
                          {st.num}
                        </span>
                        <span className="text-xs font-medium text-neutral-100">
                          {st.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500 leading-relaxed">
                        {st.desc}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-900">
                <span className="text-[11px] font-mono text-neutral-500">
                  所有课件均纯本地保存在 courses/ 目录，支持离线阅读与 ZIP 备份
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onClose(selectedMode, false)}
                    className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 hover:border-neutral-600 rounded transition-colors"
                  >
                    先浏览时间轴
                  </button>
                  <button
                    type="button"
                    onClick={() => onClose(selectedMode, true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                  >
                    <span>使用所选模式创建课程</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
