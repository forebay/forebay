<script lang="ts">
  import AddPluginDialog from "./AddPluginDialog.svelte";

  export let home = "forebay";
  export let closed = 0;
  export let installed = 0;
</script>

<AddPluginDialog {home} onClose={() => (closed += 1)} onInstalled={() => (installed += 1)} />
