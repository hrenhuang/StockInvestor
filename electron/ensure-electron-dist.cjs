const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const distPath = path.join(electronRoot, 'dist');
const distFixedPath = path.join(electronRoot, 'dist-fixed');
const electronExeName = process.platform === 'win32' ? 'electron.exe' : 'electron';
const distElectronExe = path.join(distPath, electronExeName);
const fixedElectronExe = path.join(distFixedPath, electronExeName);

function log(message) {
  console.log(`[ensure-electron-dist] ${message}`);
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function removeDirectory(targetPath) {
  if (!exists(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, {
    force: true,
    recursive: true,
    maxRetries: 2,
    retryDelay: 150,
  });
}

function copyDirectory(sourcePath, targetPath) {
  removeDirectory(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function getElectronPackageVersion() {
  const packageJsonPath = path.join(electronRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

function getCachedZipPath(version) {
  const cacheRoot = process.env.electron_config_cache || path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache');
  const platform = process.platform;
  const arch = process.arch;
  const zipName = `electron-v${version}-${platform}-${arch}.zip`;

  if (!exists(cacheRoot)) {
    return null;
  }

  const queue = [cacheRoot];
  while (queue.length > 0) {
    const currentPath = queue.shift();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.name === zipName) {
        return entryPath;
      }
    }
  }

  return null;
}

function extractZip(zipPath, targetPath) {
  removeDirectory(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetPath.replace(/'/g, "''")}' -Force`,
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );
}

function ensureFixedDist() {
  if (exists(fixedElectronExe)) {
    log('dist-fixed already available.');
    return;
  }

  if (exists(distElectronExe)) {
    log('Copying valid Electron dist to dist-fixed.');
    copyDirectory(distPath, distFixedPath);
    return;
  }

  const version = getElectronPackageVersion();
  const cachedZipPath = getCachedZipPath(version);

  if (cachedZipPath) {
    log(`Restoring dist-fixed from cache: ${cachedZipPath}`);
    extractZip(cachedZipPath, distFixedPath);
    if (exists(fixedElectronExe)) {
      return;
    }
  }

  throw new Error(
    'Unable to prepare Electron runtime. Expected either node_modules/electron/dist/electron.exe or a cached Electron zip under %LOCALAPPDATA%\\electron\\Cache.'
  );
}

try {
  ensureFixedDist();
} catch (error) {
  console.error(`[ensure-electron-dist] ${error.message}`);
  process.exitCode = 1;
}
