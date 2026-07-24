import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { Routes, Route } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import GithubLogin from './pages/GithubLogin'
import GithubSuccess from './pages/GithubSuccess'
import './App.css'

function App() {
  const [socket, setSocket] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [productionReport, setProductionReport] = useState(null)
  const sessionRef = useRef(null)
  const socketRef = useRef(null)

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (socket?.connected && sessionId) {
      socket.emit('joinSession', { sessionId })
    }
  }, [socket, sessionId])

  useEffect(() => {
    const appendLog = (type, payload) => {
      const message = typeof payload === 'string'
        ? payload
        : payload?.message || payload?.data || payload?.output || ''

      if (!message) return

      setLogs((prev) => [...prev, {
        type,
        data: message,
        timestamp: Date.now()
      }])
    }

    const appendStatusLog = (data) => {
      if (!data?.message) return
      appendLog(data.type || 'status', data)
    }

    const newSocket = io('http://localhost:5000', {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    })

    newSocket.on('connect', () => {
      console.log('Connected to backend')
      if (sessionRef.current) {
        newSocket.emit('joinSession', { sessionId: sessionRef.current })
      }
    })

    newSocket.on('connect_error', (err) => {
      console.warn('Socket connect error', err)
      setErrorMessage('Unable to connect to backend socket. Logs and live status may be unavailable.')
    })

    newSocket.on('reconnect_attempt', (count) => {
      console.log('Socket reconnect attempt', count)
    })

    newSocket.on('disconnect', (reason) => {
      console.warn('Socket disconnected', reason)
      if (reason !== 'io client disconnect') {
        setErrorMessage('Socket disconnected from backend.')
      }
    })

    newSocket.on('status', (data) => {
      if (sessionRef.current && data.sessionId === sessionRef.current) {
        console.log('Status update:', data.status)
        setStatus(data.status || 'status')

        if (typeof data.percent === 'number') {
          setProgress(data.percent)
        }

        if (data.status === 'ERROR' || data.status === 'BUILD_FAILED' || data.status === 'CONTAINER_FAILED' || data.status === 'CLEANUP_ERROR') {
          setErrorMessage(data.error || 'An error occurred during simulation')
        }

        appendStatusLog(data)
      }
    })

    newSocket.on('terminal_output', (data) => {
      if (data.sessionId && sessionRef.current && data.sessionId !== sessionRef.current) {
        return
      }

      appendLog(data.type || 'runtime', data.message || data.data)
    })

    newSocket.on('build_log', (data) => {
      if (data.sessionId && sessionRef.current && data.sessionId !== sessionRef.current) {
        return
      }

      appendLog('build', data.data)
    })

    newSocket.on('runtime_log', (data) => {
      if (data.sessionId && sessionRef.current && data.sessionId !== sessionRef.current) {
        return
      }

      appendLog('runtime', data.data)
    })

    newSocket.on('production-report', (data) => {
      const report = data?.report || data
      const incomingSessionId = data?.sessionId || sessionRef.current

      console.log('Received production report event:', data)

      if (!incomingSessionId || incomingSessionId === sessionRef.current) {
        if (report) {
          setProductionReport(report)
          setStatus('FINISHED')
          setProgress(100)
        }
      }
    })

    newSocket.onAny((event, payload) => {
      if (event === 'production-report' || event === 'status') {
        return
      }
      console.debug('Socket event:', event, payload)
    })

    setSocket(newSocket)
    socketRef.current = newSocket

    return () => {
      newSocket.off()
      newSocket.disconnect()
      setSocket(null)
    }
  }, [])

  const handleUploadStart = () => {
    const nextSessionId = Date.now().toString()
    sessionRef.current = nextSessionId
    setSessionId(nextSessionId)
    setLogs([])
    setProgress(0)
    setStatus('UPLOADING')
    setErrorMessage('')
    setProductionReport(null)

    if (socketRef.current?.connected) {
      socketRef.current.emit('joinSession', { sessionId: nextSessionId })
    } else {
      console.debug('Socket not yet connected, session join will happen on connect', nextSessionId)
    }

    return nextSessionId
  }

  const handleUploadComplete = (newSessionId, report) => {
    sessionRef.current = newSessionId
    setSessionId(newSessionId)
    if (report) {
      setProductionReport(report)
      setStatus('FINISHED')
      setProgress(100)
    } else {
      setStatus('EXTRACTING')
    }
  }

  const handleStop = async () => {
    if (!sessionId) return

    setStatus('STOPPING')
    try {
      const response = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      })
      const data = await response.json()
      if (!response.ok) {
        setErrorMessage(data.error || 'Failed to stop simulation')
        setStatus('ERROR')
      } else {
        setStatus('FINISHED')
      }
    } catch (error) {
      setErrorMessage(error.message)
      setStatus('ERROR')
    }
  }

  return (
    <Routes>
      <Route 
        path="/" 
        element={
          <div className="app container glass-effect">
            <Dashboard 
              socket={socket}
              sessionId={sessionId}
              setSessionId={setSessionId}
              status={status}
              progress={progress}
              logs={logs}
              errorMessage={errorMessage}
              productionReport={productionReport}
              onUploadStart={handleUploadStart}
              onUploadComplete={handleUploadComplete}
              onStop={handleStop}
            />
          </div>
        }
      />
      <Route 
        path="/github-login" 
        element={<GithubLogin />} 
      />
      <Route 
        path="/github-success" 
        element={<GithubSuccess />} 
      />
    </Routes>
  )
}

export default App
