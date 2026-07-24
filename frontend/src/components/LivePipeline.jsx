import './LivePipeline.css'

const PIPELINE_STAGES = [
  { id: 'upload', label: 'Upload', icon: '📦' },
  { id: 'extract', label: 'Extract', icon: '📂' },
  { id: 'build', label: 'Build Image', icon: '🔨' },
  { id: 'run', label: 'Run Container', icon: '▶️' },
  { id: 'finish', label: 'Finished', icon: '✅' }
]

const getStageStatus = (status) => {
  const statusMap = {
    'UPLOADING': 'upload',
    'EXTRACTING': 'extract',
    'EXTRACTED': 'extract',
    'STARTING_BUILD': 'build',
    'BUILD_LOG': 'build',
    'BUILD_IMAGE': 'build',
    'BUILD_FAILED': 'build',
    'RUN_CONTAINER': 'run',
    'CONTAINER_RUNNING': 'run',
    'RUNTIME_LOG': 'run',
    'STOPPING': 'run',
    'CLEANUP': 'finish',
    'FINISHED': 'finish',
    'ERROR': 'error',
  }
  return statusMap[status] || 'upload'
}

const getStatusDetail = (status) => {
  const detailMap = {
    'UPLOADING': 'Preparing upload and assigning session.',
    'EXTRACTING': 'Extracting the package and validating Dockerfile.',
    'EXTRACTED': 'Package successfully extracted.',
    'STARTING_BUILD': 'Building the Docker image from your app.',
    'BUILD_LOG': 'Docker build is in progress.',
    'BUILD_IMAGE': 'Docker image build completed.',
    'BUILD_FAILED': 'Image build failed. Check logs for details.',
    'RUN_CONTAINER': 'Launching the container and starting runtime.',
    'CONTAINER_RUNNING': 'Container is running successfully.',
    'RUNTIME_LOG': 'Streaming runtime logs from the container.',
    'STOPPING': 'Stopping the active simulation session.',
    'CLEANUP': 'Stopping and removing the container.',
    'FINISHED': 'Simulation finished successfully.',
    'ERROR': 'An error occurred during the deployment pipeline.',
    'LOG_STREAM_ERROR': 'There was a problem streaming logs.',
    'LOG_ERROR': 'Log capture failed during container runtime.',
  }
  return detailMap[status] || 'Waiting for pipeline activity.'
}

const isStageComplete = (stageId, currentStage) => {
  const stageOrder = ['upload', 'extract', 'build', 'run', 'finish']
  return stageOrder.indexOf(stageId) < stageOrder.indexOf(currentStage)
}

const isStageActive = (stageId, currentStage) => {
  return stageId === currentStage
}

export default function LivePipeline({ status, progress = 0, sessionId, onStop }) {
  const currentStage = getStageStatus(status)
  const isFinished = status === 'FINISHED' || status === 'ERROR'

  return (
    <div className="live-pipeline">
      <div className="pipeline-stages">
        {PIPELINE_STAGES.map((stage, index) => (
          <div key={stage.id}>
            <div
              className={`pipeline-stage ${
                isStageComplete(stage.id, currentStage) ? 'complete' : ''
              } ${isStageActive(stage.id, currentStage) ? 'active' : ''}`}
            >
              <div className="stage-icon">{stage.icon}</div>
              <div className="stage-label">{stage.label}</div>
              {isStageActive(stage.id, currentStage) && (
                <div className="stage-loader"></div>
              )}
            </div>
            {index < PIPELINE_STAGES.length - 1 && (
              <div
                className={`pipeline-connector ${
                  isStageComplete(stage.id, currentStage) ? 'complete' : ''
                }`}
              ></div>
            )}
          </div>
        ))}
      </div>

      <div className="pipeline-info">
        <p>Session ID: <code>{sessionId}</code></p>
        <p>Status: <span className={`status-badge ${status.toLowerCase()}`}>{status}</span></p>
        <p className="status-detail">{getStatusDetail(status)}</p>
        <div className="progress-wrapper">
          <progress value={progress} max="100"></progress>
          <span>{progress}%</span>
        </div>
        {onStop && !isFinished && (
          <button className="stop-button" onClick={onStop}>
            Stop Simulation
          </button>
        )}
      </div>
    </div>
  )
}
