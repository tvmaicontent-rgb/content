import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as archiverPkg from 'archiver';
const archiver = ((archiverPkg as any).default || archiverPkg) as any;
import { createServer as createViteServer } from 'vite';
import { handleLogin, handleMe, requireAdmin } from './server/auth';
import { handleHealth } from './server/http';
import { handleDataSnapshot, handleSheetsStatus, handleSyncSheets, handleWebhookProxy } from './server/sheets';
import { sendJson, toCtx } from './server/adapter';
import type { RequestCtx } from './server/http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set. Authentication will reject all tokens.');
}

function ctxFromExpress(req: express.Request): RequestCtx {
  const ctx = toCtx(req);
  ctx.ip = req.ip || ctx.ip;
  return ctx;
}

app.get('/api/health', (req, res) => {
  sendJson(res as any, handleHealth(ctxFromExpress(req)));
});

app.post('/api/auth/login', async (req, res) => {
  sendJson(res as any, await handleLogin(ctxFromExpress(req)));
});

app.get('/api/auth/me', (req, res) => {
  sendJson(res as any, handleMe(ctxFromExpress(req)));
});

app.get('/api/sheets/status', (req, res) => {
  sendJson(res as any, handleSheetsStatus(ctxFromExpress(req)));
});

app.get('/api/sync-sheets', async (req, res) => {
  sendJson(res as any, await handleSyncSheets(ctxFromExpress(req)));
});

app.post('/api/sheets/webhook-proxy', async (req, res) => {
  sendJson(res as any, await handleWebhookProxy(ctxFromExpress(req)));
});

app.get('/api/data-snapshot', (req, res) => {
  sendJson(res as any, handleDataSnapshot(ctxFromExpress(req)));
});

app.get('/api/download-project-zip', (req, res) => {
  const admin = requireAdmin(ctxFromExpress(req));
  if (admin.ok === false) {
    return sendJson(res as any, admin.result);
  }

  try {
    const rootDir = process.cwd();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="content-ops-project.zip"');

    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    archive.glob('**/*', {
      cwd: rootDir,
      ignore: [
        'node_modules/**',
        'dist/**',
        '.git/**',
        '*.log',
        '.vite/**',
        '.env',
        '.env.*',
      ],
      dot: true,
    });

    archive.finalize();
  } catch (err: any) {
    console.error('Zip export error:', err);
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
