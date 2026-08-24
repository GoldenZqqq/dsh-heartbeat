# DSH Heartbeat Monitor

一个实时反映模型工作状态的心率监视器，固定在 DSH Web 侧边栏 logo 正下方。
**token 输出越快，心跳越快；越慢，心跳越慢。**

## 安装

```bash
dsh plugin --profile web add https://github.com/superzhang21/dsh-heartbeat/releases/download/v0.1.0/dsh-heartbeat-0.1.0.tgz
```

安装后重启 DSH，然后刷新页面即可看到效果。

## 使用

心脏图标会固定在侧边栏 logo 正下方，自动反映当前模型的工作状态：

| 状态 | 心率 | 表现 |
| --- | --- | --- |
| 🥶 冬眠 (idle) | 20-30 BPM | 没有任何会话在运行，像睡着了一样缓慢呼吸 |
| 🤔 思考 (thinking) | 38-50 BPM | 有会话在跑，但还没吐出第一个 token |
| 💚 输出 (streaming) | 50-160 BPM | token 正常流出，心率随 tok/s 平滑上升 |
| 🔥 狂暴 (burst) | 180-200 BPM | 超高速输出时自动进入"狂暴模式"，红光 + 粒子特效 |
| ⚫ 离线 | — | 与主机的连接断开 |

所有动画由 rAF 驱动，不依赖 React 重渲染，性能开销极小。

## 许可

MIT
