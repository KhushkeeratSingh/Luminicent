import Docker from 'dockerode'
import fs from 'fs'
import path from 'path'

const docker = new Docker()

class DockerOrchestrator {
  constructor(io) {
    this.io = io
    this.containers = new Map()
    this.sessions = new Map()
    this.statsStreams = new Map()
  }

  emit(sessionId, event, payload) {
    if (sessionId) {
      this.io.to(sessionId).emit(event, payload)
    } else {
      this.io.emit(event, payload)
    }
  }

  createSession(sessionId, initial = {}) {
    const record = {
      sessionId,
      status: 'IDLE',
      startedAt: Date.now(),
      logs: [],
      metrics: {},
      ...initial
    }
    this.sessions.set(sessionId, record)
    return record
  }

  updateSession(sessionId, patch) {
    const session = this.sessions.get(sessionId) || this.createSession(sessionId)
    const updated = {
      ...session,
      ...patch,
      updatedAt: Date.now()
    }
    if (patch.logs) {
      updated.logs = [...(session.logs || []), ...patch.logs]
    }
    this.sessions.set(sessionId, updated)
    return updated
  }

  getSessionInfo(sessionId) {
    return this.sessions.get(sessionId) || null
  }

  getDeploymentHistory() {
    return Array.from(this.sessions.values()).sort((a, b) => b.startedAt - a.startedAt)
  }

  async buildImage(buildContext, imageName, sessionId, dockerfilePath) {
    const timeoutMs = 5 * 60 * 1000
    this.updateSession(sessionId, {
      imageName,
      status: 'BUILD_IMAGE',
      buildStart: Date.now()
    })
    this.emit(sessionId, 'status', {
      sessionId,
      status: 'BUILD_IMAGE',
      message: `Building image: ${imageName}`
    })

    // Validate build context exists
    if (!buildContext || !fs.existsSync(buildContext)) {
      const errMsg = `Build context not found: ${buildContext}`
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'BUILD_FAILED',
        error: errMsg
      })
      throw new Error(errMsg)
    }

    if (!dockerfilePath || !fs.existsSync(dockerfilePath)) {
      const errMsg = `Dockerfile not found in build context: ${dockerfilePath}`
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'BUILD_FAILED',
        error: errMsg
      })
      throw new Error(errMsg)
    }

    // Check Docker daemon availability
    try {
      await new Promise((resolve, reject) => docker.ping((err) => err ? reject(err) : resolve()))
    } catch (err) {
      const errMsg = `Docker daemon not available: ${err.message || err}`
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'BUILD_FAILED',
        error: errMsg
      })
      throw new Error(errMsg)
    }

    const dockerfileRelative = path.relative(buildContext, dockerfilePath)
    const stream = await docker.buildImage(
      { context: buildContext, src: ['.'] },
      { t: imageName, dockerfile: dockerfileRelative }
    )

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Docker build timed out after 5 minutes')
        this.emit(sessionId, 'status', {
          sessionId,
          status: 'BUILD_FAILED',
          error: error.message
        })
        reject(error)
      }, timeoutMs)

      docker.modem.followProgress(
        stream,
        (err) => {
          clearTimeout(timeout)
          if (err) {
            this.emit(sessionId, 'status', {
              sessionId,
              status: 'BUILD_FAILED',
              error: err.message
            })
            reject(err)
          } else {
            this.updateSession(sessionId, {
              status: 'BUILD_SUCCESS',
              buildEnd: Date.now()
            })
            this.emit(sessionId, 'status', {
              sessionId,
              status: 'BUILD_SUCCESS',
              message: 'Image built successfully'
            })
            resolve(imageName)
          }
        },
        (event) => {
          if (!event) return
          let message = ''
          if (event.stream) {
            message = event.stream.toString().trim()
          } else if (event.status) {
            message = event.status.toString()
          } else {
            message = JSON.stringify(event)
          }
          if (message) {
            this.emit(sessionId, 'BUILD_LOG', {
              sessionId,
              data: message
            })
            this.updateSession(sessionId, {
              logs: [{ type: 'build', message, timestamp: Date.now() }]
            })
          }
        }
      )
    })
  }

  async runContainer(imageName, sessionId) {
    try {
      this.updateSession(sessionId, {
        status: 'START_CONTAINER',
        containerStart: Date.now()
      })
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'START_CONTAINER',
        message: 'Starting container...'
      })

      const container = await docker.createContainer({
        Image: imageName,
        Hostname: 'devops-simulator',
        Tty: true,
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: false,
        HostConfig: {
          Memory: 512 * 1024 * 1024,
          CpuShares: 512,
          AutoRemove: false,
          NetworkMode: 'bridge'
        }
      })

      this.containers.set(sessionId, container.id)
      this.updateSession(sessionId, {
        containerId: container.id,
        status: 'CONTAINER_STARTING'
      })

      await container.start()
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'CONTAINER_RUNNING',
        message: `Container started: ${container.id.substring(0, 12)}`
      })
      this.updateSession(sessionId, {
        status: 'CONTAINER_RUNNING'
      })

      this.monitorContainerStats(container, sessionId)
      return container
    } catch (error) {
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'ERROR',
        error: error.message
      })
      this.updateSession(sessionId, {
        status: 'ERROR',
        error: error.message
      })
      throw error
    }
  }

  async streamLogs(container, sessionId) {
    try {
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'STREAM_LOGS',
        message: 'Streaming container logs...'
      })
      this.updateSession(sessionId, {
        status: 'STREAM_LOGS'
      })

      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 100
      })

      stream.on('data', (chunk) => {
        const message = chunk.toString('utf-8')
        if (message.trim()) {
          this.emit(sessionId, 'RUNTIME_LOG', {
            sessionId,
            data: message
          })
          this.updateSession(sessionId, {
            logs: [{ type: 'runtime', message, timestamp: Date.now() }]
          })
        }
      })

      stream.on('error', (error) => {
        this.emit(sessionId, 'status', {
          sessionId,
          status: 'ERROR',
          error: error.message
        })
      })

      stream.on('end', () => {
        this.emit(sessionId, 'status', {
          sessionId,
          status: 'STREAM_ENDED',
          message: 'Log stream ended.'
        })
      })

      return stream
    } catch (error) {
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'ERROR',
        error: error.message
      })
      throw error
    }
  }

  async monitorContainerStats(container, sessionId) {
    try {
      const statsStream = await container.stats({ stream: true })
      this.statsStreams.set(sessionId, statsStream)
      let buffer = ''
      let lastCpu = 0
      let lastSystem = 0

      statsStream.on('data', (chunk) => {
        buffer += chunk.toString('utf-8')
        const parts = buffer.split(/\r?\n/)
        buffer = parts.pop() || ''

        for (const part of parts) {
          if (!part.trim()) continue
          try {
            const stats = JSON.parse(part)
            const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - lastCpu
            const systemDelta = stats.cpu_stats.system_cpu_usage - lastSystem
            const onlineCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1
            const cpuUsage = systemDelta > 0 ? Number(((cpuDelta / systemDelta) * onlineCpus * 100).toFixed(2)) : 0
            lastCpu = stats.cpu_stats.cpu_usage.total_usage || lastCpu
            lastSystem = stats.cpu_stats.system_cpu_usage || lastSystem
            const memoryUsage = stats.memory_stats.usage || 0
            const memoryLimit = stats.memory_stats.limit || 0
            const memoryPercent = memoryLimit ? Number(((memoryUsage / memoryLimit) * 100).toFixed(2)) : 0
            const networkRx = Object.values(stats.networks || {}).reduce((sum, net) => sum + (net.rx_bytes || 0), 0)
            const networkTx = Object.values(stats.networks || {}).reduce((sum, net) => sum + (net.tx_bytes || 0), 0)

            const metrics = {
              cpuUsage,
              memoryUsage,
              memoryLimit,
              memoryPercent,
              networkRx,
              networkTx
            }

            this.emit(sessionId, 'CONTAINER_METRICS', {
              sessionId,
              metrics
            })
            this.emit(sessionId, 'docker_stats', {
              sessionId,
              metrics
            })
            this.updateSession(sessionId, { metrics })
          } catch (err) {
            // ignore partial JSON chunks
          }
        }
      })

      statsStream.on('end', () => {
        this.statsStreams.delete(sessionId)
      })

      statsStream.on('error', () => {
        this.statsStreams.delete(sessionId)
      })
    } catch (error) {
      console.warn('Unable to monitor container stats:', error.message)
    }
  }

  async cleanup(sessionId) {
    try {
      const containerId = this.containers.get(sessionId)
      if (!containerId) {
        this.updateSession(sessionId, { status: 'CLEANUP', message: 'No active container to remove' })
        return
      }

      const container = docker.getContainer(containerId)
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'CLEANUP',
        message: 'Cleaning up container...'
      })

      try {
        await container.stop()
      } catch (e) {
        // ignore
      }

      try {
        await container.remove()
      } catch (e) {
        // ignore
      }

      const session = this.sessions.get(sessionId)
      const imageName = session?.imageName
      this.containers.delete(sessionId)
      this.statsStreams.get(sessionId)?.destroy()
      this.statsStreams.delete(sessionId)

      if (imageName) {
        try {
          await docker.getImage(imageName).remove({ force: true })
        } catch (removeErr) {
          console.warn(`Unable to remove image ${imageName}:`, removeErr.message)
        }
      }

      this.updateSession(sessionId, {
        status: 'FINISHED',
        endedAt: Date.now(),
        durationMs: Date.now() - (this.sessions.get(sessionId)?.startedAt || Date.now())
      })

      this.emit(sessionId, 'status', {
        sessionId,
        status: 'FINISHED',
        message: 'Simulation completed and cleaned up'
      })
    } catch (error) {
      this.emit(sessionId, 'status', {
        sessionId,
        status: 'CLEANUP_ERROR',
        error: error.message
      })
      this.updateSession(sessionId, {
        status: 'CLEANUP_ERROR',
        error: error.message
      })
    }
  }
}

export default DockerOrchestrator;
