const DRIVE_TYPE = {
  0: '前驱',
  1: '后驱',
  2: '四驱',
}

class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    this.offset = 0
  }

  read(size, getter) {
    if (this.offset + size > this.view.byteLength) return null
    const value = getter.call(this.view, this.offset, true)
    this.offset += size
    return value
  }

  int32() {
    return this.read(4, this.view.getInt32)
  }

  uint32() {
    return this.read(4, this.view.getUint32)
  }

  uint16() {
    return this.read(2, this.view.getUint16)
  }

  uint8() {
    return this.read(1, this.view.getUint8)
  }

  int8() {
    return this.read(1, this.view.getInt8)
  }

  float32() {
    return this.read(4, this.view.getFloat32)
  }
}

function toPercent(value) {
  if (value === null || value === undefined) return null
  return Math.round((value / 255) * 100)
}

function toGearDisplay(gear) {
  if (gear === null || gear === undefined) return '--'
  if (gear === 0) return 'R'
  if (gear === 1) return 'N'
  return `${gear - 1}`
}

export function parseForzaTelemetry(buffer) {
  const r = new Reader(buffer)

  const data = {
    isRaceOn: r.int32(),
    timestampMs: r.uint32(),

    engineMaxRpm: r.float32(),
    engineIdleRpm: r.float32(),
    currentEngineRpm: r.float32(),

    accelerationX: r.float32(),
    accelerationY: r.float32(),
    accelerationZ: r.float32(),

    velocityX: r.float32(),
    velocityY: r.float32(),
    velocityZ: r.float32(),

    angularVelocityX: r.float32(),
    angularVelocityY: r.float32(),
    angularVelocityZ: r.float32(),

    yaw: r.float32(),
    pitch: r.float32(),
    roll: r.float32(),

    normalizedSuspensionTravelFrontLeft: r.float32(),
    normalizedSuspensionTravelFrontRight: r.float32(),
    normalizedSuspensionTravelRearLeft: r.float32(),
    normalizedSuspensionTravelRearRight: r.float32(),

    tireSlipRatioFrontLeft: r.float32(),
    tireSlipRatioFrontRight: r.float32(),
    tireSlipRatioRearLeft: r.float32(),
    tireSlipRatioRearRight: r.float32(),

    wheelRotationSpeedFrontLeft: r.float32(),
    wheelRotationSpeedFrontRight: r.float32(),
    wheelRotationSpeedRearLeft: r.float32(),
    wheelRotationSpeedRearRight: r.float32(),

    wheelOnRumbleStripFrontLeft: r.int32(),
    wheelOnRumbleStripFrontRight: r.int32(),
    wheelOnRumbleStripRearLeft: r.int32(),
    wheelOnRumbleStripRearRight: r.int32(),

    wheelInPuddleDepthFrontLeft: r.float32(),
    wheelInPuddleDepthFrontRight: r.float32(),
    wheelInPuddleDepthRearLeft: r.float32(),
    wheelInPuddleDepthRearRight: r.float32(),

    surfaceRumbleFrontLeft: r.float32(),
    surfaceRumbleFrontRight: r.float32(),
    surfaceRumbleRearLeft: r.float32(),
    surfaceRumbleRearRight: r.float32(),

    tireSlipAngleFrontLeft: r.float32(),
    tireSlipAngleFrontRight: r.float32(),
    tireSlipAngleRearLeft: r.float32(),
    tireSlipAngleRearRight: r.float32(),

    tireCombinedSlipFrontLeft: r.float32(),
    tireCombinedSlipFrontRight: r.float32(),
    tireCombinedSlipRearLeft: r.float32(),
    tireCombinedSlipRearRight: r.float32(),

    suspensionTravelMetersFrontLeft: r.float32(),
    suspensionTravelMetersFrontRight: r.float32(),
    suspensionTravelMetersRearLeft: r.float32(),
    suspensionTravelMetersRearRight: r.float32(),

    carOrdinal: r.int32(),
    carClass: r.int32(),
    carPerformanceIndex: r.int32(),
    drivetrainTypeRaw: r.int32(),
    numCylinders: r.int32(),

    positionX: r.float32(),
    positionY: r.float32(),
    positionZ: r.float32(),

    speed: r.float32(),
    power: r.float32(),
    torque: r.float32(),

    tireTempFrontLeft: r.float32(),
    tireTempFrontRight: r.float32(),
    tireTempRearLeft: r.float32(),
    tireTempRearRight: r.float32(),

    boost: r.float32(),
    fuel: r.float32(),
    distanceTraveled: r.float32(),
    bestLap: r.float32(),
    lastLap: r.float32(),
    currentLap: r.float32(),
    currentRaceTime: r.float32(),

    lapNumber: r.uint16(),
    racePosition: r.uint8(),
    accelRaw: r.uint8(),
    brakeRaw: r.uint8(),
    clutchRaw: r.uint8(),
    handBrakeRaw: r.uint8(),
    gearRaw: r.uint8(),
    steerRaw: r.int8(),
    normalizedDrivingLine: r.uint8(),
    normalizedAiBrakeDifference: r.int8(),
  }

  const speed = data.speed ?? 0
  const speedKmh = speed * 3.6

  return {
    ...data,
    speedKmh,
    accel: toPercent(data.accelRaw),
    brake: toPercent(data.brakeRaw),
    clutch: toPercent(data.clutchRaw),
    handBrake: toPercent(data.handBrakeRaw),
    steerPercent: toPercent((data.steerRaw ?? 0) + 128) - 50,
    drivetrainType: DRIVE_TYPE[data.drivetrainTypeRaw] ?? `${data.drivetrainTypeRaw ?? '--'}`,
    gearDisplay: toGearDisplay(data.gearRaw),
    packetSize: buffer.length,
  }
}
