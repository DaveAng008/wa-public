import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readDB, writeDB } from '@/lib/db';

// 系统日志：仅登录用户可读写，避免公开泄露运行信息
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const db = await readDB();
        const logs = [...(db.logs || [])].reverse().slice(0, 100);
        return NextResponse.json(logs);
    } catch (e: any) {
        return NextResponse.json([]);
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const db = await readDB();
        
        const newLog = {
            id: Date.now().toString(),
            time: new Date().toISOString(),
            level: body.level || 'info',
            message: body.message,
            detail: body.detail || ''
        };
        
        db.logs.push(newLog);
        
        if (db.logs.length > 500) {
            db.logs = db.logs.slice(-500);
        }
        
        await writeDB(db);
        return NextResponse.json({ success: true, log: newLog });
    } catch (error: any) {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}

export async function DELETE() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const db = await readDB();
        db.logs = [];
        await writeDB(db);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}
