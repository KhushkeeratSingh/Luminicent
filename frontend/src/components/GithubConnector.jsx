import { useState, useEffect } from 'react'
import './GithubConnector.css'

export default function GithubConnector({ onDeployStart, onDeployComplete }) {
  const [token, setToken] = useState(localStorage.getItem('github_token') || '')
  const [user, setUser] = useState(null)
  const [repos, setRepos] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  
  // PAT Form state
  const [patInput, setPatInput] = useState('')
  const [showPatInfo, setShowPatInfo] = useState(false)

  // Branch Selection state
  const [selectedRepo, setSelectedRepo] = useState(null)
  const [branches, setBranches] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('main')
  const [fetchingBranches, setFetchingBranches] = useState(false)
  const [deploying, setDeploying] = useState(false)

  useEffect(() => {
    if (token) {
      fetchUserData(token)
    }
  }, [token])

  // Watch for token changes in URL (returned from backend OAuth redirect)
  useEffect(() => {
    const handleUrlToken = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const urlToken = urlParams.get('github_token')
      const urlError = urlParams.get('github_error')

      if (urlToken) {
        localStorage.setItem('github_token', urlToken)
        setToken(urlToken)
        // Clean up URL query parameters
        window.history.replaceState({}, document.title, window.location.pathname)
      } else if (urlError) {
        setAuthError(decodeURIComponent(urlError))
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }

    handleUrlToken()
  }, [])

  const fetchUserData = async (authToken) => {
    setLoading(true)
    setAuthError('')
    try {
      // Get User Info
      const userRes = await fetch('/api/github/user', {
        headers: { Authorization: `Bearer ${authToken}` }
      })

      if (!userRes.ok) {
        throw new Error('Failed to authenticate token')
      }

      const userData = await userRes.json()
      setUser(userData)
      
      // Get User Repositories
      const reposRes = await fetch('/api/github/repos', {
        headers: { Authorization: `Bearer ${authToken}` }
      })

      if (reposRes.ok) {
        const reposData = await reposRes.json()
        setRepos(reposData)
      }
    } catch (err) {
      console.error(err)
      setAuthError('Authentication failed. Please verify your token or try logging in again.')
      handleLogout()
    } finally {
      setLoading(false)
    }
  }

  const handleGithubLogin = () => {
    window.location.href = "http://localhost:5000/api/github/login";
  }

  const handlePatSubmit = (e) => {
    e.preventDefault()
    if (!patInput.trim()) return

    const sanitizedToken = patInput.trim()
    localStorage.setItem('github_token', sanitizedToken)
    setToken(sanitizedToken)
    setPatInput('')
  }

  const handleLogout = () => {
    localStorage.removeItem('github_token')
    setToken('')
    setUser(null)
    setRepos([])
    setSelectedRepo(null)
  }

  const handleSelectRepo = async (repo) => {
    setSelectedRepo(repo)
    setFetchingBranches(true)
    setBranches([])
    setSelectedBranch('main')

    try {
      const res = await fetch(`/api/github/branches?owner=${repo.owner.login}&repo=${repo.name}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch branches')
      const branchData = await res.json()
      setBranches(branchData)
      
      // Try to find default branch, or first one, or main
      const defaultBranch = repo.default_branch || (branchData.length > 0 ? branchData[0].name : 'main')
      setSelectedBranch(defaultBranch)
    } catch (err) {
      console.error(err)
      alert('Error fetching branches for this repository.')
    } finally {
      setFetchingBranches(false)
    }
  }

  const handleDeploy = async () => {
    if (!selectedRepo) return

    setDeploying(true)
    const sessionId = onDeployStart()

    try {
      const response = await fetch('/api/github/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          branch: selectedBranch,
          token,
          sessionId
        })
      })

      const data = await response.json()
      if (response.ok) {
        onDeployComplete(data.sessionId)
      } else {
        alert('Deployment failed: ' + data.error)
      }
    } catch (err) {
      console.error(err)
      alert('Deployment request failed: ' + err.message)
    } finally {
      setDeploying(false)
    }
  }

  // Filter repos based on search
  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // Language colors mapping for nice indicators
  const getLanguageColor = (lang) => {
    const colors = {
      JavaScript: '#f1e05a',
      TypeScript: '#3178c6',
      Python: '#3572A5',
      HTML: '#e34c26',
      CSS: '#563d7c',
      Ruby: '#701516',
      Go: '#00ADD8',
      Rust: '#dea584',
      Java: '#b07219',
      'C++': '#f34b7d'
    }
    return colors[lang] || '#8b949e'
  }

  if (loading) {
    return (
      <div className="github-loading">
        <div className="spinner"></div>
        <p>Loading GitHub details...</p>
      </div>
    )
  }

  return (
    <div className="github-connector">
      {!user ? (
        <div className="auth-container">
          <p className="auth-subtitle">Connect your account to deploy projects directly from GitHub</p>
          
          <button className="github-btn" onClick={handleGithubLogin}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.867 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            Sign in with GitHub
          </button>

          <div className="auth-divider">
            <span>OR</span>
          </div>

          <form onSubmit={handlePatSubmit} className="pat-form">
            <div className="form-group">
              <label htmlFor="pat">GitHub Personal Access Token (PAT)</label>
              <input
                id="pat"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
              />
            </div>
            <button type="submit" className="submit-btn" disabled={!patInput.trim()}>
              Connect with Token
            </button>
          </form>

          {authError && <p className="error-text">{authError}</p>}

          <div className="pat-info-accordion">
            <button 
              type="button" 
              className="accordion-toggle"
              onClick={() => setShowPatInfo(!showPatInfo)}
            >
              💡 How to generate a GitHub Token? {showPatInfo ? '▲' : '▼'}
            </button>
            {showPatInfo && (
              <div className="accordion-content">
                <ol>
                  <li>Go to GitHub <strong>Settings</strong> &gt; <strong>Developer Settings</strong> &gt; <strong>Personal Access Tokens</strong> &gt; <strong>Tokens (classic)</strong>.</li>
                  <li>Click <strong>Generate new token (classic)</strong>.</li>
                  <li>Give it a description and check the <strong><code>repo</code></strong> and <strong><code>user</code></strong> scopes.</li>
                  <li>Click <strong>Generate token</strong> at the bottom.</li>
                  <li>Copy the token and paste it above!</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="repo-container">
          <div className="profile-header">
            <div className="user-profile">
              <img src={user.avatar_url} alt={user.login} className="avatar" />
              <div className="user-profile-info">
                <h4>{user.name || user.login}</h4>
                <p>@{user.login}</p>
              </div>
            </div>
            <button className="logout-btn" onClick={handleLogout}>Log Out</button>
          </div>

          {!selectedRepo ? (
            <div className="repo-browser">
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="🔍 Search repositories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="repo-list">
                {filteredRepos.length > 0 ? (
                  filteredRepos.map((repo) => (
                    <div key={repo.id} className="repo-item" onClick={() => handleSelectRepo(repo)}>
                      <div className="repo-info">
                        <div className="repo-name-row">
                          <span className="repo-name">{repo.name}</span>
                          <span className={`repo-badge ${repo.private ? 'private' : 'public'}`}>
                            {repo.private ? 'Private' : 'Public'}
                          </span>
                        </div>
                        {repo.description && <p className="repo-desc">{repo.description}</p>}
                        <div className="repo-meta">
                          {repo.language && (
                            <span className="repo-lang">
                              <span 
                                className="lang-color" 
                                style={{ backgroundColor: getLanguageColor(repo.language) }}
                              ></span>
                              {repo.language}
                            </span>
                          )}
                          <span className="repo-date">
                            Updated {new Date(repo.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="repo-action">
                        <button className="select-btn">Select</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="no-repos">No repositories found.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="deploy-config">
              <button className="back-btn" onClick={() => setSelectedRepo(null)}>
                ← Back to Repositories
              </button>
              
              <div className="selected-repo-details">
                <h3>📦 {selectedRepo.name}</h3>
                {selectedRepo.description && <p>{selectedRepo.description}</p>}
              </div>

              <div className="deploy-form">
                <div className="form-group">
                  <label htmlFor="branch-select">🌿 Select Branch</label>
                  {fetchingBranches ? (
                    <div className="fetching-branches">
                      <div className="small-spinner"></div>
                      <span>Fetching branches...</span>
                    </div>
                  ) : (
                    <select
                      id="branch-select"
                      className="branch-dropdown"
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                    >
                      {branches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button 
                  className="deploy-submit-btn" 
                  onClick={handleDeploy} 
                  disabled={deploying || fetchingBranches}
                >
                  {deploying ? (
                    <>
                      <div className="small-spinner inline-spinner"></div>
                      Deploying...
                    </>
                  ) : (
                    `🚀 Deploy ${selectedBranch} Branch`
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
