const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require('electron/main')
const path = require('path')
const fs = require('fs')
const { nativeImage } = require('electron/common')

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

const createWindow = () => {
  const [defaultX, defaultY] = loadWindowPosition()
  
  mainWindow = new BrowserWindow({
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
    // 设置背景色为透明
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // 加载页面内容
  mainWindow.loadFile('pages/index.html')

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
    createSettingHandler(settingName).save(isEnabled);
    
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

// 创建作业输入窗口
const createHomeworkWindow = () => {
  // 如果窗口已经存在，就聚焦它
  if (homeworkWindow) {
    homeworkWindow.focus();
    return;
  }


  homeworkWindow = new BrowserWindow({
    icon: './assets/logo.png',
    frame: true,  // 有边框，便于用户操作
    alwaysOnTop: true,  // 保持在最前面
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

// 为 Tray 对象保存一个全局引用以避免被垃圾回收
let tray

const icon = nativeImage.createFromPath('./assets/logo.png')

// 应用准备就绪时
app.whenReady().then(() => {
  isClockEnabled = loadClockSetting();
  isHomeworkEnabled = loadHomeworkSetting();

  createWindow();

  // 确保窗口完全加载后发送初始状态
  mainWindow.webContents.once('dom-ready', () => {
    // 发送时钟和作业的初始状态
    mainWindow.webContents.send('clock-toggle', isClockEnabled);
    mainWindow.webContents.send('homework-toggle', isHomeworkEnabled);
  });

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '课堂窗 - ClassWindow',
      role: "about"
    },
    {
      label: '设置',
      submenu: [
        { type: 'separator' },
        { 
          label: '启用时钟', 
          type: 'checkbox', 
          checked: isClockEnabled, // 使用实际加载的值
          click: (menuItem) => {
            // 监听时钟开关状态变化
            handleClockToggle(menuItem.checked);
          }
        },
        { 
          label: '启用作业', 
          type: 'checkbox', 
          checked: isHomeworkEnabled, // 使用实际加载的值
          click: (menuItem) => {
            // 监听作业开关状态变化
            handleHomeworkToggle(menuItem.checked);
          }
        }
      ]
    },
    {
      label: '退出',
      role: "quit"
    },
  ])

  tray.setContextMenu(contextMenu)

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {});