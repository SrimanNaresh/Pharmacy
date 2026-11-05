import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { hashPassword } from '../utils/password.js';

const router = Router();

const ROLES = ['Staff', 'Admin'];
const COLUMNS = 'INSERTED.UserId, INSERTED.Username, INSERTED.IsActive, INSERTED.CreatedAt, INSERTED.Role';

function adminOnly(req, res, next) {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can manage users' });
  next();
}

// List users (never expose password hash). Optional ?search=
router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('search', sql.NVarChar, `%${search}%`)
      .query(`
        SELECT UserId, Username, IsActive, CreatedAt, Role FROM AppUser
        WHERE (@search = '%%' OR Username LIKE @search)
        ORDER BY UserId DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { username, password, isActive = true, role = 'Staff' } = req.body;
    if (!username?.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });
    const pool = await getPool();
    const dupe = await pool.request().input('u', sql.NVarChar, username.trim())
      .query('SELECT COUNT(*) AS n FROM AppUser WHERE Username = @u');
    if (dupe.recordset[0].n > 0) return res.status(409).json({ error: 'Username already exists' });
    const result = await pool.request()
      .input('u', sql.NVarChar, username.trim())
      .input('p', sql.NVarChar, hashPassword(password))
      .input('active', sql.Bit, isActive ? 1 : 0)
      .input('role', sql.NVarChar, ROLES.includes(role) ? role : 'Staff')
      .query(`INSERT INTO AppUser (Username, PasswordHash, IsActive, Role) OUTPUT ${COLUMNS} VALUES (@u, @p, @active, @role)`);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { username, password, isActive, role = 'Staff' } = req.body;
    if (!username?.trim()) return res.status(400).json({ error: 'Username is required' });
    const pool = await getPool();
    const dupe = await pool.request()
      .input('u', sql.NVarChar, username.trim())
      .input('id', sql.Int, req.params.id)
      .query('SELECT COUNT(*) AS n FROM AppUser WHERE Username = @u AND UserId <> @id');
    if (dupe.recordset[0].n > 0) return res.status(409).json({ error: 'Username already exists' });
    const request = pool.request()
      .input('id', sql.Int, req.params.id)
      .input('u', sql.NVarChar, username.trim())
      .input('active', sql.Bit, isActive ? 1 : 0)
      .input('role', sql.NVarChar, ROLES.includes(role) ? role : 'Staff');
    let query = 'UPDATE AppUser SET Username=@u, IsActive=@active, Role=@role';
    if (password) {
      request.input('p', sql.NVarChar, hashPassword(password));
      query += ', PasswordHash=@p';
    }
    query += ` OUTPUT ${COLUMNS} WHERE UserId=@id`;
    const result = await request.query(query);
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Soft delete: the login is switched off, its history (CreatedBy) stays.
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    if (Number(req.params.id) === Number(req.user.userId)) return res.status(400).json({ error: 'You cannot delete your own login' });
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query('UPDATE AppUser SET IsActive = 0 WHERE UserId = @id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
