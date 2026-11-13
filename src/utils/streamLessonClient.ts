import type { GenerationProgressEvent } from './streamProgress';

/**
 * Call the streaming NDJSON API lesson generator and forward real-time server & LLM
 * chunk progress events to the UI caller.
 */
export async function generateLessonWithProgressStream(
  courseId: string,
  dayIndex: number,
  onProgress?: (event: GenerationProgressEvent) => void
): Promise<{ course: any; lesson: any }> {
  const res = await fetch(
    `/api/courses/${encodeURIComponent(courseId)}/days/${dayIndex}/generate?stream=1`,
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
      message: '课件生成完成',
      course: data.course,
      lesson: data.lesson,
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
  let finalPayload: { course: any; lesson: any } | null = null;

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
        finalPayload = { course: event.course, lesson: event.lesson };
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
        finalPayload = { course: parsedTrailing.course, lesson: parsedTrailing.lesson };
      }
    }
  }

  if (!finalPayload) {
    throw new Error('流式生成意外中断，未收到最终保存结果');
  }

  return finalPayload;
}
