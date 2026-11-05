import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error: 'Username and password are required' });
    const pool = await getPool();
    const result = await pool
      .request()
      .input('u', sql.NVarChar, username.trim())
      .query('SELECT UserId, Username, PasswordHash, IsActive, Role FROM AppUser WHERE Username = @u');
    const user = result.recordset[0];
    if (!user || !user.IsActive || !verifyPassword(password, user.PasswordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const payload = { userId: user.UserId, username: user.Username, role: user.Role };
    const token = signToken(payload);
    res.json({ token, user: payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ userId: req.user.userId, username: req.user.username, role: req.user.role });
});

export default router;
