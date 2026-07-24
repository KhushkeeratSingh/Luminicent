import Docker from 'dockerode'
import fs from 'fs'
import path from 'path'
import tar from "tar-fs";

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
      const room = this.io.sockets.adapter.rooms.get(sessionId)
      if (room && room.size > 0) {
        this.io.to(sessionId).emit(event, payload)
      } else {
        this.io.emit(event, payload)
      }
    } else {
      this.io.emit(event, payload)
    }
  }

  emitStatus(sessionId, data = {}) {
    const payload = {
      sessionId,
      timestamp: Date.now(),
      type: data.type || 'info',
      stage: data.stage || 'info',
      percent: data.percent,
      status: data.status,
      message: data.message,
      error: data.error
    }

    if (sessionId) {
      this.io.to(sessionId).emit('status', payload)
    } else {
      this.io.emit('status', payload)
    }
  }

  emitTerminalOutput(sessionId, type, message) {
    const normalizedMessage = typeof message === 'string'
      ? message
      : message?.message || message?.data || JSON.stringify(message || '')

    if (!normalizedMessage) return

    const payload = {
      sessionId,
      type,
      message: normalizedMessage,
      timestamp: Date.now()
    }

    this.emit(sessionId, 'terminal_output', payload)

    if (type === 'build') {
      this.emit(sessionId, 'build_log', {
        sessionId,
        data: normalizedMessage
      })
    }

    if (type === 'runtime') {
      this.emit(sessionId, 'runtime_log', {
        sessionId,
        data: normalizedMessage
      })
    }

    this.updateSession(sessionId, {
      logs: [{ type, message: normalizedMessage, timestamp: Date.now() }]
    })
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
      status: 'STARTING_BUILD',
      buildStart: Date.now()
    })
    this.emitStatus(sessionId, {
      status: 'STARTING_BUILD',
      stage: 'build',
      type: 'info',
      percent: 10,
      message: `Building image: ${imageName}`
    });
    console.log("Checking Docker connection...");
    const version = await docker.version();
    console.log("Docker Version:", version.Version);

    // Validate build context exists
    if (!buildContext || !fs.existsSync(buildContext)) {
      const errMsg = `Build context not found: ${buildContext}`
      this.emitStatus(sessionId, {
        status: 'BUILD_FAILED',
        stage: 'build',
        type: 'error',
        error: errMsg,
        message: errMsg
      })
      throw new Error(errMsg)
    }

    if (!dockerfilePath || !fs.existsSync(dockerfilePath)) {
      const errMsg = `Dockerfile not found in build context: ${dockerfilePath}`
      this.emitStatus(sessionId, {
        status: 'BUILD_FAILED',
        stage: 'build',
        type: 'error',
        error: errMsg,
        message: errMsg
      })
      throw new Error(errMsg)
    }

    // Check Docker daemon availability
    try {
      await new Promise((resolve, reject) => docker.ping((err) => err ? reject(err) : resolve()))
    } catch (err) {
      const errMsg = `Docker daemon not available: ${err.message || err}`
      this.emitStatus(sessionId, {
        status: 'BUILD_FAILED',
        stage: 'build',
        type: 'error',
        error: errMsg,
        message: errMsg
      })
      throw new Error(errMsg)
    }

    const dockerfileRelative = path.relative(buildContext, dockerfilePath).replace(/\\/g, '/')
    const tarStream = tar.pack(buildContext);
    const stream = await docker.buildImage(
      tarStream,
      {
        t: imageName,
        dockerfile: dockerfileRelative
      }
    );

    let builtImageId = null;

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
        async (err) => {
          clearTimeout(timeout)
          if (err) {
            this.emitStatus(sessionId, {
              status: 'BUILD_FAILED',
              stage: 'build',
              type: 'error',
              error: err.message,
              message: 'Docker build failed'
            })
            reject(err)
            return
          }

          this.updateSession(sessionId, {
            status: 'BUILD_IMAGE',
            buildEnd: Date.now()
          })
          this.emitStatus(sessionId, {
            status: 'BUILD_IMAGE',
            stage: 'build',
            type: 'success',
            percent: 50,
            message: 'Docker image built successfully'
          })

          try {
            let image = docker.getImage(imageName)
            let inspect = null
            try {
              inspect = await image.inspect()
            } catch (inspectErr) {
              if (builtImageId) {
                image = docker.getImage(builtImageId)
                inspect = await image.inspect()
                await image.tag({ repo: imageName, tag: 'latest' })
              } else {
                throw inspectErr
              }
            }

            console.log('✅ Image created successfully')
            console.log('Image ID:', inspect.Id)
            resolve(imageName)
          } catch (finalErr) {
            console.error('❌ Image was NOT created!')
            console.error(finalErr)
            reject(finalErr)
          }
        },
        (event) => {
          if (!event) return

          if (event.aux && event.aux.ID) {
            builtImageId = event.aux.ID
          }

          let message = ''
          if (event.stream) {
            message = event.stream.toString().trim()
          } else if (event.status) {
            message = event.status.toString()
          } else {
            message = JSON.stringify(event)
          }

          if (message) {
            console.log('[BUILD]', message)
            this.emitTerminalOutput(sessionId, 'build', message)
          }
        }
      )
    })
  }

  async runContainer(imageName, sessionId) {
    console.log('runContainer image:', imageName);
    try {
      let imageRef = imageName
      try {
        const image = docker.getImage(imageName)
        await image.inspect()
      } catch (imgErr) {
        console.warn(`Image ${imageName} not found by tag, trying by image ID fallback.`)
        if (imgErr.json && imgErr.json.message && imgErr.json.message.includes('No such image')) {
          imageRef = null
        }
      }

      this.updateSession(sessionId, {
        status: 'RUN_CONTAINER',
        containerStart: Date.now()
      })
      this.emitStatus(sessionId, {
        status: 'RUN_CONTAINER',
        stage: 'container',
        type: 'info',
        percent: 60,
        message: 'Starting container...'
      })
      console.log('Creating container...');

      const createOptions = {
        Image: imageRef || imageName,
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
      }

      const container = await docker.createContainer(createOptions)

      this.containers.set(sessionId, container.id)
      this.updateSession(sessionId, {
        containerId: container.id,
        status: 'CONTAINER_STARTING'
      })

      console.log("Container created:", container.id);

      console.log("Starting container...");
      await container.start();

      console.log("Container started successfully!");

      const inspect = await container.inspect();

      console.log("Container State:");
      console.log(inspect.State);

      if (!inspect.State.Running) {
          console.log("Container exited immediately!");

          const logs = await container.logs({
            stdout: true,
            stderr: true
          });

          console.log(logs.toString());
      }
      this.emitStatus(sessionId, {
        status: 'CONTAINER_RUNNING',
        stage: 'container',
        type: 'success',
        percent: 75,
        message: `Container started: ${container.id.substring(0, 12)}`
      })
      this.updateSession(sessionId, {
        status: 'CONTAINER_RUNNING'
      })

      this.monitorContainerStats(container, sessionId)
      return container
    } catch (error) {
      this.emitStatus(sessionId, {
        status: 'ERROR',
        stage: 'container',
        type: 'error',
        error: error.message,
        message: error.message
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
      this.emitStatus(sessionId, {
        status: 'RUNTIME_LOG',
        stage: 'container',
        type: 'info',
        percent: 80,
        message: 'Streaming container logs...'
      })
      this.updateSession(sessionId, {
        status: 'RUNTIME_LOG'
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
          this.emitTerminalOutput(sessionId, 'runtime', message)
        }
      })

      stream.on('error', (error) => {
        this.emitStatus(sessionId, {
          status: 'ERROR',
          stage: 'container',
          type: 'error',
          error: error.message,
          message: 'Error streaming container logs'
        })
      })

      stream.on('end', () => {
        this.emitStatus(sessionId, {
          status: 'FINISHED',
          stage: 'container',
          type: 'success',
          percent: 100,
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
