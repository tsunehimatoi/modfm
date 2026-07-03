import db from '../db';
import { requireUser } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const user = requireUser(event);

  db.prepare('DELETE FROM play_history WHERE user_id = ?').run(user.id);

  return { ok: true };
});
