import { limitsFromEnv } from '@hermes/budget-guard';
import { buildServer } from './server.js';

const port = Number(process.env.API_PORT ?? 3000);

const app = buildServer({
  limits: limitsFromEnv(),
  promptRegistryVersion: process.env.PROMPT_REGISTRY_VERSION ?? '0.0.0-dev',
  costPerSceneMinor: Number(process.env.COST_PER_SCENE_MINOR ?? 5000),
  // В dev допускаются неподтверждённые пресеты; на боевой выдаче — запрещено.
  allowUnverifiedPresets: process.env.NODE_ENV !== 'production',
});

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.warn(`api listening on :${port}`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
