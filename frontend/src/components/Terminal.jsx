import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function Terminal({ socket }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [ctrlActive, setCtrlActive] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm instance
    const term = new XTerm({
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

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.write('\x1b[35;1mPocket-G Terminal Emulator\x1b[0m\r\n');
    term.write('Connected to host PTY streams after session is established...\r\n\n');

    // Handle incoming data from backend
    const handleTerminalOutput = (data) => {
      term.write(data);
    };
    socket.on('terminal_output', handleTerminalOutput);

    // Handle user keystrokes in terminal
    const disposableOnData = term.onData((data) => {
      if (!socket || !socket.connected) return;

      // Handle Ctrl modifier action
      if (ctrlActive) {
        setCtrlActive(false);
        if (data.length === 1) {
          const code = data.charCodeAt(0);
          if (code >= 65 && code <= 90) { // A-Z
            socket.emit('terminal_input', String.fromCharCode(code - 64));
            return;
          } else if (code >= 97 && code <= 122) { // a-z
            socket.emit('terminal_input', String.fromCharCode(code - 96));
            return;
          }
        }
      }
      socket.emit('terminal_input', data);
    });

    // Handle window resize event
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        socket.emit('terminal_resize', {
          cols: term.cols,
          rows: term.rows
        });
      }
    };
    window.addEventListener('resize', handleResize);

    // Initial resize trigger to backend
    setTimeout(() => {
      handleResize();
    }, 100);

    // Cleanup listeners
    return () => {
      socket.off('terminal_output', handleTerminalOutput);
      disposableOnData.dispose();
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [socket, ctrlActive]);

  // Click handler for mobile shortcut row keys
  const handleShortcutPress = (key) => {
    if (!socket || !socket.connected) return;

    switch (key) {
      case 'Tab':
        socket.emit('terminal_input', '\t');
        break;
      case 'Esc':
        socket.emit('terminal_input', '\x1b');
        break;
      case 'Up':
        socket.emit('terminal_input', '\x1b[A');
        break;
      case 'Down':
        socket.emit('terminal_input', '\x1b[B');
        break;
      case 'Ctrl':
        setCtrlActive(!ctrlActive);
        break;
      default:
        break;
    }
    if (termRef.current) {
      termRef.current.focus();
    }
  };

  return (
    <div className="terminal-view-container">
      {/* Mobile Developer Shortcuts bar */}
      <div className="terminal-shortcut-bar">
        <button className="shortcut-btn" onClick={() => handleShortcutPress('Esc')}>Esc</button>
        <button 
          className={`shortcut-btn ${ctrlActive ? 'active' : ''}`} 
          onClick={() => handleShortcutPress('Ctrl')}
        >
          Ctrl
        </button>
        <button className="shortcut-btn" onClick={() => handleShortcutPress('Tab')}>Tab</button>
        <button className="shortcut-btn" onClick={() => handleShortcutPress('Up')}>▲</button>
        <button className="shortcut-btn" onClick={() => handleShortcutPress('Down')}>▼</button>
      </div>

      {/* Terminal mount element */}
      <div ref={containerRef} className="xterm-container-el" />
    </div>
  );
}
