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

**数据服务（对外接口）**：在"数据服务"页为清洗完成的任务配置接口标识、输出字段和分页大小，保存后立即生效——`GET /api/data-services/:slug?page=` 由 `bff` 直接提供真实数据，无需鉴权即可被外部系统调用，跨域已放行；清洗结果更新后需重新确认配置，接口地址不变。

## 快速开始

需要 Docker。

```bash
git clone https://github.com/AntonyCheng/data-cleansing.git
cd data-cleansing
cp .env.example .env   # 按提示填写：火山引擎密钥（图片/音频/视频清洗）、JWT_SECRET（必填，见下）、演示账号
docker compose up -d --build
```

打开 <http://localhost:8080>，用 `.env` 里配置的演示账号登录。**公开注册已关闭**——账号由管理员在侧边栏「设置 → 用户管理」里开通（该入口仅管理员可见，演示账号即是管理员）。`samples/` 目录下提供了图片 / 音频 / 视频三个示例文件；表格清洗登录后自带 6 个黑龙江省真实数据任务（「黑龙江省地市经济与人口指标」已预清洗、入库并配置好对外服务，其余 5 个保持待清洗供现场演示，见下），数据库连接器可以直接连 `demo-db`（内置的演示数据源，见下）体验真实连接抓取。

**`JWT_SECRET` 是必填项**，`.env.example` 里刻意留空、没有默认值：bff 启动时会校验，缺失就直接拒绝启动并在日志里打印生成命令（登录态签名密钥泄露等于任何人都能伪造任意用户的登录态，所以不给兜底值）。另外**更换它会让所有已签发的 token 立即失效、全部用户需要重新登录一次**。

**对外只暴露 8080 一个端口**：web 的 nginx 既托管前端，也把 `/api/`（含 WebSocket）反代给 `bff:8787`，所以浏览器只需要这一个入口。`db` / `demo-db` / `demo-api` / `bff` 一律不映射宿主机端口，只在 compose 网内被 `bff` 按服务名访问——演示机部署到公网时不用担心数据库和内部服务跟着暴露。（本地调试要直连这些容器时，见「本地开发」。）

未填写火山引擎密钥时，图片/音频/视频入口会提示服务不可用，但表格数据清洗和数据库/API 连接器不受影响。

## 演示数据源 demo-db / demo-api

`docker-compose.yaml` 里有两个独立的演示数据源容器，数据全部来自权威公开发布（不是编造的样例，来源见文件顶部注释）：

**demo-db**（PostgreSQL）：启动时自动灌入黑龙江省 5 张表——

| 表 | 内容 |
|---|---|
| `heilongjiang_cities` | 13 地市经济指标（2024，统计年鉴2025）+ 人口指标（2020 七普） |
| `hlj_gdp_2025` | 13 地市 2025 年 GDP 与增速（各地市 2025 年统计公报） |
| `hlj_grain_2024` | 13 地市 2024 年粮食产量与播种面积（各地市公报 + 新华社） |
| `hlj_tourism` | 哈尔滨近三个冰雪季游客量与花费（哈尔滨市文广旅局） |
| `hlj_scenic_spots` | 全省 438 家 A 级旅游景区（省文旅厅《2023年全省A级旅游景区名录》） |

在"创建数据任务 → 数据库"里新建连接：整套 `docker compose up` 启动时 host 填 `demo-db`、端口 `5432`；本机 `npm run dev` 裸跑 bff 调试时（需带 `docker-compose.dev.yaml`）host 填 `localhost`、端口 `5434`。数据库名 `heilongjiang`，用户名 `demo`，密码见 `.env` 的 `DEMO_DB_PASSWORD`。

**demo-api**（零依赖 Node 服务）：演示"API 连接器"的 API Key 鉴权与翻页抓取——

- `GET /api/trade`：黑龙江省货物贸易年度序列（2021-2024，哈尔滨海关）
- `GET /api/oilfield`：大庆油田年度生产序列（2022-2024，新华网/国资委）
- `GET /page/bulletin.html`：免鉴权的"公报摘要"演示网页，供"URL / 网页"来源演示服务端真实抓取 + 表格解析
- 连接器配置：鉴权方式 API Key，请求头名 `X-Api-Key`，值见 `.env` 的 `DEMO_API_KEY`（默认 `hlj-demo-2026`）；容器内 bff 填 `http://demo-api:8090`，本机裸跑 bff 调试时（需带 `docker-compose.dev.yaml`）填 `http://localhost:8090`

数据修改方式：改 `web/src/data/heilongjiang.ts` / `hlj2025.ts` / `hljScenic.ts`（唯一数据真源），然后 `npx tsx demo-data/generate.mts` 重新生成 SQL 与 API 数据。

## 本地开发（不使用 Docker）

```bash
npm install              # 安装根工作区（bff）
npm run install:web      # 安装前端 web 的独立依赖
cp .env.example .env
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d db demo-db demo-api
npm run migrate --workspace bff          # 建表
npm run dev               # 前端 http://localhost:5173，后端 :8787
```

前端 `web/` 未纳入根 npm workspaces（保留自己独立的依赖与锁文件，可单独 `cd web && npm install && npm run dev` 启动）；`bff/` 是根工作区成员。

**为什么要带 `-f docker-compose.dev.yaml`**：基础文件为了安全不映射任何宿主机端口（对外只有 web 的 8080），而裸跑在宿主机的 `bff` 进程在 compose 网外，够不到 `db` / `demo-db` / `demo-api`，必须经宿主机端口访问——这个覆盖层就是补回 `db:5432`、`demo-db:5434`、`demo-api:8090`（以及绕过 nginx 直连容器 bff 的 `8787`），并且都绑在 `127.0.0.1`，不会对局域网/公网暴露。跑整套容器时 bff 走服务名直连，不需要这个文件。

## 工程结构

```text
web/                    前端：数据任务 / 清洗规则 / 数据服务 + 图片/音频/视频清洗工作台
bff/                    后端：登录鉴权、工作区持久化、数据库/API 连接器、图片/音频/视频结构化
demo-data/              demo-db 的初始化数据（黑龙江省真实数据，由 demo-data/generate.mts 生成，见上）
demo-api/               demo-api 演示服务（对俄贸易/大庆油田序列 + 公报演示页，见上）
docker-compose.dev.yaml 本地开发的端口覆盖层（部署时不用，见「本地开发」）
samples/                体验用示例素材
```
