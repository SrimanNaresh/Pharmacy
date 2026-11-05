import { Router } from 'express';
import { getPool } from '../db/pool.js';

const router = Router();

// Software brand name (sidebar, login screen, browser tab) — public, since the
// login page itself needs to show it before anyone is authenticated.
router.get('/app-info', async (req, res) => {
  let appName = 'Ayush Pharmacy';
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT TOP 1 AppName FROM ClinicDetails WHERE ClinicId = 1');
    if (result.recordset[0]?.AppName?.trim()) appName = result.recordset[0].AppName.trim();
  } catch {
    // Fall back to the default name if the DB isn't reachable.
  }
  res.json({ appName });
});

export default router;
