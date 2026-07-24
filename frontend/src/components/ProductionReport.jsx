import './ProductionReport.css'

export default function ProductionReport({ report }) {
  if (!report) return null

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'Critical':
        return '#ff4444'
      case 'High':
        return '#ff9800'
      case 'Medium':
        return '#ffc107'
      case 'Low':
        return '#4caf50'
      default:
        return '#9e9e9e'
    }
  }

  const getSeverityBgColor = (severity) => {
    switch (severity) {
      case 'Critical':
        return '#ffebee'
      case 'High':
        return '#fff3e0'
      case 'Medium':
        return '#fffde7'
      case 'Low':
        return '#e8f5e9'
      default:
        return '#f5f5f5'
    }
  }

  const getScoreColor = (score) => {
    if (score >= 80) return '#4caf50'
    if (score >= 60) return '#ffc107'
    if (score >= 40) return '#ff9800'
    return '#ff4444'
  }

  return (
    <div className="production-report">
      <h2>📊 Production Readiness Report</h2>
      
      <div className="report-header">
        <div className="score-box">
          <div className="score-circle" style={{ borderColor: getScoreColor(report.score) }}>
            <div className="score-value" style={{ color: getScoreColor(report.score) }}>
              {report.score}
            </div>
            <div className="score-label">Score</div>
          </div>
        </div>
        
        <div className="status-info">
          <div className="status-badge" style={{ 
            backgroundColor: report.status === 'PASS' ? '#4caf50' : '#ff4444',
            color: 'white'
          }}>
            {report.status}
          </div>
          <p className="total-issues">
            {report.issues.length} issue{report.issues.length !== 1 ? 's' : ''} found
          </p>
        </div>
      </div>

      {report.docker && Object.keys(report.docker).length > 0 && (
        <div className="report-section">
          <h3>🐳 Docker Information</h3>
          <div className="info-grid">
            {report.docker.imageId && (
              <div className="info-item">
                <span className="info-label">Image ID:</span>
                <span className="info-value">{report.docker.imageId?.substring(0, 20)}...</span>
              </div>
            )}
            {report.docker.sizeMB && (
              <div className="info-item">
                <span className="info-label">Image Size:</span>
                <span className="info-value">{report.docker.sizeMB} MB</span>
              </div>
            )}
            {report.docker.created && (
              <div className="info-item">
                <span className="info-label">Created:</span>
                <span className="info-value">{new Date(report.docker.created).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {report.runtime && Object.keys(report.runtime).length > 0 && (
        <div className="report-section">
          <h3>⚙️ Runtime Information</h3>
          <div className="info-grid">
            {report.runtime.status && (
              <div className="info-item">
                <span className="info-label">Status:</span>
                <span className="info-value">{report.runtime.status}</span>
              </div>
            )}
            {report.runtime.running !== undefined && (
              <div className="info-item">
                <span className="info-label">Running:</span>
                <span className="info-value">{report.runtime.running ? 'Yes' : 'No'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {report.issues && report.issues.length > 0 && (
        <div className="report-section">
          <h3>⚠️ Issues Found ({report.issues.length})</h3>
          <div className="issues-list">
            {report.issues.map((issue, index) => (
              <div
                key={index}
                className="issue-item"
                style={{ backgroundColor: getSeverityBgColor(issue.severity) }}
              >
                <div className="issue-header">
                  <span
                    className="issue-severity"
                    style={{ 
                      backgroundColor: getSeverityColor(issue.severity),
                      color: 'white'
                    }}
                  >
                    {issue.severity}
                  </span>
                  <h4 className="issue-title">{issue.title}</h4>
                </div>
                <p className="issue-description">{issue.description}</p>
                {issue.recommendation && (
                  <div className="issue-recommendation">
                    <strong>💡 Fix:</strong> {issue.recommendation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.recommendations && report.recommendations.length > 0 && (
        <div className="report-section">
          <h3>✅ Recommendations ({report.recommendations.length})</h3>
          <div className="recommendations-list">
            {report.recommendations.map((rec, index) => (
              <div key={index} className="recommendation-item">
                <span className="rec-number">{index + 1}</span>
                <span className="rec-text">{rec}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.project && (
        <div className="report-section">
          <h3>📁 Project Information</h3>
          <div className="info-grid">
            {report.project.dockerfile && (
              <div className="info-item">
                <span className="info-label">Dockerfile:</span>
                <span className="info-value">✅ Present</span>
              </div>
            )}
            {report.project.dockerignore && (
              <div className="info-item">
                <span className="info-label">.dockerignore:</span>
                <span className="info-value">✅ Present</span>
              </div>
            )}
            {report.project.env !== undefined && (
              <div className="info-item">
                <span className="info-label">.env:</span>
                <span className="info-value">{report.project.env ? '✅ Present' : '❌ Missing'}</span>
              </div>
            )}
            {report.project.envExample !== undefined && (
              <div className="info-item">
                <span className="info-label">.env.example:</span>
                <span className="info-value">{report.project.envExample ? '✅ Present' : '❌ Missing'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
