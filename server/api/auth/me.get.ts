import { getSessionUser } from '../../utils/auth';

export default defineEventHandler((event) => {
  const user = getSessionUser(event);
  if (!user) {
    return { loggedIn: false };
  }

  return {
    loggedIn: true,
    username: user.username,
    display_name: user.username,
    musicList: user.musicList
  };
});
