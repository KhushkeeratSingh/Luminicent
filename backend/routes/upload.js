import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { normalizeRepoRoot, ensureDockerfile } from '../utils/dockerfileHelper.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  }
});

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

// POST /api/upload - Handle zip file upload and start simulation
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const sessionId = req.body.sessionId || Date.now().toString();
  const uploadPath = req.file.path;
  const extractPath = path.join('uploads', sessionId);
  const dockerOrchestrator = req.orchestrator;

  try {
    fs.mkdirSync(extractPath, { recursive: true });

    req.io.emit('status', {
      sessionId,
      status: 'EXTRACTING',
      message: 'Extracting application package...'
    });

    const zip = new AdmZip(uploadPath);
    zip.extractAllTo(extractPath, true);

    const buildContext = normalizeRepoRoot(extractPath);
    const dockerfilePath = ensureDockerfile(buildContext);

    req.io.emit('status', {
      sessionId,
      status: 'EXTRACTED',
      message: `Package extracted successfully and Dockerfile ready at ${path.relative(buildContext, dockerfilePath)}`
    });

    const imageName = `devops-sim-${sessionId}`;
    await dockerOrchestrator.buildImage(buildContext, imageName, sessionId);

    const container = await dockerOrchestrator.runContainer(imageName, sessionId);
    await dockerOrchestrator.streamLogs(container, sessionId);

    res.json({
      success: true,
      sessionId,
      message: 'Simulation started'
    });

    setTimeout(async () => {
      await dockerOrchestrator.cleanup(sessionId);
      cleanupPath(extractPath);
    }, 60000);
  } catch (error) {
    console.error('Upload error:', error);
    req.io.emit('status', {
      sessionId,
      status: 'ERROR',
      error: error.message
    });
    cleanupPath(extractPath);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupPath(uploadPath);
  }
});

router.post('/cleanup', express.json(), async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    await req.orchestrator.cleanup(sessionId);
    res.json({ success: true, sessionId, message: 'Simulation stopped' });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
