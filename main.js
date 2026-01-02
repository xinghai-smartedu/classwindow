const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require('electron/main')
const path = require('path')
const fs = require('fs')
const { nativeImage } = require('electron/common')
const { execFile } = require('child_process')
const { shell } = require('electron')

const CONFIG_PATH = path.join(__dirname, 'data/config.json')

// 确保配置目录存在
const ensureConfigDir = () => {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// 读取配置文件
const loadConfig = () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (err) {
    console.warn('读取配置文件失败:', err)
  }
  return {}
}

// 保存配置文件
const saveConfig = (config) => {
  try {
    ensureConfigDir()
    config.timestamp = Date.now()
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('保存配置文件失败:', err)
  }
}

// 获取默认位置（右上角）
const getDefaultPosition = () => {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  return [width - 320, 20]
}

// 读取/保存窗口位置
const loadWindowPosition = () => {
  const config = loadConfig()
  if (config.window?.x !== undefined && config.window?.y !== undefined) {
    return [config.window.x, config.window.y]
  }
  return getDefaultPosition()
}

const saveWindowPosition = (x, y) => {
  const config = loadConfig()
  config.window = { x, y }
  saveConfig(config)
}

// 主窗口
let mainWindow;

// 作业输入窗口
let homeworkWindow;

// 设置窗口
let settingsWindow;

// 欢迎/启动页面窗口（首次使用显示）
let welcomeWindow;

// 功能展示窗口
let featuresWindow;

// 优化后的通用设置处理函数
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

let isClockEnabled = clockSettingHandler.load();
let isHomeworkEnabled = homeworkSettingHandler.load();

const handleClockToggle = (isEnabled) => {
  isClockEnabled = isEnabled;
  clockSettingHandler.handleToggle(isEnabled, mainWindow);
};

const handleHomeworkToggle = (isEnabled) => {
  isHomeworkEnabled = isEnabled;
  homeworkSettingHandler.handleToggle(isEnabled, mainWindow);
};

// 启动台应用管理函数
const addLaunchpadApp = (app) => {
  try {
    ensureConfigDir();
    const config = loadConfig();
    if (!config.launchpadApps) {
      config.launchpadApps = [];
    }
    // 设置默认类型为应用
    if (!app.type) {
      app.type = 'app';
    }
    config.launchpadApps.push(app);
    config.timestamp = Date.now();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    
    // 通知所有窗口更新启动台应用列表
    if (mainWindow) {
      mainWindow.webContents.send('launchpad-apps-updated', config.launchpadApps);
    }
    if (settingsWindow) {
      settingsWindow.webContents.send('launchpad-apps-updated', config.launchpadApps);
    }
  } catch (err) {
    console.error('添加启动台应用失败:', err);
  }
};

const removeLaunchpadApp = (index) => {
  try {
    ensureConfigDir();
    const config = loadConfig();
    if (config.launchpadApps && config.launchpadApps.length > index) {
      config.launchpadApps.splice(index, 1);
      config.timestamp = Date.now();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      
      // 通知所有窗口更新启动台应用列表
      if (mainWindow) {
        mainWindow.webContents.send('launchpad-apps-updated', config.launchpadApps);
      }
      if (settingsWindow) {
        settingsWindow.webContents.send('launchpad-apps-updated', config.launchpadApps);
      }
    }
  } catch (err) {
    console.error('删除启动台应用失败:', err);
  }
};

const getLaunchpadApps = () => {
  const config = loadConfig();
  return config.launchpadApps || [];
};

// 启动应用或打开链接函数
const launchAppOrLink = (app) => {
  try {
    if (app.type === 'link') {
      // 如果是链接类型，使用shell打开
      shell.openExternal(app.path);
    } else {
      // 如果是应用程序类型，使用execFile启动
      execFile(app.path, (error) => {
        if (error) {
          console.error('启动应用失败:', error);
          // 可以向渲染进程发送错误信息
          if (mainWindow) {
            mainWindow.webContents.send('launch-app-error', error.message);
          }
        }
      });
    }
  } catch (error) {
    console.error('启动应用或打开链接异常:', error);
  }
};

// 创建作业输入窗口
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

// 创建设置窗口
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

// 创建欢迎页面窗口（首次使用时显示）
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

// 创建功能展示窗口（独立页面）
const createFeaturesWindow = () => {
  if (featuresWindow) {
    featuresWindow.focus();
    return;
  }

  featuresWindow = new BrowserWindow({
    icon: './assets/logo.png',
    frame: true,
    width: 560,
    height: 420,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  featuresWindow.loadFile('pages/features.html');
  featuresWindow.setMenu(null);

  featuresWindow.on('closed', () => {
    featuresWindow = null;
  });
};

// 为 Tray 对象保存一个全局引用以避免被垃圾回收
let tray

if (app.isPackaged) {
  iconPath = path.join(process.resourcesPath, "assets/logo.png");
} else {
  iconPath = path.join(__dirname, "assets/logo.png");
}
const icon = nativeImage.createFromPath(iconPath);

// 应用准备就绪时
app.whenReady().then(() => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { height } = primaryDisplay.workAreaSize;
  const createWindow = () => {
    const [defaultX, defaultY] = loadWindowPosition()
    
    mainWindow = new BrowserWindow({
      height: parseInt(height * 0.9),
      x: defaultX,
      y: defaultY,
      // 设置为无边框窗口
      frame: false,
      // 始终在最前（可被其他窗口覆盖）
      alwaysOnTop: false,
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
    })

    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    // 加载页面内容
    mainWindow.loadFile('pages/index.html')

    // 当主窗口 DOM 就绪时发送初始状态（时钟/作业/启动台）
    mainWindow.webContents.once('dom-ready', () => {
      mainWindow.webContents.send('clock-toggle', isClockEnabled);
      mainWindow.webContents.send('homework-toggle', isHomeworkEnabled);
      mainWindow.webContents.send('launchpad-apps-updated', getLaunchpadApps());
    });

    // 监听窗口移动事件，保存位置
    mainWindow.on('moved', () => {
      const [x, y] = mainWindow.getPosition()
      saveWindowPosition(x, y)
    })

    // 监听窗口关闭事件，保存位置
    mainWindow.on('close', () => {
      const [x, y] = mainWindow.getPosition()
      saveWindowPosition(x, y)
    })

    return mainWindow
  }

  isClockEnabled = clockSettingHandler.load();
  isHomeworkEnabled = homeworkSettingHandler.load();

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

  ipcMain.on('homework-button-hover', () => {
    mainWindow.setIgnoreMouseEvents(false, { forward: false });
  });

  ipcMain.on('homework-delbutton-hover', () => {
    mainWindow.setIgnoreMouseEvents(false, { forward: false });
    setTimeout(() => {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }, 500);
  });

  tray = new Tray(icon)

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
      label: '退出',
      role: "quit"
    },
  ])

  tray.setContextMenu(contextMenu)

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
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  });
  
  // 监听获取设置的请求
  ipcMain.on('get-settings', () => {
    if (settingsWindow) {
      settingsWindow.webContents.send('settings-updated', {
        clockEnabled: isClockEnabled,
        homeworkEnabled: isHomeworkEnabled,
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
  
  // 监听添加启动台应用
  ipcMain.on('add-launchpad-app', (event, app) => {
    addLaunchpadApp(app);
  });
  
  // 监听删除启动台应用
  ipcMain.on('remove-launchpad-app', (event, index) => {
    removeLaunchpadApp(index);
  });
  
  // 监听启动应用请求
  ipcMain.on('launch-app', (event, app) => {
    launchAppOrLink(app);
  });

  // 监听打开功能展示窗口的请求（从欢迎页触发）
  ipcMain.on('open-features-window', () => {
    createFeaturesWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {});