// src/lib/stores/desktop.ts — desktop-shell actions for components (file pickers, window, app info),
// so components never reach into api/ directly.
import { openDialog, saveDialog, openDirDialog, readTextFileIfExists, importFileSize } from "../api/files";
import { quit, minimize, toggleMaximize, isMaximized, onMaximizedChange } from "../api/window";
import { getAppVersion } from "../api/app";
import { forgetSshHostKey } from "../api/connection";
import type { DialogFilter } from "../api/files";

export const pickCertFile = () => openDialog([{ name: "PEM", extensions: ["pem", "crt", "cer"] }]);
export const pickAnyFile = () => openDialog([{ name: "All files", extensions: ["*"] }]);
export const pickFile = (filters: DialogFilter[]) => openDialog(filters);
export const pickSavePath = (name: string, ext: string) => saveDialog(name, [{ name: ext.toUpperCase(), extensions: [ext] }]);
export const pickDirectory = () => openDirDialog();
export const readOptionalTextFile = (path: string) => readTextFileIfExists(path);
export const fileSize = (path: string) => importFileSize(path);
export const forgetHostKey = (host: string, port: number) => forgetSshHostKey(host, port);
export const appVersion = () => getAppVersion();
export const windowControls = { quit, minimize, toggleMaximize, isMaximized, onMaximizedChange };
