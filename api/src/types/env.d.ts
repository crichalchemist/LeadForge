// Augments the ambient `Cloudflare.Env` / `Cloudflare.Exports` types (declared empty in
// @cloudflare/workers-types, meant to be merged in per-project) so `env` and `exports` imported
// from `cloudflare:workers` in tests are typed against our bindings and worker entrypoint.
// Normally produced by `wrangler types`; hand-written here to avoid pulling in the full generated
// runtime-types file, which duplicates @cloudflare/workers-types.
import type { Bindings } from './index';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
    interface GlobalProps {
      mainModule: typeof import('../index');
    }
  }
}

export {};
