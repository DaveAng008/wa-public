import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

// ─── Extend Session & JWT to include role + id ──────────────────────────────
declare module "next-auth" {
  interface Session {
    user: { id: string; role: string; kanbanEnabled: boolean; automationsEnabled: boolean } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    kanbanEnabled?: boolean;
    automationsEnabled?: boolean;
  }
}

// ─── DB helper ───────────────────────────────────────────────────────────────
async function getUser(email: string) {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute<any[]>(
    "SELECT id, name, email, passwordHash, role, kanbanEnabled, automationsEnabled FROM User WHERE email = ? LIMIT 1",
    [email]
  );
  await conn.end();
  return rows[0] ?? null;
}

// ─── 会话密钥：必须由环境变量提供，源码中不留任何默认值 ──────────────────────
function getAuthSecret(): string | undefined {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    // next build 阶段会导入模块做静态分析，此时还没有运行时会话，允许先通过
    if (process.env.NEXT_PHASE === "phase-production-build") return undefined;
    throw new Error(
      "[FATAL] 未配置环境变量 AUTH_SECRET。请设置一个 ≥32 位的随机字符串（openssl rand -base64 48）后重启服务。"
    );
  }
  return secret;
}

// ─── Auth config ─────────────────────────────────────────────────────────────
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        
        const user = await getUser(credentials.email as string);
        if (!user) {
          console.log(`[AUTH_DEBUG] 用户不存在: ${credentials.email}`);
          return null;
        }



        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          console.log(`[AUTH_DEBUG] 密码错误: ${credentials.email}`);
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          kanbanEnabled: !!user.kanbanEnabled,
          automationsEnabled: !!user.automationsEnabled,
        };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user) {
        console.log(`[AUTH_DEBUG] JWT 回调: 为用户 ${user.email} 生成 Token`);
        token.id = user.id;
        token.role = (user as any).role;
        token.kanbanEnabled = (user as any).kanbanEnabled;
        token.automationsEnabled = (user as any).automationsEnabled;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.kanbanEnabled = !!token.kanbanEnabled;
        session.user.automationsEnabled = !!token.automationsEnabled;

        try {
          const conn = await mysql.createConnection(process.env.DATABASE_URL!);
          try {
            const [rows] = await conn.execute<any[]>(
              "SELECT role, kanbanEnabled, automationsEnabled FROM User WHERE id = ? LIMIT 1",
              [token.id as string]
            );
            if (rows[0]) {
              session.user.role = rows[0].role.toLowerCase();
              session.user.kanbanEnabled = !!rows[0].kanbanEnabled;
              session.user.automationsEnabled = !!rows[0].automationsEnabled;
            }
          } finally {
            await conn.end();
          }
        } catch (e) {
          console.error("[AUTH_DEBUG] Session callback DB check error:", e);
        }

        console.log(`[AUTH_DEBUG] Session 回调: 会话已建立 (Role: ${session.user.role}, KanbanEnabled: ${session.user.kanbanEnabled}, AutomationsEnabled: ${session.user.automationsEnabled})`);
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  secret: getAuthSecret(),
  session: { strategy: "jwt" },
});
