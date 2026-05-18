import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const port = Number(process.env.PORT || 3077);

const { app } = await createApp({ rootDir, dataDir });

app.listen(port, () => {
  console.log(`WeCom scheduled webhook server listening on http://localhost:${port}`);
});
