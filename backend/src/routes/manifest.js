import { Router } from 'express';
import { getPool } from '../db/pool.js';

const router = Router();

// PWA manifest is generated per-request (not a static build file) so the
// installed app's name/icon reflect this deployment's App Name (Settings >
// Clinic Master > App Name) — the same software brand name shown in the
// sidebar/login/browser tab. Public — must be fetchable before login.
router.get('/manifest.webmanifest', async (req, res) => {
  let appName = 'Ayush Pharmacy';
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT TOP 1 AppName FROM ClinicDetails WHERE ClinicId = 1');
    if (result.recordset[0]?.AppName?.trim()) appName = result.recordset[0].AppName.trim();
  } catch {
    // Fall back to the default name if the DB isn't reachable — the manifest must still resolve.
  }

  res.set('Content-Type', 'application/manifest+json');
  res.json({
    name: appName,
    short_name: appName,
    description: 'Pharmacy management — items, purchases, stock, sales and reports.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3563eb',
    lang: 'en',
    scope: '/',
    icons: [
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

export default router;
