<script lang="ts">
  import { rootTokenNames, tokenValue } from "../rootTokens.js";

  type Group = "colour" | "type" | "space" | "radius" | "elevation" | "other";

  function groupOf(name: string): Group {
    if (name.startsWith("--fs-") || name.startsWith("--lh-") || name === "--ui" || name === "--mono") return "type";
    if (name.startsWith("--space-")) return "space";
    if (name.startsWith("--radius")) return "radius";
    if (name.startsWith("--shadow") || name.startsWith("--elev")) return "elevation";
    if (name.startsWith("--forebay-")) return "other";
    return "colour";
  }

  function groupTokens(): Map<Group, { name: string; value: string }[]> {
    const map = new Map<Group, { name: string; value: string }[]>();
    for (const name of rootTokenNames()) {
      const group = groupOf(name);
      const list = map.get(group) ?? [];
      list.push({ name, value: tokenValue(name) });
      map.set(group, list);
    }
    return map;
  }

  const ORDER: Group[] = ["colour", "type", "space", "radius", "elevation", "other"];
  const byGroup = groupTokens();
</script>

{#each ORDER as group (group)}
  {@const tokens = byGroup.get(group) ?? []}
  {#if tokens.length > 0}
    <h3>{group}</h3>
    <div class="grid" class:swatches={group === "colour"}>
      {#each tokens as token (token.name)}
        <div class="token">
          {#if group === "colour"}
            <span class="swatch" style={`background:${token.value}`}></span>
          {:else if group === "space"}
            <span class="bar" style={`width:${token.value}`}></span>
          {:else if group === "radius"}
            <span class="radius" style={`border-radius:${token.value}`}></span>
          {:else if group === "elevation"}
            <span class="elev" style={`box-shadow:${token.value}`}></span>
          {:else if group === "type"}
            <span class="type" style={`font-size:${token.value}`}>Forebay 123</span>
          {/if}
          <span class="meta"><code>{token.name}</code><span class="val">{token.value}</span></span>
        </div>
      {/each}
    </div>
  {/if}
{/each}

<style>
  h3 {
    margin: 22px 0 8px;
    font-size: 10.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .token {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  code {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .val {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swatch,
  .radius,
  .elev {
    width: 34px;
    height: 34px;
    flex: none;
    border: 1px solid var(--border-strong);
  }
  .swatch {
    border-radius: 8px;
  }
  .elev {
    background: var(--surface);
    border-radius: 8px;
  }
  .bar {
    height: 10px;
    flex: none;
    background: var(--accent);
    border-radius: 3px;
  }
  .type {
    flex: none;
    color: var(--text);
  }
</style>
