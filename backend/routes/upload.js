import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import {normalizeRepoRoot,ensureDockerfile,findBuildContext} from "../utils/dockerfileHelper.js";
import { analyzeProduction } from "../utils/productionAnalyzer.js";

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

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'EXTRACTING',
      stage: 'extract',
      type: 'info',
      percent: 10,
      message: 'Extracting application package...'
    });

    const zip = new AdmZip(uploadPath);
    zip.extractAllTo(extractPath, true);

    const repoRoot = normalizeRepoRoot(extractPath);
    const buildContext = findBuildContext(repoRoot);
    console.log("Build Context:", buildContext);
    console.log("Files in Build Context:");
    console.log(fs.readdirSync(buildContext));
    const dockerfilePath = ensureDockerfile(buildContext);

    dockerOrchestrator.emitStatus(sessionId, {
      status: 'EXTRACTED',
      stage: 'extract',
      type: 'success',
      percent: 20,
      message: `Package extracted successfully and Dockerfile ready at ${path.relative(buildContext, dockerfilePath)}`
    });

    const imageName = `devops-sim-${sessionId}`;
    console.log("Session ID:", sessionId);
    console.log("Image Name:", imageName);
    await dockerOrchestrator.buildImage(
    buildContext,
    imageName,
    sessionId,
    dockerfilePath
    );

    const container = await dockerOrchestrator.runContainer(imageName, sessionId);

    const report = await analyzeProduction(
      buildContext,
      imageName,
      container
    );

    console.log("========== Production Report ==========");
    console.log(JSON.stringify(report, null, 2));

    dockerOrchestrator.emit(sessionId, 'production-report', {
      sessionId,
      report
    });

    await dockerOrchestrator.streamLogs(container, sessionId);

    res.json({
      success: true,
      sessionId,
      report,
      message: 'Simulation completed'
    });

    setTimeout(async () => {
      await dockerOrchestrator.cleanup(sessionId);
      cleanupPath(extractPath);
    }, 60000);
  } catch (error) {
    console.error('Upload error:', error);
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
