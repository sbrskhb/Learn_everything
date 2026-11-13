import {
  Course,
  DailyPlanSlot,
  ExerciseQuestion,
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
      explanation: q.explanation,
    };
  }

  return {
    score,
    total: questions.length,
    details,
  };
}
