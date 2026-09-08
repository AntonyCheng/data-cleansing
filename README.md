# 多模态数据清洗台

图片 / 音频 / 视频结构化清洗控制台，基于火山引擎（豆包）API。
PRD：<https://claude.ai/code/artifact/239c4350-2404-4f1c-b82d-755640d4ac36>

## 结构

```
data-cleansing/
├─ bff/          Node + TS 后端代理（持有全部火山密钥、做签名、WebSocket 转发）
│  └─ src/
│     ├─ index.ts          Express + ws 入口
│     ├─ config.ts         环境变量
│     ├─ mock.ts           内置样例数据
│     ├─ providers/volc.ts 火山调用封装（mock / live 分支）
│     └─ types.ts          结果数据结构（PRD 第 07 节）
├─ web/          React + Vite + TS 前端 SPA
│  ├─ src/
│  │  ├─ App.tsx           三栏布局 + 状态机
│  │  ├─ api.ts            调用 BFF
│  │  ├─ components/       TypeMenu / UploadPanel / results/*
│  │  └─ types.ts          与 bff/src/types.ts 同步
│  ├─ Dockerfile           vite build → nginx
│  └─ nginx.conf           静态托管 + /api 反代
├─ samples/       冒烟测试样本（invoice.jpg / meeting.wav / demo.mp4）
└─ docker-compose.yaml
```

## 快速开始（mock 模式，无需密钥）

```bash
npm install            # 安装根 + bff + web 依赖（npm workspaces）
cp .env.example .env    # 默认 CLEANSING_MODE=mock
npm run dev             # 同时起 bff(:8787) 和 web(:5173)
```

打开 <http://localhost:5173>：右侧选类型 → 上传任意文件 → 「确认清洗」→ 看内置样例结果。
视频类型点「确认清洗 · 开始播放」会通过 WebSocket 收到模拟的流式字幕与画面事件。

## 切到 live 模式（M0 联调）

1. 火山引擎控制台开通并填入 `.env`：TOS、文字识别 OCR（AK/SK）、豆包语音（AppID + Token）、火山方舟（API Key）。
2. `CLEANSING_MODE=live`
3. 在 `bff/src/providers/volc.ts` 里把 `notImpl(...)` 桩按官方文档补全（PRD 跟进项 F2）。
   `GET /api/health` 会列出缺失的配置项。

## Docker 启动（推荐，省内存）

```bash
cp .env.example .env    # 填入火山密钥，CLEANSING_MODE=live
docker compose up -d --build
```

打开 **http://localhost:8080**，把 `samples/` 里的三个文件分别拖进去可快速验证三条链路。

结构：

- `web`（nginx，:8080）托管 `vite build` 出的静态站点，`/api`（含 WebSocket `/api/video/stream`）反代到 `bff`
- `bff`（Node，:8787）编译后的 Express + ws，用系统 `ffmpeg`（`FFMPEG_PATH`）
- 火山密钥经 `env_file: .env` 注入容器，**不打进镜像**
- `./exports` `./telemetry` 挂载卷持久化数仓回传与埋点
- `WEB_ORIGIN` 在 compose 里覆盖为 `http://localhost:8080`

| 命令 | 作用 |
|---|---|
| `docker compose up -d --build` | 构建并后台启动 |
| `docker compose logs -f bff` | 看 BFF 日志 |
| `docker compose down` | 停止并删除容器 |
| `docker compose up -d --build web` | 只改了前端 / nginx.conf 时重建 web |
| `docker compose restart bff` | 改了 `.env` 后重启 bff 生效 |

改后端源码要 `--build` 重新构建 bff（生产镜像不带 watch）。

## 脚本（本地 Node 开发）

不走 Docker、直接在宿主机跑时，先 `npm install`（仓库不含 `node_modules`）。

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖（根 + bff + web，npm workspaces） |
| `npm run dev` | 并行启动 bff(:8787) + web(:5173)，带热更新 |
| `npm run build` | 构建两端 |
| `npm run typecheck` | 两端类型检查 |

## 当前进度

- [x] 脚手架 + mock 链路
- [x] **图片 live**：方舟 `doubao-seed-2-1-turbo` 视觉理解做结构化（发票/证照字段 + 全文 + 摘要 + 标签），~14s
- [x] **音频 live**：TOS 上传 → 豆包录音文件识别模型2.0（`volc.seedasr.auc`，X-Api-Key 鉴权）分说话人转写 → `doubao-seed-2-1-turbo` 出摘要/要点/待办
- [x] **视频 live（M3）**：`POST /api/video/upload` 拿 id → WebSocket `/api/video/stream`。
  服务端 `@ffmpeg-installer/ffmpeg` 抽音轨（→录音识别）+ 抽帧（默认 3s，上限 30 帧，`bff/src/providers/video.ts`），
  每帧送 `doubao-seed-2-1-turbo` 视觉理解实时吐 `frame_event`，字幕就绪后吐 `subtitle`，最后合并出章节/摘要。
- [x] **M4 打磨**：
  - 会话费用计（顶栏 `¥x.xxx · n 次`）：`bff/src/cost.ts` 用 AsyncLocalStorage 累计 ark token 费 + 录音时长费，
    随结果返回 `cost_estimate_cny` / `cost_calls`，视频经 WS `cost` 消息
  - 历史记录（`web/src/history.ts`，localStorage 最近 40 条，去掉视频缩略帧）：顶栏「历史」抽屉，点条目回看不重复计费
  - 结果人工修正：图片字段值 / 音频摘要就地编辑，标 `human_edited`，同步回历史
- [x] **收尾**：
  - 字幕跟随播放：`VideoResultView` 按 `<video>` currentTime 逐句放出字幕/事件（「跟随播放」可关），近实时体验
  - 图片字段框选定位：prompt 让视觉模型返回像素 bbox，悬停字段在原图叠加高亮框（VLM 框选精度一般）
  - 数仓回传：`POST /api/export/warehouse` → `exports/*.jsonl`（占位真实数仓）
  - 埋点：`web/src/telemetry.ts` 批量攒事件 → `POST /api/telemetry` → `telemetry/*.jsonl`（task_start/success/fail、export、field_edit、frame_interval_change…）
  - a11y：菜单方向键切换、aria 标签
### 图片字段框选定位 — 已尝试，暂缓
`doubao-seed-2-1-turbo/pro` 的 bbox 输出不自洽（自报坐标系尺寸与实际坐标不一致），画不准框。
可靠 grounding 需 `doubao-seed-1-6-vision`（内置 grounding/crop 工具），但该模型在本账号方舟未上架。
已回退：图片仍用 `turbo`，prompt 不再要 bbox，保留字段就地编辑。待模型可用再做。

- [ ] 真正剩下的：视频 WebSocket 二进制流式 ASR（逐字回显，非逐句）；数仓真实对接

### 已知事项
- 火山方舟 `doubao-seed-2-1-pro` 带思考约 60s，故图片/帧/摘要用 `turbo` + `thinking.disabled`（图片~14s；视频每帧 3-5s）。
- 改 `.env` 后需重启 `npm run dev`（tsx watch 只监听 `src/`）。
- 录音识别偶发 `55xxxxxx` 网关瞬时错误，轮询逻辑已做容错重试。
- 视频当前为"近实时"：字幕在音轨识别完成后一次性出现（非逐句跟播放）。
