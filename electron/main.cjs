const path = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');

const { app: electronApp, BrowserWindow, Menu, Tray, nativeImage, shell } = require('electron');

let mainWindow = null;
let httpServer = null;
let tray = null;
let serviceUrl = '';
let isQuitting = false;

async function startBackend() {
  if (httpServer) return serviceUrl;
  const appRoot = electronApp.getAppPath();
  const dataDir = path.join(electronApp.getPath('userData'), 'data');
  const logDir = path.join(electronApp.getPath('userData'), 'logs');
  const { createApp } = await import(pathToFileURL(path.join(appRoot, 'src', 'app.js')).href);
  const { createRuntimeLogger } = await import(pathToFileURL(path.join(appRoot, 'src', 'runtime-log.js')).href);
  const logger = createRuntimeLogger({ logDir, service: 'wecom-scheduled-webhook-electron' });
  const startedAt = new Date().toISOString();
  const runtime = {
    mode: 'electron',
    startedAt
  };
  const { app } = await createApp({
    rootDir: appRoot,
    dataDir,
    logger,
    runtime
  });

  httpServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const { port } = httpServer.address();
  runtime.port = port;
  serviceUrl = `http://127.0.0.1:${port}/`;
  logger.info('server-listening', { url: serviceUrl, port });
  return serviceUrl;
}

async function createWindow() {
  const url = await startBackend();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: '企业微信定时消息推送',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  await mainWindow.loadURL(url);
}

function showMainWindow() {
  if (!mainWindow) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('企业微信定时消息推送');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: showMainWindow
    },
    {
      label: '隐藏窗口',
      click: () => mainWindow?.hide()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        electronApp.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
}

function createTrayIcon() {
  return nativeImage.createFromBuffer(createPng(16, 16, (x, y) => {
    const inBox = x >= 2 && x <= 13 && y >= 3 && y <= 12;
    const inFold = x >= 10 && y >= 3 && x + y <= 17;
    const inDot = x >= 5 && x <= 10 && y >= 7 && y <= 8;
    if (inDot) return [255, 255, 255, 255];
    if (inFold) return [90, 168, 255, 255];
    if (inBox) return [34, 111, 187, 255];
    return [0, 0, 0, 0];
  }));
}

function createPng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([header, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

electronApp.whenReady().then(async () => {
  createTray();
  await createWindow();
});

electronApp.on('activate', () => {
  showMainWindow();
});

electronApp.on('window-all-closed', () => {
  // Keep the scheduler alive in tray mode until the user chooses Quit.
});

electronApp.on('before-quit', () => {
  isQuitting = true;
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});
