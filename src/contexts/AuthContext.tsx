"use client";

import { signIn, signOut, SessionProvider, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type UserRole = "admin" | "operator";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  kanbanEnabled: boolean;
  automationsEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

export function useAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const user: User | null =
    session?.user && mounted
      ? {
          id: (session.user as any).id as string,
          name: (session.user.name as string) || "",
          email: (session.user.email as string) || "",
          role: (((session.user as any).role as string)?.toLowerCase() || "operator") as UserRole,
          kanbanEnabled: !!(session.user as any).kanbanEnabled,
          automationsEnabled: !!(session.user as any).automationsEnabled,
        }
      : null;

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    if (!mounted) return { success: false, error: "Loading..." };
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl: "/",
      });
      return { success: true };
    } catch {
      return { success: false, error: "网络错误，请稍后重试" };
    }
  };

  const logout = () => {
    signOut({ callbackUrl: "/login" });
  };

  return { user, isLoading: status === "loading", login, logout };
}

export function requireAuth() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isLoading && !auth.user) {
      router.push("/login");
    }
  }, [auth.isLoading, auth.user, router]);

  return auth;
}