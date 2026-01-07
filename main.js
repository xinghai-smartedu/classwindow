const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require('electron/main');
const path = require('path');
const fs = require('fs');
const { nativeImage } = require('electron/common');

// 引入启动台模块
const { 
  addLaunchpadApp, 
  removeLaunchpadApp, 
  getLaunchpadApps,
  launchAppOrLink
} = require('./launchpad');

let iconPath;

let resourcesRoot = path.resolve(app.getAppPath());

let CONFIG_PATH = path.join(__dirname, 'data/config.json');

if (app.isPackaged) {
  iconPath = path.join(resourcesRoot, "assets/logo.png");
  // 在打包应用中，将配置文件存储在可执行文件的同级目录
  const appDir = path.dirname(app.getPath('exe'));
  const CONFIG_DIR = path.join(appDir, 'data');
  CONFIG_PATH = path.join(CONFIG_DIR, 'data/config.json');
} else {
  iconPath = path.join(__dirname, "assets/logo.png");
  CONFIG_PATH = path.join(__dirname, 'data/config.json');
}

// 确保配置目录存在
const ensureConfigDir = () => {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// 读取配置文件
const loadConfig = () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('读取配置文件失败:', err);
  }
  return {};
};

// 保存配置文件
const saveConfig = (config) => {
  try {
    ensureConfigDir();
    config.timestamp = Date.now();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('保存配置文件失败:', err);
  }
};

// 获取默认位置（右上角）
const getDefaultPosition = () => {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  return [width - 320, 20];
};

// 读取/保存窗口位置
const loadWindowPosition = () => {
  const config = loadConfig();
  if (config.window?.x !== undefined && config.window?.y !== undefined) {
    return [config.window.x, config.window.y];
  }
  return getDefaultPosition();
};

const saveWindowPosition = (x, y) => {
  const config = loadConfig();
  config.window = { x, y };
  saveConfig(config);
};

// 主窗口
let mainWindow;

const createWindow = () => {
  const [defaultX, defaultY] = loadWindowPosition();
  
  // 读取置顶设置
  const config = loadConfig();
  const isAlwaysOnTop = config.alwaysOnTop !== undefined ? config.alwaysOnTop : false;
  const isDarkThemeEnabled = config.darkThemeEnabled !== undefined ? config.darkThemeEnabled : false; // 读取暗色主题设置
  
  mainWindow = new BrowserWindow({
    width: 300,
    x: defaultX,
    y: defaultY,
    // 设置为无边框窗口
    frame: false,
    // 根据配置设置是否置顶
    alwaysOnTop: isAlwaysOnTop,
    // 设置窗口层级为桌面窗口
    type: 'desktop',
    // 背景透明
    transparent: true,
    // 可调整大小
    resizable: true,
    // 不显示在任务栏
    skipTaskbar: true,
    // 焦点丢失时是否隐藏窗口
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'assets/js/main.js')
    }
  });

  // 加载页面内容
  mainWindow.loadFile('pages/index.html');

  // 当主窗口 DOM 就绪时发送初始状态（时钟/作业/启动台/置顶/暗色主题）
  mainWindow.webContents.once('dom-ready', () => {
    mainWindow.webContents.send('clock-toggle', isClockEnabled);
    mainWindow.webContents.send('homework-toggle', isHomeworkEnabled);
    mainWindow.webContents.send('always-on-top-toggle', isAlwaysOnTop); // 发送置顶状态
    mainWindow.webContents.send('dark-theme-toggle', isDarkThemeEnabled); // 发送暗色主题状态
    mainWindow.webContents.send('launchpad-apps-updated', getLaunchpadApps());
  });

  // 监听窗口移动事件，保存位置
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    saveWindowPosition(x, y);
  });

  // 监听窗口关闭事件，保存位置
  mainWindow.on('close', () => {
    const [x, y] = mainWindow.getPosition();
    saveWindowPosition(x, y);
  });

  return mainWindow;
};

// 作业添加窗口
let homeworkWindow;

const createHomeworkWindow = () => {
  // 如果窗口已经存在，就聚焦它
  if (homeworkWindow) {
    homeworkWindow.focus();
    return;
  }

  homeworkWindow = new BrowserWindow({
    icon: iconPath,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 加载作业表单页面
  homeworkWindow.loadFile('pages/homework-form.html');
  homeworkWindow.setMenu(null);

  // 窗口关闭时清理引用
  homeworkWindow.on('closed', () => {
    homeworkWindow = null;
  });
};
// 作业列表窗口
let homeworkListWindow;

const createHomeworkListWindow = () => {
  // 如果窗口已经存在，就聚焦它
  if (homeworkListWindow) {
    homeworkListWindow.focus();
    return homeworkListWindow;
  }

  homeworkListWindow = new BrowserWindow({
    icon: iconPath,
    frame: false,
    width: 800,
    height: 600,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  homeworkListWindow.loadFile('pages/homework.html');
  homeworkListWindow.setMenu(null);

  // 窗口关闭时清理引用
  homeworkListWindow.on('closed', () => {
    homeworkListWindow = null;
  });

  return homeworkListWindow;
};

// 设置窗口
let settingsWindow;

const createSettingsWindow = () => {
  // 如果窗口已经存在，就聚焦它
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    icon: iconPath,
    frame: false,
    width: 700,
    height: 600,
    resizable: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile('pages/settings.html');
  settingsWindow.setMenu(null);

  // 窗口关闭时清理引用
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
};

let aboutWindow;

const createAboutWindow = () => { 
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    icon: iconPath,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  aboutWindow.loadFile('pages/about.html');

};
// 欢迎页面窗口
let welcomeWindow;

const createWelcomeWindow = () => {
  if (welcomeWindow) {
    welcomeWindow.focus();
    return;
  }

  welcomeWindow = new BrowserWindow({
    icon: iconPath,
    transparent: true,
    frame: false,
    width: 600,
    height: 420,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  welcomeWindow.loadFile('pages/welcome.html');
  welcomeWindow.setMenu(null);

  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
  });
};

const createSettingHandler = (settingName, toggleEvent) => ({
  load: () => {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return config[settingName] !== undefined ? config[settingName] : true;
      }
    } catch (err) {
      console.warn(`读取${settingName}设置失败:`, err);
    }
    return true;
  },
  
  save: (isEnabled) => {
    try {
      ensureConfigDir();
      const config = loadConfig();
      config[settingName] = isEnabled;
      config.timestamp = Date.now();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error(`保存${settingName}设置失败:`, err);
    }
  },
  
  handleToggle: (isEnabled, mainWindow) => {
    // 保存设置到配置文件
    createSettingHandler(settingName, toggleEvent).save(isEnabled);
    
    // 根据开关状态控制显示/隐藏
    if (mainWindow) {
      mainWindow.webContents.send(toggleEvent, isEnabled);
    }
  }
});

const clockSettingHandler = createSettingHandler('clockEnabled', 'clock-toggle');
const homeworkSettingHandler = createSettingHandler('homeworkEnabled', 'homework-toggle');

// 添加置顶设置处理程序
const alwaysOnTopSettingHandler = createSettingHandler('alwaysOnTop', 'always-on-top-toggle');

// 添加暗色主题设置处理程序
const darkThemeSettingHandler = createSettingHandler('darkThemeEnabled', 'dark-theme-toggle');

let isClockEnabled = clockSettingHandler.load();
let isHomeworkEnabled = homeworkSettingHandler.load();
let isAlwaysOnTop = alwaysOnTopSettingHandler.load(); // 添加置顶状态变量
let isDarkThemeEnabled = darkThemeSettingHandler.load(); // 添加暗色主题状态变量

const handleClockToggle = (isEnabled) => {
  isClockEnabled = isEnabled;
  clockSettingHandler.handleToggle(isEnabled, mainWindow);
};

const handleHomeworkToggle = (isEnabled) => {
  isHomeworkEnabled = isEnabled;
  homeworkSettingHandler.handleToggle(isEnabled, mainWindow);
};

// 添加置顶切换处理函数
const handleAlwaysOnTopToggle = (isEnabled) => {
  isAlwaysOnTop = isEnabled;
  alwaysOnTopSettingHandler.handleToggle(isEnabled, mainWindow);
  
  // 立即应用置顶设置
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(isEnabled);
  }
};

// 暗色主题切换处理函数
const handleDarkThemeToggle = (isEnabled) => {
  isDarkThemeEnabled = isEnabled;
  darkThemeSettingHandler.handleToggle(isEnabled, mainWindow);
  
  // 通知主窗口更新主题
  if (mainWindow) {
    mainWindow.webContents.send('dark-theme-toggle', isEnabled);
  }
};

// 为 Tray 对象保存一个全局引用以避免被垃圾回收
let tray;
const icon = nativeImage.createFromPath(iconPath);

// 应用准备就绪时
app.whenReady().then(() => {
  isClockEnabled = clockSettingHandler.load();
  isHomeworkEnabled = homeworkSettingHandler.load();
  isAlwaysOnTop = alwaysOnTopSettingHandler.load(); // 加载置顶设置
  isDarkThemeEnabled = darkThemeSettingHandler.load(); // 加载暗色主题设置

  // 如果是首次运行，显示欢迎页；否则直接创建主窗口
  const appConfig = loadConfig();

  // 接收欢迎页完成信号：保存首次运行标记并创建主窗口
  ipcMain.on('first-run-complete', () => {
    try {
      const cfg = loadConfig();
      cfg.firstRun = false;
      saveConfig(cfg);
    } catch (e) {
      console.warn('设置首次运行标记失败:', e);
    }

    // 创建主窗口并关闭欢迎页
    createWindow();
    if (welcomeWindow) {
      welcomeWindow.close();
      welcomeWindow = null;
    }
  });

  if (appConfig.firstRun === undefined || appConfig.firstRun) {
    createWelcomeWindow();
  } else {
    createWindow();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '课堂窗 - ClassWindow',
      role: "about"
    },
    {
      label: '设置',
      click: () => {
        createSettingsWindow();
      }
    },
    {
      label: '重新加载页面',
      role: "forceReload"
    },
    {
      label: '关于',
      click: () => {
        createAboutWindow();
      }

    },
    {
      label: '退出',
      role: "quit"
    },
  ]);

  tray.setContextMenu(contextMenu);

  ipcMain.on('set-ignore-mouse-events', (event, { ignore, forward }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
          win.setIgnoreMouseEvents(ignore, forward ? { forward: true } : undefined);
      }
  });

  ipcMain.on('open-settings-window', () => {
    createSettingsWindow();
  });

  // 监听打开作业窗口的请求
  ipcMain.on('open-homework-window', () => {
    if(isHomeworkEnabled) { // 只有时作业功能启用时才打开窗口
      createHomeworkWindow();
    }
  });
  
  // 监听保存作业的请求
  ipcMain.on('save-homework', (event, homework) => {
    // 将作业数据发送回主窗口
    if (mainWindow) {
      mainWindow.webContents.send('new-homework', homework);
    }
  });
  
  // 监听作业窗口关闭事件
  ipcMain.on('homework-window-closed', () => {
    homeworkWindow = null;
  });
  
  // 监听获取设置的请求
  ipcMain.on('get-settings', () => {
    if (settingsWindow) {
      settingsWindow.webContents.send('settings-updated', {
        clockEnabled: isClockEnabled,
        homeworkEnabled: isHomeworkEnabled,
        alwaysOnTop: isAlwaysOnTop, // 添加置顶状态
        darkThemeEnabled: isDarkThemeEnabled, // 添加暗色主题状态
        launchpadApps: getLaunchpadApps()
      });
    }
  });
  
  // 监听时钟开关变化
  ipcMain.on('toggle-clock', (event, isEnabled) => {
    handleClockToggle(isEnabled);
  });
  
  // 监听作业开关变化
  ipcMain.on('toggle-homework', (event, isEnabled) => {
    handleHomeworkToggle(isEnabled);
  });
  
  // 监听置顶开关变化
  ipcMain.on('toggle-always-on-top', (event, isEnabled) => {
    handleAlwaysOnTopToggle(isEnabled);
  });
  
  // 监听暗色主题开关变化
  ipcMain.on('toggle-dark-theme', (event, isEnabled) => {
    handleDarkThemeToggle(isEnabled);
  });
  
  // 监听添加启动台应用
  ipcMain.on('add-launchpad-app', (event, app) => {
    const updatedApps = addLaunchpadApp(app);
    if (updatedApps) {
      // 通知所有窗口更新启动台应用列表
      if (mainWindow) {
        mainWindow.webContents.send('launchpad-apps-updated', updatedApps);
      }
      if (settingsWindow) {
        settingsWindow.webContents.send('launchpad-apps-updated', updatedApps);
      }
    }
  });
  
  // 监听删除启动台应用
  ipcMain.on('remove-launchpad-app', (event, index) => {
    const updatedApps = removeLaunchpadApp(index);
    if (updatedApps !== null) {
      // 通知所有窗口更新启动台应用列表
      if (mainWindow) {
        mainWindow.webContents.send('launchpad-apps-updated', updatedApps);
      }
      if (settingsWindow) {
        settingsWindow.webContents.send('launchpad-apps-updated', updatedApps);
      }
    }
  });
  
  // 监听启动应用请求
  ipcMain.on('launch-app', (event, app) => {
    launchAppOrLink(app);
  });

  // 监听打开功能展示窗口的请求（从欢迎页触发）
  ipcMain.on('open-features-window', () => {
    createFeaturesWindow();
  });

  ipcMain.on('open-homework-list-window', () => {
    createHomeworkListWindow();
  });

  // 监听作业列表窗口关闭事件
  ipcMain.on('homework-list-window-closed', () => {
    homeworkListWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {});