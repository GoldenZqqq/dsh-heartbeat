# DSH Heartbeat Monitor

一个实时反映模型工作状态的心率监视器，以浮动小组件形式显示在 DSH Web 界面，可以随意拖到任何位置。
 位置会保存在浏览器本地。

**token 输出越快，心跳越快；越慢，心跳越慢。**

本 fork 已适配 DSH `0.1.2-rc.1` 的客户端事件接口 (通过 `remote.session.follow` 监听运行中会话的 token 事件)，并加入了可拖拽浮动位置支持。

 不再依赖已移除的 `dsh-client-runtime` / `dsh-client-ui-slots` / 旧的 `connection.api.events.mux` 事件流。

## 安装

在本地构建并添加到你的 DSH profile：

```bash
cd dsh-heartbeat
npm pack
dsh plugin --profile web add ./dsh-heartbeat-0.2.7.tgz
```

安装后重启 DSH，然后刷新页面即可看到效果。

## 使用

小组件默认出现在右下角，可直接用鼠标/触摸拖到屏幕任意位置；拖拽位置会持久化到 `localStorage` 的 `dsh-heartbeat:pos` 键中。

| 状态 | 心率 |表现 |
| --- | --- | --- |
| 🥶 冬眠 (idle) |20-30 BPM | 没有任何会话在运行，像睡着了一样缓慢呼吸 |
| 🤔 思考 (thinking) |38-50 BPM |有会话在跑，但还没吐出第一个 token |
| 💚 输出 (streaming) |50-160 BPM |token 正常流出，心率随 tok/s 平滑上升 |
| 🔥 狂暴 (burst) |180-200 BPM |超高速输出时自动进入“狂暴模式”，红光 + 粒子特效 |
| ⚫ 离线 |— |与主机的连接断开 |

所有动画由 rAF 驱动，不依赖 React 重渲染，性能开销极小。

## 许可

MIT