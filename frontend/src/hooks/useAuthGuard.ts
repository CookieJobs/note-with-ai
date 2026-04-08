import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, getUser, User } from '../utils/auth';

export const useAuthGuard = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    if (!isAuthenticated()) {
      router.push('/auth');
      return;
    }

    const userData = getUser();
    if (userData) {
      setUser(userData);
    } else {
      router.push('/auth');
    }
  }, [isClient, router]);

  return { user, isClient };
};
