import { getScanStatus } from '../../utils/scanner';

export default defineEventHandler(() => {
  return getScanStatus();
});
