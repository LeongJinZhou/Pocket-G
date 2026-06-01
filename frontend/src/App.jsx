import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
import Login from './Login';
import { io } from 'socket.io-client';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [socket, setSocket] = useState(null);
  const [hostIp, setHostIp] = useState(localStorage.getItem('pocket_g_host_ip') || 'localhost:3001');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

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

  const handleLogout = () => {
    signOut(auth);
  };

  if (!user) {
    return <Login />;
  }

  return (
    <div style={{
      padding: '24px',
      backgroundColor: '#0a0d14',
      color: '#f0f3f6',
      height: '100vh',
      fontFamily: 'sans-serif'
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #1e293b',
        paddingBottom: '16px',
        marginBottom: '24px'
      }}>
        <div>
          <h2>Pocket-G Workspace</h2>
          <span style={{ fontSize: '12px', color: '#8892b0' }}>Authenticated as: {user.email}</span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </header>

      <main style={{
        backgroundColor: '#121620',
        padding: '24px',
        borderRadius: '8px',
        border: '1px solid #1e293b',
        maxWidth: '500px'
      }}>
        <h3>Host Gateway Connection</h3>
        <p style={{ fontSize: '13px', color: '#8892b0', marginBottom: '16px' }}>
          Connect to the gatekeeper server running on your macOS host Tailscale IP address.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '12px', fontWeight: 'bold' }}>MacBook Host IP Address</label>
          <input
            type="text"
            value={hostIp}
            onChange={(e) => setHostIp(e.target.value)}
            placeholder="e.g. 100.x.x.x:3001"
            style={{
              padding: '10px',
              backgroundColor: '#0a0d14',
              color: '#fff',
              border: '1px solid #1e293b',
              borderRadius: '4px'
            }}
          />

          <button
            onClick={connectToHost}
            style={{
              padding: '12px',
              backgroundColor: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginTop: '8px'
            }}
          >
            Connect to Backend
          </button>
        </div>

        <div style={{ marginTop: '24px', borderTop: '1px solid #1e293b', paddingTop: '16px' }}>
          <span style={{ fontSize: '13px' }}>
            Connection Status:{' '}
            <strong style={{
              color: connectionStatus === 'Connected' ? '#10b981' :
                     connectionStatus === 'Disconnected' ? '#ef4444' : '#f59e0b'
            }}>
              {connectionStatus}
            </strong>
          </span>
        </div>
      </main>
    </div>
  );
}
