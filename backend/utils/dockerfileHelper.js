import fs from 'fs'
import path from 'path'

const KNOWN_DOCKERFILE_NAMES = ['Dockerfile', 'dockerfile']
const DEFAULT_NODE_VERSION = '18-alpine'
const DEFAULT_PYTHON_VERSION = '3.11-slim'

const sanitizeGithubSegment = (value) => {
  if (typeof value !== 'string') return ''
  return value.replace(/[^a-zA-Z0-9._-]/g, '')
}

export const normalizeRepoRoot = (extractPath) => {
  const entries = fs.readdirSync(extractPath).filter((name) => !['.DS_Store', '__MACOSX'].includes(name))
  if (entries.length === 1) {
    const first = path.join(extractPath, entries[0])
    if (fs.existsSync(first) && fs.statSync(first).isDirectory()) {
      return first
    }
  }
  return extractPath
}

export const findExistingDockerfile = (contextPath) => {
  for (const name of KNOWN_DOCKERFILE_NAMES) {
    const candidate = path.join(contextPath, name)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export const detectAppType = (contextPath) => {
  const packagePath = path.join(contextPath, 'package.json')
  const requirementsPath = path.join(contextPath, 'requirements.txt')
  const pyprojectPath = path.join(contextPath, 'pyproject.toml')
  const appPy = ['app.py', 'main.py', 'wsgi.py'].find((file) => fs.existsSync(path.join(contextPath, file)))
  const hasPythonFiles = fs.readdirSync(contextPath).some((name) => ['.py'].includes(path.extname(name)))

  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      }
      const depKeys = Object.keys(deps || {})
      const lowerDeps = depKeys.map((dep) => dep.toLowerCase())

      if (lowerDeps.some((dep) => dep.includes('react') || dep.includes('vite') || dep.includes('next') || dep.includes('svelte') || dep.includes('nuxt'))) {
        return { type: 'react', package: pkg }
      }

      if (lowerDeps.some((dep) => dep.includes('express'))) {
        return { type: 'express', package: pkg }
      }

      if (pkg.scripts && typeof pkg.scripts.start === 'string') {
        return { type: 'node', package: pkg }
      }

      return { type: 'node', package: pkg }
    } catch (error) {
      return { type: 'node', package: null }
    }
  }

  if (fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath) || appPy || hasPythonFiles) {
    if (appPy || fs.existsSync(path.join(contextPath, 'flask_app.py')) || fs.existsSync(path.join(contextPath, 'wsgi.py'))) {
      return { type: 'flask', package: null }
    }
    return { type: 'python', package: null }
  }

  return { type: 'node', package: null }
}

const buildNodeDockerfile = (pkg) => {
  const hasYarn = pkg && pkg.engines && pkg.engines.yarn
  const packageFiles = 'COPY package*.json ./'
  const install = hasYarn ? 'RUN yarn install --production' : 'RUN npm install --production'
  const startCommand = pkg?.scripts?.start ? `CMD ["sh", "-c", "${pkg.scripts.start.replace(/"/g, '\\"')}"]` : 'CMD ["node", "index.js"]'

  return `FROM node:${DEFAULT_NODE_VERSION}
WORKDIR /app
${packageFiles}
${install}
COPY . .
EXPOSE 3000
${startCommand}
`
}

const buildReactDockerfile = () => {
  return `FROM node:${DEFAULT_NODE_VERSION}
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm install -g serve
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
`
}

const buildExpressDockerfile = (pkg) => {
  const hasYarn = pkg && pkg.engines && pkg.engines.yarn
  const install = hasYarn ? 'RUN yarn install --production' : 'RUN npm install --production'
  const startCommand = pkg?.scripts?.start ? `CMD ["sh", "-c", "${pkg.scripts.start.replace(/"/g, '\\"')}"]` : 'CMD ["node", "index.js"]'

  return `FROM node:${DEFAULT_NODE_VERSION}
WORKDIR /app
COPY package*.json ./
${install}
COPY . .
EXPOSE 3000
${startCommand}
`
}

const buildPythonDockerfile = () => {
  return `FROM python:${DEFAULT_PYTHON_VERSION}
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
`
}

const buildFlaskDockerfile = () => {
  return `FROM python:${DEFAULT_PYTHON_VERSION}
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0
EXPOSE 5000
CMD ["flask", "run"]
`
}

export const ensureDockerfile = (contextPath) => {
  const existing = findExistingDockerfile(contextPath)
  if (existing) {
    return existing
  }

  const normalizedContext = normalizeRepoRoot(contextPath)
  const appMeta = detectAppType(normalizedContext)
  let dockerfileContent = ''

  switch (appMeta.type) {
    case 'react':
      dockerfileContent = buildReactDockerfile()
      break
    case 'express':
      dockerfileContent = buildExpressDockerfile(appMeta.package)
      break
    case 'python':
      dockerfileContent = buildPythonDockerfile()
      break
    case 'flask':
      dockerfileContent = buildFlaskDockerfile()
      break
    case 'node':
    default:
      dockerfileContent = buildNodeDockerfile(appMeta.package)
      break
  }

  const dockerfilePath = path.join(normalizedContext, 'Dockerfile')
  fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8')
  return dockerfilePath
}

export const validateGithubRepo = (owner, repo) => {
  const normalizedOwner = sanitizeGithubSegment(owner)
  const normalizedRepo = sanitizeGithubSegment(repo)
  if (!normalizedOwner || !normalizedRepo || normalizedOwner !== owner || normalizedRepo !== repo) {
    throw new Error('Invalid repository owner or name')
  }
  return { owner: normalizedOwner, repo: normalizedRepo }
}
