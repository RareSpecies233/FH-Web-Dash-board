<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const wsPort = Number(import.meta.env.VITE_WS_PORT || 8080)
const wsHost = import.meta.env.VITE_WS_HOST || window.location.hostname
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`
const connectionStatus = ref('未连接')
const lastUpdated = ref('-')
const telemetry = ref(null)
let ws = null

const metricSections = [
  {
    title: '比赛状态',
    items: [
      { key: 'isRaceOn', label: '比赛中', format: (v) => (v === 1 ? '是' : '否') },
      { key: 'timestampMs', label: '遥测时间戳', unit: 'ms' },
      { key: 'lapNumber', label: '圈数' },
      { key: 'racePosition', label: '比赛排名' },
      { key: 'currentRaceTime', label: '当前比赛时间', unit: 's', digits: 2 },
      { key: 'bestLap', label: '最佳圈速', unit: 's', digits: 3 },
      { key: 'lastLap', label: '上一圈', unit: 's', digits: 3 },
      { key: 'currentLap', label: '当前圈', unit: 's', digits: 3 },
    ],
  },
  {
    title: '车辆与引擎',
    items: [
      { key: 'speed', label: '车速', unit: 'm/s', digits: 2 },
      { key: 'speedKmh', label: '车速', unit: 'km/h', digits: 1 },
      { key: 'currentEngineRpm', label: '当前转速', unit: 'rpm', digits: 0 },
      { key: 'engineIdleRpm', label: '怠速转速', unit: 'rpm', digits: 0 },
      { key: 'engineMaxRpm', label: '最大转速', unit: 'rpm', digits: 0 },
      { key: 'gearDisplay', label: '档位' },
      { key: 'boost', label: '增压值', digits: 2 },
      { key: 'fuel', label: '油量', digits: 2 },
      { key: 'power', label: '功率', digits: 2 },
      { key: 'torque', label: '扭矩', digits: 2 },
    ],
  },
  {
    title: '操控输入',
    items: [
      { key: 'accel', label: '油门', unit: '%' },
      { key: 'brake', label: '刹车', unit: '%' },
      { key: 'clutch', label: '离合', unit: '%' },
      { key: 'handBrake', label: '手刹', unit: '%' },
      { key: 'steerPercent', label: '转向', unit: '%' },
      { key: 'normalizedDrivingLine', label: '理想路线辅助' },
      { key: 'normalizedAiBrakeDifference', label: 'AI刹车差值' },
    ],
  },
  {
    title: '运动状态',
    items: [
      { key: 'velocityX', label: '速度 X', unit: 'm/s', digits: 2 },
      { key: 'velocityY', label: '速度 Y', unit: 'm/s', digits: 2 },
      { key: 'velocityZ', label: '速度 Z', unit: 'm/s', digits: 2 },
      { key: 'accelerationX', label: '加速度 X', unit: 'm/s²', digits: 2 },
      { key: 'accelerationY', label: '加速度 Y', unit: 'm/s²', digits: 2 },
      { key: 'accelerationZ', label: '加速度 Z', unit: 'm/s²', digits: 2 },
      { key: 'yaw', label: '偏航', digits: 3 },
      { key: 'pitch', label: '俯仰', digits: 3 },
      { key: 'roll', label: '横滚', digits: 3 },
      { key: 'positionX', label: '世界坐标 X', digits: 2 },
      { key: 'positionY', label: '世界坐标 Y', digits: 2 },
      { key: 'positionZ', label: '世界坐标 Z', digits: 2 },
    ],
  },
]

const vehicleInfo = computed(() => {
  if (!telemetry.value) return []
  return [
    { label: '车辆ID', value: telemetry.value.carOrdinal },
    { label: '车辆等级', value: telemetry.value.carClass },
    { label: '性能指数 PI', value: telemetry.value.carPerformanceIndex },
    { label: '传动形式', value: telemetry.value.drivetrainType },
    { label: '气缸数', value: telemetry.value.numCylinders },
    { label: '已行驶距离', value: `${toNumber(telemetry.value.distanceTraveled, 2)} m` },
    { label: '包格式', value: telemetry.value.packetFormat },
    { label: '包长度', value: telemetry.value.packetSize },
  ]
})

function toNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  if (typeof value === 'number') return value.toFixed(digits)
  return value
}

function formatValue(item) {
  if (!telemetry.value) return '--'
  const value = telemetry.value[item.key]
  if (item.format) return item.format(value)
  const displayValue = typeof value === 'number' ? toNumber(value, item.digits ?? 0) : value ?? '--'
  return item.unit ? `${displayValue} ${item.unit}` : `${displayValue}`
}

function connectTelemetrySocket() {
  connectionStatus.value = '连接中'
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    connectionStatus.value = '已连接'
  }

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.type === 'telemetry') {
        telemetry.value = payload.data
        lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      }
    } catch (error) {
      connectionStatus.value = '数据解析失败'
      console.error(error)
    }
  }

  ws.onerror = () => {
    connectionStatus.value = '连接异常'
  }

  ws.onclose = () => {
    connectionStatus.value = '已断开，3秒后重连'
    setTimeout(connectTelemetrySocket, 3000)
  }
}

onMounted(() => {
  connectTelemetrySocket()
})

onBeforeUnmount(() => {
  ws?.close()
})
</script>

<template>
  <main class="dashboard">
    <header class="header">
      <h1>Forza Horizon 4/5 UDP 遥测面板</h1>
      <p>连接状态：{{ connectionStatus }}｜最后更新：{{ lastUpdated }}</p>
      <p class="tips">请先启动 `npm run dev:server`，并在游戏中开启 Data Out (UDP)。</p>
      <p class="tips">当前数据地址：{{ wsUrl }}</p>
    </header>

    <section class="card" v-if="vehicleInfo.length">
      <h2>车辆信息</h2>
      <div class="kv-grid">
        <div class="kv" v-for="item in vehicleInfo" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value ?? '--' }}</strong>
        </div>
      </div>
    </section>

    <section class="card" v-for="section in metricSections" :key="section.title">
      <h2>{{ section.title }}</h2>
      <div class="kv-grid">
        <div class="kv" v-for="item in section.items" :key="item.key">
          <span>{{ item.label }}</span>
          <strong>{{ formatValue(item) }}</strong>
        </div>
      </div>
    </section>
  </main>
</template>
