# 冒烟测试样本

`docker compose up -d` 起来后，在 http://localhost:8080 分别用这三个文件验证三条链路：

| 文件 | 数据类型 | 预期 |
|---|---|---|
| `invoice.jpg` | 图片 | 命中 `vat_invoice` 版式，输出发票代码/号码/金额等字段 |
| `meeting.wav` | 音频 | 分说话人转写（英文），输出摘要/要点/待办 |
| `demo.mp4` | 视频 | 边播边出画面事件卡 + 字幕，结束给整片摘要与章节 |

`invoice.jpg` 是渲染的示例增值税发票；`meeting.wav` 由 Windows SAPI 合成的一段会议对话；
`demo.mp4` 是 ffmpeg 测试图 + `meeting.wav` 合成的约 19s 视频。均为合成数据，不含真实信息。
