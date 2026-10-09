import fs from 'fs/promises';
import path from 'path';

// 运行时数据目录：默认当前工作目录；容器部署时用 DATA_DIR 指向持久卷（如 /app/data）
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const DB_FILE = path.join(DATA_DIR, 'data.json');

const defaultData = {
    settings: {
        scheduledTime: "09:35",
        maxSendLimit: 150,
        minDelay: 140,
        maxDelay: 190,
        n8nWebhookUrl: "",
        notionSecret: "",
        notionDatabaseId: ""
    },
    audience: {
        markets: [],
        relations: [],
        raceAndLangs: [],
        sendStatuses: [],
        responseStatuses: [],
    },
    cachedSchema: {
        data: null as any,
        updatedAt: null as string | null,
    },
    logs: [] as any[]
};

export async function readDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        
        // 关键增强：确保即使旧版 data.json 存在，返回的对象也会包含 logs 数组
        if (!parsed.logs) {
            parsed.logs = [];
        }
        
        return parsed;
    } catch (err) {
        // If file doesn't exist or is invalid, create it with default data
        await writeDB(defaultData);
        return defaultData;
    }
}

export async function writeDB(data: any) {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
