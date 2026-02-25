# Forza Horizon 4/5 UDP 遥测面板（Vue3）

本项目包含两部分：

- 前端：Vue3 页面，实时显示遥测数据（中文字段）。
- 本地网关：Node.js UDP 监听服务，把游戏发来的 UDP 数据转发给前端 WebSocket。

## 1. 安装依赖

```bash
npm install
```

## 2. 启动 UDP 网关

```bash
npm run dev:server
```

默认端口：

- UDP 监听端口：`5300`
- WebSocket 端口：`8080`

可通过环境变量修改：

```bash
UDP_PORT=5300 WS_PORT=8080 npm run dev:server
```

## 3. 启动前端

```bash
npm run dev
```

打开浏览器访问 Vite 提示的地址（默认 `http://localhost:5173`）。

## 4. 游戏内设置（FH4/FH5）

在 Forza Horizon 的设置里找到 Data Out（遥测输出）相关选项：

- 打开 UDP Telemetry / Data Out。
- IP 地址填写运行本项目的机器 IP（本机可填 `127.0.0.1`）。
- 端口填写 `5300`（或与你的 `UDP_PORT` 一致）。

完成后进入驾驶画面即可看到面板数据刷新。

## 5. 说明

- 浏览器本身不能直接监听 UDP，所以必须先运行本地 UDP 网关。
- 当前解析兼容 Forza Horizon 常见 Data Out Dash 格式字段，页面已中文标注核心实时指标。
