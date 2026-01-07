module.exports = {
  packagerConfig: {
    icon: "./assets/logo",
    executableName: "classwindow",
    asar: true
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "electron_quick_start"
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: [
        "darwin"
      ]
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          icon: "./assets/logo.png"
        }
      }
    }
  ]
};