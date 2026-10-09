import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: 读取缓存的 schema（不访问 Notion，秒回）。需要登录，避免泄露工作区结构。
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await readDB();
    const cached = db.cachedSchema;

    if (cached && cached.data) {
        return NextResponse.json({
            schema: cached.data,
            updatedAt: cached.updatedAt,
            source: 'cache'
        });
    }

    return NextResponse.json({ schema: null, source: 'empty' });
}
