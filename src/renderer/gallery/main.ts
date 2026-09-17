import { mount } from "svelte";
import "../app.css";
import { stubForebay } from "../lib/testing.js";
import { screenFixtures } from "./fixtures.js";
import Gallery from "./Gallery.svelte";
import { SECTIONS } from "./sections.js";

// #<section>/<theme>, both optional. Theme lives in the URL rather than in a click so a
// screenshot run reproduces exactly one state per load.
const [section = "", theme = "dark"] = location.hash.slice(1).split("/");

const target = document.getElementById("gallery");
if (!target) throw new Error("missing #gallery mount element");

document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
stubForebay(screenFixtures());

(window as unknown as { gallerySections: { id: string; viewportHeight?: number }[] }).gallerySections =
  SECTIONS.map((entry) => ({ id: entry.id, viewportHeight: entry.viewportHeight }));
window.addEventListener("hashchange", () => location.reload());

mount(Gallery, { target, props: { section, theme } });
