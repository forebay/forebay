<script lang="ts">
  import AccountRow from "../../lib/components/AccountRow.svelte";
  import Card from "../../lib/components/Card.svelte";
  import PluginRow from "../../lib/components/PluginRow.svelte";
  import ProviderRow from "../../lib/components/ProviderRow.svelte";
  import Specimen from "../Specimen.svelte";
  import { HOST_APPS, LONG_NAME, LOREM, QUOTA, STATUS } from "../fixtures.js";

  const noop = (): void => {};
</script>

<div class="stack">
  <Specimen label="ProviderRow" wide>
    <Card>
      <ProviderRow
        name="Antigravity"
        subtitle="3 accounts"
        translator="gemini"
        status={STATUS.good}
        apps={HOST_APPS}
        exposure={{ alpha: true, beta: false }}
        accountLabel="3 signed in"
        enabled
        onOpen={noop}
      />
      <ProviderRow
        name="Claude Code"
        subtitle="no accounts"
        status={STATUS.off}
        apps={HOST_APPS}
        exposure={{ alpha: false, beta: false }}
        accountLabel="none"
        enabled={false}
        onOpen={noop}
      />
      <ProviderRow
        name={LONG_NAME}
        subtitle={LOREM}
        translator="openai"
        status={STATUS.warn}
        apps={HOST_APPS}
        exposure={{ alpha: true, beta: true }}
        accountLabel="1 signed in"
        enabled
        onOpen={noop}
      />
    </Card>
  </Specimen>

  <Specimen label="PluginRow" wide>
    <Card>
      <PluginRow name="wakatime-sync" kind="git" installedVersion="1.4.0" updateAvailable={false} enabled />
      <PluginRow name="provider-stub" kind="npm" updateAvailable enabled={false} catalogKind="provider" description={LOREM} />
      <PluginRow name={LONG_NAME} kind="git" installedVersion="0.1.0" updateAvailable={false} enabled deprecated onUninstall={noop} />
      <PluginRow name="config-ledger" kind="git" updateAvailable={false} enabled onUninstall={noop} uninstallState="confirm" />
    </Card>
  </Specimen>

  <Specimen label="AccountRow" wide>
    <Card>
      <AccountRow label="ben@birich.de" detail="oauth · refreshed 4m ago" status={STATUS.good} enabled quota={QUOTA} />
      <AccountRow label="spare@example.com" detail="api key" status={STATUS.warn} enabled quota={QUOTA.slice(1, 2)} onRemove={noop} />
      <AccountRow label="retired@example.com" status={STATUS.off} enabled={false} onRemove={noop} />
    </Card>
  </Specimen>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
