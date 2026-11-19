import type { GenerationProgressEvent } from './streamProgress';

async function runSingleStageStreamRequest(
  courseId: string,
  dayIndex: number,
  stage: 'stage1' | 'stage2',
  onProgress?: (event: GenerationProgressEvent) => void
): Promise<{ course: any; lesson: any; stage1Draft?: any; pendingDiagramsCount?: number; diagnosticReport?: GenerationProgressEvent['diagnosticReport'] }> {
  const res = await fetch(
    `/api/courses/${encodeURIComponent(courseId)}/days/${dayIndex}/generate?stream=1&stage=${encodeURIComponent(stage)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
      },
    }
  );

  const contentType = res.headers.get('content-type') || '';

  // Fallback in case a proxy or server returned plain JSON
  if (!res.body || contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '生成课件失败');
    }
    onProgress?.({
      type: 'done',
      stage: 'done',
      step: 4,
      percent: 100,
      message: stage === 'stage1' ? '阶段一内容生成完成' : '阶段二图表代码组装完成',
      course: data.course,
      lesson: data.lesson,
      stage1Draft: data.stage1Draft,
      pendingDiagramsCount: data.pendingDiagramsCount,
      diagnosticReport: data.diagnosticReport,
    });
    return data;
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = '生成课件失败';
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) msg = parsed.error;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: {
    course: any;
    lesson: any;
    stage1Draft?: any;
    pendingDiagramsCount?: number;
    diagnosticReport?: GenerationProgressEvent['diagnosticReport'];
  } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      let event: GenerationProgressEvent;
      try {
        event = JSON.parse(line) as GenerationProgressEvent;
      } catch {
        continue;
      }

      onProgress?.(event);

      if (event.type === 'error') {
        throw new Error(event.error || event.message || '生成课件失败');
      }
      if (event.type === 'done' && event.course) {
        finalPayload = {
          course: event.course,
          lesson: event.lesson,
          stage1Draft: event.stage1Draft,
          pendingDiagramsCount: event.pendingDiagramsCount,
          diagnosticReport: event.diagnosticReport,
        };
      }
    }
  }

  // Handle any trailing buffered line without newline
  const trailing = buffer.trim();
  if (trailing) {
    let parsedTrailing: GenerationProgressEvent | null = null;
    try {
      parsedTrailing = JSON.parse(trailing) as GenerationProgressEvent;
    } catch {
      parsedTrailing = null;
    }
    if (parsedTrailing) {
      onProgress?.(parsedTrailing);
      if (parsedTrailing.type === 'error') {
        throw new Error(parsedTrailing.error || parsedTrailing.message || '生成课件失败');
      }
      if (parsedTrailing.type === 'done' && parsedTrailing.course) {
        finalPayload = {
          course: parsedTrailing.course,
          lesson: parsedTrailing.lesson,
          stage1Draft: parsedTrailing.stage1Draft,
          pendingDiagramsCount: parsedTrailing.pendingDiagramsCount,
          diagnosticReport: parsedTrailing.diagnosticReport,
        };
      }
    }
  }

  if (!finalPayload) {
    throw new Error('流式生成意外中断，未收到最终保存结果');
  }

  return finalPayload;
}

/**
 * Call the streaming NDJSON API lesson generator and forward real-time server & LLM
 * chunk progress events to the UI caller.
 * Every HTTP request executes at most ONE stage of ONE lesson (`stage1` or `stage2`).
 * When `stage === 'all'`, this executes two sequential per-step requests (`stage1` -> `stage2`).
 */
export async function generateLessonWithProgressStream(
  courseId: string,
  dayIndex: number,
  onProgress?: (event: GenerationProgressEvent) => void,
  stage: 'all' | 'stage1' | 'stage2' = 'all'
): Promise<{ course: any; lesson: any; stage1Draft?: any; pendingDiagramsCount?: number; diagnosticReport?: GenerationProgressEvent['diagnosticReport'] }> {
  if (stage === 'stage1' || stage === 'stage2') {
    return runSingleStageStreamRequest(courseId, dayIndex, stage, onProgress);
  }

  // Step 1 request: generate content & diagram specs only
  const stage1Result = await runSingleStageStreamRequest(
    courseId,
    dayIndex,
    'stage1',
    (ev) => {
      if (!onProgress) return;
      if (ev.type === 'done') {
        onProgress({
          type: 'progress',
          stage: 'diagrams',
          step: 3,
          percent: 55,
          message:
            (ev.pendingDiagramsCount ?? 0) > 0
              ? `步骤一已完成（待生成 ${ev.pendingDiagramsCount} 张图表），正在发起步骤二请求...`
              : ev.message,
          course: ev.course,
          lesson: ev.lesson,
          stage1Draft: ev.stage1Draft,
        });
        return;
      }
      onProgress({
        ...ev,
        percent: Math.max(1, Math.min(54, Math.round((ev.percent || 0) * 0.54))),
        message: `[步骤 1/2] ${ev.message}`,
      });
    }
  );

  // If Stage 1 required zero diagrams, Stage 1 already finalized the lesson
  if (stage1Result.pendingDiagramsCount === 0) {
    onProgress?.({
      type: 'done',
      stage: 'done',
      step: 4,
      percent: 100,
      message: `第 ${dayIndex} 讲无需额外配图，已完成生成`,
      course: stage1Result.course,
      lesson: stage1Result.lesson,
      stage1Draft: stage1Result.stage1Draft,
      pendingDiagramsCount: 0,
    });
    return stage1Result;
  }

  // Step 2 request: generate SVGs for the Stage 1 diagram specs only
  return runSingleStageStreamRequest(courseId, dayIndex, 'stage2', (ev) => {
    if (!onProgress) return;
    if (ev.type === 'done') {
      onProgress(ev);
      return;
    }
    onProgress({
      ...ev,
      percent: Math.max(56, Math.min(99, 56 + Math.round((ev.percent || 0) * 0.43))),
      message: `[步骤 2/2] ${ev.message}`,
    });
  });
}
