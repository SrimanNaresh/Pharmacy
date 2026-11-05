import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';

const router = Router();

// The pharmacy's own details (one row, ClinicId = 1): printed on the sales
// receipt, and AppName is the software name on the login page and browser tab.
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT TOP 1 * FROM ClinicDetails WHERE ClinicId = 1');
    res.json(result.recordset[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can change the pharmacy details' });
    const { name, address, logo, email, contactNo, appName } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Pharmacy name is required' });
    const pool = await getPool();
    const result = await pool.request()
      .input('name', sql.NVarChar, name.trim())
      .input('address', sql.NVarChar, address?.trim() || null)
      .input('logo', sql.NVarChar(sql.MAX), logo || null)
      .input('email', sql.NVarChar, email?.trim() || null)
      .input('contactNo', sql.NVarChar, contactNo?.trim() || null)
      .input('appName', sql.NVarChar, appName?.trim() || null)
      .query(`
        MERGE ClinicDetails AS target
        USING (SELECT 1 AS ClinicId) AS source ON target.ClinicId = source.ClinicId
        WHEN MATCHED THEN UPDATE SET Name=@name, Address=@address, Logo=@logo, Email=@email,
          ContactNo=@contactNo, AppName=@appName, UpdatedAt=GETDATE()
        WHEN NOT MATCHED THEN INSERT (ClinicId, Name, Address, Logo, Email, ContactNo, AppName)
          VALUES (1, @name, @address, @logo, @email, @contactNo, @appName)
        OUTPUT INSERTED.*;
      `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
