const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const AUTHORIZED_EMAIL = process.env.AUTHORIZED_EMAIL;
const ACTIVE_WORKSPACE = process.env.ACTIVE_WORKSPACE ? path.resolve(process.env.ACTIVE_WORKSPACE) : null;

// Initialize Firebase Admin SDK
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccountPath) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin using certificate path:', error);
    process.exit(1);
  }
} else {
  // Try default credentials or environment variables fallback
  try {
    admin.initializeApp();
    console.log('Firebase Admin SDK initialized using default application credentials.');
  } catch (error) {
    console.warn('Firebase Admin SDK initialization warning: No credentials provided. Token validation will fail.');
  }
}

// Create HTTP and Socket.io Server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Tailscale environment, adjust in production
    methods: ['GET', 'POST']
  }
});

// Identity Verification: Intercept WebSocket Upgrade
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.error('Connection rejected: Missing auth token');
    return next(new Error('Authentication failed: Missing token'));
  }

  try {
    // Verify Firebase JWT ID Token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;

    // Check against authorized email list
    if (!email || email !== AUTHORIZED_EMAIL) {
      console.error(`Connection rejected: Email ${email} is not authorized`);
      return next(new Error('Authentication failed: Email not authorized'));
    }

    console.log(`Connection approved: User ${email} connected`);
    socket.user = decodedToken;
    next();
  } catch (error) {
    console.error('Connection rejected: Invalid Firebase token', error);
    return next(new Error('Authentication failed: Invalid token'));
  }
});

// Server endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', workspace: ACTIVE_WORKSPACE });
});

io.on('connection', (socket) => {
  console.log(`Socket connection established: ${socket.id}`);

  // Auto-kill placeholder (will be implemented in next step)
  socket.on('disconnect', () => {
    console.log(`Socket connection closed: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Pocket-G gatekeeper backend listening on port ${PORT}`);
  console.log(`Authorized Email target: ${AUTHORIZED_EMAIL}`);
  console.log(`Active Workspace sandbox path: ${ACTIVE_WORKSPACE}`);
});
