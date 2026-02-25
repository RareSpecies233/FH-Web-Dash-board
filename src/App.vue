<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import fh5CarMapData from './fh5CarMap.json'

const wsPort = Number(import.meta.env.VITE_WS_PORT || 8080)
const wsHost = import.meta.env.VITE_WS_HOST || window.location.hostname
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`
const storageKey = 'fh-accel-tests-v1'

const activeView = ref('dashboard')
const navCollapsed = ref(true)
const connectionStatus = ref('未连接')
const lastUpdated = ref('-')
const telemetry = ref(null)
const chartCanvas = ref(null)
const gChartCanvas = ref(null)
const powerChartCanvas = ref(null)
const torqueChartCanvas = ref(null)
const historyChartCanvas = ref(null)
const historyGChartCanvas = ref(null)
const historyPowerChartCanvas = ref(null)
const historyTorqueChartCanvas = ref(null)
let ws = null

const navItems = [
  { key: 'overview', label: '数据包总览' },
  { key: 'dashboard', label: '仪表盘' },
  { key: 'accelTest', label: '加速测试' },
  { key: 'history', label: '测试历史' },
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
      { key: 'power', label: '功率', unit: 'kW', digits: 1, format: (v) => toNumber(Number(v || 0) / 1000, 1) },
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
const powerKwValue = computed(() => Math.max(0, Number(telemetry.value?.power || 0) / 1000))
const horsepowerValue = computed(() => powerKwValue.value * 1.34102209)
const torqueNmValue = computed(() => Math.max(0, Number(telemetry.value?.torque || 0)))
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
const zeroSpeedSinceMs = ref(null)
const disableRealtimeDrawing = ref(false)
const testEndNoticeVisible = ref(false)
const testSamples = ref([])
const runningSummary = ref(createEmptySummary())
const testMilestones = ref(createMilestones())
const testMeta = ref(null)
const launchPromptVisible = ref(false)
const latestRun = ref(null)
const savedRuns = ref([])
const selectedCompareId = ref('')
const selectedHistoryRunId = ref('')
const importedRun = ref(null)
const accelRenderSerial = ref(0)
const chartHover = ref({})
const chartMeta = ref({})
let testEndNoticeTimer = null
let lastAccelRenderAtMs = 0

const activeSummary = computed(() => {
  if (testRunning.value) return runningSummary.value
  if (latestRun.value) return ensureRunSummary(latestRun.value)
  return createEmptySummary()
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

const selectedHistoryRun = computed(() => {
  if (!savedRuns.value.length) return null
  const found = savedRuns.value.find((item) => item.id === selectedHistoryRunId.value)
  return found || savedRuns.value[0]
})

const accelMetrics = computed(() => {
  const m = testRunning.value ? testMilestones.value : (latestRun.value?.milestones || createMilestones())
  const summary = activeSummary.value
  return [
    { label: '实时速度', value: `${toNumber(speedKmhValue.value, 1)} km/h` },
    { label: '当前G值', value: `${toNumber(zGValue.value, 3)} g` },
    { label: '最大功率', value: `${toNumber(summary.maxPowerKw, 1)} kW` },
    { label: '最大马力', value: `${toNumber(summary.maxHp, 1)} HP` },
    { label: '最大扭矩', value: `${toNumber(summary.maxTorqueNm, 1)} Nm` },
    { label: '最大加速G值', value: `${toNumber(summary.maxAccelG, 3)} g` },
    { label: '最大减速G值', value: `${toNumber(summary.maxDecelGAbs, 3)} g` },
    { label: '0-100 km/h', value: formatSec(m.to100) },
    { label: '0-200 km/h', value: formatSec(m.to200) },
    { label: '0-300 km/h', value: formatSec(m.to300) },
    { label: '0-400 km/h', value: formatSec(m.to400) },
    { label: '100-200 km/h', value: formatSec(segmentTime(m.to100, m.to200)) },
    { label: '200-300 km/h', value: formatSec(segmentTime(m.to200, m.to300)) },
    { label: '300-400 km/h', value: formatSec(segmentTime(m.to300, m.to400)) },
    { label: '100-0 km/h', value: formatSec(segmentTime(summary.decel.from100, summary.decel.to0)) },
    { label: '200-100 km/h(减速)', value: formatSec(segmentTime(summary.decel.from200, summary.decel.from100)) },
    { label: '300-200 km/h(减速)', value: formatSec(segmentTime(summary.decel.from300, summary.decel.from200)) },
    { label: '400-300 km/h(减速)', value: formatSec(segmentTime(summary.decel.from400, summary.decel.from300)) },
    { label: '200-0 km/h', value: formatSec(segmentTime(summary.decel.from200, summary.decel.to0)) },
    { label: '300-0 km/h', value: formatSec(segmentTime(summary.decel.from300, summary.decel.to0)) },
    { label: '400-0 km/h', value: formatSec(segmentTime(summary.decel.from400, summary.decel.to0)) },
  ]
})

function createEmptySummary() {
  return {
    maxAccelG: null,
    maxDecelGAbs: null,
    maxPowerKw: null,
    maxHp: null,
    maxTorqueNm: null,
    decel: {
      from400: null,
      from300: null,
      from200: null,
      from100: null,
      to0: null,
    },
  }
}

function createRunSummary(samples) {
  const summary = createEmptySummary()
  if (!Array.isArray(samples) || samples.length < 1) return summary

  for (const sample of samples) {
    const gValue = Number(sample.g)
    if (Number.isFinite(gValue)) {
      summary.maxAccelG = summary.maxAccelG === null ? Math.max(0, gValue) : Math.max(summary.maxAccelG, gValue)
      const decelAbs = Math.abs(Math.min(0, gValue))
      summary.maxDecelGAbs = summary.maxDecelGAbs === null ? decelAbs : Math.max(summary.maxDecelGAbs, decelAbs)
    }

    const powerKw = Number(sample.powerKw)
    if (Number.isFinite(powerKw)) {
      summary.maxPowerKw = summary.maxPowerKw === null ? powerKw : Math.max(summary.maxPowerKw, powerKw)
    }

    const hpValue = Number(sample.hp)
    if (Number.isFinite(hpValue)) {
      summary.maxHp = summary.maxHp === null ? hpValue : Math.max(summary.maxHp, hpValue)
    }

    const torqueNm = Number(sample.torqueNm)
    if (Number.isFinite(torqueNm)) {
      summary.maxTorqueNm = summary.maxTorqueNm === null ? torqueNm : Math.max(summary.maxTorqueNm, torqueNm)
    }
  }

  summary.decel = computeDecelMilestones(samples)
  return summary
}

function ensureRunSummary(run) {
  if (!run) return createEmptySummary()
  if (!run.summary) {
    run.summary = createRunSummary(run.samples)
  }
  return run.summary
}

function normalizeRunSamples(samples) {
  if (!Array.isArray(samples)) return []
  return samples.map((sample) => {
    const rawPowerKw = Number(sample.powerKw)
    const needsScaleFix = Number.isFinite(rawPowerKw) && rawPowerKw > 5000
    const normalizedPowerKw = needsScaleFix ? rawPowerKw / 1000 : rawPowerKw
    const normalizedHp = Number.isFinite(sample.hp) && !needsScaleFix
      ? Number(sample.hp)
      : (Number.isFinite(normalizedPowerKw) ? normalizedPowerKw * 1.34102209 : Number(sample.hp))
    return {
      ...sample,
      powerKw: Number.isFinite(normalizedPowerKw) ? normalizedPowerKw : sample.powerKw,
      hp: Number.isFinite(normalizedHp) ? normalizedHp : sample.hp,
    }
  })
}

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
  lastAccelRenderAtMs = 0
  zeroSpeedSinceMs.value = null
  runningSummary.value = createEmptySummary()
  testMilestones.value = createMilestones()
  testSamples.value = [{
    t: 0,
    speed: speedKmhValue.value,
    g: zGValue.value,
    powerKw: powerKwValue.value,
    hp: horsepowerValue.value,
    torqueNm: torqueNmValue.value,
  }]
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
  const powerKw = Math.max(0, Number(data.power || 0) / 1000)
  const hp = powerKw * 1.34102209
  const torqueNm = Math.max(0, Number(data.torque || 0))
  const last = testSamples.value[testSamples.value.length - 1]
  if (
    !last ||
    elapsedSec - last.t >= 0.05 ||
    Math.abs(speed - last.speed) >= 0.5 ||
    Math.abs((last.g ?? 0) - gValue) >= 0.03 ||
    Math.abs((last.powerKw ?? 0) - powerKw) >= 5 ||
    Math.abs((last.torqueNm ?? 0) - torqueNm) >= 10
  ) {
    testSamples.value.push({ t: elapsedSec, speed, g: gValue, powerKw, hp, torqueNm })

    runningSummary.value.maxAccelG = runningSummary.value.maxAccelG === null
      ? Math.max(0, gValue)
      : Math.max(runningSummary.value.maxAccelG, gValue)
    const decelAbs = Math.abs(Math.min(0, gValue))
    runningSummary.value.maxDecelGAbs = runningSummary.value.maxDecelGAbs === null
      ? decelAbs
      : Math.max(runningSummary.value.maxDecelGAbs, decelAbs)
    runningSummary.value.maxPowerKw = runningSummary.value.maxPowerKw === null
      ? powerKw
      : Math.max(runningSummary.value.maxPowerKw, powerKw)
    runningSummary.value.maxHp = runningSummary.value.maxHp === null
      ? hp
      : Math.max(runningSummary.value.maxHp, hp)
    runningSummary.value.maxTorqueNm = runningSummary.value.maxTorqueNm === null
      ? torqueNm
      : Math.max(runningSummary.value.maxTorqueNm, torqueNm)
  }
  const reached400 = maybeMarkMilestones(speed, elapsedSec)
  if (speed <= 0.5) {
    if (zeroSpeedSinceMs.value === null) zeroSpeedSinceMs.value = now
  } else {
    zeroSpeedSinceMs.value = null
  }

  const stayedZeroFor250ms = zeroSpeedSinceMs.value !== null && now - zeroSpeedSinceMs.value >= 250
  if (reached400 || stayedZeroFor250ms) {
    stopAndSaveTest()
  }
}

function buildRunObject() {
  const summary = createRunSummary(testSamples.value)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    carOrdinal: testMeta.value?.carOrdinal ?? 0,
    carName: testMeta.value?.carName ?? '未知车辆',
    samples: [...testSamples.value],
    milestones: { ...testMilestones.value },
    summary,
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
      savedRuns.value = parsed
        .filter((item) => Array.isArray(item.samples) && item.samples.length > 0)
        .map((item) => {
          const samples = normalizeRunSamples(item.samples)
          return { ...item, samples, summary: item.summary || createRunSummary(samples) }
        })
      if (savedRuns.value.length) {
        selectedHistoryRunId.value = savedRuns.value[0].id
      }
    }
  } catch (error) {
    console.error(error)
  }
}

function stopAndSaveTest() {
  if (!testRunning.value) return
  testRunning.value = false
  zeroSpeedSinceMs.value = null
  showTestEndedNotice()
  if (testSamples.value.length < 2) return
  const run = buildRunObject()
  savedRuns.value = [run, ...savedRuns.value].slice(0, 60)
  latestRun.value = run
  saveRunsToStorage()
}

function showTestEndedNotice() {
  testEndNoticeVisible.value = true
  if (testEndNoticeTimer) clearTimeout(testEndNoticeTimer)
  testEndNoticeTimer = setTimeout(() => {
    testEndNoticeVisible.value = false
  }, 750)
}

function resetCurrentTest() {
  testRunning.value = false
  zeroSpeedSinceMs.value = null
  testSamples.value = []
  runningSummary.value = createEmptySummary()
  testMilestones.value = createMilestones()
  latestRun.value = null
}

function cancelLaunchPrompt() {
  launchPromptVisible.value = false
  testAutoArmed.value = false
}

function loadRunAsPrimary(run) {
  latestRun.value = { ...run, summary: run.summary || createRunSummary(run.samples) }
  testRunning.value = false
  testSamples.value = []
  testMilestones.value = { ...run.milestones }
}

function deleteSavedRun(runId) {
  if (!runId) return
  savedRuns.value = savedRuns.value.filter((item) => item.id !== runId)
  if (selectedCompareId.value === runId) selectedCompareId.value = ''
  if (latestRun.value?.id === runId) latestRun.value = null
  if (selectedHistoryRunId.value === runId) {
    selectedHistoryRunId.value = savedRuns.value[0]?.id || ''
  }
  saveRunsToStorage()
}

function clearAllSavedRuns() {
  savedRuns.value = []
  selectedCompareId.value = ''
  selectedHistoryRunId.value = ''
  if (!testRunning.value) latestRun.value = null
  saveRunsToStorage()
}

function exportCurrentRunTxt() {
  const run = latestRun.value
  if (!run) return
  exportRunTxt(run)
}

function exportRunTxt(run) {
  if (!run) return
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `accel-test-${run.carOrdinal}-${run.timestamp}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleHistoryImportTxt(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'))
      if (!Array.isArray(parsed.samples) || parsed.samples.length < 2) return
      const samples = normalizeRunSamples(parsed.samples)
      const run = {
        id: `import-${Date.now()}`,
        timestamp: parsed.timestamp || Date.now(),
        carOrdinal: parsed.carOrdinal ?? 0,
        carName: parsed.carName || '导入数据',
        milestones: parsed.milestones || createMilestones(),
        samples,
        summary: parsed.summary || createRunSummary(samples),
      }
      savedRuns.value = [run, ...savedRuns.value].slice(0, 60)
      selectedHistoryRunId.value = run.id
      saveRunsToStorage()
    } catch (error) {
      console.error(error)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function getDisplaySamples(samples, maxPoints = 280) {
  if (!Array.isArray(samples) || samples.length <= maxPoints) return samples || []
  const result = []
  const step = (samples.length - 1) / (maxPoints - 1)
  for (let index = 0; index < maxPoints; index += 1) {
    result.push(samples[Math.round(index * step)])
  }
  return result
}

function drawYAxisTicks(context, leftX, rightX, top, height, yMin, yMax, digits = 1) {
  const tickCount = 4
  context.fillStyle = '#6b7280'
  context.font = '10px sans-serif'
  for (let index = 0; index <= tickCount; index += 1) {
    const ratio = index / tickCount
    const y = top + ratio * height
    const value = yMax - ratio * (yMax - yMin)
    const text = Number.isFinite(value) ? value.toFixed(digits) : '--'
    context.fillText(text, 6, y + 3)
    context.fillText(text, rightX + 6, y + 3)
  }
}

function drawCurveOnCanvas(context, run, color, xMax, yMin, yMax, left, top, width, height, valueKey) {
  if (!run || !Array.isArray(run.samples) || run.samples.length < 2) return
  const displaySamples = getDisplaySamples(run.samples)
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  displaySamples.forEach((sample, index) => {
    const x = left + (Math.max(0, sample.t) / xMax) * width
    const value = Number(sample[valueKey])
    if (!Number.isFinite(value)) return
    const y = top + height - ((value - yMin) / Math.max(0.0001, yMax - yMin)) * height
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
}

function drawChart({ canvas, chartKey, valueKey, yLabel, colors, minDefault, maxDefault }) {
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
  const right = 44
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
  drawYAxisTicks(context, left, left + width, top, height, yMin, yMax, valueKey === 'g' ? 2 : 1)

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

  chartMeta.value[chartKey] = {
    xMax,
    yMin,
    yMax,
    left,
    top,
    width,
    height,
    samples: getDisplaySamples(primaryRun.value?.samples || []),
    valueKey,
    yLabel,
  }
}

function drawHistoryChart({ canvas, valueKey, yLabel, colors, minDefault, maxDefault }) {
  if (!canvas) return
  const run = selectedHistoryRun.value
  if (!run || !Array.isArray(run.samples) || run.samples.length < 2) return

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
  const right = 44
  const top = 14
  const bottom = 30
  const width = rect.width - left - right
  const height = rect.height - top - bottom

  context.strokeStyle = '#d1d5db'
  context.lineWidth = 1
  context.strokeRect(left, top, width, height)

  const maxT = Math.max(...run.samples.map((sample) => Number(sample.t || 0)), 5)
  const values = run.samples.map((sample) => Number(sample[valueKey])).filter((item) => Number.isFinite(item))
  if (!values.length) return
  const xMax = Math.ceil(maxT)
  const yMax = Math.max(maxDefault, Math.max(...values))
  const yMin = Math.min(minDefault, Math.min(...values))

  drawCurveOnCanvas(context, run, colors.primary, xMax, yMin, yMax, left, top, width, height, valueKey)
  drawYAxisTicks(context, left, left + width, top, height, yMin, yMax, valueKey === 'g' ? 2 : 1)

  context.fillStyle = '#6b7280'
  context.font = '11px sans-serif'
  context.fillText('时间(s)', left + width - 48, rect.height - 8)
  context.fillText(yLabel, 4, top + 10)

  chartMeta.value[`history-${valueKey}`] = {
    xMax,
    yMin,
    yMax,
    left,
    top,
    width,
    height,
    samples: getDisplaySamples(run.samples || []),
    valueKey,
    yLabel,
  }
}

function drawAccelerationChart() {
  drawChart({
    canvas: chartCanvas.value,
    chartKey: 'speed',
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
    chartKey: 'g',
    valueKey: 'g',
    yLabel: 'G值(g)',
    colors: { primary: '#16a34a', compare: '#dc2626' },
    minDefault: -1,
    maxDefault: 1,
  })
}

function drawPowerChart() {
  drawChart({
    canvas: powerChartCanvas.value,
    chartKey: 'power',
    valueKey: 'powerKw',
    yLabel: '功率(kW)',
    colors: { primary: '#f59e0b', compare: '#dc2626' },
    minDefault: 0,
    maxDefault: 300,
  })
}

function drawTorqueChart() {
  drawChart({
    canvas: torqueChartCanvas.value,
    chartKey: 'torque',
    valueKey: 'torqueNm',
    yLabel: '扭矩(Nm)',
    colors: { primary: '#7c3aed', compare: '#dc2626' },
    minDefault: 0,
    maxDefault: 500,
  })
}

function drawHistoryAccelerationChart() {
  drawHistoryChart({
    canvas: historyChartCanvas.value,
    valueKey: 'speed',
    yLabel: '车速(km/h)',
    colors: { primary: '#2563eb' },
    minDefault: 0,
    maxDefault: 100,
  })
}

function drawHistoryGChart() {
  drawHistoryChart({
    canvas: historyGChartCanvas.value,
    valueKey: 'g',
    yLabel: 'G值(g)',
    colors: { primary: '#16a34a' },
    minDefault: -1,
    maxDefault: 1,
  })
}

function drawHistoryPowerChart() {
  drawHistoryChart({
    canvas: historyPowerChartCanvas.value,
    valueKey: 'powerKw',
    yLabel: '功率(kW)',
    colors: { primary: '#f59e0b' },
    minDefault: 0,
    maxDefault: 300,
  })
}

function drawHistoryTorqueChart() {
  drawHistoryChart({
    canvas: historyTorqueChartCanvas.value,
    valueKey: 'torqueNm',
    yLabel: '扭矩(Nm)',
    colors: { primary: '#7c3aed' },
    minDefault: 0,
    maxDefault: 500,
  })
}

function updateChartHover(chartKey, event) {
  const meta = chartMeta.value[chartKey]
  if (!meta || !Array.isArray(meta.samples) || meta.samples.length === 0) {
    chartHover.value[chartKey] = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - rect.left
  const ratio = Math.max(0, Math.min(1, (x - meta.left) / Math.max(1, meta.width)))
  const targetT = ratio * meta.xMax
  let nearest = meta.samples[0]
  let nearestDiff = Math.abs((nearest.t || 0) - targetT)
  for (const sample of meta.samples) {
    const diff = Math.abs((sample.t || 0) - targetT)
    if (diff < nearestDiff) {
      nearest = sample
      nearestDiff = diff
    }
  }
  const value = Number(nearest[meta.valueKey])
  chartHover.value[chartKey] = {
    left: `${Math.max(6, Math.min(rect.width - 120, x + 8))}px`,
    top: `${Math.max(6, event.clientY - rect.top - 28)}px`,
    text: `t=${toNumber(Number(nearest.t || 0), 2)}s  ${meta.yLabel}=${toNumber(value, meta.valueKey === 'g' ? 3 : 1)}`,
  }
}

function clearChartHover(chartKey) {
  chartHover.value[chartKey] = null
}

function exportCanvasImage(canvasRef, filenamePrefix) {
  const canvas = canvasRef?.value
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filenamePrefix}-${Date.now()}.png`
  anchor.click()
}

function exportChartImage() {
  exportCanvasImage(chartCanvas, 'accel-curve')
}

function exportGChartImage() {
  exportCanvasImage(gChartCanvas, 'g-curve')
}

function exportPowerChartImage() {
  exportCanvasImage(powerChartCanvas, 'power-curve')
}

function exportTorqueChartImage() {
  exportCanvasImage(torqueChartCanvas, 'torque-curve')
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

        if (activeView.value === 'accelTest' && !testRunning.value) {
          if (autoCondition && testAutoArmed.value && !launchPromptVisible.value) {
            launchPromptVisible.value = true
          }

          if (launchPromptVisible.value) {
            const handBrakeReleased = (payload.data.handBrake ?? 0) < 100
            const accelStillPressed = (payload.data.accel ?? 0) >= 100

            if (handBrakeReleased && accelStillPressed) {
              launchPromptVisible.value = false
              startAccelerationTest()
              testAutoArmed.value = false
            }

            if (!accelStillPressed) {
              launchPromptVisible.value = false
              testAutoArmed.value = false
            }
          }
        }

        if (!autoCondition) {
          if (!testRunning.value) launchPromptVisible.value = false
          testAutoArmed.value = true
        }

        recordAccelerationSample(payload.data)

        if (activeView.value === 'accelTest' && testRunning.value && !disableRealtimeDrawing.value) {
          const now = performance.now()
          if (now - lastAccelRenderAtMs >= 130) {
            lastAccelRenderAtMs = now
            accelRenderSerial.value += 1
          }
        }
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
    if (disableRealtimeDrawing.value && testRunning.value) return
    drawAccelerationChart()
    drawGChart()
    drawPowerChart()
    drawTorqueChart()
  }
  if (activeView.value === 'history') {
    drawHistoryAccelerationChart()
    drawHistoryGChart()
    drawHistoryPowerChart()
    drawHistoryTorqueChart()
  }
}

watch(
  () => [
    activeView.value,
    disableRealtimeDrawing.value,
    accelRenderSerial.value,
    testRunning.value,
    latestRun.value?.id,
    selectedCompareId.value,
    selectedHistoryRunId.value,
    savedRuns.value.length,
    importedRun.value?.id,
  ],
  async () => {
    if (activeView.value !== 'accelTest') {
      launchPromptVisible.value = false
      testAutoArmed.value = true
    }
    if (activeView.value === 'accelTest') {
      if (disableRealtimeDrawing.value && testRunning.value) return
      await nextTick()
      drawAccelerationChart()
      drawGChart()
      drawPowerChart()
      drawTorqueChart()
    }
    if (activeView.value === 'history') {
      if (!selectedHistoryRunId.value && savedRuns.value.length) {
        selectedHistoryRunId.value = savedRuns.value[0].id
      }
      await nextTick()
      drawHistoryAccelerationChart()
      drawHistoryGChart()
      drawHistoryPowerChart()
      drawHistoryTorqueChart()
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
  if (testEndNoticeTimer) clearTimeout(testEndNoticeTimer)
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
                <div class="pedal-fill" :style="{ '--pedal-fill': `${brakePercent}%` }"></div>
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
                <div class="handbrake-light" :class="{ off: !handBrakeEngaged }">手刹</div>
                <div class="gear-box">
                  <span>档位</span>
                  <strong>{{ dashboardGear }}</strong>
                </div>
                <div class="engine-metric-list">
                  <p class="engine-value">功率：{{ toNumber(powerKwValue, 1) }} kW</p>
                  <p class="engine-value">马力：{{ toNumber(horsepowerValue, 1) }} HP</p>
                  <p class="engine-value">扭矩：{{ toNumber(torqueNmValue, 1) }} Nm</p>
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
                <div class="pedal-fill accel" :style="{ '--pedal-fill': `${accelPercent}%` }"></div>
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

      <section v-else-if="activeView === 'accelTest'" class="accel-page" :style="accelPageStyle">
        <div class="accel-actions">
          <button class="action-btn small-btn primary" @click="startAccelerationTest" :disabled="testRunning">开始测试</button>
          <button class="action-btn small-btn" @click="stopAndSaveTest" :disabled="!testRunning">停止测试</button>
          <button class="action-btn small-btn" @click="resetCurrentTest">清空当前</button>
          <button class="action-btn small-btn" @click="exportCurrentRunTxt" :disabled="!latestRun">导出TXT原始数据</button>
          <button class="action-btn small-btn realtime-btn" :class="{ off: disableRealtimeDrawing }" @click="disableRealtimeDrawing = !disableRealtimeDrawing">
            {{ disableRealtimeDrawing ? '开启实时绘制图标' : '关闭实时绘制图标' }}
          </button>
          <p class="tips tips-small">点击开始测试或弹射起步以开始测试</p>
        </div>

        <div class="metric-grid fixed-three-rows compact-metrics">
          <div class="metric-item" v-for="item in accelMetrics" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <section class="charts-row">
          <section class="chart-card chart-panel">
            <header class="chart-title-row">
              <h3>加速曲线（时间-车速）</h3>
              <button class="action-btn small-btn" @click="exportChartImage">下载</button>
            </header>
            <div class="chart-wrap" @mousemove="updateChartHover('speed', $event)" @mouseleave="clearChartHover('speed')">
              <canvas ref="chartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover.speed" class="chart-tooltip" :style="{ left: chartHover.speed.left, top: chartHover.speed.top }">{{ chartHover.speed.text }}</div>
            </div>
          </section>

          <section class="chart-card chart-panel">
            <header class="chart-title-row">
              <h3>G值曲线（时间-Z轴G值）</h3>
              <button class="action-btn small-btn" @click="exportGChartImage">下载</button>
            </header>
            <div class="chart-wrap" @mousemove="updateChartHover('g', $event)" @mouseleave="clearChartHover('g')">
              <canvas ref="gChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover.g" class="chart-tooltip" :style="{ left: chartHover.g.left, top: chartHover.g.top }">{{ chartHover.g.text }}</div>
            </div>
          </section>
        </section>

        <section class="charts-row">
          <section class="chart-card chart-panel">
            <header class="chart-title-row">
              <h3>功率曲线（时间-kW）</h3>
              <button class="action-btn small-btn" @click="exportPowerChartImage">下载</button>
            </header>
            <div class="chart-wrap" @mousemove="updateChartHover('power', $event)" @mouseleave="clearChartHover('power')">
              <canvas ref="powerChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover.power" class="chart-tooltip" :style="{ left: chartHover.power.left, top: chartHover.power.top }">{{ chartHover.power.text }}</div>
            </div>
          </section>

          <section class="chart-card chart-panel">
            <header class="chart-title-row">
              <h3>扭矩曲线（时间-Nm）</h3>
              <button class="action-btn small-btn" @click="exportTorqueChartImage">下载</button>
            </header>
            <div class="chart-wrap" @mousemove="updateChartHover('torque', $event)" @mouseleave="clearChartHover('torque')">
              <canvas ref="torqueChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover.torque" class="chart-tooltip" :style="{ left: chartHover.torque.left, top: chartHover.torque.top }">{{ chartHover.torque.text }}</div>
            </div>
          </section>
        </section>
      </section>

      <section v-else-if="activeView === 'history'" class="accel-page">
        <section class="accel-actions">
          <label class="action-btn small-btn file-btn">
            加载TXT
            <input type="file" accept=".txt,application/json,text/plain" @change="handleHistoryImportTxt" />
          </label>
          <button class="action-btn small-btn" @click="clearAllSavedRuns" :disabled="!savedRuns.length">清空所有测试结果</button>
        </section>

        <div class="history-list" v-if="savedRuns.length">
          <button
            class="history-item history-select"
            :class="{ active: selectedHistoryRunId === run.id }"
            v-for="run in savedRuns"
            :key="run.id"
            @click="selectedHistoryRunId = run.id"
          >
            <div>
              <strong>{{ run.carName }}</strong>
              <p>{{ new Date(run.timestamp).toLocaleString('zh-CN') }}</p>
              <p>最大功率 {{ toNumber(ensureRunSummary(run).maxPowerKw, 1) }} kW · 最大扭矩 {{ toNumber(ensureRunSummary(run).maxTorqueNm, 1) }} Nm</p>
            </div>
            <div class="history-actions">
              <span class="action-btn small-btn pseudo" @click.stop="exportRunTxt(run)">导出原始数据TXT</span>
              <span class="action-btn small-btn pseudo" @click.stop="deleteSavedRun(run.id)">删除</span>
            </div>
          </button>
        </div>
        <p v-else class="tips">暂无测试记录，开始一次测试后会自动保存到本地。</p>

        <section v-if="selectedHistoryRun" class="charts-row">
          <section class="chart-card chart-panel">
            <header class="chart-title-row"><h3>历史加速曲线（时间-车速）</h3></header>
            <div class="chart-wrap" @mousemove="updateChartHover('history-speed', $event)" @mouseleave="clearChartHover('history-speed')">
              <canvas ref="historyChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover['history-speed']" class="chart-tooltip" :style="{ left: chartHover['history-speed'].left, top: chartHover['history-speed'].top }">{{ chartHover['history-speed'].text }}</div>
            </div>
          </section>

          <section class="chart-card chart-panel">
            <header class="chart-title-row"><h3>历史G值曲线（时间-Z轴G值）</h3></header>
            <div class="chart-wrap" @mousemove="updateChartHover('history-g', $event)" @mouseleave="clearChartHover('history-g')">
              <canvas ref="historyGChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover['history-g']" class="chart-tooltip" :style="{ left: chartHover['history-g'].left, top: chartHover['history-g'].top }">{{ chartHover['history-g'].text }}</div>
            </div>
          </section>
        </section>

        <section v-if="selectedHistoryRun" class="charts-row">
          <section class="chart-card chart-panel">
            <header class="chart-title-row"><h3>历史功率曲线（时间-kW）</h3></header>
            <div class="chart-wrap" @mousemove="updateChartHover('history-powerKw', $event)" @mouseleave="clearChartHover('history-powerKw')">
              <canvas ref="historyPowerChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover['history-powerKw']" class="chart-tooltip" :style="{ left: chartHover['history-powerKw'].left, top: chartHover['history-powerKw'].top }">{{ chartHover['history-powerKw'].text }}</div>
            </div>
          </section>

          <section class="chart-card chart-panel">
            <header class="chart-title-row"><h3>历史扭矩曲线（时间-Nm）</h3></header>
            <div class="chart-wrap" @mousemove="updateChartHover('history-torqueNm', $event)" @mouseleave="clearChartHover('history-torqueNm')">
              <canvas ref="historyTorqueChartCanvas" class="chart-canvas"></canvas>
              <div v-if="chartHover['history-torqueNm']" class="chart-tooltip" :style="{ left: chartHover['history-torqueNm'].left, top: chartHover['history-torqueNm'].top }">{{ chartHover['history-torqueNm'].text }}</div>
            </div>
          </section>
        </section>
      </section>
    </section>

    <div v-if="isGamePaused" class="modal-mask">
      <div class="modal-card">
        <h3>游戏已暂停</h3>
      </div>
    </div>

    <div v-if="launchPromptVisible && activeView === 'accelTest' && !isGamePaused" class="modal-mask">
      <div class="modal-card">
        <h2>已检测到弹射起步</h2>
        <h3>松开手刹以开始测试</h3>
        <h3>松开油门以取消测试</h3>
        <div class="modal-actions">
          <button class="action-btn" @click="cancelLaunchPrompt">取消</button>
        </div>
      </div>
    </div>

    <div v-if="testEndNoticeVisible" class="modal-mask">
      <div class="modal-card">
        <h3>已结束测试</h3>
      </div>
    </div>
  </main>
</template>
