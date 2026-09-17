import type { Component } from "svelte";
import type { NodeStyle, ScreenNode } from "@forebay/shared";
import type { ScreenContext } from "./context.js";
import Stack from "./Stack.svelte";
import Grid from "./Grid.svelte";
import CardNode from "./CardNode.svelte";
import GroupNode from "./GroupNode.svelte";
import Tabs from "./Tabs.svelte";
import TextNode from "./TextNode.svelte";
import Stats from "./Stats.svelte";
import Table from "./Table.svelte";
import ListNode from "./ListNode.svelte";
import Chips from "./Chips.svelte";
import FormNode from "./FormNode.svelte";
import FieldsNode from "./FieldsNode.svelte";
import Banner from "./Banner.svelte";
import Meter from "./Meter.svelte";
import Actions from "./Actions.svelte";

type NodeComponent = Component<{ node: ScreenNode; ctx: ScreenContext }>;

export const NODE_RENDERERS: Record<string, NodeComponent> = {};

export function registerNode(kind: string, component: NodeComponent): void {
  NODE_RENDERERS[kind] = component;
}

const PAD = { none: "0", tight: "var(--space-xs)", normal: "var(--space-xl) var(--space-2xl)" };

export function styleOf(style?: NodeStyle): string {
  if (!style) return "";
  const out: string[] = [];
  if (style.width) out.push(`width:${style.width}`);
  if (typeof style.grow === "number") out.push(`flex-grow:${style.grow}`);
  if (style.align) out.push(`align-items:${style.align}`);
  if (style.pad && style.pad in PAD) out.push(`padding:${PAD[style.pad]}`);
  return out.join(";");
}

registerNode("stack", Stack);
registerNode("row", Stack);
registerNode("grid", Grid);
registerNode("card", CardNode);
registerNode("group", GroupNode);
registerNode("tabs", Tabs);
registerNode("text", TextNode);
registerNode("stats", Stats);
registerNode("table", Table);
registerNode("list", ListNode);
registerNode("chips", Chips);
registerNode("form", FormNode);
registerNode("fields", FieldsNode);
registerNode("banner", Banner);
registerNode("meter", Meter);
registerNode("actions", Actions);
