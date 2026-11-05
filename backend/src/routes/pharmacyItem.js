import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';

const router = Router();

// ItemCode is derived from ItemId, not stored — e.g. ItemId 42 -> "ITM000042".
const ITEM_CODE_EXPR = `'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6)`;

// Item catalog for the pickers on Sales, Stock Adjustment and Stock Report.
// Adding and editing items is done through routes/itemMaster.js.
router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('search', sql.NVarChar, `%${search}%`)
      .query(`
        SELECT i.ItemId, ${ITEM_CODE_EXPR} AS ItemCode, i.Name, i.Category, i.HSNCode,
               i.UnitId, u.Name AS UnitName, i.ManufacturerId, m.Name AS ManufacturerName,
               i.ScheduleH, i.ScheduleH1, i.GenericNameId, g.Name AS GenericNameName,
               i.PurchaseRate, i.GSTPercent, i.MRP, i.SellPrice, i.Rack, i.BoxNo, i.Pack, i.EditedAt, i.CreatedAt
        FROM PharmacyItem i
        LEFT JOIN GenericNameMaster g ON g.GenericNameId = i.GenericNameId
        LEFT JOIN ManufacturerMaster m ON m.ManufacturerId = i.ManufacturerId
        LEFT JOIN UnitMaster u ON u.UnitId = i.UnitId
        WHERE i.IsActive = 1
          AND (@search = '%%' OR i.Name LIKE @search OR i.Category LIKE @search OR i.HSNCode LIKE @search
               OR g.Name LIKE @search OR m.Name LIKE @search OR u.Name LIKE @search)
        ORDER BY i.ItemId DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
