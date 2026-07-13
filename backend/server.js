import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "http";
import { Server as socketIO } from "socket.io";
import DockerOrchestrator from "./utils/dockerOrchestrator.js";
import uploadRoutes from "./routes/upload.js";
import githubRoutes from "./routes/githubRoutes.js";
import passport from "passport";

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new socketIO(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const orchestrator = new DockerOrchestrator(io);

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
app.use(passport.initialize());

// Make io and orchestrator accessible to routes middleware
app.use((req, res, next) => {
  req.io = io;
  req.orchestrator = orchestrator;
  next();
});

// Upload routes
app.use('/api', uploadRoutes);

// GitHub Integration routes
app.use('/api/github', githubRoutes);

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinSession', ({ sessionId }) => {
    if (sessionId) {
      socket.join(sessionId);
      console.log(`Socket ${socket.id} joined session ${sessionId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export { app, io };
