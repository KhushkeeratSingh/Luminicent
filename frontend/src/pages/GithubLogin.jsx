import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './GithubLogin.css'

const BACKEND_URL = 'http://localhost:5000'

export default function GithubLogin() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [tokenReady, setTokenReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('github_token')
    const urlError = params.get('github_error')

    if (urlToken) {
      localStorage.setItem('github_token', urlToken)
      window.history.replaceState({}, document.title, window.location.pathname)
      setTokenReady(true)
      navigate('/github-success', { replace: true })
      return
    }

    if (urlError) {
      setError(decodeURIComponent(urlError))
      return
    }

    const existingToken = localStorage.getItem('github_token')
    if (existingToken) {
      setTokenReady(true)
      navigate('/github-success', { replace: true })
    }
  }, [navigate])

  const handleGithubLogin = () => {
    setIsSigningIn(true)
    setError('')
    window.location.href = `${BACKEND_URL}/api/github/login`
  }

  const handleContinueWithToken = () => {
    navigate('/github-success', { replace: true })
  }

  const message = useMemo(() => {
    if (error) return error
    return 'Connect GitHub to browse your repositories, select a project, and deploy it directly to the simulator.'
  }, [error])

  return (
    <div className="github-login-page">
      <div className="github-login-card">
        <div className="login-badge">GitHub Access</div>
        <h1>Sign in with GitHub</h1>
        <p>{message}</p>

        <button className="github-login-btn" onClick={handleGithubLogin} disabled={isSigningIn}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.867 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
          </svg>
          {isSigningIn ? 'Redirecting to GitHub…' : 'Continue with GitHub'}
        </button>

        <div className="login-help-list">
          <div>• Browse repositories from your GitHub account</div>
          <div>• Select a branch and deploy it to the simulator</div>
          <div>• Review build logs and deployment history</div>
        </div>

        <button className="secondary-action" type="button" onClick={handleContinueWithToken}>
          Continue to repository dashboard
        </button>
      </div>
    </div>
  )
}
