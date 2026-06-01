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

// Import node-pty and os
const pty = require('node-pty');
const os = require('os');

// Detect default shell
const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'zsh');

// Security Command Blacklist Regex
const COMMAND_BLACKLIST = /rm\s+-rf|sudo\s|dd\s+if=|:\(\)\{\s*:\|:&\}\s*;/i;

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

// Path Traversal Protection Helper
function validatePath(targetPath) {
  if (!ACTIVE_WORKSPACE) {
    throw new Error('ACTIVE_WORKSPACE is not configured');
  }
  // Resolve absolute path
  const absolutePath = path.resolve(ACTIVE_WORKSPACE, targetPath);
  
  // Strict descendant checking
  const isSelf = absolutePath === ACTIVE_WORKSPACE;
  const isDescendant = absolutePath.startsWith(ACTIVE_WORKSPACE + path.sep);
  
  if (!isSelf && !isDescendant) {
    const error = new Error('Access Denied: Path traversal detected');
    error.status = 403;
    throw error;
  }
  return absolutePath;
}

// Directory Tree Generator
function getDirectoryTree(dirPath) {
  const stats = fs.statSync(dirPath);
  const info = {
    name: path.basename(dirPath),
    path: path.relative(ACTIVE_WORKSPACE, dirPath) || '.',
  };

  if (stats.isDirectory()) {
    info.type = 'directory';
    const files = fs.readdirSync(dirPath);
    info.children = files
      .filter(file => file !== 'node_modules' && file !== '.git' && file !== '.claude' && file !== '.gemini')
      .map(file => {
        try {
          return getDirectoryTree(path.join(dirPath, file));
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } else {
    info.type = 'file';
  }
  return info;
}

// WebSocket Connection Handler
io.on('connection', (socket) => {
  console.log(`Socket connection established: ${socket.id}`);

  // Spawn node-pty process for the user session
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: ACTIVE_WORKSPACE || process.env.HOME,
    env: {
      ...process.env,
      PS1: 'pocket-g:\\w\\$ ' // Secure custom prompt indicator
    }
  });

  socket.ptyProcess = ptyProcess;
  let lineBuffer = '';

  // Stream data from pty to socket client via 'terminal_output'
  ptyProcess.onData((data) => {
    socket.emit('terminal_output', data);
  });

  // Handle keystroke data from client via 'terminal_input'
  socket.on('terminal_input', (data) => {
    if (!socket.ptyProcess) return;

    // Iterate over incoming characters for line buffering
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (char === '\r' || char === '\n') {
        // Evaluate command line buffer against blacklist
        if (COMMAND_BLACKLIST.test(lineBuffer.trim())) {
          console.warn(`[SECURITY ALERT] User tried to execute blacklisted command: "${lineBuffer}"`);
          
          // Print red warning to terminal
          socket.emit('terminal_output', '\r\n\x1b[31;1m[SECURITY BLOCK] Command execution blocked!\x1b[0m\r\n');
          
          // Send interrupt to pty to clear the current line buffer on host shell
          socket.ptyProcess.write('\x03');
          lineBuffer = '';
          return;
        }
        lineBuffer = '';
      } else if (char === '\x7f' || char === '\b') {
        // Backspace
        if (lineBuffer.length > 0) {
          lineBuffer = lineBuffer.slice(0, -1);
        }
      } else if (char === '\x03') {
        // Ctrl+C
        lineBuffer = '';
      } else if (char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126) {
        // Only buffer printable characters
        lineBuffer += char;
      }
    }

    // Forward the input stream to node-pty
    socket.ptyProcess.write(data);
  });

  // Resize terminal event
  socket.on('terminal_resize', (size) => {
    if (socket.ptyProcess && size && typeof size.cols === 'number' && typeof size.rows === 'number') {
      try {
        socket.ptyProcess.resize(size.cols, size.rows);
      } catch (err) {
        console.error('Failed to resize PTY:', err);
      }
    }
  });

  // Live File Tree request handler
  socket.on('get_file_tree', () => {
    try {
      if (!ACTIVE_WORKSPACE) {
        return socket.emit('file_tree_error', 'ACTIVE_WORKSPACE not configured on backend.');
      }
      const tree = getDirectoryTree(ACTIVE_WORKSPACE);
      socket.emit('file_tree', tree);
    } catch (error) {
      console.error('Error listing directory tree:', error);
      socket.emit('file_tree_error', 'Failed to list directory tree.');
    }
  });

  // Live File Content request handler
  socket.on('fetch_file_content', (relativePath) => {
    try {
      const securePath = validatePath(relativePath);
      const stats = fs.statSync(securePath);
      
      if (!stats.isFile()) {
        return socket.emit('fetch_file_content_error', { path: relativePath, error: 'Path is not a file' });
      }

      fs.readFile(securePath, 'utf8', (err, data) => {
        if (err) {
          console.error(`Error reading file ${relativePath}:`, err.message);
          return socket.emit('fetch_file_content_error', { path: relativePath, error: err.message });
        }
        socket.emit('file_content', { path: relativePath, content: data });
      });
    } catch (error) {
      console.error(`Error validating file ${relativePath}:`, error.message);
      const status = error.status || 500;
      socket.emit('fetch_file_content_error', { 
        path: relativePath, 
        error: `${status} Forbidden: Access Denied` 
      });
    }
  });

  // Auto-kill on disconnect
  socket.on('disconnect', () => {
    console.log(`Socket connection closed: ${socket.id}`);
    if (socket.ptyProcess) {
      console.log(`Killing PTY process (PID: ${socket.ptyProcess.pid}) for socket ${socket.id}`);
      try {
        socket.ptyProcess.kill();
      } catch (e) {
        console.error('Error killing PTY:', e);
      }
      socket.ptyProcess = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Pocket-G gatekeeper backend listening on port ${PORT}`);
  console.log(`Authorized Email target: ${AUTHORIZED_EMAIL}`);
  console.log(`Active Workspace sandbox path: ${ACTIVE_WORKSPACE}`);
});
