// Test-only fixture. Forebay's no-hardcoded-apps rule holds in tests too: exercising
// routing/model-map logic must not import a specific app-proxy's RoutingProfile
// (e.g. claude-code-proxy's anthropicProfile). This is a synthetic, generic profile
// carrying just enough shape for the routing/model-map code paths under test.
import type { RoutingProfile } from "@intisy-ai/basekit/proxy";

export function fixtureRoutingProfile(overrides: Partial<RoutingProfile> = {}): RoutingProfile {
  return {
    configFile: "fixture-profile.json",
    routingKey: "routingEnabled",
    tierSourceProvider: "stub",
    // Tests exercise a "opus" routing slot as a stand-in tier name; it carries no
    // vendor meaning here, it just needs to be a recognized tier for resolveModelMap
    // to surface a stored/derived chain under that key.
    tierOrder: ["opus"],
    tierFallback: ["opus"],
    tierRegex: /.*/,
    envPrefix: "FIXTURE",
    defaultContext: 128000,
    defaultOutput: 8192,
    nativeRateLimit: async () => ({ status: 429, headers: {}, body: "{}" }),
    ...overrides,
  };
}
