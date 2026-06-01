import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// --- State Variables ---
let authInstance = null;
let firebaseIdToken = null;
let socket = null;
let currentActiveTab = 'workspace';
let term = null;
let fitAddon = null;
let ctrlActive = false; // State for on-screen Ctrl key modifier

// --- DOM Elements ---
const elAuthScreen = document.getElementById('auth-screen');
const elMainScreen = document.getElementById('main-screen');
const elAuthStatus = document.getElementById('auth-status-message');
const elBtnLogin = document.getElementById('btn-login');
const elUserEmail = document.getElementById('header-user-email');
const elHostIp = document.getElementById('host-ip-input');
const elBtnConnect = document.getElementById('btn-connect');
const elConnStatus = document.getElementById('connection-status');
const elFileTree = document.getElementById('file-tree-container');
const elFilePath = document.getElementById('view-file-path');
const elCodeViewer = document.getElementById('code-viewer-block');
const elRefreshTree = document.getElementById('btn-refresh-tree');

// --- Tab Buttons ---
const elTabBtns = {
  workspace: document.getElementById('nav-btn-workspace'),
  terminal: document.getElementById('nav-btn-terminal')
};
const elTabContents = {
  workspace: document.getElementById('tab-workspace'),
  terminal: document.getElementById('tab-terminal')
};

// Initialize Firebase
try {
  if (firebaseConfig.apiKey === "YOUR_API_KEY_HERE") {
    console.warn("Firebase credentials not configured. Auth screens will display a configuration warning.");
    elAuthStatus.textContent = "Please configure your Firebase credentials in firebase-config.js";
  } else {
    const firebaseApp = initializeApp(firebaseConfig);
    authInstance = getAuth(firebaseApp);
    setupAuthListeners();
  }
} catch (error) {
  console.error("Firebase init failed:", error);
  elAuthStatus.textContent = "Firebase initialization failed.";
}

// --- Firebase Authentication Flow ---
function setupAuthListeners() {
  elAuthStatus.textContent = "Checking auth status...";
  elBtnLogin.style.display = 'none';

  onAuthStateChanged(authInstance, async (user) => {
    if (user) {
      elAuthStatus.textContent = `Welcome, ${user.email}. Generating session key...`;
      try {
        // Force refresh of the token
        firebaseIdToken = await user.getIdToken(true);
        elUserEmail.textContent = user.email;
        
        // Show main dashboard screen
        elAuthScreen.classList.remove('active');
        elMainScreen.classList.add('active');
        
        // Load last host IP from localStorage if exists
        const savedIp = localStorage.getItem('pocket_g_host_ip');
        if (savedIp) {
          elHostIp.value = savedIp;
        }
      } catch (err) {
        console.error("Error retrieving token:", err);
        elAuthStatus.textContent = "Failed to generate token. Try signing in again.";
        elBtnLogin.style.display = 'flex';
      }
    } else {
      elAuthScreen.classList.add('active');
      elMainScreen.classList.remove('active');
      elAuthStatus.textContent = "Please sign in to proceed.";
      elBtnLogin.style.display = 'flex';
    }
  });

  elBtnLogin.addEventListener('click', async () => {
    elAuthStatus.textContent = "Redirecting to Google...";
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(authInstance, provider);
    } catch (error) {
      console.error("Login failed:", error);
      elAuthStatus.textContent = `Sign-in failed: ${error.message}`;
    }
  });
}

// --- Tab Swapping ---
Object.keys(elTabBtns).forEach(tabName => {
  elTabBtns[tabName].addEventListener('click', () => {
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  currentActiveTab = tabName;
  
  // Update Tab buttons styling
  Object.keys(elTabBtns).forEach(name => {
    if (name === tabName) {
      elTabBtns[name].classList.add('active');
      elTabContents[name].classList.add('active');
    } else {
      elTabBtns[name].classList.remove('active');
      elTabContents[name].classList.remove('active');
    }
  });

  // Re-adjust terminal size on tab activate
  if (tabName === 'terminal') {
    initTerminalOnce();
    setTimeout(() => {
      if (fitAddon) {
        fitAddon.fit();
        // Notify backend of terminal dimensions
        if (socket && socket.connected && term) {
          socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
        }
      }
    }, 50);
  }
}

// --- Socket.io Host Connection ---
elBtnConnect.addEventListener('click', () => {
  if (socket && socket.connected) {
    disconnectSocket();
  } else {
    connectSocket();
  }
});

function connectSocket() {
  const host = elHostIp.value.trim();
  if (!host) {
    alert("Please specify a host IP:port address");
    return;
  }

  // Support tailscale connection directly (adds http/https protocol prefix)
  const hostUrl = host.startsWith('http') ? host : `http://${host}`;
  elBtnConnect.disabled = true;
  elBtnConnect.textContent = "Connecting...";
  
  localStorage.setItem('pocket_g_host_ip', host);

  // Initialize socket
  socket = io(hostUrl, {
    auth: {
      token: firebaseIdToken
    },
    transports: ['websocket'],
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log("Connected to local gatekeeper");
    elBtnConnect.disabled = false;
    elBtnConnect.textContent = "Disconnect";
    elBtnConnect.style.backgroundColor = "var(--error)";
    
    elConnStatus.textContent = "Online";
    elConnStatus.classList.remove('disconnected');
    elConnStatus.classList.add('connected');
    
    // Refresh File Tree on load
    socket.emit('get-workspace-tree');
  });

  socket.on('connect_error', (error) => {
    console.error("Socket connection error:", error);
    alert(`Connection failed: ${error.message}`);
    disconnectSocket();
  });

  socket.on('disconnect', () => {
    console.log("Disconnected from local gatekeeper");
    disconnectSocket();
  });

  // File System Handlers
  socket.on('workspace-tree', (tree) => {
    renderFileTree(tree);
  });

  socket.on('workspace-tree-error', (err) => {
    elFileTree.innerHTML = `<p class="placeholder-text" style="color: var(--error);">${err}</p>`;
  });

  socket.on('file-content', (data) => {
    elFilePath.textContent = data.path;
    
    // Set file text content
    elCodeViewer.textContent = data.content;
    
    // Detect extension and auto-load highlighting class
    const ext = data.path.split('.').pop() || '';
    elCodeViewer.className = `language-${ext}`;
    
    // Trigger Prism Highlight
    if (window.Prism) {
      window.Prism.highlightElement(elCodeViewer);
    }
  });

  socket.on('file-read-error', (data) => {
    alert(`Failed to load file "${data.path}": ${data.error}`);
  });

  // Terminal Handlers
  socket.on('terminal-output', (data) => {
    if (term) {
      term.write(data);
    }
  });
}

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  elBtnConnect.disabled = false;
  elBtnConnect.textContent = "Connect";
  elBtnConnect.style.backgroundColor = "var(--accent)";
  
  elConnStatus.textContent = "Offline";
  elConnStatus.classList.remove('connected');
  elConnStatus.classList.add('disconnected');
  
  elFileTree.innerHTML = '<p class="placeholder-text">Please connect to host to view file tree.</p>';
  elFilePath.textContent = "No File Selected";
  elCodeViewer.textContent = "// Select a file from the tree to view its content.";
  elCodeViewer.className = "language-javascript";
  
  if (term) {
    term.write('\r\n\x1b[31;1m[Offline] Connection closed.\x1b[0m\r\n');
  }
}

// --- File Tree Renderer ---
function renderFileTree(treeNode) {
  elFileTree.innerHTML = '';
  if (!treeNode) return;
  
  const treeRoot = buildTreeHTML(treeNode);
  elFileTree.appendChild(treeRoot);
}

function buildTreeHTML(node) {
  const container = document.createElement('div');
  container.className = 'tree-node';

  const item = document.createElement('div');
  item.className = 'tree-item';
  
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = node.type === 'directory' ? '📁' : '📄';
  
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = node.name;

  item.appendChild(icon);
  item.appendChild(label);
  container.appendChild(item);

  if (node.type === 'directory') {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-node-children';
    
    // Sort directories first, then alphabetically
    const sortedChildren = (node.children || []).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    sortedChildren.forEach(child => {
      childrenContainer.appendChild(buildTreeHTML(child));
    });

    container.appendChild(childrenContainer);

    // Directory click toggles collapse/expand
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = childrenContainer.classList.toggle('expanded');
      icon.textContent = isExpanded ? '📂' : '📁';
    });
  } else {
    // File click fetches content from host
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (socket && socket.connected) {
        socket.emit('read-file', node.path);
      } else {
        alert("Not connected to host");
      }
    });
  }

  return container;
}

elRefreshTree.addEventListener('click', () => {
  if (socket && socket.connected) {
    socket.emit('get-workspace-tree');
  }
});

// --- Terminal (xterm.js) Integration ---
function initTerminalOnce() {
  if (term) return; // Already initialized

  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Fira Code, monospace',
    fontSize: 12,
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      magenta: '#9e7cfc',
      cyan: '#00e5ff'
    }
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  
  const container = document.getElementById('terminal-container');
  term.open(container);
  fitAddon.fit();

  term.write('\x1b[35;1mPocket-G Terminal Emulator\x1b[0m\r\n');
  term.write('Connecting to host PTY streams after session is established...\r\n\n');

  // Handle client keystrokes
  term.onData((data) => {
    if (!socket || !socket.connected) return;

    if (ctrlActive) {
      // Intercept keystroke for Ctrl shortcut modifier logic
      ctrlActive = false;
      const ctrlBtn = document.querySelector('.kbd-btn[data-key="Ctrl"]');
      if (ctrlBtn) ctrlBtn.style.backgroundColor = '';

      if (data.length === 1) {
        const code = data.charCodeAt(0);
        // Map keys A-Z (upper and lower) to control codes
        if (code >= 65 && code <= 90) { // Uppercase A-Z
          socket.emit('terminal-input', String.fromCharCode(code - 64));
          return;
        } else if (code >= 97 && code <= 122) { // Lowercase a-z
          socket.emit('terminal-input', String.fromCharCode(code - 96));
          return;
        }
      }
    }

    socket.emit('terminal-input', data);
  });

  // Attach Resize listener
  window.addEventListener('resize', () => {
    if (currentActiveTab === 'terminal' && fitAddon) {
      fitAddon.fit();
      if (socket && socket.connected) {
        socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
      }
    }
  });

  setupShortcutRow();
}

// Mobile Developer Shortcut Row
function setupShortcutRow() {
  const btns = document.querySelectorAll('.kbd-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!socket || !socket.connected) return;
      
      const keyType = btn.getAttribute('data-key');
      
      switch(keyType) {
        case 'Tab':
          socket.emit('terminal-input', '\t');
          break;
        case 'Esc':
          socket.emit('terminal-input', '\x1b');
          break;
        case 'Up':
          socket.emit('terminal-input', '\x1b[A');
          break;
        case 'Down':
          socket.emit('terminal-input', '\x1b[B');
          break;
        case 'Clear':
          term.clear();
          break;
        case 'Ctrl':
          ctrlActive = !ctrlActive;
          btn.style.backgroundColor = ctrlActive ? 'var(--accent)' : '';
          break;
      }
      term.focus();
    });
  });
}
