import { mount } from "svelte";
import { forebayMarkDataUri } from "@forebay/shared";
import "../app.css";
import App from "../App.svelte";
import { initTheme } from "../lib/theme.js";

function setFavicon(): void {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = forebayMarkDataUri();
  document.head.appendChild(link);
}

const target = document.getElementById("app");
if (!target) throw new Error("missing #app mount element");

initTheme();
setFavicon();
mount(App, { target });
