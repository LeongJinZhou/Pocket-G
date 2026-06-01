import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
import Login from './Login';
import { io } from 'socket.io-client';
import Terminal from './components/Terminal';
import Workspace from './components/Workspace';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [socket, setSocket] = useState(null);
  const [hostIp, setHostIp] = useState(localStorage.getItem('pocket_g_host_ip') || 'localhost:3001');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [activeTab, setActiveTab] = useState('workspace'); // 'workspace' or 'terminal'

  // Listen to Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const jwtToken = await currentUser.getIdToken(true);
          setUser(currentUser);
          setToken(jwtToken);
          console.log("Firebase Auth success. Decoded JWT retrieved.");
        } catch (err) {
          console.error("Error retrieving ID token:", err);
          setUser(null);
          setToken(null);
        }
      } else {
        setUser(null);
        setToken(null);
        // Disconnect socket if user signs out
        if (socket) {
          socket.disconnect();
          setSocket(null);
          setConnectionStatus('Disconnected');
        }
      }
    });
    return () => unsubscribe();
  }, [socket]);

  // Connect to Local Gatekeeper (Socket.io)
  const connectToHost = () => {
    if (!token) {
      console.warn("No token available. Cannot connect.");
      return;
    }

    if (socket) {
      socket.disconnect();
    }

    const targetUrl = hostIp.startsWith('http') ? hostIp : `http://${hostIp}`;
    console.log(`Connecting to Socket.io backend at: ${targetUrl}...`);

    localStorage.setItem('pocket_g_host_ip', hostIp);

    const newSocket = io(targetUrl, {
      auth: {
        token: token
      },
      transports: ['websocket'],
      timeout: 10000
    });

    newSocket.on('connect', () => {
      console.log('✓ Connected to Socket.io backend successfully! ID:', newSocket.id);
      setConnectionStatus('Connected');
    });

    newSocket.on('connect_error', (err) => {
      console.error('✗ Socket.io connection error:', err.message);
      setConnectionStatus('Connection Error');
      newSocket.disconnect();
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket.io disconnected. Reason:', reason);
      setConnectionStatus('Disconnected');
    });

    setSocket(newSocket);
  };

  const disconnectFromHost = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setConnectionStatus('Disconnected');
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  if (!user) {
    return <Login />;
  }

  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="app-header">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold' }}>Pocket-G</span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{user.email}</span>
        </div>

        <div className="host-section">
          <input
            type="text"
            className="host-input"
            value={hostIp}
            onChange={(e) => setHostIp(e.target.value)}
            placeholder="Host IP (e.g. 100.x.x.x:3001)"
          />
          {connectionStatus === 'Connected' ? (
            <button className="btn-conn" style={{ backgroundColor: 'var(--error)' }} onClick={disconnectFromHost}>
              Disconnect
            </button>
          ) : (
            <button className="btn-conn" onClick={connectToHost}>
              Connect
            </button>
          )}
          <span className={`status-indicator ${connectionStatus === 'Connected' ? 'connected' : 'disconnected'}`}>
            {connectionStatus}
          </span>
        </div>

        <button
          onClick={handleLogout}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--error)',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Sign Out
        </button>
      </header>

      {/* Main Content Viewports */}
      <main className="app-content">
        {activeTab === 'workspace' && <Workspace socket={socket} />}
        {activeTab === 'terminal' && <Terminal socket={socket} />}
      </main>

      {/* Bottom Navigation tab bar */}
      <nav className="app-nav">
        <button 
          className={`nav-tab-btn ${activeTab === 'workspace' ? 'active' : ''}`}
          onClick={() => setActiveTab('workspace')}
        >
          <span className="nav-tab-icon">📁</span>
          <span className="nav-tab-label">Workspace</span>
        </button>
        <button 
          className={`nav-tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          <span className="nav-tab-icon">💻</span>
          <span className="nav-tab-label">Terminal</span>
        </button>
      </nav>
    </div>
  );
}
