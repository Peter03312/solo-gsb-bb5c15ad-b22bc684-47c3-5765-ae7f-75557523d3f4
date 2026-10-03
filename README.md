# 联排提示板（Rehearsal CueBoard）

为剧场联排制作的 Web 提示板：舞监（Stage Manager）在草稿中录入提示项的计划开始时间、时长、负责岗位与前置关系，校验通过后发布**只读联排版本**；灯光 / 音响 / 道具等执行岗位在现场页面只登记**本岗位**提示项的实际开始、完成或预计结束时间，系统依据前置项的实际/预计结束自动重算未开始项，并展示顺延导致的岗位冲突。

- 后端：Node.js + Express + better-sqlite3（SQLite，同步事务）
- 前端：浏览器原生 HTML/CSS/JavaScript（无需构建）
- 本地账号体系：服务端 Session 登录，区分**舞监**与**执行岗位**
- 打包：Dockerfile + Docker Compose 一键启动（自动安装依赖、初始化数据）

## 一、快速启动（推荐，Docker 一键）

要求已安装 Docker 与 Docker Compose 插件。

```bash
docker compose up --build -d
```

启动过程会自动完成：

1. 构建镜像并安装 npm 依赖（含 better-sqlite3）；
2. 初始化 SQLite 数据库：建表、创建默认账号、写入一份可直接发布的示例草稿；
3. 在容器内启动 Web 服务。

浏览器访问：

> **http://localhost:3000**

如宿主机 3000 端口被占用，可指定其他端口：

```bash
PORT=8080 docker compose up --build -d
# 访问 http://localhost:8080
```

停止与查看日志：

```bash
docker compose logs -f
docker compose down            # 停止并移除容器（保留数据卷）
docker compose down -v         # 同时删除数据库数据卷（恢复出厂）
```

数据库文件持久化在 Docker 卷 `cueboard-data`（容器内 `/app/data/cueboard.db`）。

## 二、本地直接运行（无需 Docker）

要求 Node.js ≥ 18（推荐 20）。

```bash
npm install
npm run initdb     # 首次运行：建表 + 播种（重复执行安全、幂等）
npm start
```

浏览器访问 **http://localhost:3000**。

## 三、默认账号

首次启动自动创建（请在生产环境及时更改代码/重新播种密码）：

| 角色 | 用户名 | 密码 | 说明 |
| --- | --- | --- | --- |
| 舞监 | `sm` | `sm12345` | 草稿增删改、发布版本、查看全部 |
| 灯光执行 | `light` | `light123` | 仅可登记「灯光」岗位提示项 |
| 音响执行 | `sound` | `sound123` | 仅可登记「音响」岗位提示项 |
| 道具执行 | `props` | `props123` | 仅可登记「道具」岗位提示项 |

## 四、使用说明

### 舞监

1. **草稿编辑**页新增提示项：编号、岗位、计划开始（HH:MM）、时长（分钟）、说明；
2. 在「前置关系」区为提示项指定「某提示项完成后 → 本提示项」，可构成多前置链；
3. 页面实时显示校验结果。满足以下全部条件时才可发布：
   - 每个前置项的**计划结束 ≤ 后项计划开始**；
   - **同一岗位**的计划时段不重叠（首尾相接允许）；
   - 前置依赖**无环**；
   - 失败时明确列出每一项冲突（冲突双方、岗位、时间、环路径）；
4. 点击「发布联排版本」生成只读版本，现场随即以该版本为准；草稿可继续修改并发布新版本。

#### 发布新版前：旧执行版已完成登记交接（本轮新增）

发布面板的「旧执行版登记交接」区会在**发布前自动预览**（也可点击「重新预览」），对照**当前草稿与旧执行版（最新已发布版本）**逐条列出旧版中**已完成**提示项（旧登记同时有实际开始与实际完成）的交接资格：

- **可选条件（同时满足）**：草稿与旧版**同一提示项引用**（即草稿提示项 id）的**编号、说明、岗位、计划开始、时长、前置集合**六项完全一致，且旧登记**同时有实际开始和实际完成**；
- 不满足的项列入「不可选」，逐项注明不合格原因（如「计划开始不一致（旧版 19:12 → 草稿 19:13）」），复选框禁用；
- **无旧版（首次发布）或旧版无已完成项时，列表为空**，不影响正常发布。

舞监勾选要延续的项后点「发布联排版本」：

- 确认发布时服务器在**同一事务内重新核对**：①草稿版本号、②旧执行版（必须仍是当前执行版）、③每个所选登记行的**行版本号**、④资格是否仍成立；任一变化或资格失效则**整体拒绝**（HTTP 409 `HANDOVER_STALE`，响应逐项列出原因），不会产生新版本，请**重新预览**后再发布；
- 成功后**仅将所选项的实际开始、实际完成带入新版**（不延续预计结束、不复制更正历史），**未选项保持空登记**；新版对应行标注「↩ 交接自第 N 版·编号」标明来源版本与提示项；
- **旧版登记与更正历史原样保留、继续可回看**（「发布版本」页回看，含来源标注与更正记录）；已发布计划仍然冻结，交接只影响新版的现场登记初值；
- 未传 `handover` 字段的发布请求**完全维持原行为**（新版全部空登记）；计划冲突仍然阻止发布（422）。

#### 舞监现场更正（仅当前执行版本）

舞监在「现场联排」页可对任一行登记进行**更正**（点击该行「更正」按钮）：

- 一次只能更正或清除**实际开始 / 实际完成 / 预计结束**中的**任意一项**，并必须填写更正原因（≤200 字）；
- 更正**只改变现场登记**，不修改已发布计划（计划开始/时长/前置关系保持冻结）；
- 提交必须携带所见登记行的**行版本号**，且与岗位登记**共用同一版本校验**：岗位或舞监任一方先提交后，另一方持旧版本提交会收到 **409** 并提示刷新，不能覆盖新登记；
- **归档版本（已有更新版本发布）禁止更正**，现场页对应行显示「归档不可更正」；
- 联动约束（不满足则整体拒绝，不写入任何部分更正与历史）：
  - 更正后的实际完成必须有实际开始，且不得早于实际开始；
  - 清除实际开始时系统**同时清除实际完成**（级联清除，历史中标注「级联清除」）；
  - 保留的预计结束不得早于实际开始；若无实际开始则不得早于原计划开始；
  - 无变化的提交（前后值相同）视为无效。
- 更正成功后按现有规则**重算后续未开始项与同岗位冲突**（顺延不早于原计划，冲突在红条展示）；
- 每次更正都记录**更正项、更正前/更正后值、操作者、时间、原因**；点击行内「更正记录(N)」可回看，历史版本回看页中也可查看（只读）。

### 执行岗位

- 「现场联排」页只能看到当前执行版本，本岗位的行高亮并出现操作按钮：
  - **开始**：登记实际开始（默认取当前时间，可手填 HH:MM）；
  - **完成**：登记实际完成（须先开始，完成时刻不得早于开始）；
  - **预计结束**：未开始或已开始均可登记，不得早于（实际或原计划）开始；
- 非本岗位提示项只读；对非最新（已归档）版本不能登记；
- **被安排代班时**：代班账号可登记代班岗位提示项（同时保留原岗位权限），相关行高亮；本岗位被他人代班期间，原岗位账号对应行只读并显示「本岗代班中」；代班撤销后需刷新页面恢复；
- 已完成项保留实际时间不再变化；未开始项按前置链重算，**重算开始不早于原计划**；
- 顺延产生的同岗位时段冲突在页面顶部红色横幅逐条展示，同时相关行标注「已顺延」；
- 岗位登记可能被舞监按规定更正（见上节），更正与岗位登记共用行版本号，持旧版本提交会被 409 拒绝。

### 现场临时换人：岗位代班（本轮新增）

现场临时换人时，舞监在「现场联排」页顶部的**现场临时代班**面板（或 HTTP API）可对**当前执行版**选择岗位与已有执行账号，**启用 / 撤销代班**：

- 每个版本每个岗位**至多一名在任代班**；代班期间**原岗位账号失去该岗位登记权**，代班账号**获得该岗位登记权且保留自己原有岗位权限**（同一账号可同时代班多个岗位）；
- 仅**当前执行版**可变更：归档版本的代班记录在「发布版本」回看页**只读可查**；
- **发布新版后代班不自动延续**，新版默认无代班，需在新版重新安排；
- 每次启用 / 撤销都记录**操作者与时间**，面板与回看页均可查看完整变更记录；
- 现场页面按**最新授权**显示可操作项：被代班岗位标注「🎫 某某代班」，原岗位账号该行变为「本岗代班中」，代班账号可直接登记；页面顶部横幅提示本人本岗被代班 / 正在代班哪些岗位；
- 登记提交时服务器在**同一事务内复核当前版、代班权限与登记行版本**：代班被撤销后持旧页面提交会被 **403 拒绝且不改登记**；原有登记响应、行版本冲突（409）与时间校验完全保持兼容；
- 明确报错不留部分记录：未知账号 / 非执行账号（404 `UNKNOWN_OPERATOR`）、当前版没有的岗位（404 `POSITION_NOT_IN_VERSION`）、重复启用（409 `SUBSTITUTION_ACTIVE`）、无在任代班却撤销（409 `NO_ACTIVE_SUBSTITUTION`）、重复撤销（409 `SUBSTITUTION_REVOKED`）、对归档版本变更（409 `SUBSTITUTION_NOT_CURRENT`）。

### 已发布版本回看

「发布版本」页列出全部历史版本（版本号、说明、发布时间、登记数量），点击「回看」查看该版本冻结的提示项、前置关系与当时/最新的现场重算结果；舞监还可在回看页查看每行的**更正记录**（更正前后值、操作者、时间、原因），归档版本为只读、不能更正。

### 版本号（乐观锁）规则

- 草稿维护全局**草稿版本号**，页面显示 `vN`。任何编辑、增删依赖、发布都必须携带页面加载时的版本号；他人已修改导致版本号过期时返回 **409** 并明确提示当前版本号，前端自动刷新，需要重新编辑后提交；
- 单条提示项的修改同时校验**行版本号**；
- 现场登记按「提示项行版本号」校验：两位岗位同时操作同一提示项时，先提交者成功，后提交者收到 409 明确报错并刷新；
- **舞监更正与岗位登记共用同一条登记行版本号**：任一方更新后行版本 +1，另一方（或持旧页面重复提交）会收到 409 拒绝并被要求刷新，确保更正不能覆盖新登记、新登记也不能覆盖更正。

## 五、配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | Web 服务监听端口（容器内） |
| `DATA_DIR` | `/app/data`（镜像）/ `./data`（本地） | SQLite 数据库所在目录 |
| `DB_PATH` | `$DATA_DIR/cueboard.db` | 数据库文件完整路径 |
| `SESSION_SECRET` | 开发用默认值 | Session  Cookie 签名密钥，**生产必须修改** |
| `TZ` | `Asia/Shanghai` | 容器时区，影响「取当前时间」登记 |

通过 Compose 修改可在项目根目录创建 `.env`，例如：

```env
PORT=8080
SESSION_SECRET=your-long-random-secret
```

## 六、目录结构

```
.
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh          # 容器入口：先 initdb 再启动服务
├── package.json
├── src
│   ├── server.js          # Express 路由、权限与版本号校验、发布事务
│   ├── db.js              # SQLite 连接与建表
│   ├── initdb.js          # 幂等初始化：账号 + 示例草稿
│   ├── auth.js            # scrypt 密码哈希
│   └── scheduling.js      # 校验/拓扑环检测/现场重算核心算法
└── public
    ├── index.html
    ├── styles.css
    └── app.js             # 登录、草稿、现场、版本回看三个页面
```

## 七、主要 HTTP API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/login` `/api/logout` | 公开 | 登录 / 退出 |
| GET | `/api/me` | 公开 | 当前会话与岗位列表 |
| GET | `/api/draft` | 舞监 | 草稿（含实时校验结果） |
| POST/PUT/DELETE | `/api/draft/cues[/:id]` | 舞监 | 提示项增改删（校验草稿版本号/行版本号） |
| POST/DELETE | `/api/draft/deps[/:id]` | 舞监 | 前置关系增删（校验草稿版本号） |
| GET | `/api/publish/handover/preview` | 舞监 | **发布前交接预览**：旧执行版已完成项的交接资格、不合格原因、旧登记行版本；无旧版时列表为空 |
| POST | `/api/publish` | 舞监 | 发布只读版本；冲突返回 422 并列出冲突项；可带 `handover` 交接选择，资格/版本失效返回 409 `HANDOVER_STALE` |
| GET | `/api/live` | 已登录 | 当前最新版本的现场重算结果（含每行更正历史 `corrections` 与代班数据 `substitutions`） |
| GET | `/api/substitutions` | 已登录 | 当前执行版（或 `?versionId=` 指定版）代班状态：版本岗位、在任代班、变更日志；舞监额外返回执行账号清单 |
| POST | `/api/substitutions` | 舞监 | 在当前执行版启用岗位代班 `{position, username}`；重复启用/未知账号/非执行账号/岗位不在本版均报错 |
| POST | `/api/substitutions/revoke` | 舞监 | 撤销在任代班 `{id}` 或 `{position}`；重复撤销、无在任代班、归档版代班均报错 |
| GET | `/api/versions/:id/substitutions` | 已登录 | 指定版本代班记录（只读，含每次启用/撤销的操作者与时间） |
| POST | `/api/registrations` | 执行岗位 | start / complete / estimate（同一事务内复核版本最新、代班权限、行版本号与时间校验） |
| POST | `/api/registrations/corrections` | 舞监 | 更正/清除单个登记字段（校验行版本号、仅当前执行版本；级联清除与一致性校验；原子写入更正历史） |
| GET | `/api/versions` `/api/versions/:id` | 已登录 | 版本列表与历史回看（回看含每行更正历史） |

## 八、登记交接 API 调用示例

以本地默认端口 3000、舞监账号为例（`curl -c/-b` 复用会话 Cookie）：

### 1. 登录并预览交接资格

```bash
# 登录（保存会话 Cookie）
curl -c sm.cookie -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sm","password":"sm12345"}'

# 发布前预览：返回草稿版本、旧执行版、可选 / 不可选清单
curl -b sm.cookie -s http://localhost:3000/api/publish/handover/preview
```

响应示例（旧版中 L1、S1 已完成且与草稿完全一致；S2 已完成但草稿计划开始被改过）：

```json
{
  "draftVersion": 1,
  "oldVersion": { "id": 1, "versionNo": 1, "note": "首版", "createdAt": "2026-10-03 19:40:00" },
  "eligible": [
    { "cueRef": 1, "code": "L1", "title": "开场灯光就位", "position": "灯光",
      "actualStartText": "19:00", "actualEndText": "19:06", "rowVersion": 3, "selected": true },
    { "cueRef": 2, "code": "S1", "title": "开场音乐", "position": "音响",
      "actualStartText": "19:05", "actualEndText": "19:08", "rowVersion": 3, "selected": true }
  ],
  "ineligible": [
    { "cueRef": 5, "code": "S2", "title": "风声效果", "position": "音响",
      "actualStartText": "19:12", "actualEndText": "19:17", "rowVersion": 3,
      "reasons": ["计划开始不一致（旧版 19:12 → 草稿 19:13）"],
      "diffs": [{ "field": "plannedStart", "label": "计划开始", "oldText": "19:12", "newText": "19:13",
                  "reason": "计划开始不一致：旧版为 19:12，草稿为 19:13" }] }
  ]
}
```

- 首次发布（无旧版）时 `oldVersion` 为 `null`，`eligible` / `ineligible` 均为 `[]`；
- 仅「旧登记同时有实际开始和实际完成」的项会出现（只开始未完成的项不在列表中）。

### 2. 携带交接选择发布

```bash
curl -b sm.cookie -s -X POST http://localhost:3000/api/publish \
  -H 'Content-Type: application/json' -d '{
    "version": 1,
    "note": "第二场联排",
    "handover": {
      "oldVersionId": 1,
      "draftVersion": 1,
      "items": [
        { "cueRef": 1, "rowVersion": 3 },
        { "cueRef": 2, "rowVersion": 3 }
      ]
    }
  }'
```

- `version`：沿用现有发布请求的**草稿版本号**校验（不一致返回 409 `VERSION_CONFLICT`）；
- `handover.oldVersionId` / `draftVersion` / `items[].rowVersion` 均取自上一步预览；
- `items` 只放要延续的项；为空数组 `[]` 表示一项都不延续（仍会核对预览基于的草稿版本与旧版）；
- **不传 `handover` 字段时完全维持原有发布行为**（新版全部空登记）。

成功响应沿用原发布返回（新版本完整负载），并追加 `handover` 汇总；每个被延续的提示项负载中带有 `handover` 来源标注：

```json
{
  "id": 2, "versionNo": 2, "note": "第二场联排",
  "cues": [
    { "code": "L1", "status": "DONE", "actualStartText": "19:00", "actualEndText": "19:06",
      "estimatedEndText": null,
      "handover": { "sourceVersionId": 1, "sourceVersionNo": 1, "sourceCueRef": 1, "sourceCode": "L1" } }
  ],
  "handover": { "carriedCount": 2, "sourceVersionId": 1, "sourceVersionNo": 1 }
}
```

### 3. 资格 / 版本失效被整体拒绝

预览之后若草稿又被编辑、旧版被新版替代、或岗位/舞监对所选登记行又有提交（行版本推进），发布整体拒绝（不产生任何新版本、不写部分登记）：

```json
HTTP 409
{
  "error": "HANDOVER_STALE",
  "message": "交接资格核对未通过（1 项），本次发布已整体拒绝，请重新预览后再选择发布",
  "items": [
    { "cueRef": 1, "code": "L1",
      "reason": "「L1」旧登记行版本已变化（预览时 v3，当前 v4，可能被岗位登记或舞监更正更新），请重新预览后再发布",
      "currentRowVersion": 4 }
  ]
}
```

其余既有行为不变：计划冲突仍返回 **422 `PUBLISH_CONFLICT`** 并列出冲突项；草稿版本号过期返回 **409 `VERSION_CONFLICT`**。页面上的勾选与上述 API 完全等价：草稿编辑页发布面板内完成「预览 → 勾选 → 发布」，现场页与版本回看页均可看到延续项的来源标注，旧版登记与更正历史保持可回看。


## 九、现场代班 API 调用示例

以本地默认端口 3000 为例（`curl -c/-b` 复用会话 Cookie）。代班只能在**当前执行版**上安排，因此需先发布至少一个版本。

### 1. 舞监查看代班面板

```bash
# 舞监登录
curl -c sm.cookie -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sm","password":"sm12345"}'

# 当前执行版的岗位、执行账号清单、在任代班与变更日志
curl -b sm.cookie -s http://localhost:3000/api/substitutions
```

响应示例（刚发布、尚无代班）：

```json
{
  "version": { "id": 2, "versionNo": 2, "note": "二版", "createdAt": "2026-10-03 20:10:00" },
  "positions": ["灯光", "音响", "道具"],
  "operators": [
    { "id": 2, "username": "light", "displayName": "灯光执行", "position": "灯光" },
    { "id": 3, "username": "sound", "displayName": "音响执行", "position": "音响" },
    { "id": 4, "username": "props", "displayName": "道具执行", "position": "道具" }
  ],
  "active": [],
  "log": []
}
```

执行账号调用同一接口时不会返回 `operators` 字段；`/api/live` 负载的每个版本也内嵌 `substitutions`，现场页面据此显示最新授权。

### 2. 启用代班

```bash
# 由音响执行账号 sound 临时代班「灯光」岗位
curl -b sm.cookie -s -X POST http://localhost:3000/api/substitutions \
  -H 'Content-Type: application/json' \
  -d '{"position":"灯光","username":"sound"}'
```

成功返回 **201** 与完整代班面板负载（节选）：

```json
{
  "positions": ["灯光", "音响", "道具"],
  "active": [
    { "id": 3, "position": "灯光",
      "deputy": { "username": "sound", "displayName": "音响执行", "position": "音响" },
      "enabledBy": "舞监", "enabledAt": "2026-10-03 20:15:09",
      "revokedBy": null, "revokedAt": null, "active": true }
  ],
  "log": [
    { "change": "enable", "id": 3, "position": "灯光",
      "deputy": { "username": "sound", "displayName": "音响执行", "position": "音响" },
      "by": "舞监", "at": "2026-10-03 20:15:09" }
  ]
}
```

此后 `sound` 可登记「灯光」提示项（原有「音响」权限保留），`light` 登记「灯光」提示项会收到：

```json
HTTP 403
{ "error": "FORBIDDEN",
  "message": "「L1」属于岗位「灯光」，该岗位当前由「音响执行（sound）」代班，原岗位账号暂不能登记，请刷新页面" }
```

登记请求体与原有接口完全一致（`versionId / cueRef / rowVersion / action / time`），只是岗位授权改由当前代班状态决定。

### 3. 撤销代班

```bash
# 方式一：按岗位撤销当前执行版在任代班
curl -b sm.cookie -s -X POST http://localhost:3000/api/substitutions/revoke \
  -H 'Content-Type: application/json' -d '{"position":"灯光"}'

# 方式二：按启用记录 id 撤销（id 取自 active / log）
curl -b sm.cookie -s -X POST http://localhost:3000/api/substitutions/revoke \
  -H 'Content-Type: application/json' -d '{"id":3}'
```

撤销后原岗位账号立即恢复登记权；代班账号若仍持撤销前打开的旧页面提交，服务器在同一事务内复核代班权限后返回 **403**，**不修改登记**：

```json
HTTP 403
{ "error": "FORBIDDEN",
  "message": "「L1」属于岗位「灯光」，当前账号只能登记本岗位提示项" }
```

### 4. 错误码与旧版只读

| 场景 | 状态码 | `error` |
| --- | --- | --- |
| 账号不存在或不是执行账号（含舞监账号） | 404 | `UNKNOWN_OPERATOR`（响应附可用执行账号） |
| 岗位不在当前执行版 | 404 | `POSITION_NOT_IN_VERSION`（响应附本版岗位） |
| 指定代班人就是该岗原账号 | 400 | `BAD_INPUT` |
| 该岗位已有在任代班（重复启用） | 409 | `SUBSTITUTION_ACTIVE` |
| 撤销时该岗位无在任代班 | 409 | `NO_ACTIVE_SUBSTITUTION` |
| 撤销一条已撤销记录 | 409 | `SUBSTITUTION_REVOKED` |
| 对归档版本的代班记录做变更 | 409 | `SUBSTITUTION_NOT_CURRENT` |
| 尚未发布任何版本就安排代班 | 409 | `NO_PUBLISHED_VERSION` |

所有启用/撤销都在单事务内完成，失败不留下部分记录。

```bash
# 查看旧版（只读）代班记录：含每次启用/撤销的操作者与时间
curl -b sm.cookie -s http://localhost:3000/api/versions/1/substitutions
```

发布新版本后代班不延续（新版 `active` / `log` 均为空）；若旧版尚有未撤销的在任代班，它会原样保留在旧版记录中可查，但不能再变更。
