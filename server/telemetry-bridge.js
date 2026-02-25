import dgram from 'node:dgram'
import { WebSocketServer } from 'ws'
import { parseForzaTelemetry } from './forzaTelemetryParser.js'

const UDP_HOST = process.env.UDP_HOST || '0.0.0.0'
const UDP_PORT = Number(process.env.UDP_PORT || 5300)
const WS_HOST = process.env.WS_HOST || '0.0.0.0'
const WS_PORT = Number(process.env.WS_PORT || 8080)

const udpServer = dgram.createSocket('udp4')
const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT })

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({
      type: 'info',
      message: 'WebSocket 已连接，等待游戏UDP遥测数据。',
    }),
  )
})

udpServer.on('listening', () => {
  const address = udpServer.address()
  console.log(`UDP监听中：${address.address}:${address.port}`)
  console.log(`WebSocket服务：ws://${WS_HOST}:${WS_PORT}`)
})

udpServer.on('message', (message) => {
  try {
    const data = parseForzaTelemetry(message)
    const payload = JSON.stringify({
      type: 'telemetry',
      createdAt: Date.now(),
      data,
    })

    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload)
      }
    })
  } catch (error) {
    console.error('遥测包解析失败：', error)
  }
})

udpServer.on('error', (error) => {
  console.error('UDP服务错误：', error)
})

udpServer.bind(UDP_PORT, UDP_HOST)

process.on('SIGINT', () => {
  console.log('\n正在关闭遥测服务...')
  udpServer.close()
  wss.close(() => process.exit(0))
})
