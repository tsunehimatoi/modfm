import { computed } from "vue";
import { $fetch } from "ofetch";

export interface AuthUser {
  loggedIn: boolean;
  username: string;
  musicList: Array<{ fn: string; id: number }>;
}

const apiFetch = (input: string, init?: any) => {
  if (import.meta.server) {
    // Forward request context (including cookies) during SSR.
    const requestFetch = useRequestFetch();
    return requestFetch(input, init);
  }
  return $fetch(input, { ...init, credentials: "include" });
};

/**
 * Global singleton composable for authentication & favorites management.
 *
 * This is the SINGLE source of truth for:
 *  - Login state (loggedIn, username)
 *  - User's music/favorites list
 *
 * All components (PlayerPage, InfoDrawer, PlayerControls, TheHeader)
 * and the legacy player-app.ts should read from this store.
 */
export const useAuthStore = () => {
  // Nuxt useState ensures SSR-safe global singleton
  const authState = useState<AuthUser>("auth", () => ({
    loggedIn: false,
    username: "",
    musicList: [],
  }));

  // Internal flag to prevent concurrent refresh calls
  const _refreshing = useState<boolean>("auth_refreshing", () => false);

  /**
   * Fetch current session from server. Call once on app init.
   */
  const refresh = async () => {
    if (_refreshing.value) return;
    _refreshing.value = true;
    try {
      const data = await apiFetch("/api/auth/me");
      if (data && data.loggedIn) {
        authState.value = {
          loggedIn: true,
          username: data.username || "",
          musicList: Array.isArray(data.musicList) ? data.musicList : [],
        };
      } else {
        authState.value = { loggedIn: false, username: "", musicList: [] };
      }
    } catch {
      authState.value = { loggedIn: false, username: "", musicList: [] };
    } finally {
      _refreshing.value = false;
    }
    _notifyLegacy();
  };

  /**
   * Login with username and password.
   * On success, automatically refreshes session state.
   */
  const login = async (username: string, password: string) => {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username, password },
    });
    // After login, refresh to get full user data including musicList
    await refresh();
    return data;
  };

  /**
   * Register a new account.
   * On success, automatically refreshes session state.
   */
  const register = async (username: string, password: string) => {
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username, password },
    });
    // After registration, refresh to get full user data
    await refresh();
    return data;
  };

  /**
   * Logout. Clears local state immediately, then calls server.
   */
  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      authState.value = { loggedIn: false, username: "", musicList: [] };
      _notifyLegacy();
    }
  };

  /**
   * Toggle like for a track. Uses the server response to update musicList
   * immediately — no extra fetch needed.
   */
  const toggleLike = async (fileName: string) => {
    if (!authState.value.loggedIn || !fileName) return;

    const data = await apiFetch("/api/like", {
      method: "POST",
      body: { name: fileName },
    });

    // The /api/like endpoint returns { ok, musicList } — use it directly
    if (data && Array.isArray(data.musicList)) {
      authState.value = {
        ...authState.value,
        musicList: data.musicList,
      };
    }
    _notifyLegacy();
  };

  /**
   * Check if a specific file is in the user's favorites.
   */
  const isLiked = (fileName: string | (() => string)) => {
    return computed(() => {
      const fn = typeof fileName === "function" ? fileName() : fileName;
      if (!fn || !authState.value.loggedIn) return false;
      return authState.value.musicList.some((item) => item.fn === fn);
    });
  };

  /**
   * Notify legacy player-app.ts about auth/musiclist changes
   * so it can update its internal state and re-render playlist if needed.
   */
  const _notifyLegacy = () => {
    if (typeof window === "undefined") return;
    // Expose store on window for player-app.ts to read
    (window as any).__authStore = {
      loggedIn: authState.value.loggedIn,
      username: authState.value.username,
      musicList: authState.value.musicList,
    };
    // Dispatch event for player-app.ts to react
    window.dispatchEvent(
      new CustomEvent("auth:state-changed", {
        detail: {
          loggedIn: authState.value.loggedIn,
          username: authState.value.username,
          musicList: authState.value.musicList,
        },
      }),
    );
  };

  return {
    authState: computed(() => authState.value),
    refresh,
    login,
    register,
    logout,
    toggleLike,
    isLiked,
  };
};
