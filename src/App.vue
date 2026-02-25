<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import fh5CarMapData from './fh5CarMap.json'

const wsPort = Number(import.meta.env.VITE_WS_PORT || 8080)
const wsHost = import.meta.env.VITE_WS_HOST || window.location.hostname
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`
const storageKey = 'fh-accel-tests-v1'

const activeView = ref('overview')
const navCollapsed = ref(false)
const connectionStatus = ref('未连接')
const lastUpdated = ref('-')
const telemetry = ref(null)
const chartCanvas = ref(null)
const gChartCanvas = ref(null)
let ws = null

const navItems = [
  { key: 'overview', label: '数据包总览' },
  { key: 'dashboard', label: '仪表盘' },
  { key: 'accelTest', label: '加速测试' },
]

const fh5CarMap = fh5CarMapData.cars || {}

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
      {
        key: 'gearDisplay',
        label: '档位',
        format: (value, all) => {
          if (all?.gearRaw === 0) return 'R'
          if (all?.gearRaw !== null && all?.gearRaw !== undefined) return `${all.gearRaw}`
          if (value === 'N') return '1'
          return value ?? '--'
        },
      },
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
]

const vehicleInfo = computed(() => {
  if (!telemetry.value) return []
  const carOrdinal = telemetry.value.carOrdinal
  const carName = fh5CarMap[String(carOrdinal)] || `未知车辆（ID: ${carOrdinal}）`
  return [
    { label: '车辆ID', value: telemetry.value.carOrdinal },
    { label: '车辆名称', value: carName },
    { label: '车辆等级', value: telemetry.value.carClass },
    { label: '性能指数 PI', value: telemetry.value.carPerformanceIndex },
    { label: '传动形式', value: telemetry.value.drivetrainType },
    { label: '气缸数', value: telemetry.value.numCylinders },
    { label: '已行驶距离', value: `${toNumber(telemetry.value.distanceTraveled, 2)} m` },
    { label: '包格式', value: telemetry.value.packetFormat },
    { label: '包长度', value: telemetry.value.packetSize },
  ]
})

const isGamePaused = computed(() => {
  if (!telemetry.value) return false
  return (
    telemetry.value.carOrdinal === 0 &&
    telemetry.value.carClass === 0 &&
    telemetry.value.carPerformanceIndex === 0
  )
})

const speedKmhValue = computed(() => Math.max(0, Number(telemetry.value?.speedKmh || 0)))
const rpmValue = computed(() => Math.max(0, Number(telemetry.value?.currentEngineRpm || 0)))
const rpmMax = computed(() => {
  const value = Number(telemetry.value?.engineMaxRpm || 0)
  return value > 0 ? value : 10000
})

const brakePercent = computed(() => Math.max(0, Math.min(100, Number(telemetry.value?.brake || 0))))
const accelPercent = computed(() => Math.max(0, Math.min(100, Number(telemetry.value?.accel || 0))))
const steerPercent = computed(() => {
  const value = Number(telemetry.value?.steerPercent || 0)
  return Math.max(-100, Math.min(100, value))
})
const steerLeftPercent = computed(() => Math.max(0, -steerPercent.value))
const steerRightPercent = computed(() => Math.max(0, steerPercent.value))

const dashboardGear = computed(() => {
  const gearRaw = telemetry.value?.gearRaw
  if (gearRaw === 0) return 'R'
  if (gearRaw !== null && gearRaw !== undefined) return `${gearRaw}`
  const gearDisplay = telemetry.value?.gearDisplay
  if (gearDisplay === 'N') return '1'
  return gearDisplay ?? '--'
})

const handBrakeEngaged = computed(() => Number(telemetry.value?.handBrake || 0) >= 1)

const rpmRatio = computed(() => Math.max(0, Math.min(1, rpmValue.value / Math.max(1, rpmMax.value))))
const aiBrakeRatio = computed(() => {
  const raw = Number(telemetry.value?.normalizedAiBrakeDifference || 0)
  return Math.max(0, Math.min(1, Math.abs(raw) / 127))
})

const dashUpperStyle = computed(() => ({ backgroundColor: zoneColor(rpmRatio.value) }))
const dashLowerStyle = computed(() => ({ backgroundColor: zoneColor(aiBrakeRatio.value) }))

const speedGaugeStyle = computed(() => getGaugeStyle(speedKmhValue.value, 420, '#2563eb'))
const rpmGaugeStyle = computed(() => getGaugeStyle(rpmValue.value, rpmMax.value, zoneColor(rpmRatio.value)))
const accelPageStyle = computed(() => ({ backgroundColor: testRunning.value ? zoneColor(rpmRatio.value) : '#ffffff' }))
const zGValue = computed(() => {
  const accelerationZ = Number(telemetry.value?.accelerationZ || 0)
  return accelerationZ / 9.80665
})

const testRunning = ref(false)
const testAutoArmed = ref(true)
const testStartMs = ref(0)
const testSamples = ref([])
const testMilestones = ref(createMilestones())
const testMeta = ref(null)
const latestRun = ref(null)
const savedRuns = ref([])
const selectedCompareId = ref('')
const importedRun = ref(null)

const activeMetricSamples = computed(() => {
  if (testRunning.value) return testSamples.value
  return latestRun.value?.samples || []
})

const gExtremes = computed(() => {
  const samples = activeMetricSamples.value
  if (!Array.isArray(samples) || samples.length === 0) {
    return { maxAccelG: null, maxDecelG: null }
  }
  const gValues = samples.map((sample) => Number(sample.g)).filter((value) => Number.isFinite(value))
  if (gValues.length === 0) return { maxAccelG: null, maxDecelG: null }

  const maxAccel = Math.max(0, ...gValues)
  const minDecel = Math.min(0, ...gValues)
  return {
    maxAccelG: maxAccel,
    maxDecelG: minDecel,
  }
})

const maxDecelGAbs = computed(() => {
  if (gExtremes.value.maxDecelG == null) return null
  return Math.abs(gExtremes.value.maxDecelG)
})

const primaryRun = computed(() => {
  if (testRunning.value) {
    return {
      id: 'running',
      title: `进行中：${testMeta.value?.carName || '未知车辆'}`,
      samples: testSamples.value,
    }
  }
  if (latestRun.value) {
    return {
      id: latestRun.value.id,
      title: `${latestRun.value.carName} ${new Date(latestRun.value.timestamp).toLocaleString('zh-CN')}`,
      samples: latestRun.value.samples,
    }
  }
  return null
})

const compareRun = computed(() => {
  if (selectedCompareId.value) {
    const found = savedRuns.value.find((item) => item.id === selectedCompareId.value)
    if (found) {
      return {
        id: found.id,
        title: `${found.carName} ${new Date(found.timestamp).toLocaleString('zh-CN')}`,
        samples: found.samples,
      }
    }
  }
  if (importedRun.value) {
    return {
      id: importedRun.value.id,
      title: `导入：${importedRun.value.carName}`,
      samples: importedRun.value.samples,
    }
  }
  return null
})

const accelMetrics = computed(() => {
  const m = testRunning.value ? testMilestones.value : (latestRun.value?.milestones || createMilestones())
  const decel = computeDecelMilestones(activeMetricSamples.value)
  return [
    { label: '0-100 km/h', value: formatSec(m.to100) },
    { label: '0-200 km/h', value: formatSec(m.to200) },
    { label: '0-300 km/h', value: formatSec(m.to300) },
    { label: '0-400 km/h', value: formatSec(m.to400) },
    { label: '100-200 km/h', value: formatSec(segmentTime(m.to100, m.to200)) },
    { label: '200-300 km/h', value: formatSec(segmentTime(m.to200, m.to300)) },
    { label: '300-400 km/h', value: formatSec(segmentTime(m.to300, m.to400)) },
    { label: '100-0 km/h', value: formatSec(segmentTime(decel.from100, decel.to0)) },
    { label: '200-100 km/h(减速)', value: formatSec(segmentTime(decel.from200, decel.from100)) },
    { label: '300-200 km/h(减速)', value: formatSec(segmentTime(decel.from300, decel.from200)) },
    { label: '400-300 km/h(减速)', value: formatSec(segmentTime(decel.from400, decel.from300)) },
    { label: '200-0 km/h', value: formatSec(segmentTime(decel.from200, decel.to0)) },
    { label: '300-0 km/h', value: formatSec(segmentTime(decel.from300, decel.to0)) },
    { label: '400-0 km/h', value: formatSec(segmentTime(decel.from400, decel.to0)) },
  ]
})

function createMilestones() {
  return {
    to100: null,
    to200: null,
    to300: null,
    to400: null,
  }
}

function computeDecelMilestones(samples) {
  const result = {
    from400: null,
    from300: null,
    from200: null,
    from100: null,
    to0: null,
  }
  if (!Array.isArray(samples) || samples.length < 2) return result

  let peakIndex = 0
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index].speed || 0) > (samples[peakIndex].speed || 0)) {
      peakIndex = index
    }
  }

  for (let index = peakIndex; index < samples.length; index += 1) {
    const speed = Number(samples[index].speed || 0)
    const time = Number(samples[index].t || 0)
    if (result.from400 === null && speed <= 400 && (samples[peakIndex].speed || 0) >= 400) result.from400 = time
    if (result.from300 === null && speed <= 300 && (samples[peakIndex].speed || 0) >= 300) result.from300 = time
    if (result.from200 === null && speed <= 200 && (samples[peakIndex].speed || 0) >= 200) result.from200 = time
    if (result.from100 === null && speed <= 100 && (samples[peakIndex].speed || 0) >= 100) result.from100 = time
    if (result.to0 === null && speed <= 1) result.to0 = time
  }

  return result
}

function zoneColor(ratio) {
  if (ratio >= 0.9) return '#fca5a5'
  if (ratio >= 0.8) return '#fde047'
  if (ratio >= 0.5) return '#86efac'
  return '#93c5fd'
}

function getGaugeStyle(value, max, color) {
  const safeMax = Math.max(1, max)
  const ratio = Math.max(0, Math.min(1, value / safeMax))
  const degree = Math.round(ratio * 360)
  return {
    background: `conic-gradient(${color} ${degree}deg, #e5e7eb ${degree}deg 360deg)`,
  }
}

function toNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  if (typeof value === 'number') return value.toFixed(digits)
  return value
}

function formatSec(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value.toFixed(3)} s`
}

function segmentTime(from, to) {
  if (from === null || to === null || from === undefined || to === undefined) return null
  return Math.max(0, to - from)
}

function formatValue(item) {
  if (!telemetry.value) return '--'
  const value = telemetry.value[item.key]
  if (item.format) return item.format(value, telemetry.value)
  const displayValue = typeof value === 'number' ? toNumber(value, item.digits ?? 0) : value ?? '--'
  return item.unit ? `${displayValue} ${item.unit}` : `${displayValue}`
}

function startAccelerationTest() {
  if (testRunning.value) return
  testRunning.value = true
  testStartMs.value = performance.now()
  testMilestones.value = createMilestones()
  testSamples.value = [{ t: 0, speed: speedKmhValue.value, g: zGValue.value }]
  const carOrdinal = telemetry.value?.carOrdinal ?? 0
  testMeta.value = {
    carOrdinal,
    carName: fh5CarMap[String(carOrdinal)] || `未知车辆（ID: ${carOrdinal}）`,
  }
}

function maybeMarkMilestones(speed, elapsedSec) {
  const marks = testMilestones.value
  if (marks.to100 === null && speed >= 100) marks.to100 = elapsedSec
  if (marks.to200 === null && speed >= 200) marks.to200 = elapsedSec
  if (marks.to300 === null && speed >= 300) marks.to300 = elapsedSec
  if (marks.to400 === null && speed >= 400) {
    marks.to400 = elapsedSec
    return true
  }
  return false
}

function recordAccelerationSample(data) {
  if (!testRunning.value) return
  const now = performance.now()
  const elapsedSec = (now - testStartMs.value) / 1000
  const speed = Math.max(0, Number(data.speedKmh || 0))
  const gValue = Number(data.accelerationZ || 0) / 9.80665
  const last = testSamples.value[testSamples.value.length - 1]
  if (
    !last ||
    elapsedSec - last.t >= 0.05 ||
    Math.abs(speed - last.speed) >= 0.5 ||
    Math.abs((last.g ?? 0) - gValue) >= 0.03
  ) {
    testSamples.value.push({ t: elapsedSec, speed, g: gValue })
  }
  const reached400 = maybeMarkMilestones(speed, elapsedSec)
  const backToZeroAfter100 = testMilestones.value.to100 !== null && speed <= 1 && elapsedSec > testMilestones.value.to100 + 0.2
  if (reached400 || backToZeroAfter100) {
    stopAndSaveTest()
  }
}

function buildRunObject() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    carOrdinal: testMeta.value?.carOrdinal ?? 0,
    carName: testMeta.value?.carName ?? '未知车辆',
    samples: [...testSamples.value],
    milestones: { ...testMilestones.value },
  }
}

function saveRunsToStorage() {
  localStorage.setItem(storageKey, JSON.stringify(savedRuns.value))
}

function loadRunsFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      savedRuns.value = parsed.filter((item) => Array.isArray(item.samples) && item.samples.length > 0)
    }
  } catch (error) {
    console.error(error)
  }
}

function stopAndSaveTest() {
  if (!testRunning.value) return
  testRunning.value = false
  if (testSamples.value.length < 2) return
  const run = buildRunObject()
  savedRuns.value = [run, ...savedRuns.value].slice(0, 60)
  latestRun.value = run
  saveRunsToStorage()
}

function resetCurrentTest() {
  testRunning.value = false
  testSamples.value = []
  testMilestones.value = createMilestones()
  latestRun.value = null
}

function loadRunAsPrimary(run) {
  latestRun.value = run
  testRunning.value = false
  testSamples.value = []
  testMilestones.value = { ...run.milestones }
}

function exportCurrentRunTxt() {
  const run = latestRun.value
  if (!run) return
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `accel-test-${run.carOrdinal}-${run.timestamp}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleImportTxt(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'))
      if (!Array.isArray(parsed.samples) || parsed.samples.length < 2) return
      importedRun.value = {
        id: `import-${Date.now()}`,
        carName: parsed.carName || '导入数据',
        samples: parsed.samples,
      }
    } catch (error) {
      console.error(error)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function drawCurveOnCanvas(context, run, color, xMax, yMin, yMax, left, top, width, height, valueKey) {
  if (!run || !Array.isArray(run.samples) || run.samples.length < 2) return
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  run.samples.forEach((sample, index) => {
    const x = left + (Math.max(0, sample.t) / xMax) * width
    const value = Number(sample[valueKey])
    if (!Number.isFinite(value)) return
    const y = top + height - ((value - yMin) / Math.max(0.0001, yMax - yMin)) * height
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
}

function drawChart({ canvas, valueKey, yLabel, colors, minDefault, maxDefault }) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(rect.width * dpr))
  canvas.height = Math.max(1, Math.floor(rect.height * dpr))
  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(dpr, dpr)

  context.clearRect(0, 0, rect.width, rect.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, rect.width, rect.height)

  const left = 44
  const right = 14
  const top = 14
  const bottom = 30
  const width = rect.width - left - right
  const height = rect.height - top - bottom

  context.strokeStyle = '#d1d5db'
  context.lineWidth = 1
  context.strokeRect(left, top, width, height)

  const runs = [primaryRun.value, compareRun.value].filter(Boolean)
  if (runs.length === 0) return

  const maxT = Math.max(...runs.flatMap((run) => run.samples.map((sample) => sample.t)), 5)
  const values = runs.flatMap((run) => run.samples.map((sample) => Number(sample[valueKey]))).filter((item) => Number.isFinite(item))
  if (values.length === 0) return

  const xMax = Math.ceil(maxT)
  const maxV = Math.max(...values, maxDefault)
  const minV = Math.min(...values, minDefault)
  const yMax = Math.max(maxDefault, maxV)
  const yMin = Math.min(minDefault, minV)

  drawCurveOnCanvas(context, primaryRun.value, colors.primary, xMax, yMin, yMax, left, top, width, height, valueKey)
  drawCurveOnCanvas(context, compareRun.value, colors.compare, xMax, yMin, yMax, left, top, width, height, valueKey)

  context.fillStyle = '#6b7280'
  context.font = '11px sans-serif'
  context.fillText('时间(s)', left + width - 48, rect.height - 8)
  context.fillText(yLabel, 4, top + 10)

  context.fillStyle = '#111827'
  context.fillText('主曲线', left + 4, top + 14)
  context.fillStyle = colors.primary
  context.fillRect(left + 42, top + 7, 18, 3)

  if (compareRun.value) {
    context.fillStyle = '#111827'
    context.fillText('对比', left + 70, top + 14)
    context.fillStyle = colors.compare
    context.fillRect(left + 98, top + 7, 18, 3)
  }
}

function drawAccelerationChart() {
  drawChart({
    canvas: chartCanvas.value,
    valueKey: 'speed',
    yLabel: '车速(km/h)',
    colors: { primary: '#2563eb', compare: '#ef4444' },
    minDefault: 0,
    maxDefault: 100,
  })
}

function drawGChart() {
  drawChart({
    canvas: gChartCanvas.value,
    valueKey: 'g',
    yLabel: 'G值(g)',
    colors: { primary: '#16a34a', compare: '#dc2626' },
    minDefault: -1,
    maxDefault: 1,
  })
}

function exportChartImage() {
  const canvas = chartCanvas.value
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `accel-curve-${Date.now()}.png`
  anchor.click()
}

function exportGChartImage() {
  const canvas = gChartCanvas.value
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `g-curve-${Date.now()}.png`
  anchor.click()
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

        const autoCondition = (payload.data.handBrake ?? 0) >= 100 && (payload.data.accel ?? 0) >= 100
        if (autoCondition && testAutoArmed.value && !testRunning.value) {
          startAccelerationTest()
          testAutoArmed.value = false
        }
        if (!autoCondition) {
          testAutoArmed.value = true
        }

        recordAccelerationSample(payload.data)
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

function handleResize() {
  if (activeView.value === 'accelTest') {
    drawAccelerationChart()
    drawGChart()
  }
}

watch(
  () => [
    activeView.value,
    testRunning.value,
    testSamples.value.length,
    latestRun.value?.id,
    selectedCompareId.value,
    importedRun.value?.id,
  ],
  async () => {
    if (activeView.value === 'accelTest') {
      await nextTick()
      drawAccelerationChart()
      drawGChart()
    }
  },
)

onMounted(() => {
  connectTelemetrySocket()
  loadRunsFromStorage()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  ws?.close()
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <main class="app-shell">
    <nav class="side-nav card" :class="{ collapsed: navCollapsed }">
      <button class="nav-toggle" @click="navCollapsed = !navCollapsed">
        {{ navCollapsed ? '展开' : '收起' }}
      </button>
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-btn"
        :class="{ active: activeView === item.key }"
        @click="activeView = item.key"
      >
        {{ navCollapsed ? item.label.slice(0, 2) : item.label }}
      </button>
    </nav>

    <section class="content">
      <template v-if="activeView === 'overview'">
        <header class="header card">
          <h2>数据包总览</h2>
          <p class="tips">请先启动 `npm run dev:server`，并在游戏中开启 Data Out (UDP)。</p>
          <p class="tips">连接：{{ connectionStatus }}</p>
          <p class="tips">更新：{{ lastUpdated }}</p>
          <p class="tips">地址：{{ wsUrl }}</p>
        </header>

        <section class="card" v-if="vehicleInfo.length">
          <h3>车辆信息</h3>
          <div class="kv-grid">
            <div class="kv" v-for="item in vehicleInfo" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value ?? '--' }}</strong>
            </div>
          </div>
        </section>

        <section class="card" v-for="section in metricSections" :key="section.title">
          <h3>{{ section.title }}</h3>
          <div class="kv-grid">
            <div class="kv" v-for="item in section.items" :key="item.key">
              <span>{{ item.label }}</span>
              <strong>{{ formatValue(item) }}</strong>
            </div>
          </div>
        </section>
      </template>

      <section v-else-if="activeView === 'dashboard'" class="dash-page">
        <section class="card dash-upper" :style="dashUpperStyle">
          <div class="center-row">
            <div class="pedal-card">
              <span>刹车</span>
              <div class="pedal-track">
                <div class="pedal-fill" :style="{ height: `${brakePercent}%` }"></div>
              </div>
              <strong>{{ toNumber(brakePercent, 0) }}%</strong>
            </div>

            <div class="gauge-wrap">
              <article class="gauge-card">
                <h3>车速</h3>
                <div class="gauge" :style="speedGaugeStyle">
                  <div class="gauge-inner">
                    <strong>{{ toNumber(speedKmhValue, 1) }}</strong>
                    <span>km/h</span>
                  </div>
                </div>
              </article>

              <article class="middle-info-card">
                <div v-if="handBrakeEngaged" class="handbrake-light">手刹</div>
                <div class="gear-box">
                  <span>档位</span>
                  <strong>{{ dashboardGear }}</strong>
                </div>
              </article>

              <article class="gauge-card">
                <h3>转速</h3>
                <div class="gauge" :style="rpmGaugeStyle">
                  <div class="gauge-inner">
                    <strong>{{ toNumber(rpmValue, 0) }}</strong>
                    <span>rpm</span>
                  </div>
                </div>
              </article>
            </div>

            <div class="pedal-card">
              <span>油门</span>
              <div class="pedal-track">
                <div class="pedal-fill accel" :style="{ height: `${accelPercent}%` }"></div>
              </div>
              <strong>{{ toNumber(accelPercent, 0) }}%</strong>
            </div>
          </div>
        </section>

        <section class="card dash-lower" :style="dashLowerStyle">

          <div class="steer-section">
            <div class="steer-row">
              <strong class="steer-value">{{ toNumber(steerLeftPercent, 0) }}%</strong>
              <div class="steer-track">
                <div class="steer-center"></div>
                <div
                  class="steer-fill"
                  :style="{
                    left: steerPercent < 0 ? `${50 + steerPercent / 2}%` : '50%',
                    width: `${Math.abs(steerPercent) / 2}%`,
                  }"
                ></div>
              </div>
              <strong class="steer-value">{{ toNumber(steerRightPercent, 0) }}%</strong>
            </div>
          </div>
        </section>
      </section>

      <section v-else class="accel-page card" :style="accelPageStyle">
        <section class="card">
          <p class="tips">点击开始测试或弹射起步以开始测试</p>
          <p class="tips">G值（Z轴加速度）：{{ toNumber(zGValue, 3) }} g</p>
          <p class="tips">最大加速G值：{{ toNumber(gExtremes.maxAccelG, 3) }} g</p>
          <p class="tips">最大减速G值：{{ toNumber(maxDecelGAbs, 3) }} g</p>
        </section>

        <section class="card accel-actions">
          <button class="action-btn primary" @click="startAccelerationTest" :disabled="testRunning">开始测试</button>
          <button class="action-btn" @click="stopAndSaveTest" :disabled="!testRunning">停止并保存</button>
          <button class="action-btn" @click="resetCurrentTest">清空当前</button>
          <button class="action-btn" @click="exportChartImage" :disabled="!primaryRun">保存曲线图片</button>
          <button class="action-btn" @click="exportGChartImage" :disabled="!primaryRun">保存G值图片</button>
          <button class="action-btn" @click="exportCurrentRunTxt" :disabled="!latestRun">导出TXT原始数据</button>
          <label class="action-btn file-btn">
            加载TXT
            <input type="file" accept=".txt,application/json,text/plain" @change="handleImportTxt" />
          </label>
        </section>

        <section class="card">
          <h3>加速成绩</h3>
          <div class="metric-grid">
            <div class="metric-item" v-for="item in accelMetrics" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </section>

        <section class="card chart-card">
          <h3>加速曲线（时间-车速）</h3>
          <canvas ref="chartCanvas" class="chart-canvas"></canvas>
        </section>

        <section class="card chart-card">
          <h3>G值曲线（时间-Z轴G值）</h3>
          <canvas ref="gChartCanvas" class="chart-canvas"></canvas>
        </section>

        <section class="card">
          <h3>历史测试（本地存储）</h3>
          <div class="history-list" v-if="savedRuns.length">
            <div class="history-item" v-for="run in savedRuns" :key="run.id">
              <div>
                <strong>{{ run.carName }}</strong>
                <p>{{ new Date(run.timestamp).toLocaleString('zh-CN') }}</p>
              </div>
              <div class="history-actions">
                <button class="action-btn" @click="loadRunAsPrimary(run)">主曲线</button>
                <button class="action-btn" @click="selectedCompareId = run.id">设为对比</button>
              </div>
            </div>
          </div>
          <p v-else class="tips">暂无测试记录，开始一次测试后会自动保存到本地。</p>
        </section>
      </section>
    </section>

    <div v-if="isGamePaused" class="modal-mask">
      <div class="modal-card">
        <h3>游戏已暂停</h3>
      </div>
    </div>
  </main>
</template>
