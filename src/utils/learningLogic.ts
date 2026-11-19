import {
  Course,
  DailyLessonContent,
  DailyPlanSlot,
  DailyScheduleDay,
  ExerciseQuestion,
  ExerciseSubmissionRecord,
  PdfSplitPlanItem,
  VocabCoverageStats,
  VocabItem,
} from '../types';

/**
 * Built-in graded vocabulary banks so users can perform real set operations
 * (e.g., 六级目标词库 − 高考已掌握词库 = 实际需要学习的词汇) or upload custom files.
 * Note: Higher-level banks include lower-level foundational words plus advanced words,
 * so set subtraction (CET-6 minus Gaokao, or CET-6 minus CET-4) yields authentic differences.
 */
const GAOKAO_BASE_WORDS: VocabItem[] = [
  { word: 'abandon', phonetic: '/əˈbændən/', meaning: 'v. 放弃，抛弃' },
  { word: 'acknowledge', phonetic: '/əkˈnɒlɪdʒ/', meaning: 'v. 承认，致谢' },
  { word: 'Adapt', phonetic: '/əˈdæpt/', meaning: 'v. 适应，改编' },
  { word: 'advocate', phonetic: '/ˈædvəkeɪt/', meaning: 'v. 提倡，拥护 n. 提倡者' },
  { word: 'alternative', phonetic: '/ɔːlˈtɜːnətɪv/', meaning: 'n. 可供选择的事物 adj. 替代的' },
  { word: 'ambiguous', phonetic: '/æmˈbɪɡjuəs/', meaning: 'adj. 模棱两可的，含糊不清的' },
  { word: 'anticipate', phonetic: '/ænˈtɪsɪpeɪt/', meaning: 'v. 预期，期盼' },
  { word: 'apparent', phonetic: '/əˈpærənt/', meaning: 'adj. 显而易见的，表面上的' },
  { word: 'assess', phonetic: '/əˈses/', meaning: 'v. 评估，估价' },
  { word: 'assumption', phonetic: '/əˈsʌmpʃn/', meaning: 'n. 假定，设想' },
  { word: 'barrier', phonetic: '/ˈbæriə(r)/', meaning: 'n. 障碍，屏障' },
  { word: 'capacity', phonetic: '/kəˈpæsəti/', meaning: 'n. 容量，能力' },
  { word: 'circumstance', phonetic: '/ˈsɜːkəmstəns/', meaning: 'n. 环境，状况' },
  { word: 'commitment', phonetic: '/kəˈmɪtmənt/', meaning: 'n. 承诺，投入，奉献' },
  { word: 'compensate', phonetic: '/ˈkɒmpenseɪt/', meaning: 'v. 补偿，弥补' },
  { word: 'comprehensive', phonetic: '/ˌkɒmprɪˈhensɪv/', meaning: 'adj. 全面的，综合的' },
  { word: 'consequence', phonetic: '/ˈkɒnsɪkwəns/', meaning: 'n. 结果，后果' },
  { word: 'conservative', phonetic: '/kənˈsɜːvətɪv/', meaning: 'adj. 保守的，守旧的' },
  { word: 'consistent', phonetic: '/kənˈsɪstənt/', meaning: 'adj. 一致的，始终如一的' },
  { word: 'conventional', phonetic: '/kənˈvenʃənl/', meaning: 'adj. 传统的，惯例的' },
  { word: 'crucial', phonetic: '/ˈkruːʃl/', meaning: 'adj. 至关重要的，决定性的' },
  { word: 'cultivate', phonetic: '/ˈkʌltɪveɪt/', meaning: 'v. 培养，耕作' },
  { word: 'decline', phonetic: '/dɪˈklaɪn/', meaning: 'v./n. 下降，衰退；婉拒' },
  { word: 'demonstrate', phonetic: '/ˈdemənstreɪt/', meaning: 'v. 证明，演示，表达' },
  { word: 'distinguish', phonetic: '/dɪˈstɪŋɡwɪʃ/', meaning: 'v. 区分，辨别' },
  { word: 'diverse', phonetic: '/daɪˈvɜːs/', meaning: 'adj. 多样的，不同的' },
  { word: 'domestic', phonetic: '/dəˈmestɪk/', meaning: 'adj. 国内的，家庭的' },
  { word: 'eliminate', phonetic: '/ɪˈlɪmɪneɪt/', meaning: 'v. 消除，淘汰' },
  { word: 'emerge', phonetic: '/ɪˈmɜːdʒ/', meaning: 'v. 浮现，出现' },
  { word: 'emphasis', phonetic: '/ˈemfəsɪs/', meaning: 'n. 强调，重点' },
  { word: 'encounter', phonetic: '/ɪnˈkaʊntə(r)/', meaning: 'v./n. 遭遇，邂逅' },
  { word: 'enhance', phonetic: '/ɪnˈhɑːns/', meaning: 'v. 提高，增强' },
  { word: 'evaluate', phonetic: '/ɪˈvæljueɪt/', meaning: 'v. 评价，评估' },
  { word: 'fundamental', phonetic: '/ˌfʌndəˈmentl/', meaning: 'adj. 根本的，基础的' },
  { word: 'guarantee', phonetic: '/ˌɡærənˈtiː/', meaning: 'v./n. 保证，担保' },
  { word: 'hypothesis', phonetic: '/haɪˈpɒθəsɪs/', meaning: 'n. 假说，假设' },
  { word: 'inevitable', phonetic: '/ɪnˈevɪtəbl/', meaning: 'adj. 不可避免的，必然的' },
  { word: 'initial', phonetic: '/ɪˈnɪʃl/', meaning: 'adj. 最初的，开始的' },
  { word: 'innovation', phonetic: '/ˌɪnəˈveɪʃn/', meaning: 'n. 创新，革新' },
  { word: 'integrate', phonetic: '/ˈɪntɪɡreɪt/', meaning: 'v. 整合，融入' },
  { word: 'interpret', phonetic: '/ɪnˈtɜːprɪt/', meaning: 'v. 解释，口译' },
  { word: 'justify', phonetic: '/ˈdʒʌstɪfaɪ/', meaning: 'v. 证明……正当，为……辩护' },
  { word: 'maintain', phonetic: '/meɪnˈteɪn/', meaning: 'v. 维持，保养；坚持认为' },
  { word: 'mechanism', phonetic: '/ˈmekənɪzəm/', meaning: 'n. 机制，机械装置' },
  { word: 'minimum', phonetic: '/ˈmɪnɪməm/', meaning: 'n./adj. 最低限度（的）' },
  { word: 'objective', phonetic: '/əbˈdʒektɪv/', meaning: 'n. 目标 adj. 客观的' },
  { word: 'obstacle', phonetic: '/ˈɒbstəkl/', meaning: 'n. 障碍，阻碍' },
  { word: 'perspective', phonetic: '/pəˈspektɪv/', meaning: 'n. 视角，观点；透视法' },
  { word: 'phenomenon', phonetic: '/fəˈnɒmɪnən/', meaning: 'n. 现象，非凡的人或事物' },
  { word: 'potential', phonetic: '/pəˈtenʃl/', meaning: 'adj. 潜在的 n. 潜力' },
  { word: 'preserve', phonetic: '/prɪˈzɜːv/', meaning: 'v. 保护，保存' },
  { word: 'priority', phonetic: '/praɪˈɒrəti/', meaning: 'n. 优先事项，优先权' },
  { word: 'prohibit', phonetic: '/prəˈhɪbɪt/', meaning: 'v. 禁止，阻止' },
  { word: 'pursue', phonetic: '/pəˈsjuː/', meaning: 'v. 追求，从事' },
  { word: 'relevant', phonetic: '/ˈreləvənt/', meaning: 'adj. 相关的，切题的' },
  { word: 'reluctant', phonetic: '/rɪˈlʌktənt/', meaning: 'adj. 不情愿的，勉强的' },
  { word: 'significant', phonetic: '/sɪɡˈnɪfɪkənt/', meaning: 'adj. 重大的，显著的' },
  { word: 'stimulate', phonetic: '/ˈstɪmjuleɪt/', meaning: 'v. 刺激，激励' },
  { word: 'sufficient', phonetic: '/səˈfɪʃnt/', meaning: 'adj. 足够的，充分的' },
  { word: 'sustainable', phonetic: '/səˈsteɪnəbl/', meaning: 'adj. 可持续的' },
];

const CET4_EXTRA_WORDS: VocabItem[] = [
  { word: 'accelerate', phonetic: '/əkˈseləreɪt/', meaning: 'v. 加速，促进' },
  { word: 'accommodate', phonetic: '/əˈkɒmədeɪt/', meaning: 'v. 容纳；提供住宿；适应' },
  { word: 'accumulate', phonetic: '/əˈkjuːmjəleɪt/', meaning: 'v. 积累，积聚' },
  { word: 'adequate', phonetic: '/ˈædɪkwət/', meaning: 'adj. 充足的，胜任的' },
  { word: 'allocate', phonetic: '/ˈæləkeɪt/', meaning: 'v. 分配，拨出' },
  { word: 'attribute', phonetic: '/əˈtrɪbjuːt/', meaning: 'v. 把……归因于 n. 属性，特质' },
  { word: 'autonomous', phonetic: '/ɔːˈtɒnəməs/', meaning: 'adj. 自治的，自主的' },
  { word: 'Chronicle', phonetic: '/ˈkrɒnɪkl/', meaning: 'n. 编年史 v. 记录' },
  { word: 'coherent', phonetic: '/kəʊˈhɪərənt/', meaning: 'adj. 连贯的，条理清楚的' },
  { word: 'coincide', phonetic: '/ˌkəʊɪnˈsaɪd/', meaning: 'v. 同时发生；相符' },
  { word: 'collaborate', phonetic: '/kəˈlæbəreɪt/', meaning: 'v. 合作，协作' },
  { word: 'commodity', phonetic: '/kəˈmɒdəti/', meaning: 'n. 商品，日用品' },
  { word: 'compatible', phonetic: '/kəmˈpætəbl/', meaning: 'adj. 兼容的，合得来的' },
  { word: 'compel', phonetic: '/kəmˈpel/', meaning: 'v. 强迫，迫使' },
  { word: 'compromise', phonetic: '/ˈkɒmprəmaɪz/', meaning: 'n./v. 妥协，折中' },
  { word: 'conceive', phonetic: '/kənˈsiːv/', meaning: 'v. 构想，设想；怀孕' },
  { word: 'confront', phonetic: '/kənˈfrʌnt/', meaning: 'v. 面临，正视，对抗' },
  { word: 'consensus', phonetic: '/kənˈsensəs/', meaning: 'n. 共识，一致意见' },
  { word: 'constrain', phonetic: '/kənˈstreɪn/', meaning: 'v. 限制，约束' },
  { word: 'contemporary', phonetic: '/kənˈtempərəri/', meaning: 'adj. 当代的，同时代的' },
  { word: 'contradict', phonetic: '/ˌkɒntrəˈdɪkt/', meaning: 'v. 反驳，与……矛盾' },
  { word: 'controversy', phonetic: '/ˈkɒntrəvɜːsi/', meaning: 'n. 争论，争议' },
  { word: 'coordinate', phonetic: '/kəʊˈɔːdɪneɪt/', meaning: 'v. 协调，配合 n. 坐标' },
  { word: 'criteria', phonetic: '/kraɪˈtɪəriə/', meaning: 'n. 标准，准则' },
  { word: 'dedicate', phonetic: '/ˈdedɪkeɪt/', meaning: 'v. 致力于，献身于' },
  { word: 'deficit', phonetic: '/ˈdefɪsɪt/', meaning: 'n. 赤字，亏损，不足' },
  { word: 'deliberate', phonetic: '/dɪˈlɪbərət/', meaning: 'adj. 故意的；深思熟虑的 v. 仔细考虑' },
  { word: 'deprive', phonetic: '/dɪˈpraɪv/', meaning: 'v. 剥夺，使丧失' },
  { word: 'derive', phonetic: '/dɪˈraɪv/', meaning: 'v. 源于，得自' },
  { word: 'detect', phonetic: '/dɪˈtekt/', meaning: 'v. 侦测，察觉，发现' },
  { word: 'deteriorate', phonetic: '/dɪˈtɪəriəreɪt/', meaning: 'v. 恶化，变坏' },
  { word: 'diminish', phonetic: '/dɪˈmɪnɪʃ/', meaning: 'v. 减少，削弱' },
  { word: 'disrupt', phonetic: '/dɪsˈrʌpt/', meaning: 'v. 扰乱，使中断' },
  { word: 'distort', phonetic: '/dɪˈstɔːt/', meaning: 'v. 扭曲，歪曲' },
  { word: 'dominate', phonetic: '/ˈdɒmɪneɪt/', meaning: 'v. 支配，占主导地位' },
  { word: 'drastic', phonetic: '/ˈdræstɪk/', meaning: 'adj. 激烈的，猛烈的' },
  { word: 'elaborate', phonetic: '/ɪˈlæbərət/', meaning: 'adj. 详尽的，精巧的 v. 详细阐述' },
  { word: 'empirical', phonetic: '/ɪmˈpɪrɪkl/', meaning: 'adj. 实证的，经验主义的' },
  { word: 'endorse', phonetic: '/ɪnˈdɔːs/', meaning: 'v. 赞同，支持，背书' },
  { word: 'entitle', phonetic: '/ɪnˈtaɪtl/', meaning: 'v. 赋予权利；定名为' },
];

const CET6_EXTRA_WORDS: VocabItem[] = [
  { word: 'alleviate', phonetic: '/əˈliːvieɪt/', meaning: 'v. 减轻，缓和，缓解', example: 'Targeted fiscal policies can alleviate economic pressure on small enterprises.' },
  { word: 'ambivalence', phonetic: '/æmˈbɪvələns/', meaning: 'n. 矛盾心理，犹豫不决', example: 'Public ambivalence toward automation reflects both optimism and anxiety.' },
  { word: 'analogy', phonetic: '/əˈnælədʒi/', meaning: 'n. 类比，比喻', example: 'The physicist drew an analogy between fluid ripples and acoustic waves.' },
  { word: 'anomaly', phonetic: '/əˈnɒməli/', meaning: 'n. 异常现象，反常事物', example: 'Scientists noticed a thermal anomaly in the deep ocean current records.' },
  { word: 'apparatus', phonetic: '/ˌæpəˈreɪtəs/', meaning: 'n. 仪器，装置；机构', example: 'The laboratory apparatus was calibrated to measure microvolt fluctuations.' },
  { word: 'articulate', phonetic: '/ɑːˈtɪkjuleɪt/', meaning: 'v. 清晰地表达 adj. 善于表达的', example: 'An essay should articulate its central thesis without rhetorical clutter.' },
  { word: 'asymmetry', phonetic: '/ˌeɪˈsɪmətri/', meaning: 'n. 不对称，失衡', example: 'Information asymmetry often distorts pricing in emerging markets.' },
  { word: 'augment', phonetic: '/ɔːɡˈment/', meaning: 'v. 增加，扩大，强化', example: 'Engineers use feedback loops to augment the stability of the amplifier.' },
  { word: 'authentic', phonetic: '/ɔːˈθentɪk/', meaning: 'adj. 真正的，真实的，可靠的', example: 'Reading authentic essays builds a deeper intuition for idiomatic syntax.' },
  { word: 'benchmark', phonetic: '/ˈbentʃmɑːk/', meaning: 'n. 基准，参照标准 v. 评估', example: 'This dataset serves as an industry benchmark for signal processing.' },
  { word: 'catalyst', phonetic: '/ˈkætəlɪst/', meaning: 'n. 催化剂；促进因素', example: 'Affordable microprocessors acted as a catalyst for personal computing.' },
  { word: 'cognitive', phonetic: '/ˈkɒɡnətɪv/', meaning: 'adj. 认知的，认识能力的', example: 'Spaced repetition reduces cognitive load during long-term study.' },
  { word: 'commensurate', phonetic: '/kəˈmenʃərət/', meaning: 'adj. 相称的，成比例的', example: 'Expected returns must be commensurate with the underlying risk.' },
  { word: 'compelling', phonetic: '/kəmˈpelɪŋ/', meaning: 'adj. 引人入胜的；令人信服的', example: 'The monograph presents compelling evidence for continental drift.' },
  { word: 'consolidate', phonetic: '/kənˈsɒlɪdeɪt/', meaning: 'v. 巩固，加强；合并', example: 'Reviewing notes each evening helps consolidate newly acquired concepts.' },
  { word: 'contingent', phonetic: '/kənˈtɪndʒənt/', meaning: 'adj. 取决于……的；偶发的', example: 'System reliability is contingent upon rigorous thermal dissipation.' },
  { word: 'corroborate', phonetic: '/kəˈrɒbəreɪt/', meaning: 'v. 证实，确证（理论或陈述）', example: 'Independent experiments corroborated the theoretical prediction.' },
  { word: 'culminate', phonetic: '/ˈkʌlmɪneɪt/', meaning: 'v. 达到高潮，以……告终', example: 'Decades of mathematical inquiry culminated in a unified proof.' },
  { word: 'deplete', phonetic: '/dɪˈpliːt/', meaning: 'v. 耗尽，使枯竭', example: 'Continuous high-current discharge will rapidly deplete the battery.' },
  { word: 'dichotomy', phonetic: '/daɪˈkɒtəmi/', meaning: 'n. 二分法，对立分歧', example: 'The false dichotomy between theory and practice hinders engineering.' },
  { word: 'discrepancy', phonetic: '/dɪˈskrepənsi/', meaning: 'n. 差异，不一致，出入', example: 'We must account for the discrepancy between simulated and measured gain.' },
  { word: 'disseminate', phonetic: '/dɪˈsemɪneɪt/', meaning: 'v. 传播，散布（信息或知识）', example: 'Open-access journals disseminate research findings globally.' },
  { word: 'efficacy', phonetic: '/ˈefɪkəsi/', meaning: 'n. 功效，效力，有效性', example: 'Clinical trials evaluated the long-term efficacy of the treatment.' },
  { word: 'elucidate', phonetic: '/ɪˈluːsɪdeɪt/', meaning: 'v. 阐明，解释，说明', example: 'A clear schematic diagram can elucidate complex circuit topologies.' },
  { word: 'ephemeral', phonetic: '/ɪˈfemərəl/', meaning: 'adj. 短暂的，转瞬即逝的', example: 'Unlike ephemeral trends, foundational mathematics endures.' },
  { word: 'equilibrium', phonetic: '/ˌiːkwɪˈlɪbriəm/', meaning: 'n. 平衡，均衡状态', example: 'Thermal equilibrium is reached when net heat transfer drops to zero.' },
  { word: 'exacerbate', phonetic: '/ɪɡˈzæsəbeɪt/', meaning: 'v. 加剧，使恶化', example: 'Parasitic capacitance can exacerbate high-frequency oscillation.' },
  { word: 'exemplify', phonetic: '/ɪɡˈzemplɪfaɪ/', meaning: 'v. 作为……的典范，例证', example: 'Maxwell’s equations exemplify mathematical elegance in physics.' },
  { word: 'fluctuate', phonetic: '/ˈflʌktʃueɪt/', meaning: 'v. 波动，起伏，涨落', example: 'Solar power output may fluctuate with atmospheric cloud cover.' },
  { word: 'foster', phonetic: '/ˈfɒstə(r)/', meaning: 'v. 培养，促进，助长', example: 'Reading primary literature fosters critical analytical habits.' },
  { word: 'autonomous', phonetic: '/ɔːˈtɒnəməs/', meaning: 'adj. 自主的，自治的' },
  { word: 'hierarchy', phonetic: '/ˈhaɪərɑːki/', meaning: 'n. 层级，等级制度', example: 'Memory hierarchy balances latency against storage capacity.' },
  { word: 'imperative', phonetic: '/ɪmˈperətɪv/', meaning: 'adj. 必要的，紧急的 n. 必要的事', example: 'Impedance matching is imperative in radio-frequency transmission.' },
  { word: 'incentive', phonetic: '/ɪnˈsentɪv/', meaning: 'n. 激励，诱因，动机', example: 'Clear daily milestones provide a steady incentive for learners.' },
  { word: 'inherent', phonetic: '/ɪnˈhɪərənt/', meaning: 'adj. 固有的，内在的', example: 'Thermal noise is an inherent property of resistive components.' },
  { word: 'intricate', phonetic: '/ˈɪntrɪkət/', meaning: 'adj. 错综复杂的，精细的', example: 'The watchmaker repaired the intricate escapement mechanism.' },
  { word: 'Juxtapose', phonetic: '/ˌdʒʌkstəˈpəʊz/', meaning: 'v. 并列，并置以作对比', example: 'The critic juxtaposed classical prose with modernist fragments.' },
  { word: 'lucid', phonetic: '/ˈluːsɪd/', meaning: 'adj. 清晰易懂的，透彻的', example: 'Feynman was celebrated for his lucid explanations of quantum mechanics.' },
  { word: 'meticulous', phonetic: '/məˈtɪkjələs/', meaning: 'adj. 一丝不苟的，严谨的', example: 'Meticulous derivation prevents sign errors in differential equations.' },
  { word: 'mitigate', phonetic: '/ˈmɪtɪɡeɪt/', meaning: 'v. 减轻，缓和，降低风险', example: 'Differential signaling helps mitigate electromagnetic interference.' },
  { word: 'nuance', phonetic: '/ˈnjuːɑːns/', meaning: 'n. 细微差别', example: 'Contextual reading reveals the semantic nuance of synonyms.' },
  { word: 'paradigm', phonetic: '/ˈpærədaɪm/', meaning: 'n. 范式，典范，思维模式', example: 'Digital twins represent a shift in industrial design paradigms.' },
  { word: 'pervasive', phonetic: '/pəˈveɪsɪv/', meaning: 'adj. 普遍的，无处不在的', example: 'Embedded sensors have become pervasive in modern civil infrastructure.' },
  { word: 'pragmatic', phonetic: '/præɡˈmætɪk/', meaning: 'adj. 务实的，实用主义的', example: 'Engineers adopted a pragmatic approximation to simplify the model.' },
  { word: 'precarious', phonetic: '/prɪˈkeəriəs/', meaning: 'adj. 不稳定的，岌岌可危的', example: 'Over-reliance on a single supplier creates a precarious supply chain.' },
  { word: 'proliferate', phonetic: '/prəˈlɪfəreɪt/', meaning: 'v. 激增，迅速繁殖或扩散', example: 'Open-source toolchains continued to proliferate across universities.' },
  { word: 'resilient', phonetic: '/rɪˈzɪliənt/', meaning: 'adj. 有韧性的，能迅速恢复的', example: 'Distributed networks are designed to remain resilient under node failure.' },
  { word: 'scrutinize', phonetic: '/ˈskruːtənaɪz/', meaning: 'v. 仔细检查，细致审查', example: 'Auditors scrutinized the ledger for statistical irregularities.' },
  { word: 'substantiate', phonetic: '/səbˈstænʃieɪt/', meaning: 'v. 用事实证实，证明', example: 'Empirical measurements are required to substantiate the hypothesis.' },
  { word: 'synthesize', phonetic: '/ˈsɪnθəsaɪz/', meaning: 'v. 综合，合成', example: 'The final chapter synthesizes linear algebra and multivariable calculus.' },
];

export const BUILTIN_VOCAB_BANKS: Record<
  string,
  { id: string; label: string; description: string; words: VocabItem[] }
> = {
  none: {
    id: 'none',
    label: '不使用预设词库',
    description: '仅使用手动上传的词库文件',
    words: [],
  },
  gaokao: {
    id: 'gaokao',
    label: '高考英语核心词库',
    description: `包含 ${GAOKAO_BASE_WORDS.length} 个高中阶段基础核心词汇`,
    words: GAOKAO_BASE_WORDS,
  },
  cet4: {
    id: 'cet4',
    label: '大学英语四级词库 (CET-4)',
    description: `包含高考基础词及四级进阶词（共 ${GAOKAO_BASE_WORDS.length + CET4_EXTRA_WORDS.length} 词）`,
    words: [...GAOKAO_BASE_WORDS, ...CET4_EXTRA_WORDS],
  },
  cet6: {
    id: 'cet6',
    label: '大学英语六级词库 (CET-6)',
    description: `涵盖高考、四级及六级高阶学术阅读词汇（共 ${GAOKAO_BASE_WORDS.length + CET4_EXTRA_WORDS.length + CET6_EXTRA_WORDS.length - 1} 词）`,
    words: [...GAOKAO_BASE_WORDS, ...CET4_EXTRA_WORDS, ...CET6_EXTRA_WORDS],
  },
};

/**
 * Ensure stable unique section ID (e.g. "sec-01", "sec-02") so renaming or shifting dates
 * never breaks links between outline.json, segments/sec-XX.pdf, and lessons/sec-XX.json.
 */
export function ensureStableSectionId(dayIndex: number, existingId?: string): string {
  if (existingId && typeof existingId === 'string' && /^[a-zA-Z0-9_-]+$/.test(existingId.trim())) {
    return existingId.trim();
  }
  return `sec-${String(Math.max(1, dayIndex)).padStart(2, '0')}`;
}

/**
 * Sanitize course name into a valid, collision-free folder name under `courses/`.
 * Handles illegal filesystem characters, path traversal, Windows reserved names,
 * and avoids duplicate folder names.
 */
export function sanitizeCourseFolderName(
  rawName: string,
  existingFolderNames: Iterable<string> = []
): string {
  const existingSet = new Set(Array.from(existingFolderNames).map((s) => s.toLowerCase()));

  let cleaned = (rawName || '')
    .trim()
    // Remove illegal path characters across Windows/Linux/macOS
    .replace(/[<>:"/\\|?*\x00-\x1f~#%&+{}`'=@!$,;()[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    cleaned = 'course_project';
  }

  if (cleaned.length > 64) {
    cleaned = cleaned.slice(0, 64).replace(/_+$/g, '');
  }

  let candidate = cleaned;
  let counter = 2;
  while (existingSet.has(candidate.toLowerCase())) {
    candidate = `${cleaned}_${counter}`;
    counter++;
  }
  return candidate;
}

/**
 * Convert arbitrary filename into an ASCII-safe filename for internal PDF script safety
 * while preserving extension.
 */
export function sanitizeMaterialFileName(fileName: string, index: number): string {
  const extMatch = (fileName || '').match(/(\.[a-zA-Z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '.txt';
  const baseRaw = extMatch ? fileName.slice(0, -extMatch[0].length) : fileName;
  const asciiPart = baseRaw
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const prefix = `source-${String(index + 1).padStart(2, '0')}`;
  return asciiPart ? `${prefix}_${asciiPart}${ext}` : `${prefix}${ext}`;
}

/**
 * Normalize a vocabulary word for set comparison (lowercase, trimmed).
 */
export function normalizeWordKey(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * Parse raw text, CSV, or JSON string into structured VocabItem list.
 */
export function parseVocabularyInput(rawText: string): VocabItem[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : parsed.words || Object.keys(parsed);
      if (Array.isArray(arr)) {
        const result: VocabItem[] = [];
        for (const item of arr) {
          if (typeof item === 'string' && item.trim()) {
            result.push({ word: item.trim(), meaning: '待结合语境学习' });
          } else if (item && typeof item === 'object' && typeof item.word === 'string') {
            result.push({
              word: item.word.trim(),
              phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : undefined,
              meaning:
                typeof item.meaning === 'string'
                  ? item.meaning.trim()
                  : item.translation || '待结合语境学习',
              example: typeof item.example === 'string' ? item.example.trim() : undefined,
            });
          }
        }
        return deduplicateVocabList(result);
      }
    } catch {
      // Fall back to line-based parsing
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const items: VocabItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const phoneticMatch = line.match(/^([a-zA-Z][a-zA-Z\s'-]*?)\s+(\/[^/]+\/|\[[^\]]+\])\s*(.*)$/);
    if (phoneticMatch) {
      items.push({
        word: phoneticMatch[1].trim(),
        phonetic: phoneticMatch[2].trim(),
        meaning: phoneticMatch[3].trim() || '待结合语境学习',
      });
      continue;
    }

    const sepMatch = line.match(/^([a-zA-Z][a-zA-Z\s'-]*?)(?:\t|,|\s+-\s+|\s+—\s+|\s{2,})(.+)$/);
    if (sepMatch) {
      items.push({
        word: sepMatch[1].trim(),
        meaning: sepMatch[2].trim(),
      });
      continue;
    }

    const chineseMatch = line.match(/^([a-zA-Z][a-zA-Z'-]*)\s+(.+)$/);
    if (chineseMatch) {
      items.push({
        word: chineseMatch[1].trim(),
        meaning: chineseMatch[2].trim(),
      });
      continue;
    }

    if (/^[a-zA-Z][a-zA-Z'-]*$/.test(line)) {
      items.push({
        word: line,
        meaning: '待结合语境学习',
      });
    }
  }

  return deduplicateVocabList(items);
}

export function deduplicateVocabList(items: VocabItem[]): VocabItem[] {
  const seen = new Map<string, VocabItem>();
  for (const item of items) {
    const key = normalizeWordKey(item.word);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, {
        ...item,
        word: item.word.trim().toLowerCase(),
      });
    } else {
      const existing = seen.get(key)!;
      if (
        existing.meaning === '待结合语境学习' &&
        item.meaning &&
        item.meaning !== '待结合语境学习'
      ) {
        seen.set(key, { ...existing, ...item, word: existing.word });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Vocabulary Set Difference Operation:
 * Target Vocabulary Set - Excluded (Mastered) Vocabulary Set = Actual Words to Learn
 */
export function computeVocabSetDifference(
  targetWords: VocabItem[],
  excludedWords: VocabItem[]
): {
  targetTotal: number;
  excludedTotal: number;
  overlapCount: number;
  effectiveWords: VocabItem[];
} {
  const dedupedTarget = deduplicateVocabList(targetWords);
  const dedupedExcluded = deduplicateVocabList(excludedWords);
  const excludedSet = new Set(dedupedExcluded.map((w) => normalizeWordKey(w.word)));

  const effectiveWords: VocabItem[] = [];
  let overlapCount = 0;

  for (const item of dedupedTarget) {
    const key = normalizeWordKey(item.word);
    if (excludedSet.has(key)) {
      overlapCount++;
    } else {
      effectiveWords.push(item);
    }
  }

  return {
    targetTotal: dedupedTarget.length,
    excludedTotal: dedupedExcluded.length,
    overlapCount,
    effectiveWords,
  };
}

/**
 * Compute vocabulary coverage & capacity warning for English courses.
 */
export function computeVocabCoverageStats(
  effectiveTotal: number,
  durationDays: number,
  dailyWordCount: number
): VocabCoverageStats {
  const safeDays = Math.max(1, Math.floor(durationDays || 1));
  const safeDaily = Math.max(1, Math.floor(dailyWordCount || 20));
  const plannedTotal = safeDays * safeDaily;
  const actualAllocatedTotal = Math.min(effectiveTotal, plannedTotal);
  const unallocatedRemainingCount = Math.max(0, effectiveTotal - plannedTotal);
  const isExceedingCapacity = plannedTotal > effectiveTotal;
  const fullDaysCount = safeDaily > 0 ? Math.floor(effectiveTotal / safeDaily) : 0;
  const coveragePercent =
    effectiveTotal > 0 ? Math.min(100, Math.round((actualAllocatedTotal / effectiveTotal) * 100)) : 0;

  let message = '';
  if (effectiveTotal === 0) {
    message = '当前待学词库为空（0 词），请调整目标词库或排除词库。';
  } else if (isExceedingCapacity) {
    const coveredDays = Math.ceil(effectiveTotal / safeDaily);
    message = `容量提醒：计划 ${safeDays} 天 × 每日 ${safeDaily} 词 = ${plannedTotal} 词，已超过待学词库实际容量（${effectiveTotal} 词）。系统将不重复分配全部 ${effectiveTotal} 词（可覆盖前 ${coveredDays} 天，其中 ${fullDaysCount} 天满额），建议调小每日单词数、缩短期限或扩充目标词库。`;
  } else {
    message = `词库覆盖正常：计划 ${safeDays} 天 × 每日 ${safeDaily} 词 = 共随机抽取 ${actualAllocatedTotal} 词（同一周期内不重复），覆盖待学词库（${effectiveTotal} 词）的 ${coveragePercent}%，词库剩余 ${unallocatedRemainingCount} 词未分配。`;
  }

  return {
    effectiveTotal,
    dailyWordCount: safeDaily,
    durationDays: safeDays,
    plannedTotal,
    actualAllocatedTotal,
    unallocatedRemainingCount,
    isExceedingCapacity,
    fullDaysCount,
    coveragePercent,
    message,
  };
}

/**
 * Deterministic or random Fisher-Yates shuffle of vocabulary array.
 */
export function shuffleVocabList(words: VocabItem[], seedStr?: string): VocabItem[] {
  const copy = [...words];
  if (copy.length <= 1) return copy;

  let rng: () => number = Math.random;
  if (seedStr) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0 || 1;
    rng = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Allocate vocabulary words randomly across study days according to `dailyWordCount`:
 * - Randomly draws words from `effectiveWords` without repetition within the study cycle.
 * - Each day receives up to `dailyWordCount` words.
 * - If `preserveStartedSlots` is true, slots that already have a generated lesson (`Boolean(slot.lesson)`)
 *   keep their existing `assignedWords` unchanged, and only unstarted slots receive freshly randomized words
 *   from the remaining unused vocabulary pool!
 */
export function allocateEnglishWordsRandomly(params: {
  effectiveWords: VocabItem[];
  durationDays: number;
  dailyWordCount: number;
  seedStr?: string;
  existingSlots?: DailyPlanSlot[];
  masteredWords?: string[];
  preserveStartedSlots?: boolean;
}): {
  buckets: VocabItem[][];
  coverageStats: VocabCoverageStats;
} {
  const {
    effectiveWords,
    durationDays,
    dailyWordCount,
    seedStr,
    existingSlots = [],
    masteredWords = [],
    preserveStartedSlots = false,
  } = params;

  const days = Math.max(1, Math.floor(durationDays || 1));
  const perDay = Math.max(1, Math.floor(dailyWordCount || 20));
  const dedupedPool = deduplicateVocabList(effectiveWords);
  const coverageStats = computeVocabCoverageStats(dedupedPool.length, days, perDay);

  const lockedWordsSet = new Set<string>(masteredWords.map(normalizeWordKey));
  const buckets: VocabItem[][] = Array.from({ length: days }, () => []);
  const lockedDayIndices = new Set<number>();

  if (preserveStartedSlots && existingSlots.length > 0) {
    for (let i = 0; i < days; i++) {
      const slot = existingSlots[i];
      if (slot && slot.lesson && Array.isArray(slot.assignedWords) && slot.assignedWords.length > 0) {
        buckets[i] = [...slot.assignedWords];
        lockedDayIndices.add(i);
        for (const w of slot.assignedWords) {
          lockedWordsSet.add(normalizeWordKey(w.word));
        }
      }
    }
  }

  const availablePool = dedupedPool.filter((w) => !lockedWordsSet.has(normalizeWordKey(w.word)));
  const shuffled = shuffleVocabList(availablePool, seedStr);

  let cursor = 0;
  for (let i = 0; i < days; i++) {
    if (lockedDayIndices.has(i)) continue;
    const slice = shuffled.slice(cursor, cursor + perDay);
    buckets[i] = slice;
    cursor += slice.length;
  }

  return { buckets, coverageStats };
}

/**
 * Legacy helper: Evenly or by dailyWordCount distribute vocabulary words across N study days.
 */
export function allocateWordsToDays(
  words: VocabItem[],
  durationDays: number,
  dailyWordCount?: number,
  seedStr?: string
): VocabItem[][] {
  if (dailyWordCount && dailyWordCount > 0) {
    return allocateEnglishWordsRandomly({
      effectiveWords: words,
      durationDays,
      dailyWordCount,
      seedStr,
    }).buckets;
  }
  const days = Math.max(1, Math.floor(durationDays));
  const buckets: VocabItem[][] = Array.from({ length: days }, () => []);
  if (words.length === 0) return buckets;

  const total = words.length;
  for (let i = 0; i < total; i++) {
    const dayIdx = Math.min(days - 1, Math.floor((i * days) / total));
    buckets[dayIdx].push(words[i]);
  }
  return buckets;
}

/**
 * Date math utilities (YYYY-MM-DD in local time)
 */
export function getTodayDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatChineseDateLabel(dateStr: string): {
  monthDay: string;
  weekday: string;
  year: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekday = WEEKDAY_NAMES[dt.getUTCDay()] || '';
  return {
    monthDay: `${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日`,
    weekday,
    year: String(y),
  };
}

export interface TimelineDateEntry {
  date: string;
  isToday: boolean;
  items: Array<{
    course: Course;
    slot: DailyPlanSlot;
  }>;
}

/**
 * Build a continuous chronological timeline of dates covering today and all scheduled course dates.
 */
export function buildDateTimeline(
  courses: Course[],
  todayStr: string = getTodayDateString()
): TimelineDateEntry[] {
  const dateMap = new Map<string, Array<{ course: Course; slot: DailyPlanSlot }>>();

  let minDate = todayStr;
  let maxDate = addDaysToDateString(todayStr, 13); // Show at least a 14-day window even when empty

  for (const course of courses) {
    for (const slot of course.dailyPlan) {
      if (!slot.date) continue;
      if (slot.date < minDate) minDate = slot.date;
      if (slot.date > maxDate) maxDate = slot.date;

      const list = dateMap.get(slot.date) || [];
      list.push({ course, slot });
      dateMap.set(slot.date, list);
    }
  }

  const entries: TimelineDateEntry[] = [];
  let cursor = minDate;
  let safetyCounter = 0;
  while (cursor <= maxDate && safetyCounter < 400) {
    entries.push({
      date: cursor,
      isToday: cursor === todayStr,
      items: dateMap.get(cursor) || [],
    });
    cursor = addDaysToDateString(cursor, 1);
    safetyCounter++;
  }

  return entries;
}

/**
 * Partition timeline entries so Today is always Row 1 of `todayAndUpcomingEntries`,
 * while any earlier dates (`date < todayStr`) are placed in `pastEntries`.
 */
export function partitionTimelineAroundToday(entries: TimelineDateEntry[]): {
  pastEntries: TimelineDateEntry[];
  todayAndUpcomingEntries: TimelineDateEntry[];
} {
  const todayIdx = entries.findIndex((e) => e.isToday);
  if (todayIdx <= 0) {
    return {
      pastEntries: [],
      todayAndUpcomingEntries: entries,
    };
  }
  return {
    pastEntries: entries.slice(0, todayIdx),
    todayAndUpcomingEntries: entries.slice(todayIdx),
  };
}

/**
 * Deterministic offline exercise grading (requires NO LLM or internet connection).
 */
export function gradeSingleExercise(
  question: ExerciseQuestion,
  userRawAnswer: string
): { isCorrect: boolean; normalizedUser: string; normalizedExpected: string } {
  const userClean = (userRawAnswer || '').trim();
  const expectedClean = (question.answer || '').trim();

  if (question.type === 'choice') {
    const userLetterMatch = userClean.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
    const expectedLetterMatch = expectedClean.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
    const u = userLetterMatch ? userLetterMatch[1].toUpperCase() : userClean.toUpperCase();
    const e = expectedLetterMatch ? expectedLetterMatch[1].toUpperCase() : expectedClean.toUpperCase();
    return {
      isCorrect: Boolean(u && u === e),
      normalizedUser: u,
      normalizedExpected: e,
    };
  }

  const normalizeText = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,;!?。，；！？]+$/g, '');

  const uNorm = normalizeText(userClean);
  const candidates = expectedClean.split(/\s*[/|]\s*/).map(normalizeText);
  const isCorrect = Boolean(uNorm && candidates.includes(uNorm));

  return {
    isCorrect,
    normalizedUser: userClean,
    normalizedExpected: expectedClean,
  };
}

export function gradeExerciseSet(
  questions: ExerciseQuestion[],
  userAnswers: Record<string, string>
): {
  score: number;
  total: number;
  details: Record<string, { isCorrect: boolean; expected: string; explanation: string }>;
} {
  let score = 0;
  const details: Record<string, { isCorrect: boolean; expected: string; explanation: string }> = {};

  for (const q of questions) {
    const res = gradeSingleExercise(q, userAnswers[q.id] || '');
    if (res.isCorrect) score++;
    details[q.id] = {
      isCorrect: res.isCorrect,
      expected: q.answer,
      explanation: q.explanation || '',
    };
  }

  return {
    score,
    total: questions.length,
    details,
  };
}

export function formatStudyDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export interface ComputedLearningStats {
  totalStudySeconds: number;
  todayStudySeconds: number;
  totalQuestionsAnswered: number;
  totalQuestionsCorrect: number;
  accuracyPercent: number | null;
  todayQuestionsAnswered: number;
  todayQuestionsCorrect: number;
  todayAccuracyPercent: number | null;
  completedLessonsCount: number;
  totalLessonsCount: number;
}

export function getSlotExerciseSubmission(
  course: Course,
  slot: DailyPlanSlot
): ExerciseSubmissionRecord | undefined {
  const subs = course.exerciseSubmissions || {};
  if (slot.id && subs[slot.id]) {
    return subs[slot.id];
  }
  const secKey = ensureStableSectionId(slot.dayIndex, slot.id);
  if (subs[secKey]) {
    return subs[secKey];
  }
  if (slot.date && subs[slot.date]) {
    const record = subs[slot.date];
    if (!record.sectionId || record.sectionId === secKey || record.sectionId === slot.id) {
      return record;
    }
  }
  return undefined;
}

/** Estimate study time from finished courseware, without trusting imported estimates. */
export function estimateWrittenLessonMinutes(lesson: DailyLessonContent): number {
  const body = (lesson.markdownBody || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');
  const displayMath = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
  let derivationMinutes = 0;
  for (const match of body.matchAll(displayMath)) {
    const formula = match[1] ?? match[2];
    const steps = formula.split(/\\\\|\\(?:Rightarrow|Longrightarrow|implies)/).filter((step) => step.trim()).length;
    if (steps >= 2) derivationMinutes += steps > 4 ? 4 : 2;
  }
  const paragraphs = Array.isArray(lesson.englishPayload?.paragraphs) ? lesson.englishPayload.paragraphs : [];
  const prose = [
    body.replace(displayMath, '').replace(/\$[^$\n]+\$|\\\([^\n]*?\\\)/g, ''),
    ...paragraphs.map(({ english, chinese }) => `${english || ''} ${chinese || ''}`),
    lesson.englishPayload?.grammarAndUsageNotes || '',
  ].join(' ');
  const readingMinutes = (prose.match(/\p{Script=Han}/gu)?.length || 0) / 200
    + (prose.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0) / 150;
  const concepts = new Set((lesson.keyPoints || []).map((point) => point.trim()).filter(Boolean));
  const exerciseWeights = { basic: 2, application: 5, comprehensive: 10 };
  const exerciseMinutes = (lesson.exercises || []).reduce((total, exercise) =>
    total + (exercise.difficulty ? exerciseWeights[exercise.difficulty] ?? 5 : 5), 0);
  const minutes = readingMinutes + concepts.size * 2 + derivationMinutes
    + (lesson.diagrams?.length || 0) * 1.5 + exerciseMinutes
    + (lesson.heuristicQuestions?.length || 0) * 2 + (lesson.reverseChecks?.length || 0) * 2;
  return Math.max(1, Math.ceil(minutes));
}

export function getEvaluatedSectionMinutes(slot: Partial<DailyPlanSlot>): number | undefined {
  return slot.lesson && slot.lesson.generationStage !== 'stage1_content'
    ? estimateWrittenLessonMinutes(slot.lesson)
    : undefined;
}

/**
 * Deterministic estimation fallback for a teaching section's study duration in minutes
 * when an imported/legacy outline omits `estimatedMinutes`.
 */
export function estimateSectionMinutesFallback(slot: Partial<DailyPlanSlot>): number {
  const evaluated = getEvaluatedSectionMinutes(slot);
  if (evaluated !== undefined) {
    return evaluated;
  }
  const segPages = slot.pdfSegment
    ? Math.max(
        1,
        (Number(slot.pdfSegment.physicalEndPage) || 1) -
          (Number(slot.pdfSegment.physicalStartPage) || 1) +
          1
      )
    : 0;
  const topicCount = Array.isArray(slot.keyTopics) ? slot.keyTopics.length : 0;

  let estimate = 45;
  if (segPages > 0 && topicCount > 0) {
    estimate = Math.round(segPages * 4.5 + topicCount * 6);
  } else if (segPages > 0) {
    estimate = Math.round(segPages * 5.5);
  } else if (topicCount > 0) {
    estimate = Math.round(topicCount * 14);
  }
  return Math.max(20, Math.min(120, estimate));
}

/**
 * Deterministic sequence-preserving day allocation algorithm:
 * Partitions ordered sections across `durationDays` based on `estimatedMinutes`,
 * using `totalMinutes / durationDays` as the baseline daily load while preserving
 * strict section order and section indivisibility (no AI used for scheduling).
 */
export function allocateSectionsToDays(
  slots: DailyPlanSlot[],
  durationDays: number,
  startDate: string
): DailyPlanSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const safeStartDate =
    typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : getTodayDateString();
  const M = slots.length;
  const N = Math.max(1, Math.min(180, Math.round(Number(durationDays) || M)));

  const normalized: DailyPlanSlot[] = slots.map((slot, idx) => {
    const secNum = idx + 1;
    const stableId = ensureStableSectionId(secNum, slot.id);
    const evaluatedOrExplicit = getEvaluatedSectionMinutes(slot);
    return {
      ...slot,
      id: stableId,
      dayIndex: secNum,
      estimatedMinutes: evaluatedOrExplicit,
    };
  });

  if (M === N) {
    return normalized.map((slot, idx) => ({
      ...slot,
      scheduledDay: idx + 1,
      date: addDaysToDateString(safeStartDate, idx),
    }));
  }

  const weights = normalized.map((s) => estimateSectionMinutesFallback(s));
  const totalMinutes = weights.reduce((acc, w) => acc + w, 0);

  if (M < N) {
    // Spread M indivisible sections proportionally across N days by cumulative midpoint,
    // keeping strict monotonic progression: Day 1 gets section 1, and each section advances.
    const assignedDays: number[] = new Array(M).fill(1);
    let cumBefore = 0;
    for (let i = 0; i < M; i++) {
      const w = weights[i];
      if (i === 0) {
        assignedDays[i] = 1;
      } else {
        const midpointRatio = totalMinutes > 0 ? (cumBefore + w * 0.5) / totalMinutes : i / M;
        const idealDay = Math.floor(midpointRatio * N) + 1;
        const minAllowed = assignedDays[i - 1] + 1;
        const maxAllowed = N - (M - 1 - i);
        assignedDays[i] = Math.max(minAllowed, Math.min(maxAllowed, idealDay));
      }
      cumBefore += w;
    }
    return normalized.map((slot, idx) => {
      const d = assignedDays[idx];
      return {
        ...slot,
        scheduledDay: d,
        date: addDaysToDateString(safeStartDate, d - 1),
      };
    });
  }

  // M > N: Exact dynamic programming partition minimizing SSE from targetMinutes = totalMinutes / N
  const target = totalMinutes / N;
  const prefix = new Array<number>(M + 1).fill(0);
  for (let i = 0; i < M; i++) {
    prefix[i + 1] = prefix[i] + weights[i];
  }

  const INF = Number.POSITIVE_INFINITY;
  const dpSse: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const dpMaxLoad: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const prevSplit: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

  for (let i = 1; i <= M - (N - 1); i++) {
    const load = prefix[i];
    const diff = load - target;
    dpSse[1][i] = diff * diff;
    dpMaxLoad[1][i] = load;
    prevSplit[1][i] = 0;
  }

  for (let d = 2; d <= N; d++) {
    const maxI = M - (N - d);
    for (let i = d; i <= maxI; i++) {
      let bestSse = INF;
      let bestMax = INF;
      let bestJ = d - 1;
      for (let j = d - 1; j < i; j++) {
        if (dpSse[d - 1][j] === INF) continue;
        const segLoad = prefix[i] - prefix[j];
        const diff = segLoad - target;
        const candSse = dpSse[d - 1][j] + diff * diff;
        const candMax = Math.max(dpMaxLoad[d - 1][j], segLoad);
        if (
          candSse < bestSse - 1e-6 ||
          (Math.abs(candSse - bestSse) <= 1e-6 && candMax < bestMax)
        ) {
          bestSse = candSse;
          bestMax = candMax;
          bestJ = j;
        }
      }
      dpSse[d][i] = bestSse;
      dpMaxLoad[d][i] = bestMax;
      prevSplit[d][i] = bestJ;
    }
  }

  // Reconstruct day index (1..N) for each section 0..M-1
  const assignedDays = new Array<number>(M).fill(N);
  let cursorEnd = M;
  for (let d = N; d >= 1; d--) {
    const startIdx = prevSplit[d][cursorEnd];
    for (let k = startIdx; k < cursorEnd; k++) {
      assignedDays[k] = d;
    }
    cursorEnd = startIdx;
  }

  return normalized.map((slot, idx) => {
    const d = assignedDays[idx];
    return {
      ...slot,
      scheduledDay: d,
      date: addDaysToDateString(safeStartDate, d - 1),
    };
  });
}

/**
 * Build day-by-day grouped study schedule summary from allocated section slots.
 */
export function buildCourseDailySchedule(
  slots: DailyPlanSlot[],
  durationDays: number,
  startDate: string
): DailyScheduleDay[] {
  const safeStartDate =
    typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : getTodayDateString();
  const safeDays = Math.max(1, Math.min(180, Math.round(Number(durationDays) || slots.length || 1)));
  const totalMinutes = slots.reduce((sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0), 0);
  const targetMinutes = Math.round(totalMinutes / safeDays);

  const byDate = new Map<string, DailyPlanSlot[]>();
  for (const s of slots) {
    const key = s.date || addDaysToDateString(safeStartDate, Math.max(0, (s.scheduledDay || s.dayIndex) - 1));
    const list = byDate.get(key) || [];
    list.push(s);
    byDate.set(key, list);
  }

  const schedule: DailyScheduleDay[] = [];
  for (let d = 1; d <= safeDays; d++) {
    const date = addDaysToDateString(safeStartDate, d - 1);
    const daySlots = byDate.get(date) || [];
    schedule.push({
      dayNumber: d,
      date,
      sectionIds: daySlots.map((s) => ensureStableSectionId(s.dayIndex, s.id)),
      estimatedMinutes: daySlots.reduce((sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0), 0),
      targetMinutes,
    });
  }
  return schedule;
}

export function computeLearningStats(
  courses: Course[],
  studyStats: {
    totalSeconds?: number;
    secondsByDate?: Record<string, number>;
    secondsByCourse?: Record<string, number>;
  } | null | undefined,
  todayStr: string = getTodayDateString()
): ComputedLearningStats {
  const totalStudySeconds = Math.max(0, Math.floor(studyStats?.totalSeconds || 0));
  const todayStudySeconds = Math.max(
    0,
    Math.floor(studyStats?.secondsByDate?.[todayStr] || 0)
  );

  let totalQuestionsAnswered = 0;
  let totalQuestionsCorrect = 0;
  let todayQuestionsAnswered = 0;
  let todayQuestionsCorrect = 0;
  let completedLessonsCount = 0;
  let totalLessonsCount = 0;

  for (const course of courses) {
    totalLessonsCount += course.dailyPlan.length;
    const slotDateBySecId = new Map<string, string>();
    for (const slot of course.dailyPlan) {
      if (slot.id) slotDateBySecId.set(slot.id, slot.date);
      slotDateBySecId.set(ensureStableSectionId(slot.dayIndex, slot.id), slot.date);
      if (slot.lesson) {
        completedLessonsCount++;
      }
    }
    const subs = course.exerciseSubmissions || {};
    for (const [subKey, sub] of Object.entries(subs)) {
      if (!sub || typeof sub.total !== 'number' || sub.total <= 0) continue;
      const total = Math.max(0, Number(sub.total) || 0);
      const score = Math.max(0, Math.min(total, Number(sub.score) || 0));
      totalQuestionsAnswered += total;
      totalQuestionsCorrect += score;
      const effectiveDate = sub.date || slotDateBySecId.get(subKey) || subKey;
      if (subKey === todayStr || effectiveDate === todayStr) {
        todayQuestionsAnswered += total;
        todayQuestionsCorrect += score;
      }
    }
  }

  const accuracyPercent =
    totalQuestionsAnswered > 0
      ? Math.round((totalQuestionsCorrect / totalQuestionsAnswered) * 1000) / 10
      : null;

  const todayAccuracyPercent =
    todayQuestionsAnswered > 0
      ? Math.round((todayQuestionsCorrect / todayQuestionsAnswered) * 1000) / 10
      : null;

  return {
    totalStudySeconds,
    todayStudySeconds,
    totalQuestionsAnswered,
    totalQuestionsCorrect,
    accuracyPercent,
    todayQuestionsAnswered,
    todayQuestionsCorrect,
    todayAccuracyPercent,
    completedLessonsCount,
    totalLessonsCount,
  };
}

function normalizeRegionToken(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^region[-_\s]?(\d+)$/i);
  if (match) {
    return `region-${String(Number(match[1])).padStart(2, '0')}`;
  }
  return trimmed;
}

/**
 * Extract all referenced PDF region IDs (`region-01`, `region-02`, ...) from a section's
 * `regionIds`, `regionId`, `teachingScope`, and `title`.
 */
export function extractReferencedRegionIds(slot: {
  regionId?: string;
  regionIds?: string[];
  teachingScope?: string;
  title?: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushId = (raw: string) => {
    const normalized = normalizeRegionToken(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  if (Array.isArray(slot.regionIds)) {
    for (const entry of slot.regionIds) {
      if (typeof entry !== 'string') continue;
      for (const token of entry.split(/[,，、;；/+&\s]+/)) {
        if (token.trim()) pushId(token);
      }
    }
  }

  if (typeof slot.regionId === 'string' && slot.regionId.trim()) {
    for (const token of slot.regionId.split(/[,，、;；/+&\s]+/)) {
      if (token.trim()) pushId(token);
    }
  }

  const scanText = `${slot.teachingScope || ''}\n${slot.title || ''}`;
  const matches = scanText.match(/region[-_\s]?\d+/gi) || [];
  for (const m of matches) {
    pushId(m);
  }

  return out;
}

/**
 * Resolve ALL PDF segments bound to a section (supporting 1-to-1 and many-to-one merged regions).
 */
export function resolveSlotPdfSegments(
  slot: Pick<
    DailyPlanSlot,
    'id' | 'dayIndex' | 'regionId' | 'regionIds' | 'teachingScope' | 'title' | 'pdfSegment' | 'pdfSegments'
  >,
  splitPlan?: PdfSplitPlanItem[]
): PdfSplitPlanItem[] {
  const fallbackList = (): PdfSplitPlanItem[] => {
    const items: PdfSplitPlanItem[] = [];
    const seen = new Set<string>();
    const add = (seg?: PdfSplitPlanItem) => {
      if (!seg) return;
      const key = seg.sectionId || seg.segmentFileName || seg.segmentRelPath || String(seg.dayIndex);
      if (seen.has(key)) return;
      seen.add(key);
      items.push(seg);
    };
    if (Array.isArray(slot.pdfSegments)) {
      for (const s of slot.pdfSegments) add(s);
    }
    add(slot.pdfSegment);
    return items;
  };

  if (!splitPlan || splitPlan.length === 0) {
    return fallbackList();
  }

  const findInPlan = (id: string): PdfSplitPlanItem | undefined => {
    const norm = normalizeRegionToken(id);
    return splitPlan.find(
      (p) => p.sectionId === id || normalizeRegionToken(p.sectionId) === norm
    );
  };

  const refIds = extractReferencedRegionIds(slot);
  const matched: PdfSplitPlanItem[] = [];
  const seen = new Set<string>();
  for (const refId of refIds) {
    const found = findInPlan(refId);
    if (found && !seen.has(found.sectionId)) {
      seen.add(found.sectionId);
      matched.push(found);
    }
  }
  if (matched.length > 0) {
    return matched;
  }

  // Compatibility fallback when section didn't specify regionId
  const bySecId = findInPlan(slot.id);
  if (bySecId) return [bySecId];
  const byDayIndex = splitPlan.find((p) => p.dayIndex === slot.dayIndex);
  if (byDayIndex) return [byDayIndex];

  return fallbackList();
}

function findBestSlotIndexByPageOverlap(
  slots: DailyPlanSlot[],
  region: PdfSplitPlanItem
): number {
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < slots.length; i++) {
    const text = `${slots[i].teachingScope || ''}\n${slots[i].title || ''}`;
    let score = 0;

    // Look for physical or printed page ranges like "物理页54~64" or "329~339"
    const rangeRegex = /(\d{1,4})\s*[~–\-－至到]\s*(\d{1,4})/g;
    let m: RegExpExecArray | null;
    while ((m = rangeRegex.exec(text)) !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
      const physOverlap = Math.max(
        0,
        Math.min(b, region.physicalEndPage) - Math.max(a, region.physicalStartPage) + 1
      );
      if (physOverlap > 0) {
        score += physOverlap * 2;
      }
      if (
        typeof region.printedStartPage === 'number' &&
        typeof region.printedEndPage === 'number'
      ) {
        const printedOverlap = Math.max(
          0,
          Math.min(b, region.printedEndPage) - Math.max(a, region.printedStartPage) + 1
        );
        if (printedOverlap > 0) {
          score += printedOverlap * 2;
        }
      }
    }

    if (score >= bestScore && score > 0) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Bind every section to its referenced PDF region(s) and guarantee 100% coverage of all
 * split PDF regions in `splitPlan` so no sliced PDF is left unused.
 */
export function bindAndEnsureAllPdfRegionsCovered(
  slots: DailyPlanSlot[],
  splitPlan?: PdfSplitPlanItem[]
): DailyPlanSlot[] {
  if (!slots || slots.length === 0) return [];
  if (!splitPlan || splitPlan.length === 0) {
    return slots.map((slot) => {
      const existingSegs = resolveSlotPdfSegments(slot, undefined);
      const existingIds = extractReferencedRegionIds(slot);
      return {
        ...slot,
        regionId: existingIds[0] || slot.regionId || existingSegs[0]?.sectionId,
        regionIds:
          existingIds.length > 0
            ? existingIds
            : existingSegs.length > 0
              ? existingSegs.map((s) => s.sectionId)
              : slot.regionIds,
        pdfSegment: existingSegs[0] || slot.pdfSegment,
        pdfSegments: existingSegs.length > 0 ? existingSegs : slot.pdfSegments,
      };
    });
  }

  const orderIndex = new Map<string, number>();
  splitPlan.forEach((p, idx) => orderIndex.set(p.sectionId, idx));

  // Pass 1: resolve explicitly referenced regions per slot
  const slotSegLists: PdfSplitPlanItem[][] = slots.map((slot) =>
    resolveSlotPdfSegments(slot, splitPlan)
  );

  const covered = new Set<string>();
  for (const list of slotSegLists) {
    for (const seg of list) {
      covered.add(seg.sectionId);
    }
  }

  // Pass 2: assign any uncovered regions so every split PDF region is attached to a section
  for (let rIdx = 0; rIdx < splitPlan.length; rIdx++) {
    const region = splitPlan[rIdx];
    if (covered.has(region.sectionId)) continue;

    let targetSlotIdx = findBestSlotIndexByPageOverlap(slots, region);

    if (targetSlotIdx < 0 && rIdx > 0) {
      const prevRegionId = splitPlan[rIdx - 1].sectionId;
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slotSegLists[i].some((s) => s.sectionId === prevRegionId)) {
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx < 0 && rIdx + 1 < splitPlan.length) {
      const nextRegionId = splitPlan[rIdx + 1].sectionId;
      for (let i = 0; i < slots.length; i++) {
        if (slotSegLists[i].some((s) => s.sectionId === nextRegionId)) {
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx < 0) {
      const proportional = Math.floor((rIdx / Math.max(1, splitPlan.length)) * slots.length);
      targetSlotIdx = Math.max(0, Math.min(slots.length - 1, proportional));
    }

    if (!slotSegLists[targetSlotIdx].some((s) => s.sectionId === region.sectionId)) {
      slotSegLists[targetSlotIdx].push(region);
    }
    covered.add(region.sectionId);
  }

  // Pass 3: normalize ordering and sync regionId/regionIds/pdfSegment/pdfSegments
  return slots.map((slot, idx) => {
    const unique = new Map<string, PdfSplitPlanItem>();
    for (const seg of slotSegLists[idx]) {
      if (!unique.has(seg.sectionId)) unique.set(seg.sectionId, seg);
    }
    const sortedSegs = Array.from(unique.values()).sort(
      (a, b) => (orderIndex.get(a.sectionId) ?? 9999) - (orderIndex.get(b.sectionId) ?? 9999)
    );
    const regionIds = sortedSegs.map((s) => s.sectionId);
    return {
      ...slot,
      regionId: regionIds[0] || slot.regionId,
      regionIds: regionIds.length > 0 ? regionIds : undefined,
      pdfSegment: sortedSegs[0] || slot.pdfSegment,
      pdfSegments: sortedSegs.length > 0 ? sortedSegs : undefined,
    };
  });
}

