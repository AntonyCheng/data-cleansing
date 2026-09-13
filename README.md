# AI 数据采集与智能清洗平台

数据怎么快速接进来、脏数据怎么快速变成可用数据。前端 `web/`（KData Studio）+ 后端 `bff/` 覆盖三类工作：

**表格数据清洗**：登录后，上传 CSV / XLSX，或连接真实 MySQL / PostgreSQL 数据库、REST API（连接凭证加密存储，仅执行只读 SELECT / GET），自动画像、发现质量问题、推荐清洗规则、自然语言改规则、执行、确认入库、发布为数据服务。工作区持久化在服务端，登录后跨设备同步。

**图片 / 音频 / 视频结构化**（基于火山引擎 API）：
- **图片**：识别版式（发票、证件等票据/证照），结构化抽取字段并附带置信度，支持手动修正，输出全文 OCR、摘要与标签。
- **音频**：转写全文，自动分说话人、带时间戳，生成摘要、要点、待办事项。
- **视频**：边播放边分析，字幕与画面事件实时同步显示，播放结束生成章节与整片摘要。
- 结果均可下载为 JSON（音频/视频另支持 SRT 字幕）。
- 任务提交后在服务端持续处理，与浏览器连接生命周期解耦：切换页面或关闭浏览器不会中断，重新打开可继续查看进度或结果；每个用户的每种类型（图片/音频/视频）最多同时处理一个任务，不同用户、不同类型互不影响。

**数据库 / API 连接器**：在"创建数据任务"里新建或复用连接，测试连接、选表（或填请求路径+翻页参数）、预览、确认导入——导入后的数据和本地上传的文件一样，走同一套清洗流程。

## 快速开始

需要 Docker。

```bash
git clone https://github.com/AntonyCheng/data-cleansing.git
cd data-cleansing
cp .env.example .env   # 按提示填写图片/音频/视频清洗所需的火山引擎密钥；数据库/JWT/连接器密钥已有可用的默认值
docker compose up -d --build
```

打开 <http://localhost:8080>，注册账号即可使用。`samples/` 目录下提供了图片 / 音频 / 视频三个示例文件；表格清洗登录后自带内置样例数据（含黑龙江省 13 个地市真实经济与人口数据，见下），数据库连接器可以直接连 `demo-db`（内置的演示数据源，见下）体验真实连接抓取。

未填写火山引擎密钥时，图片/音频/视频入口会提示服务不可用，但表格数据清洗和数据库/API 连接器不受影响。

## 演示数据源 demo-db

`docker-compose.yaml` 里的 `demo-db` 是一个独立于应用自身数据库的 PostgreSQL 容器，启动时自动灌入黑龙江省 13 个地市的真实经济与人口数据（来源见 `demo-data/heilongjiang-init.sql` 顶部注释：《黑龙江统计年鉴－2025》+《2020年黑龙江省第七次全国人口普查主要数据公报》），专门用来演示"数据库"连接器——不是编造的样例，是真实可核实的公开数据。

在"创建数据任务 → 数据库"里新建连接：
- 整套用 `docker compose up` 启动时：host 填 `demo-db`，端口 `5432`
- 本机直接 `npm run dev` 调试 bff（不进容器）时：host 填 `localhost`，端口 `5434`

数据库名 `heilongjiang`，用户名 `demo`，密码见 `.env` 里的 `DEMO_DB_PASSWORD`（默认 `demo12345`）。

## 本地开发（不使用 Docker）

```bash
npm install              # 安装根工作区（bff）
npm run install:web      # 安装前端 web 的独立依赖
cp .env.example .env
npm run dev               # 前端 http://localhost:5173，后端 :8787
```

前端 `web/` 未纳入根 npm workspaces（保留自己独立的依赖与锁文件，可单独 `cd web && npm install && npm run dev` 启动）；`bff/` 是根工作区成员。本地开发需要一个 PostgreSQL（`docker compose up -d db` 起应用自己的库，`npm run migrate --workspace bff` 建表）。

## 工程结构

```text
web/          前端：数据任务 / 清洗规则 / 数据服务 + 图片/音频/视频清洗工作台
bff/          后端：登录鉴权、工作区持久化、数据库/API 连接器、图片/音频/视频结构化
demo-data/    demo-db 的初始化数据（黑龙江省真实经济与人口数据，见上）
samples/      体验用示例素材
```
