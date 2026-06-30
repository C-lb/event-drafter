import { app, BrowserWindow } from 'electron';

const APP_URL = process.env.ED_DESKTOP_URL ?? 'http://127.0.0.1:3000';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Event Drafter',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
