import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readDB, writeDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = await readDB();
    return NextResponse.json(db.audience);
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const newAudience = await request.json();
    const db = await readDB();
    db.audience = { ...db.audience, ...newAudience };
    await writeDB(db);
    return NextResponse.json({ success: true, audience: db.audience });
}
