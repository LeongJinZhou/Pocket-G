import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from './firebaseConfig';

export default function Login() {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Firebase login error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#0a0d14',
      color: '#f0f3f6',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        backgroundColor: '#121620',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        textAlign: 'center',
        width: '320px'
      }}>
        <h1 style={{ marginBottom: '16px' }}>Pocket-G</h1>
        <p style={{ color: '#8892b0', fontSize: '14px', marginBottom: '32px' }}>
          Secure Stateless Remote Antigravity Client
        </p>
        
        {error && (
          <div style={{
            color: '#ff4d4f',
            fontSize: '13px',
            marginBottom: '16px',
            backgroundColor: 'rgba(255, 77, 79, 0.1)',
            padding: '8px',
            borderRadius: '4px'
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            padding: '12px 24px',
            backgroundColor: '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '15px',
            fontWeight: 'bold',
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}
