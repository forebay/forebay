import { writable } from "svelte/store";
import type { PluginScreen } from "@forebay/shared";

export type ForebayScreenId = "overview" | "providers" | "accounts" | "routing" | "usage" | "activity" | "localApi" | "apps" | "plugins" | "libraries" | "downloads" | "settings";
// A plugin can declare more than one screen, so a contributed screen is addressed by the
// plugin AND the screen id, not the plugin alone. Forebay's own screens stay a closed set;
// anything a plugin contributes lives behind this prefix.
export type PluginScreenId = `plugin:${string}:${string}`;
export type ScreenId = ForebayScreenId | PluginScreenId;
export type PluginScreenRef = { plugin: string; screenId: string };

const PLUGIN_PREFIX = "plugin:";

export function pluginScreen(plugin: string, screenId: string): PluginScreenId {
  return `${PLUGIN_PREFIX}${plugin}:${screenId}`;
}

export function pluginOfScreen(screen: string): PluginScreenRef | null {
  if (!screen.startsWith(PLUGIN_PREFIX)) return null;
  const rest = screen.slice(PLUGIN_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { plugin: rest.slice(0, sep), screenId: rest.slice(sep + 1) };
}

export type ScreenSection = "main" | "network";

export type ScreenDef = {
  id: ForebayScreenId;
  label: string;
  glyph: string;
  section: ScreenSection;
};

export type RouterState = { screen: ScreenId; params?: Record<string, string> };

export const SCREENS: readonly ScreenDef[] = [
  { id: "overview", label: "Overview", glyph: "▤", section: "main" },
  { id: "providers", label: "Providers", glyph: "◈", section: "main" },
  { id: "accounts", label: "Accounts", glyph: "◍", section: "main" },
  { id: "routing", label: "Routing", glyph: "⇄", section: "main" },
  { id: "usage", label: "Usage", glyph: "◷", section: "main" },
  { id: "activity", label: "Activity", glyph: "◔", section: "main" },
  { id: "localApi", label: "Local API", glyph: "⇢", section: "network" },
  { id: "apps", label: "Apps", glyph: "▤", section: "network" },
  { id: "plugins", label: "Plugins", glyph: "⊞", section: "network" },
  { id: "libraries", label: "Libraries", glyph: "◫", section: "network" },
  { id: "downloads", label: "Downloads", glyph: "⤓", section: "network" },
  { id: "settings", label: "Settings", glyph: "⚙", section: "network" },
];

export const router = writable<RouterState>({ screen: "overview" });

// `redirected` marks screens reached by an in-app redirect (a link/action jumping
// from a different screen), as opposed to picking a destination from the sidebar.
// The in-content "Back to X" affordance shows only for redirects; the titlebar
// arrows track all history regardless.
export type NavState = { canBack: boolean; canForward: boolean; backLabel: string; redirected: boolean; redirectLabel: string };
export const nav = writable<NavState>({ canBack: false, canForward: false, backLabel: "", redirected: false, redirectLabel: "" });

const past: RouterState[] = [];
const future: RouterState[] = [];
let redirectedFrom: ScreenId | null = null;

// The contributed screens the sidebar has loaded, so history can name them.
let PLUGIN_SCREENS: PluginScreen[] = [];

export function setPluginScreens(screens: PluginScreen[]): void {
  PLUGIN_SCREENS = screens;
}

function labelOf(id: ScreenId): string {
  const ref = pluginOfScreen(id);
  if (ref) return PLUGIN_SCREENS.find((s) => s.plugin === ref.plugin && s.id === ref.screenId)?.label ?? ref.plugin;
  return SCREENS.find((screen) => screen.id === id)?.label ?? "";
}

function currentState(): RouterState {
  let state: RouterState = { screen: "overview" };
  router.subscribe((value) => (state = value))();
  return state;
}

function syncNav(): void {
  nav.set({
    canBack: past.length > 0,
    canForward: future.length > 0,
    backLabel: past.length > 0 ? labelOf(past[past.length - 1].screen) : "",
    redirected: redirectedFrom !== null,
    redirectLabel: redirectedFrom !== null ? labelOf(redirectedFrom) : "",
  });
}

export function navigate(screen: ScreenId, params?: Record<string, string>, opts?: { redirect?: boolean }): void {
  const current = currentState();
  if (current.screen !== screen) {
    past.push(current);
    future.length = 0;
    redirectedFrom = opts?.redirect ? current.screen : null;
  }
  router.set({ screen, params });
  syncNav();
}

export function back(): void {
  if (past.length === 0) return;
  future.push(currentState());
  redirectedFrom = null;
  router.set(past.pop() as RouterState);
  syncNav();
}

export function forward(): void {
  if (future.length === 0) return;
  past.push(currentState());
  redirectedFrom = null;
  router.set(future.pop() as RouterState);
  syncNav();
}

export function consumeParams(): Record<string, string> | undefined {
  let currentParams: Record<string, string> | undefined;
  router.subscribe((state) => {
    currentParams = state.params;
  })();
  if (currentParams === undefined) return undefined;
  router.update((state) => ({ ...state, params: undefined }));
  return currentParams;
}
