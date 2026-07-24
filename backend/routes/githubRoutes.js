import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import axios from 'axios';
import {
  normalizeRepoRoot,
  ensureDockerfile,
  findBuildContext,
  validateGithubRepo
} from '../utils/dockerfileHelper.js';
import { analyzeProduction } from '../utils/productionAnalyzer.js';

const router = express.Router();

// Initialize Passport Strategy for GitHub
const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;
const redirectUri = process.env.GITHUB_REDIRECT_URI || 'http://localhost:5000/api/github/callback';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

if (clientId && clientId !== 'your_github_client_id_here') {
  passport.use(new GitHubStrategy({
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: redirectUri
    },
    function(accessToken, refreshToken, profile, done) {
      // Attach accessToken to profile so we can pass it to the frontend
      profile.accessToken = accessToken;
      return done(null, profile);
    }
  ));
} else {
  // Fallback dummy strategy to prevent startup crash if not configured
  passport.use(new GitHubStrategy({
      clientID: 'dummy_id',
      clientSecret: 'dummy_secret',
      callbackURL: 'http://localhost:5000/api/github/callback'
    },
    function(accessToken, refreshToken, profile, done) {
      return done(null, profile);
    }
  ));
}

// Helper to make GET requests to GitHub API
function getGithubJson(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'DevOps-Deployment-Simulator',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(responseBody));
          } else {
            let errorMsg = `GitHub API error: ${res.statusCode}`;
            try {
              const errObj = JSON.parse(responseBody);
              errorMsg = errObj.message || errorMsg;
            } catch (e) {}
            reject(new Error(errorMsg));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${responseBody.substring(0, 100)}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

// Helper to download the zipball (follows redirects)
function downloadZipball(url, destPath, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'DevOps-Deployment-Simulator',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        downloadZipball(res.headers.location, destPath, token)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          let errorMsg = `GitHub Download error: ${res.statusCode}`;
          try {
            const errObj = JSON.parse(responseBody);
            errorMsg = errObj.message || errorMsg;
          } catch (e) {}
          reject(new Error(errorMsg));
        });
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destPath);
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });

    req.end();
  });
}

// Helper to cleanup directories
const cleanupPath = (targetPath) => {
  if (!targetPath) return;
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (cleanupError) {
    console.error(`Cleanup error for ${targetPath}:`, cleanupError);
  }
};

// Route: Redirect to GitHub authorize page
router.get('/login', (req, res, next) => {
  const currentClientId = clientId;
  if (!currentClientId || currentClientId === 'your_github_client_id_here') {
    const errorMessage = encodeURIComponent('GitHub OAuth is not configured on the server. Use a Personal Access Token instead.');
    return res.redirect(`${frontendUrl}/github-success?github_error=${errorMessage}`);
  }

  const githubURL =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${currentClientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=repo`;
  console.log('Redirecting to GitHub OAuth:', githubURL);
  res.redirect(githubURL);
});

// Route: Handle GitHub redirect callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!clientId || clientId === 'your_github_client_id_here' || !clientSecret) {
    const errorMessage = encodeURIComponent('GitHub OAuth client credentials are missing or invalid.');
    return res.redirect(`${frontendUrl}/github-success?github_error=${errorMessage}`);
  }

  if (!code) {
    const errorMessage = encodeURIComponent('Authorization code is required.');
    return res.redirect(`${frontendUrl}/github-success?github_error=${errorMessage}`);
  }

  try {
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    }, {
      headers: {
        Accept: 'application/json'
      }
    });

    console.log('TOKEN RESPONSE:', tokenResponse.data);

    if (tokenResponse.data.error) {
      throw new Error(tokenResponse.data.error_description || tokenResponse.data.error);
    }

    const token = tokenResponse.data.access_token;
    if (!token) {
      throw new Error('GitHub did not return an access token.');
    }

    res.redirect(`${frontendUrl}/github-success?github_token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    const errorMessage = encodeURIComponent(error.message || 'Unknown OAuth callback error');
    res.redirect(`${frontendUrl}/github-success?github_error=${errorMessage}`);
  }
});

// Route: Fetch current user profile
router.get('/user', async (req, res) => {
  const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const userData = await getGithubJson('https://api.github.com/user', token);
    res.json(userData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route: List repositories
router.get('/repos', async (req, res) => {
  const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const repos = await getGithubJson('https://api.github.com/user/repos?per_page=100&sort=updated', token);
    res.json(repos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route: List branches of a repo
router.get('/branches', async (req, res) => {
  const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
  const { owner, repo } = req.query;

  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo parameters are required' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const branches = await getGithubJson(`https://api.github.com/repos/${owner}/${repo}/branches`, token);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route: Download repo zipball, extract, build and run container simulation
router.post('/deploy', async (req, res) => {
  const { owner, repo, branch, token } = req.body;
  if (!owner || !repo || !branch) {
    return res.status(400).json({ error: 'owner, repo, and branch are required' });
  }

  let cleanOwner, cleanRepo
  try {
    ({ owner: cleanOwner, repo: cleanRepo } = validateGithubRepo(owner, repo))
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message })
  }

  const sessionId = req.body.sessionId || Date.now().toString();
  const zipPath = path.join('uploads', `${sessionId}.zip`);
  const extractPath = path.join('uploads', sessionId);
  const dockerOrchestrator = req.orchestrator;
  dockerOrchestrator.createSession(sessionId, {
    owner: cleanOwner,
    repo: cleanRepo,
    branch,
    status: 'FETCH_REPO'
  });

  try {
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'DOWNLOAD',
      stage: 'upload',
      type: 'info',
      percent: 5,
      message: `Downloading repository archive ${cleanOwner}/${cleanRepo} (branch: ${branch})...`
    });

    const zipballUrl = `https://api.github.com/repos/${cleanOwner}/${cleanRepo}/zipball/${encodeURIComponent(branch)}`;
    await downloadZipball(zipballUrl, zipPath, token);

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'EXTRACTING',
      stage: 'extract',
      type: 'info',
      percent: 15,
      message: 'Extracting repository package...'
    });

    fs.mkdirSync(extractPath, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);

    const repoRoot = normalizeRepoRoot(extractPath);
    const buildContext = findBuildContext(repoRoot);
    console.log('GitHub deploy repoRoot:', repoRoot);
    console.log('GitHub deploy buildContext:', buildContext);
    console.log('GitHub build context files:', fs.readdirSync(buildContext));

    const dockerfilePath = ensureDockerfile(buildContext);

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'EXTRACTED',
      stage: 'extract',
      type: 'success',
      percent: 25,
      message: `Repository extracted. Using Dockerfile at ${path.relative(buildContext, dockerfilePath)}`
    });

    const imageName = `devops-sim-${sessionId}`;
    await dockerOrchestrator.buildImage(buildContext, imageName, sessionId, dockerfilePath);

    const container = await dockerOrchestrator.runContainer(imageName, sessionId);

    const report = await analyzeProduction(buildContext, imageName, container);
    dockerOrchestrator.emit(sessionId, 'production-report', {
      sessionId,
      report
    });

    dockerOrchestrator.streamLogs(container, sessionId);

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'RUNNING',
      stage: 'container',
      type: 'success',
      percent: 85,
      message: 'Container is running and logs are streaming.'
    });

    res.json({
      success: true,
      sessionId,
      report,
      message: 'Simulation started'
    });

    setTimeout(async () => {
      await dockerOrchestrator.cleanup(sessionId);
      cleanupPath(extractPath);
    }, 120000);

  } catch (error) {
    console.error('GitHub deployment error:', error);
    dockerOrchestrator.emitStatus(sessionId, {
      status: 'ERROR',
      stage: 'error',
      type: 'error',
      message: error.message,
      error: error.message
    });
    cleanupPath(extractPath);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupPath(zipPath);
  }
});

router.get('/deployments', (req, res) => {
  const deployments = req.orchestrator.getDeploymentHistory()
  res.json(deployments)
})

router.get('/deployments/:sessionId', (req, res) => {
  const session = req.orchestrator.getSessionInfo(req.params.sessionId)
  if (!session) {
    return res.status(404).json({ error: 'Deployment session not found' })
  }
  res.json(session)
})

export default router;
