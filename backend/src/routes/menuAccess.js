import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';

const router = Router();

const LEVELS = ['Full', 'View', 'No Access'];

// Get saved access rows for a user. Missing menus default to 'No Access' on the client.
router.get('/:userId', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('userId', sql.Int, req.params.userId)
      .query('SELECT MenuKey, AccessLevel FROM MenuAccess WHERE UserId = @userId');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save (bulk upsert) access for a user. Body: { items: [{ menuKey, accessLevel }] }
router.put('/:userId', async (req, res) => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    const userId = Number(req.params.userId);
    const { items = [] } = req.body;
    await tx.begin();
    for (const it of items) {
      const level = LEVELS.includes(it.accessLevel) ? it.accessLevel : 'No Access';
      await new sql.Request(tx)
        .input('userId', sql.Int, userId)
        .input('menuKey', sql.NVarChar, it.menuKey)
        .input('level', sql.NVarChar, level)
        .query(`
          MERGE MenuAccess AS target
          USING (SELECT @userId AS UserId, @menuKey AS MenuKey) AS src
            ON target.UserId = src.UserId AND target.MenuKey = src.MenuKey
          WHEN MATCHED THEN UPDATE SET AccessLevel = @level
          WHEN NOT MATCHED THEN INSERT (UserId, MenuKey, AccessLevel) VALUES (@userId, @menuKey, @level);
        `);
    }
    await tx.commit();
    res.json({ success: true, count: items.length });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

export default router;
