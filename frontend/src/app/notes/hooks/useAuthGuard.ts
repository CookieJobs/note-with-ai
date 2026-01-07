import { useEffect, useState } from 'react';

type UseAuthGuardOptions<TUser> = {
  isAuthenticated: () => boolean;
  getUser: () => TUser | null;
  redirectTo?: string;
  routerPush: (path: string) => void;
};

export function useAuthGuard<TUser = any>({
  isAuthenticated,
  getUser,
  redirectTo = '/auth',
  routerPush,
}: UseAuthGuardOptions<TUser>) {
  const [user, setUser] = useState<TUser | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      routerPush(redirectTo);
      return;
    }

    const userData = getUser();
    if (userData) setUser(userData);
    else routerPush(redirectTo);
  }, [getUser, isAuthenticated, redirectTo, routerPush]);

  return user;
}


