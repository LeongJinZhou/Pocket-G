// Unit tests to verify the security and logic components of the local gatekeeper
const path = require('path');
const fs = require('fs');

console.log("=== Pocket-G Gatekeeper Security Validation ===");

// 1. Blacklist Check
const BLACKLIST_REGEX = /rm\s+-rf|sudo\s|dd\s+if=|:\(\)\{\s*:\|:&\}\s*;/i;

const testCommands = [
  { cmd: "ls -la", expected: false },
  { cmd: "rm -rf /", expected: true },
  { cmd: "sudo apt-get update", expected: true },
  { cmd: "dd if=/dev/zero of=test", expected: true },
  { cmd: "echo rm -rf", expected: true }, // strict containment block
  { cmd: "cat /etc/passwd", expected: false },
];

console.log("\nTesting Command Blacklist Regex:");
let blacklistPass = true;
testCommands.forEach(tc => {
  const isMatch = BLACKLIST_REGEX.test(tc.cmd);
  if (isMatch === tc.expected) {
    console.log(`  ✓ "${tc.cmd}" -> Blocked: ${isMatch} (PASSED)`);
  } else {
    console.error(`  ✗ "${tc.cmd}" -> Blocked: ${isMatch} (FAILED, expected: ${tc.expected})`);
    blacklistPass = false;
  }
});

// Mock ACTIVE_WORKSPACE for traversal validation
const ACTIVE_WORKSPACE = path.resolve(__dirname, 'mock_workspace');
if (!fs.existsSync(ACTIVE_WORKSPACE)){
  fs.mkdirSync(ACTIVE_WORKSPACE);
}

function validatePath(targetPath) {
  const absolutePath = path.resolve(ACTIVE_WORKSPACE, targetPath);
  const isSelf = absolutePath === ACTIVE_WORKSPACE;
  const isDescendant = absolutePath.startsWith(ACTIVE_WORKSPACE + path.sep);
  if (!isSelf && !isDescendant) {
    throw new Error('Access Denied: Path traversal detected');
  }
  return absolutePath;
}

const testPaths = [
  { p: "src/index.js", expectedSafe: true },
  { p: ".", expectedSafe: true },
  { p: "../outside_workspace.txt", expectedSafe: false },
  { p: "src/../../outside.js", expectedSafe: false },
  { p: "src/../index.js", expectedSafe: true },
  // check sibling names starting with same prefix
  { p: "../mock_workspace-sibling/file.txt", expectedSafe: false }
];

console.log("\nTesting Path Traversal Sandboxing:");
let traversalPass = true;
testPaths.forEach(tp => {
  try {
    const res = validatePath(tp.p);
    if (tp.expectedSafe) {
      console.log(`  ✓ "${tp.p}" resolved to safe path: ${res} (PASSED)`);
    } else {
      console.error(`  ✗ "${tp.p}" resolved successfully but should be BLOCKED (FAILED)`);
      traversalPass = false;
    }
  } catch (error) {
    if (!tp.expectedSafe) {
      console.log(`  ✓ "${tp.p}" blocked with error: "${error.message}" (PASSED)`);
    } else {
      console.error(`  ✗ "${tp.p}" threw unexpected error: "${error.message}" (FAILED)`);
      traversalPass = false;
    }
  }
});

// Cleanup mock workspace
fs.rmdirSync(ACTIVE_WORKSPACE);

console.log("\n--- Validation Summary ---");
if (blacklistPass && traversalPass) {
  console.log("All unit tests PASSED successfully.");
  process.exit(0);
} else {
  console.error("Some security checks FAILED. Please review code.");
  process.exit(1);
}
