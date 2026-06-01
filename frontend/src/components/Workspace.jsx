import React, { useEffect, useState } from 'react';

// Recursive Tree Node Renderer
function TreeNode({ node, onFileClick }) {
  const [expanded, setExpanded] = useState(false);

  if (node.type === 'directory') {
    return (
      <div style={{ margin: '4px 0' }}>
        <div 
          className="tree-node-item" 
          onClick={() => setExpanded(!expanded)}
          style={{ userSelect: 'none', display: 'flex', alignItems: 'center' }}
        >
          <span className="tree-node-icon" style={{ fontSize: '15px', marginRight: '6px' }}>
            {expanded ? '📂' : '📁'}
          </span>
          <span style={{ fontWeight: 500 }}>{node.name}</span>
        </div>
        {expanded && node.children && (
          <div className="tree-node-children-list" style={{ paddingLeft: '12px', borderLeft: '1px solid var(--border-color)' }}>
            {node.children.map((child, idx) => (
              <TreeNode key={idx} node={child} onFileClick={onFileClick} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ margin: '4px 0' }}>
      <div 
        className="tree-node-item" 
        onClick={() => onFileClick(node.path)}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        <span className="tree-node-icon" style={{ fontSize: '15px', marginRight: '6px' }}>📄</span>
        <span>{node.name}</span>
      </div>
    </div>
  );
}

export default function Workspace({ socket }) {
  const [fileTree, setFileTree] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // 1. Fetch file tree structure on load
    if (socket && socket.connected) {
      socket.emit('get_file_tree');
    }

    // 2. Listen to file tree events
    const handleFileTree = (tree) => {
      setFileTree(tree);
      setErrorMsg('');
    };

    const handleTreeError = (err) => {
      setErrorMsg(typeof err === 'string' ? err : 'Failed to list directory tree');
    };

    // 3. Listen to file content events
    const handleFileContent = (data) => {
      setActiveFile(data.path);
      setFileContent(data.content);
    };

    const handleFileError = (data) => {
      alert(`File Error (${data.path}): ${data.error}`);
    };

    socket.on('file_tree', handleFileTree);
    socket.on('file_tree_error', handleTreeError);
    socket.on('file_content', handleFileContent);
    socket.on('fetch_file_content_error', handleFileError);

    // Cleanup listeners on unmount
    return () => {
      socket.off('file_tree', handleFileTree);
      socket.off('file_tree_error', handleTreeError);
      socket.off('file_content', handleFileContent);
      socket.off('fetch_file_content_error', handleFileError);
    };
  }, [socket]);

  const handleFileClick = (path) => {
    if (socket && socket.connected) {
      socket.emit('fetch_file_content', path);
    } else {
      alert('Connection lost. Please reconnect to host.');
    }
  };

  const refreshTree = () => {
    if (socket && socket.connected) {
      socket.emit('get_file_tree');
    }
  };

  return (
    <div className="workspace-view-container">
      {/* Collapsible Folder List Sidebar */}
      <div className="workspace-sidebar">
        <div className="workspace-title-bar">
          <h3>ACTIVE_WORKSPACE</h3>
          <button 
            onClick={refreshTree} 
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            ↻
          </button>
        </div>
        {errorMsg && <p style={{ color: 'var(--error)', fontSize: '13px' }}>{errorMsg}</p>}
        {fileTree ? (
          <TreeNode node={fileTree} onFileClick={handleFileClick} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
            Loading file tree structure...
          </p>
        )}
      </div>

      {/* Code viewer panel */}
      <div className="workspace-main">
        <div className="file-viewer-header">
          <span className="file-viewer-path">{activeFile || 'No File Selected'}</span>
        </div>
        <div className="file-viewer-body">
          <pre className="code-block-pre">
            <code className="code-block-code">
              {fileContent || '// Select a file from the tree to view its contents.'}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
