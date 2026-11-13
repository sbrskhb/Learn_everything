import fs from 'fs';
import path from 'path';
import type { DailyPlanSlot, PdfSplitPlanItem } from '../src/types';
import {
  executePdfSplitPlanOnDisk,
  parseImportedPdfSplitPlan,
} from '../src/utils/pdfProcessor';

async function main() {
  const targetArg = process.argv[2];
  const sectionArg = process.argv[3]; // optional sectionId e.g. sec-01

  if (!targetArg) {
    console.error('用法: npx tsx scripts/split_pdf.ts <courses/课程文件夹路径> [可选:sectionId]');
    process.exit(1);
  }

  const courseDir = path.resolve(process.cwd(), targetArg);
  if (!fs.existsSync(courseDir)) {
    console.error(`未找到课程目录: ${courseDir}`);
    process.exit(1);
  }

  const outlinePath = path.join(courseDir, 'outline.json');
  const splitPlanPath = path.join(courseDir, 'segments', 'split-plan.json');
  const sourcesDir = path.join(courseDir, 'sources');

  if (!fs.existsSync(splitPlanPath)) {
    console.error(`未找到切分方案文件: ${splitPlanPath}`);
    process.exit(1);
  }

  const rawPlan = JSON.parse(fs.readFileSync(splitPlanPath, 'utf-8'));
  let outline: DailyPlanSlot[] = [];
  if (fs.existsSync(outlinePath)) {
    const rawOutline = JSON.parse(fs.readFileSync(outlinePath, 'utf-8'));
    outline = Array.isArray(rawOutline?.days)
      ? rawOutline.days
      : Array.isArray(rawOutline?.dailyPlan)
        ? rawOutline.dailyPlan
        : [];
  }

  const pdfFiles = fs.existsSync(sourcesDir)
    ? fs.readdirSync(sourcesDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
    : [];
  const defaultSource = pdfFiles[0] || 'source.pdf';

  const normalizedPlan: PdfSplitPlanItem[] = Array.isArray(rawPlan)
    ? rawPlan
    : parseImportedPdfSplitPlan(rawPlan, outline, defaultSource);

  const courseRelDir = path.relative(process.cwd(), courseDir).replace(/\\/g, '/');
  const results = await executePdfSplitPlanOnDisk({
    courseDir,
    courseRelDir,
    splitPlan: normalizedPlan,
    targetSectionId: sectionArg,
  });

  // Update outline.json with pdfSegment info
  if (fs.existsSync(outlinePath) && outline.length > 0) {
    const rawOutline = JSON.parse(fs.readFileSync(outlinePath, 'utf-8'));
    const daysArr: DailyPlanSlot[] = Array.isArray(rawOutline.days)
      ? rawOutline.days
      : Array.isArray(rawOutline.dailyPlan)
        ? rawOutline.dailyPlan
        : [];
    for (const slot of daysArr) {
      const seg = results.find(
        (r) => r.sectionId === slot.id || r.dayIndex === slot.dayIndex
      );
      if (seg) {
        slot.pdfSegment = seg;
      }
    }
    fs.writeFileSync(outlinePath, JSON.stringify(rawOutline, null, 2), 'utf-8');
  }

  const slicedCount = results.filter((r) => r.status === 'sliced').length;
  console.log(
    `[PDF 切分完成] 已在 ${courseRelDir}/segments/ 生成 ${slicedCount}/${results.length} 个小节 PDF 文件。`
  );
}

main().catch((err) => {
  console.error('执行 PDF 切分脚本出错:', err);
  process.exit(1);
});
