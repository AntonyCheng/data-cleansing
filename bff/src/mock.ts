import type {
  AudioResult,
  ImageResult,
  TaskStreamMsg,
  VideoResult,
} from "./types.js";

export const mockImageResult: ImageResult = {
  layout: "vat_invoice",
  fields: [
    { key: "invoice_code", label: "发票代码", value: "144032509110", confidence: 0.99, bbox: [812, 60, 1010, 92] },
    { key: "invoice_no", label: "发票号码", value: "25000037", confidence: 0.98, bbox: [812, 96, 1010, 132] },
    { key: "invoice_date", label: "开票日期", value: "2026-09-01", confidence: 0.97, bbox: [812, 136, 1010, 168] },
    { key: "buyer_name", label: "购买方名称", value: "北京示例科技有限公司", confidence: 0.95 },
    { key: "buyer_tax_no", label: "购买方纳税人识别号", value: "91110108MA00EXAMPLE", confidence: 0.94 },
    { key: "seller_name", label: "销售方名称", value: "上海样例服务有限公司", confidence: 0.96 },
    { key: "total_amount", label: "金额", value: "12000.00", confidence: 0.98 },
    { key: "total_tax", label: "税额", value: "800.00", confidence: 0.98 },
    { key: "amount_in_figures", label: "价税合计", value: "12800.00", confidence: 0.99 },
  ],
  line_items: [{ name: "技术服务费", amount: 12000.0, tax: 800.0 }],
  full_text:
    "增值税专用发票\n发票代码 144032509110  发票号码 25000037\n开票日期 2026年09月01日\n购买方：北京示例科技有限公司\n销售方：上海样例服务有限公司\n项目：技术服务费  金额 12000.00  税率 6%  税额 800.00\n价税合计（大写）壹万贰仟捌佰圆整  （小写）￥12800.00",
  summary: "一张金额 1.28 万元的技术服务费增值税专用发票，开票日期 2026-09-01。",
  tags: ["发票", "增值税专用发票", "财务", "技术服务"],
};

export const mockAudioResult: AudioResult = {
  speakers: [
    { id: "S1", name: "说话人1" },
    { id: "S2", name: "说话人2" },
  ],
  transcript: [
    { speaker: "S1", start_ms: 1200, end_ms: 4300, text: "我们先对齐一下这一期的排期。" },
    { speaker: "S2", start_ms: 4600, end_ms: 9800, text: "好的，我这边设计稿大概还要两天，周四能给到。" },
    { speaker: "S1", start_ms: 10200, end_ms: 15400, text: "那前端联调就放到下周一，里程碑一定在十月中。" },
    { speaker: "S2", start_ms: 15800, end_ms: 19000, text: "没问题，我把测试用例也一起补上。" },
  ],
  summary: {
    tldr: "讨论本期排期，确认设计稿周四交付、下周一开始前端联调，里程碑一定在十月中。",
    key_points: [
      { text: "设计稿周四（约两天后）交付", evidence_ms: 9800 },
      { text: "前端联调安排在下周一", evidence_ms: 15400 },
      { text: "里程碑一定在十月中", evidence_ms: 15400 },
    ],
    todos: [
      { text: "补充设计稿", owner: "说话人2" },
      { text: "补充测试用例", owner: "说话人2" },
    ],
    entities: { persons: [], dates: ["周四", "下周一", "十月中"], amounts: [] },
  },
};

export const mockVideoResult: VideoResult = {
  subtitles: [
    { start_ms: 0, end_ms: 2600, text: "欢迎回到本期节目。" },
    { start_ms: 2600, end_ms: 6800, text: "今天我们来看这款新发布的设备。" },
    { start_ms: 6800, end_ms: 12000, text: "先从外观开始讲起。" },
  ],
  frame_events: [
    { t_ms: 3000, thumb_url: "", caption: "主持人坐在演播室，桌上放着产品样机", tags: ["演播室", "人物", "产品"], scene_change: true },
    { t_ms: 9000, thumb_url: "", caption: "特写镜头展示设备背面接口", tags: ["特写", "产品细节"], scene_change: true },
  ],
  chapters: [
    { start_ms: 0, end_ms: 45000, title: "开场介绍", summary: "主持人介绍本期评测对象。" },
    { start_ms: 45000, end_ms: 180000, title: "外观与做工", summary: "从正面、背面、接口三个角度讲外观。" },
  ],
  summary: "一期约 8 分钟的产品评测视频，涵盖外观、性能、总结三部分。",
  tags: ["评测", "数码", "开箱"],
  entities: { objects: ["手机", "充电器"], scenes: ["演播室", "户外"] },
};

/** 模拟"边播放边分析"的流式消息序列 */
export function mockVideoStream(): TaskStreamMsg[] {
  const msgs: TaskStreamMsg[] = [];
  for (const s of mockVideoResult.subtitles) msgs.push({ kind: "subtitle", data: s });
  for (const f of mockVideoResult.frame_events) msgs.push({ kind: "frame_event", data: f });
  msgs.push({
    kind: "summary",
    data: {
      chapters: mockVideoResult.chapters,
      summary: mockVideoResult.summary,
      tags: mockVideoResult.tags,
      entities: mockVideoResult.entities,
    },
  });
  msgs.push({ kind: "done" });
  return msgs;
}
