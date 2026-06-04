import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import axios from 'axios'
import './GithubSuccess.css'

const BACKEND_URL = 'http://localhost:5000'
const HISTORY_STORAGE_KEY = 'devops_deployment_history'

const PIPELINE_STAGES = [
  { id: 'CONNECTED', label: 'Connected' },
  { id: 'FETCH_REPO', label: 'Fetch Repo' },
  { id: 'DOWNLOAD', label: 'Download' },
  { id: 'EXTRACT', label: 'Extract' },
  { id: 'BUILD_IMAGE', label: 'Build Image' },
  { id: 'START_CONTAINER', label: 'Start Container' },
  { id: 'STREAM_LOGS', label: 'Stream Logs' },
  { id: 'RUNNING', label: 'Running' },
  { id: 'FINISHED', label: 'Finished' },
  { id: 'ERROR', label: 'Error' }
]

const mapStatusToStage = {
  IDLE: 'CONNECTED',
  DOWNLOADING: 'DOWNLOAD',
  DOWNLOAD: 'DOWNLOAD',
  EXTRACTING: 'EXTRACT',
  EXTRACTED: 'BUILD_IMAGE',
  BUILD_IMAGE: 'BUILD_IMAGE',
  BUILD_SUCCESS: 'BUILD_IMAGE',
  BUILD_LOG: 'BUILD_IMAGE',
  BUILD_FAILED: 'ERROR',
  START_CONTAINER: 'START_CONTAINER',
  CONTAINER_STARTING: 'START_CONTAINER',
  CONTAINER_RUNNING: 'RUNNING',
  STREAM_LOGS: 'STREAM_LOGS',
  RUNTIME_LOG: 'STREAM_LOGS',
  RUNNING: 'RUNNING',
  STREAM_ENDED: 'FINISHED',
  FINISHED: 'FINISHED',
  CLEANUP: 'FINISHED',
  ERROR: 'ERROR',
  LOG_STREAM_ERROR: 'ERROR',
  CONTAINER_FAILED: 'ERROR'
}

const getStageState = (stageId, currentStage) => {
  const stageIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === stageId)
  const currentIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === currentStage)
  if (currentIndex < 0) return 'pending'
  if (stageIndex < currentIndex) return 'complete'
  if (stageIndex === currentIndex) return 'active'
  return 'pending'
}

export default function GithubSuccess() {
  const [token, setToken] = useState('')
  const [repos, setRepos] = useState([])
  const [selectedRepo, setSelectedRepo] = useState(null)
  const [branches, setBranches] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [loadingRepos, setLoadingRepos] = useState(true)
  const [fetchingBranches, setFetchingBranches] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [liveState, setLiveState] = useState('IDLE')
  const [statusMessage, setStatusMessage] = useState('Ready to deploy')
  const [logsBySession, setLogsBySession] = useState({})
  const [history, setHistory] = useState([])
  const [metricsBySession, setMetricsBySession] = useState({})
  const [filterText, setFilterText] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated')
  const [selectedDeployment, setSelectedDeployment] = useState(null)
  const socketRef = useRef(null)
  const terminalRef = useRef(null)
  const selectedDeploymentRef = useRef(null)
  const historyRef = useRef([])
  const toastTimeoutRef = useRef(null)

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    selectedDeploymentRef.current = selectedDeployment
  }, [selectedDeployment])

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
    window.clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('github_token')
    const localToken = localStorage.getItem('github_token')
    const activeToken = urlToken || localToken

    if (urlToken) {
      localStorage.setItem('github_token', urlToken)
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    if (activeToken) {
      setToken(activeToken)
      showToast('GitHub connected successfully', 'success')
    } else {
      setError('GitHub token is missing. Please sign in with GitHub again.')
      setLoadingRepos(false)
    }

    const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (storedHistory) {
      try {
        setHistory(JSON.parse(storedHistory))
      } catch (err) {
        console.warn('Unable to parse deployment history', err)
      }
    }
  }, [showToast])

  useEffect(() => {
    if (!token) return
    fetchRepositories()
  }, [token])

  const appendHistoryPreview = useCallback((sessionId, message) => {
    setHistory((current) =>
      current.map((item) =>
        item.sessionId === sessionId
          ? { ...item, logsPreview: [...(item.logsPreview || []), message].slice(-4) }
          : item
      )
    )
  }, [])

  const handleSessionStatus = useCallback((sessionId, data) => {
    if (!sessionId) return
    const stage = mapStatusToStage[data.status] || 'CONNECTED'
    const statusText = data.message || data.status

    setHistory((current) => {
      const existing = current.find((item) => item.sessionId === sessionId)
      if (existing) {
        return current.map((item) =>
          item.sessionId === sessionId
            ? { ...item, status: data.status, stage, statusText, active: data.status !== 'FINISHED' && data.status !== 'ERROR' && data.status !== 'STREAM_ENDED', updatedAt: Date.now(), lastMessage: statusText }
            : item
        )
      }
      return [
        {
          sessionId,
          status: data.status,
          stage,
          statusText,
          active: data.status !== 'FINISHED' && data.status !== 'ERROR' && data.status !== 'STREAM_ENDED',
          updatedAt: Date.now(),
          lastMessage: statusText
        },
        ...current
      ]
    })

    if (selectedDeploymentRef.current === sessionId) {
      setLiveState(data.status)
      setStatusMessage(statusText)
    }

    if (data.status === 'ERROR') showToast(`Deployment failed: ${data.error || data.message}`, 'error')
    if (data.status === 'FINISHED') showToast('Deployment finished successfully', 'success')
  }, [showToast])

  const handleSessionLog = useCallback((sessionId, type, message) => {
    if (!sessionId) return

    setLogsBySession((current) => {
      const existing = current[sessionId] || []
      return {
        ...current,
        [sessionId]: [...existing, { type, message, timestamp: Date.now() }].slice(-500)
      }
    })
    appendHistoryPreview(sessionId, message)
  }, [appendHistoryPreview])

  useEffect(() => {
    if (socketRef.current) return
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    })

    socket.on('connect', () => {
      showToast('Connected to live deployment stream', 'success')
      historyRef.current.forEach((deployment) => {
        if (deployment.active) {
          socket.emit('joinSession', { sessionId: deployment.sessionId })
        }
      })
    })

    socket.on('status', (data) => {
      handleSessionStatus(data.sessionId, data)
    })

    socket.on('BUILD_LOG', (data) => {
      handleSessionLog(data.sessionId, 'build', data.data || data)
    })

    socket.on('RUNTIME_LOG', (data) => {
      handleSessionLog(data.sessionId, 'runtime', data.data || data)
    })

    socket.on('docker_stats', (data) => {
      if (!data?.sessionId) return
      setMetricsBySession((prev) => ({
        ...prev,
        [data.sessionId]: data.metrics
      }))
    })

    socket.on('CONTAINER_METRICS', (data) => {
      if (!data?.sessionId) return
      setMetricsBySession((prev) => ({
        ...prev,
        [data.sessionId]: data.metrics
      }))
    })

    socket.on('connect_error', (err) => {
      console.warn('Socket connect error', err)
      showToast('Socket connection failed. Logs may resume after reconnect.', 'error')
    })

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        showToast('Live stream disconnected. Trying to reconnect...', 'warning')
      }
    })

    socketRef.current = socket

    return () => {
      socket.off()
      socket.disconnect()
      socketRef.current = null
      window.clearTimeout(toastTimeoutRef.current)
    }
  }, [handleSessionLog, handleSessionStatus, showToast])

  useEffect(() => {
    if (!socketRef.current) return
    history.forEach((deployment) => {
      if (deployment.active) {
        socketRef.current.emit('joinSession', { sessionId: deployment.sessionId })
      }
    })
  }, [history])

  useEffect(() => {
    persistHistory(history)
  }, [history])

  useEffect(() => {
    if (!terminalRef.current) return
    const terminal = terminalRef.current
    terminal.scrollTop = terminal.scrollHeight
  }, [logsBySession, selectedDeployment])

  const persistHistory = (items) => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items))
  }

  const updateHistoryItem = (sessionId, patch) => {
    setHistory((current) => {
      const existing = current.find((item) => item.sessionId === sessionId)
      if (existing) {
        return current.map((item) => (item.sessionId === sessionId ? { ...item, ...patch } : item))
      }
      return [...current, { sessionId, ...patch }]
    })
  }

  const fetchRepositories = async () => {
    setError('')
    setLoadingRepos(true)
    try {
      const response = await axios.get(`${BACKEND_URL}/api/github/repos`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      setRepos(response.data || [])
      setStatusMessage('Repositories loaded')
    } catch (err) {
      console.error(err)
      setError('Unable to load GitHub repositories. Check your token or backend connection.')
      showToast('Unable to load repositories. Verify your GitHub token.', 'error')
    } finally {
      setLoadingRepos(false)
    }
  }

  const handleSelectRepo = async (repo) => {
    setSelectedRepo(repo)
    setBranches([])
    setSelectedBranch('')
    setFetchingBranches(true)
    setStatusMessage(`Fetching branches for ${repo.name}...`)
    try {
      const response = await axios.get(`${BACKEND_URL}/api/github/branches`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          owner: repo.owner.login,
          repo: repo.name
        }
      })
      const branchList = response.data || []
      setBranches(branchList)
      const defaultBranch = repo.default_branch || branchList[0]?.name || 'main'
      setSelectedBranch(defaultBranch)
      setStatusMessage(`Branches available for ${repo.name}`)
      showToast(`Branches loaded for ${repo.name}`, 'success')
    } catch (err) {
      console.error(err)
      setError('Could not load branches for this repository.')
      setStatusMessage('Branch fetch failed')
      showToast('Branch fetch failed. Check repository permissions.', 'error')
    } finally {
      setFetchingBranches(false)
    }
  }

  const handleDeploy = async () => {
    if (!selectedRepo || !selectedBranch) {
      setError('Select a repository and branch before deploying.')
      showToast('Select a repository and branch before deploying.', 'warning')
      return
    }

    setDeploying(true)
    setError('')
    const deploymentId = `gh-${Date.now()}`
    setSessionId(deploymentId)
    setLiveState('DOWNLOADING')
    setStatusMessage('Submitting deployment...')
    setLogsBySession((prev) => ({ ...prev, [deploymentId]: [] }))
    setHistory((current) => [
      {
        sessionId: deploymentId,
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        branch: selectedBranch,
        status: 'DOWNLOADING',
        stage: 'DOWNLOAD',
        createdAt: Date.now(),
        active: true,
        logsPreview: [],
        metrics: {}
      },
      ...current
    ])

    if (socketRef.current?.connected) {
      socketRef.current.emit('joinSession', { sessionId: deploymentId })
    }

    try {
      const response = await axios.post(`${BACKEND_URL}/api/github/deploy`, {
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        branch: selectedBranch,
        token,
        sessionId: deploymentId
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.data?.message) {
        handleSessionLog(deploymentId, 'status', response.data.message)
      }
      setLiveState('STARTING_BUILD')
      setStatusMessage('Deployment requested, waiting for build events')
      showToast('Deployment request submitted. Watching logs live.', 'success')
      setSelectedDeployment(deploymentId)
    } catch (err) {
      console.error(err)
      const message = err.response?.data?.error || err.message || 'Deployment failed'
      setError(message)
      showToast(`Deployment failed: ${message}`, 'error')
      setLiveState('ERROR')
      updateHistoryItem(deploymentId, { status: 'ERROR', active: false, statusText: message })
    } finally {
      setDeploying(false)
    }
  }

  const selectedRepoInfo = useMemo(() => {
    if (!selectedRepo) return null
    return {
      visibility: selectedRepo.private ? 'Private' : 'Public',
      defaultBranch: selectedRepo.default_branch || 'main',
      description: selectedRepo.description || 'No description provided.'
    }
  }, [selectedRepo])

  const filteredRepos = useMemo(() => {
    return repos
      .filter((repo) => {
        const matchText = filterText.toLowerCase()
        const matchesSearch = repo.name.toLowerCase().includes(matchText) || (repo.description || '').toLowerCase().includes(matchText)
        const matchesVisibility = visibilityFilter === 'all' || (visibilityFilter === 'public' ? !repo.private : repo.private)
        return matchesSearch && matchesVisibility
      })
      .sort((a, b) => {
        if (sortBy === 'alpha') return a.name.localeCompare(b.name)
        if (sortBy === 'updated') return new Date(b.updated_at) - new Date(a.updated_at)
        return 0
      })
  }, [repos, filterText, visibilityFilter, sortBy])

  const activeLogs = logsBySession[selectedDeployment] || []
  const currentMetrics = metricsBySession[selectedDeployment] || {}
  const selectedHistoryItem = history.find((item) => item.sessionId === selectedDeployment)

  const downloadLogs = () => {
    if (!selectedDeployment) return
    const lines = activeLogs.map((entry) => {
      const date = new Date(entry.timestamp).toLocaleTimeString()
      return `[${date}] ${entry.type.toUpperCase()}: ${entry.message}`
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${selectedDeployment}-logs.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="github-page">
      <header className="github-hero">
        <div>
          <span className="eyebrow">Connected GitHub Dashboard</span>
          <h1>Repo Browser · Deployment Control Center</h1>
          <p>Deploy repositories from GitHub with live logs, metrics, and history tracking.</p>
        </div>
        <div className="github-status-panel">
          <div className="status-chip">Live status: {liveState || 'IDLE'}</div>
          <div className="status-tag">Session: {selectedDeployment || 'none'}</div>
        </div>
      </header>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}

      <div className="github-grid dashboard-layout">
        <section className="history-panel glass-card">
          <div className="panel-header">
            <div>
              <h2>Deployment History</h2>
              <p>Track previous sessions, status, and recent logs.</p>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">No deployment history yet. Start a new deployment to see activity here.</div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <button
                  key={item.sessionId}
                  className={`history-card ${selectedDeployment === item.sessionId ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSelectedDeployment(item.sessionId)}
                >
                  <div className="history-header">
                    <div>
                      <strong>{item.repo}</strong> <span>· {item.branch}</span>
                    </div>
                    <span className={`history-badge ${item.active ? 'active' : item.status === 'ERROR' ? 'failed' : 'finished'}`}>
                      {item.active ? 'Active' : item.status === 'ERROR' ? 'Failed' : 'Finished'}
                    </span>
                  </div>
                  <div className="history-meta">
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                    <span>{item.logsPreview?.slice(-2).join(' · ')}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="repo-panel glass-card">
          <div className="panel-header">
            <div>
              <h2>Repository Browser</h2>
              <p>Search, filter, and sort your GitHub repositories.</p>
            </div>
          </div>

          <div className="filter-row">
            <input
              type="search"
              placeholder="Search repositories..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)}>
              <option value="all">All visibility</option>
              <option value="public">Public only</option>
              <option value="private">Private only</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="updated">Sort by recent</option>
              <option value="alpha">Sort alphabetically</option>
            </select>
          </div>

          {loadingRepos ? (
            <div className="repo-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="repo-card skeleton-card">
                  <div className="skeleton-title" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ))}
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="empty-state">No repositories match the current filters.</div>
          ) : (
            <div className="repo-grid">
              {filteredRepos.map((repo) => (
                <article
                  key={repo.id}
                  className={`repo-card ${selectedRepo?.id === repo.id ? 'selected' : ''}`}
                  onClick={() => handleSelectRepo(repo)}
                >
                  <div className="repo-card-top">
                    <div>
                      <h3>{repo.name}</h3>
                      <p>{repo.description || 'No description provided.'}</p>
                    </div>
                    <span className={`visibility-pill ${repo.private ? 'private' : 'public'}`}>
                      {repo.private ? 'Private' : 'Public'}
                    </span>
                  </div>
                  <div className="repo-meta-row">
                    <span>{repo.default_branch || 'main'}</span>
                    <span>{new Date(repo.updated_at).toLocaleDateString()}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="deploy-panel glass-card">
          <div className="panel-header">
            <div>
              <h2>Deployment Control</h2>
              <p>Select a repository branch and deploy to the simulator.</p>
            </div>
            <button className="refresh-button" onClick={fetchRepositories} disabled={loadingRepos}>
              Refresh repos
            </button>
          </div>

          {!selectedRepo ? (
            <div className="empty-state">Select a repository to load branches and deploy.</div>
          ) : (
            <div className="deploy-summary">
              <div className="deploy-field">
                <label>Repository</label>
                <span>{selectedRepo.full_name}</span>
              </div>
              <div className="deploy-field">
                <label>Visibility</label>
                <span>{selectedRepoInfo.visibility}</span>
              </div>
              <div className="deploy-field">
                <label>Default branch</label>
                <span>{selectedRepoInfo.defaultBranch}</span>
              </div>
              <div className="deploy-field">
                <label>Description</label>
                <span>{selectedRepoInfo.description}</span>
              </div>
              <div className="deploy-field branch-selector">
                <label htmlFor="branch">Branch</label>
                {fetchingBranches ? (
                  <div className="small-loading">Fetching branches...</div>
                ) : (
                  <select
                    id="branch"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                className="deploy-button"
                type="button"
                onClick={handleDeploy}
                disabled={deploying || !selectedBranch || fetchingBranches}
              >
                {deploying ? 'Deploying...' : 'Deploy to simulator'}
              </button>
              <div className="deployment-meta">
                <span>{statusMessage}</span>
                <strong>{selectedRepo.name}</strong>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="logs-panel glass-card">
        <div className="panel-header">
          <div>
            <h2>Live Deployment Logs</h2>
            <p>Terminal logs and container metrics for the selected session.</p>
          </div>
          <button className="refresh-button" onClick={downloadLogs} disabled={!selectedDeployment}>
            Download logs
          </button>
        </div>

        <div className="logs-grid">
          <div className="terminal-window" ref={terminalRef}>
            {selectedDeployment && activeLogs.length > 0 ? (
              activeLogs.map((log, index) => (
                <div key={`${index}-${log.type}`} className={`terminal-line ${log.type}`}>
                  <span className="terminal-prefix">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="terminal-message">{log.message}</span>
                </div>
              ))
            ) : (
              <div className="empty-terminal">Select a deployment to view logs.</div>
            )}
          </div>
          <div className="metrics-panel">
            <div className="metrics-card">
              <h3>Deployment Pipeline</h3>
              <div className="pipeline-track">
                {PIPELINE_STAGES.map((stage) => {
                  const stageStatus = getStageState(stage.id, selectedHistoryItem?.stage || 'CONNECTED')
                  return (
                    <div key={stage.id} className={`pipeline-step ${stageStatus}`}>
                      <span>{stage.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="metrics-card">
              <h3>Container Metrics</h3>
              <div className="metric-row">
                <span>CPU</span>
                <strong>{currentMetrics.cpuUsage ? `${currentMetrics.cpuUsage}%` : 'N/A'}</strong>
              </div>
              <div className="metric-row">
                <span>Memory</span>
                <strong>{currentMetrics.memoryUsage ? `${(currentMetrics.memoryUsage / 1024 / 1024).toFixed(1)} MB` : 'N/A'}</strong>
              </div>
              <div className="metric-row">
                <span>Memory Limit</span>
                <strong>{currentMetrics.memoryLimit ? `${(currentMetrics.memoryLimit / 1024 / 1024).toFixed(1)} MB` : 'N/A'}</strong>
              </div>
              <div className="metric-row">
                <span>Memory Util</span>
                <strong>{currentMetrics.memoryPercent ? `${currentMetrics.memoryPercent}%` : 'N/A'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
