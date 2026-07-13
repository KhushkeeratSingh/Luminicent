import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { Routes, Route } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import GithubSuccess from './pages/GithubSuccess'
import './App.css'

function App() {
  const [socket, setSocket] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [status, setStatus] = useState('idle')
  const [logs, setLogs] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const sessionRef = useRef(null)

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    const newSocket = io('http://localhost:5000', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
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

    newSocket.on('disconnect', (reason) => {
      console.warn('Socket disconnected', reason)
      if (reason !== 'io client disconnect') {
        setErrorMessage('Socket disconnected from backend.')
      }
    })

    newSocket.on('status', (data) => {
      if (!sessionRef.current || data.sessionId === sessionRef.current) {
        setStatus(data.status)
        if (data.status === 'ERROR' || data.status === 'BUILD_FAILED' || data.status === 'CONTAINER_FAILED' || data.status === 'CLEANUP_ERROR') {
          setErrorMessage(data.error || 'An error occurred during simulation')
        }
      }
    })

    newSocket.on('build_log', (data) => {
      if (!sessionRef.current || data.sessionId === sessionRef.current) {
        setLogs((prev) => [...prev, { type: 'build', data: data.data }])
      }
    })

    newSocket.on('runtime_log', (data) => {
      if (!sessionRef.current || data.sessionId === sessionRef.current) {
        setLogs((prev) => [...prev, { type: 'runtime', data: data.data }])
      }
    })

    setSocket(newSocket)

    return () => {
      newSocket.off()
      newSocket.disconnect()
      setSocket(null)
    }
  }, [])

  const handleUploadStart = () => {
    const nextSessionId = Date.now().toString()
    setSessionId(nextSessionId)
    setLogs([])
    setStatus('UPLOADING')
    setErrorMessage('')

    if (socket?.connected) {
      socket.emit('joinSession', { sessionId: nextSessionId })
    }

    return nextSessionId
  }

  const handleUploadComplete = (newSessionId) => {
    setSessionId(newSessionId)
    setStatus('EXTRACTING')
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
              logs={logs}
              errorMessage={errorMessage}
              onUploadStart={handleUploadStart}
              onUploadComplete={handleUploadComplete}
              onStop={handleStop}
            />
          </div>
        }
      />
      <Route 
        path="/github-success" 
        element={<GithubSuccess />} 
      />
    </Routes>
  )
}

export default App
