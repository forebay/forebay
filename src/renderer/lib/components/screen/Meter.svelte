<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import QuotaBar from "../QuotaBar.svelte";
  import type { ScreenContext } from "./context.js";

  interface Quota { used: number; total: number }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const raw = $derived(ctx.sources[node.source as string]);
  const quota = $derived(raw && typeof raw === "object" ? (raw as Partial<Quota>) : {});
  const used = $derived(typeof quota.used === "number" ? quota.used : 0);
  const total = $derived(typeof quota.total === "number" ? quota.total : 0);
  const remainingFraction = $derived(total > 0 ? 1 - used / total : 1);
  const label = $derived(typeof node.label === "string" ? node.label : "");
</script>

<QuotaBar {label} {remainingFraction} />
