import { getQuery } from 'h3';
import { startScan } from '../../utils/scanner';

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const force = query.force === 'true';
  startScan(force);
  return { ok: true, message: force ? 'Force scan started' : 'Scan started' };
});
