import { NextResponse } from 'next/server';
import { Client } from '@notionhq/client';
import { readDB, writeDB } from '@/lib/db';
import mysql from 'mysql2/promise';
import { auth } from "@/auth";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session?.user?.id;
    const url = new URL(req.url);
    const sourceId = url.searchParams.get("sourceId") || "";
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    try {
        let notionSecret = "";
        let notionDatabaseId = "";

        if (sourceId) {
            const [ds]: any = await conn.execute(
                "SELECT notionSecret, notionDatabaseId FROM DataSource WHERE id = ? AND userId = ? LIMIT 1",
                [sourceId, userId]
            );
            if (ds[0]) {
                notionSecret = ds[0].notionSecret || "";
                notionDatabaseId = ds[0].notionDatabaseId || "";
            }
        }

        if (!notionSecret || !notionDatabaseId) {
            const [settings]: any = await conn.execute(
                "SELECT notionSecret, notionDatabaseId FROM AppSettings WHERE userId = ? LIMIT 1",
                [userId]
            );
            notionSecret = settings[0]?.notionSecret || "";
            notionDatabaseId = settings[0]?.notionDatabaseId || "";
        }

        if (!notionSecret || !notionDatabaseId) {
            return NextResponse.json({ error: "NoCredentials" }, { status: 400 });
        }

        const notion = new Client({ auth: notionSecret });

        let allResults: any[] = [];
        let cursor: string | undefined = undefined;
        let pagesFetched = 0;

        do {
            const fetchResponse: Response = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}/query`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${notionSecret}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    page_size: 100,
                    start_cursor: cursor || undefined
                }, (key, value) => value === undefined ? undefined : value),
                cache: 'no-store'
            });

            if (!fetchResponse.ok) {
                const errorData = await fetchResponse.json().catch(() => ({}));
                throw new Error(`Notion API 错误: ${errorData.message || fetchResponse.statusText}`);
            }

            const response: any = await fetchResponse.json();
            allResults.push(...(response.results || []));
            cursor = response.next_cursor || undefined;
            pagesFetched++;
        } while (cursor && pagesFetched < 10); // 最多拉取前 1000 个联系人以防超时

        const markets = new Set<string>();
        const relations = new Set<string>();
        const raceAndLangs = new Set<string>();
        const sendStatuses = new Set<string>();
        const responseStatuses = new Set<string>();

        // 提取 Notion 数据库包含的所有的真实列名和类型 (用于映射下拉框)
        let propertiesSchema: Array<{ name: string; type: string }> = [];
        if (allResults.length > 0) {
            const sampleProps = allResults[0].properties;
            propertiesSchema = Object.keys(sampleProps).map(key => ({
                name: key,
                type: sampleProps[key].type
            }));
        }

        allResults.forEach((page: any) => {
            const props = page.properties;
            if (!props) return;

            const market = props["市场"]?.select?.name;
            if (market) markets.add(market);

            const rels = props["关系"]?.multi_select || [];
            rels.forEach((r: any) => relations.add(r.name));

            const rnls = props["种族和语言"]?.multi_select || [];
            rnls.forEach((r: any) => raceAndLangs.add(r.name));

            const sendStatus = props["是否已发送"]?.select?.name;
            if (sendStatus) sendStatuses.add(sendStatus);

            const responseStatus = props["是否有回应"]?.select?.name;
            if (responseStatus) responseStatuses.add(responseStatus);
        });

        const schema = {
            markets: Array.from(markets),
            relations: Array.from(relations),
            raceAndLangs: Array.from(raceAndLangs),
            sendStatuses: Array.from(sendStatuses),
            responseStatuses: Array.from(responseStatuses),
            properties: propertiesSchema, // 返回所有列名给前端做下拉框
        };

        // 将拉取到的 schema 缓存到 data.json（钉住数据）
        const db = await readDB();
        db.cachedSchema = {
            data: schema,
            updatedAt: new Date().toISOString(),
        };
        await writeDB(db);

        return NextResponse.json(schema);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        await conn.end();
    }
}
