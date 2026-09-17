import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC_CHANNELS, INVOKE_CHANNELS } from "@forebay/shared";
import type { ForebayAPI, Result, ProxyStatus, DownloadProgress, ActivityRecord, Job, InvokeMethod } from "@forebay/shared";

const invokeChannels: readonly string[] = IPC_CHANNELS.invoke;
const sendChannels: readonly string[] = IPC_CHANNELS.send;
const receiveChannels: readonly string[] = IPC_CHANNELS.receive;

function safeInvoke(channel: string, ...args: unknown[]): Promise<Result<unknown>> {
  if (!invokeChannels.includes(channel)) {
    return Promise.resolve({ ok: false, error: `channel not allowed: ${channel}` });
  }
  return ipcRenderer.invoke(channel, ...args);
}

function safeSend(channel: string, ...args: unknown[]): void {
  if (!sendChannels.includes(channel)) return;
  ipcRenderer.send(channel, ...args);
}

export function safeOn(channel: string, listener: (...args: unknown[]) => void): () => void {
  if (!receiveChannels.includes(channel)) return () => {};
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// Every request/response method is the same shape: forward its args positionally to
// its channel. Build them from the one channel map so the bridge can never drift from
// the allow-list. ForebayAPI (checked against the map at compile time) supplies the types.
type InvokeApi = Pick<ForebayAPI, InvokeMethod>;
const invokers = Object.fromEntries(
  (Object.entries(INVOKE_CHANNELS) as [InvokeMethod, string][]).map(
    ([method, channel]) => [method, (...args: unknown[]): Promise<Result<unknown>> => safeInvoke(channel, ...args)],
  ),
) as InvokeApi;

const api: ForebayAPI = {
  ...invokers,
  minimize: () => safeSend("window:minimize"),
  maximize: () => safeSend("window:maximize"),
  close: () => safeSend("window:close"),
  onServerStatus: (listener) => safeOn("server:status", (status) => listener(status as ProxyStatus)),
  onDownloadProgress: (listener) => safeOn("downloads:progress", (progress) => listener(progress as DownloadProgress)),
  onActivityEvent: (listener) => safeOn("activity:event", (record) => listener(record as ActivityRecord)),
  onJobEvent: (listener) => safeOn("jobs:event", (job) => listener(job as Job)),
  isElectron: true,
  platform: process.platform,
};

contextBridge.exposeInMainWorld("forebay", api);
