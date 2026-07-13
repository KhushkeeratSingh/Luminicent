import { useEffect, useRef } from 'react'
import './TerminalViewer.css'

export default function TerminalViewer({ logs }) {
  const terminalRef = useRef(null)

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="terminal-viewer" ref={terminalRef}>
      <div className="terminal-header">
        <div className="terminal-buttons">
          <div className="button red"></div>
          <div className="button yellow"></div>
          <div className="button green"></div>
        </div>
      </div>
      <pre className="terminal-output">
        {logs.map((log, index) => (
          <div key={index} className={`log-line ${log.type}`}>
            <span className="log-type">[{log.type.toUpperCase()}]</span>
            <span className="log-content">{log.data}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
