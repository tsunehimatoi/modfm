import { requireUser } from '../utils/auth';

export default defineEventHandler((event) => {
  const user = requireUser(event);
  return {
    display_name: user.username,
    musicList: user.musicList
  };
});
