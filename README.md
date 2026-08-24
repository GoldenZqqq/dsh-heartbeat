# DSH Heartbeat Monitor (心率监视器)

一个符合 DSH 官方插件开发标准的客户端插件：在 DSH Web 侧边栏 **logo 正下方** 固定一只"心脏"，
实时反映模型的工作状态 —— **token 输出越快，心跳越快；越慢，心跳越慢**。

| 状态 | 心率 | 含义 |
| --- | --- | --- |
| 🥶 冬眠 (idle) | 20-30 BPM | 没有任何会话在运行，像睡着了一样缓慢呼吸 |
| 🤔 思考 (thinking) | 38-50 BPM | 有会话在跑，但还没吐出第一个 token |
| 💚 输出 (streaming) | 50-160 BPM | token 正常流出，心率随 tok/s 平滑上升 |
| 🔥 狂暴 (burst) | 180-200 BPM | 超高速输出自动激发"狂暴模式"，红光 + 粒子特效 |
| ⚫ 离线 (disconnected) | — | 与主机的连接断开 |

## 功能

- **拟真心电图**：Canvas 实时绘制的 P-QRS-T 波形 + 扫描线，随心率自动变速；
- **会跳的心脏**：心形图标跟随心室收缩（lub-dub）双搏动；
- **冬眠呼吸**：空闲时心率在 20-30 之间缓慢漂移，偶尔一次早搏（PVC），尽可能接近真实心脏；
- **狂暴模式**：超高速输出自动进入 180-200 BPM 红区，ECG 变红、发光、粒子飞溅；
- **实时数值**：BPM、平滑/瞬时 tok/s、累计 token、当前模型（来自 request/header 事件）；
- **固定在 logo 下方**：挂在侧边栏品牌行正下方（sidebar.header.dock 停靠位），不遮挡对话区，也不需要挪动；侧边栏收窄时自动变成迷你脉搏点；
- **自动重连**：mux 事件流断开后自动重连并显示离线状态。

## 工作原理

- 插件在浏览器端打开第二条 mux 事件流（ctx.connection.api.events.mux），只读监听 assistant/chunk 增量事件，统计 3 秒滑动窗口内的 token 速率；
- 速率经 EMA 平滑后映射为心率（50 + 110·(1 − e^(−rate/24))），持续超过 40 tok/s 自动进入狂暴模式（180-200 BPM）；
- 模型名从 request/header 事件捕获；
- 动画全部由 rAF 驱动，不依赖 React 重渲染，性能开销极小。

## 安装

### 方式一：作为仓库内插件（源码开发 / 本仓库）

```bash
# 1. 把本包放入 packages/client/heartbeat
# 2. 在 packages/bundle/web-app/package.json 的 dependencies 中加入：
#    "dsh-heartbeat": "workspace:^"
# 3. 在 packages/bundle/web-app/cordis.patch.yml 的浏览器插件名单中加入：
#    - id: ui-heartbeat
#      name: 'dsh-heartbeat'
# 4. 安装并构建：
pnpm install
pnpm build:lib:client
# 5. 重启 DSH Web：dsh --profile web
```

### 方式二：GitHub 分发（推荐，无需 npm 账号）

把 `dsh-heartbeat-0.1.0.tgz`（`pnpm pack` 产物，14.8 kB）上传为 **GitHub Release 附件**，对方一条命令安装（已验证）：

```bash
# 对方在他的 DSH 上安装：
dsh plugin --profile web add https://github.com/<你的用户名>/<仓库>/releases/download/v0.1.0/dsh-heartbeat-0.1.0.tgz
# 然后重启 dsh，刷新页面
```

也可以用**独立源码仓库**方式（包文件在仓库根目录，本仓库已提供可推送的骨架）：
```bash
# 对方安装：
dsh plugin --profile web add github:<你的用户名>/dsh-heartbeat
```

> 说明：客户端插件名单（dsh.client 声明）在启动时扫描一次，**新增插件需要重启 DSH Web 才能生效**。

**两种形态自动适配**（对方无需任何配置）：
- 若对方的 ui-sidebar 已声明 `sidebar.header.dock` 停靠槽（本仓库版本）→ 心脏固定在 logo 正下方；
- 若对方是原生发布版 DSH（还没有该槽位）→ 插件自动检测并回退为右下角悬浮卡片。

### 方式三：作为 npm 包分发（可选，需要 npm 账号）

```bash
# 发布：
pnpm publish --registry=https://registry.npmjs.org

# 对方安装：
dsh plugin --profile web add dsh-heartbeat
```

## 开发

```bash
pnpm --filter dsh-heartbeat run bundle   # 构建
pnpm --filter dsh-heartbeat run watch    # 监听构建
```

## 许可

MIT