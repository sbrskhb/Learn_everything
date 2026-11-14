import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Sparkles, X } from 'lucide-react';

interface BrandShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PARTICLES = [
  { id: 1, x: '12%', y: '18%', size: 3, delay: 0, dur: 5.5 },
  { id: 2, x: '84%', y: '22%', size: 2, delay: 0.8, dur: 6.2 },
  { id: 3, x: '24%', y: '76%', size: 2.5, delay: 1.4, dur: 5.8 },
  { id: 4, x: '75%', y: '72%', size: 3, delay: 0.4, dur: 6.6 },
  { id: 5, x: '48%', y: '14%', size: 2, delay: 1.1, dur: 4.9 },
  { id: 6, x: '62%', y: '86%', size: 2.5, delay: 0.2, dur: 6.0 },
  { id: 7, x: '90%', y: '52%', size: 2, delay: 1.7, dur: 5.4 },
  { id: 8, x: '9%', y: '54%', size: 2.5, delay: 0.9, dur: 6.4 },
];

const CREATORS = [
  {
    name: 'Gemini',
    role: '代码编写与工程实现',
    detail: '负责项目核心代码编写与系统落地',
    accentBorder: 'border-sky-500/40 hover:border-sky-400/80',
    accentGlow: 'from-sky-500/20 via-cyan-400/10 to-transparent',
    dotColor: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.9)]',
    textGradient: 'from-sky-200 via-cyan-300 to-blue-400',
  },
  {
    name: 'ChatGPT',
    role: '交流探讨与提供建议',
    detail: '负责思路碰撞、交互沟通与改进建议',
    accentBorder: 'border-emerald-500/40 hover:border-emerald-400/80',
    accentGlow: 'from-emerald-500/20 via-teal-400/10 to-transparent',
    dotColor: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]',
    textGradient: 'from-emerald-200 via-teal-300 to-green-400',
  },
  {
    name: 'sbrskhb',
    role: '项目构想与发起人',
    detail: '提出项目核心创意与整体设计理念',
    accentBorder: 'border-violet-500/45 hover:border-amber-400/80',
    accentGlow: 'from-violet-500/20 via-fuchsia-400/10 to-amber-400/10',
    dotColor: 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.9)]',
    textGradient: 'from-amber-200 via-fuchsia-200 to-violet-300',
  },
];

export const BrandShowcaseModal: React.FC<BrandShowcaseModalProps> = ({
  isOpen,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState({ x: 50, y: 45, tiltX: 0, tiltY: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    setPointer({
      x: Math.max(0, Math.min(100, nx * 100)),
      y: Math.max(0, Math.min(100, ny * 100)),
      tiltX: (0.5 - ny) * 14,
      tiltY: (nx - 0.5) * 18,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={containerRef}
          key="brand-showcase-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={handlePointerMove}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Learn_everything 品牌展示"
          className="fixed inset-0 z-50 bg-black text-neutral-100 flex flex-col items-center justify-center overflow-hidden select-none px-6 py-10"
        >
          {/* Interactive Aurora Spotlight + Cyber Grid */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 transition-opacity duration-300"
            style={{
              background: `radial-gradient(640px circle at ${pointer.x}% ${pointer.y}%, rgba(56, 189, 248, 0.16), rgba(168, 85, 247, 0.08) 42%, transparent 72%)`,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 80%)',
            }}
          />

          {/* Ambient Floating Particles */}
          {PARTICLES.map((p) => (
            <motion.span
              key={p.id}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-sky-300/70"
              style={{
                left: p.x,
                top: p.y,
                width: p.size,
                height: p.size,
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.8)',
              }}
              animate={{
                y: [0, -18, 0],
                opacity: [0.2, 0.9, 0.2],
                scale: [0.9, 1.35, 0.9],
              }}
              transition={{
                duration: p.dur,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}

          {/* Top Bar */}
          <div
            className="absolute top-6 right-6 z-20 flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-neutral-800 hover:border-neutral-600 bg-black/70 backdrop-blur-md text-neutral-300 hover:text-white rounded-full transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>ESC 关闭</span>
            </button>
          </div>

          {/* Center Stage */}
          <div
            className="relative z-10 max-w-3xl w-full flex flex-col items-center text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. Enlarged Brand Logo + Interactive 3D Emblem */}
            <motion.div
              initial={{ opacity: 0, scale: 0.72, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              style={{
                transform: `perspective(900px) rotateX(${pointer.tiltX.toFixed(2)}deg) rotateY(${pointer.tiltY.toFixed(2)}deg)`,
                transition: 'transform 120ms ease-out',
              }}
              className="flex flex-col items-center"
            >
              <div className="relative w-36 h-36 sm:w-44 sm:h-44 flex items-center justify-center mb-6">
                {/* Pulsing Back Halo */}
                <motion.div
                  aria-hidden="true"
                  animate={{ scale: [0.92, 1.08, 0.92], opacity: [0.45, 0.78, 0.45] }}
                  transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-2 rounded-full bg-gradient-to-tr from-sky-500/35 via-violet-500/25 to-emerald-400/35 blur-2xl"
                />

                {/* Orbital Emblem SVG */}
                <svg
                  viewBox="0 0 180 180"
                  className="w-full h-full drop-shadow-[0_0_28px_rgba(56,189,248,0.35)]"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="le-ring-a" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="50%" stopColor="#a78bfa" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                    <linearGradient id="le-ring-b" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#34d399" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.25" />
                    </linearGradient>
                  </defs>

                  <motion.g
                    animate={{ rotate: 360 }}
                    transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
                    style={{ transformOrigin: '90px 90px' }}
                  >
                    <circle
                      cx="90"
                      cy="90"
                      r="74"
                      fill="none"
                      stroke="url(#le-ring-a)"
                      strokeWidth="1.5"
                      strokeDasharray="10 6"
                      opacity="0.7"
                    />
                    <circle cx="90" cy="16" r="4" fill="#38bdf8" />
                    <circle cx="90" cy="164" r="3" fill="#34d399" />
                  </motion.g>

                  <motion.g
                    animate={{ rotate: -360 }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                    style={{ transformOrigin: '90px 90px' }}
                  >
                    <ellipse
                      cx="90"
                      cy="90"
                      rx="62"
                      ry="32"
                      transform="rotate(-28 90 90)"
                      fill="none"
                      stroke="url(#le-ring-b)"
                      strokeWidth="1.6"
                      opacity="0.8"
                    />
                    <ellipse
                      cx="90"
                      cy="90"
                      rx="62"
                      ry="32"
                      transform="rotate(28 90 90)"
                      fill="none"
                      stroke="url(#le-ring-a)"
                      strokeWidth="1.4"
                      opacity="0.55"
                    />
                  </motion.g>

                  {/* Center Prism / Book-Core Symbol */}
                  <polygon
                    points="90,52 122,90 90,128 58,90"
                    fill="rgba(10, 15, 26, 0.85)"
                    stroke="url(#le-ring-a)"
                    strokeWidth="2.4"
                  />
                  <path
                    d="M78 90 L90 74 L102 90 L90 106 Z"
                    fill="url(#le-ring-a)"
                    opacity="0.9"
                  />
                  <circle cx="90" cy="90" r="4" fill="#ffffff" />
                </svg>
              </div>

              <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-white via-sky-200 to-emerald-200 bg-clip-text text-transparent drop-shadow-[0_0_32px_rgba(56,189,248,0.28)]">
                Learn_everything
              </h1>
            </motion.div>

            {/* 2. Credits Sequence: by Gemini, ChatGPT, sbrskhb */}
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 w-full space-y-6"
            >
              <div className="flex items-center justify-center gap-3">
                <span className="h-px w-12 bg-gradient-to-r from-transparent to-neutral-700" />
                <span className="inline-flex items-center gap-1.5 text-xs font-mono tracking-[0.26em] uppercase text-neutral-400">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>by Gemini, ChatGPT, sbrskhb</span>
                </span>
                <span className="h-px w-12 bg-gradient-to-l from-transparent to-neutral-700" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 max-w-2xl mx-auto">
                {CREATORS.map((creator, idx) => (
                  <motion.div
                    key={creator.name}
                    initial={{ opacity: 0, y: 16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: 0.36 + idx * 0.1,
                      duration: 0.42,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    className={`relative overflow-hidden rounded-xl border bg-neutral-950/75 backdrop-blur-md px-5 py-4 text-left transition-colors ${creator.accentBorder}`}
                  >
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${creator.accentGlow}`}
                    />
                    <div className="relative flex items-center justify-between gap-2">
                      <span
                        className={`font-display text-xl font-bold tracking-tight bg-gradient-to-r ${creator.textGradient} bg-clip-text text-transparent`}
                      >
                        {creator.name}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${creator.dotColor}`} />
                    </div>
                    <p className="relative mt-1.5 text-xs font-medium text-neutral-200">
                      {creator.role}
                    </p>
                    <p className="relative mt-1 text-[11px] text-neutral-400 leading-relaxed">
                      {creator.detail}
                    </p>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Footer Return Button */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65, duration: 0.35 }}
              className="mt-10"
            >
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded-full shadow-[0_0_24px_rgba(255,255,255,0.18)] transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回学习空间</span>
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
