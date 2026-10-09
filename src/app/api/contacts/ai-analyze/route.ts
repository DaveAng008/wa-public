import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await getConn();

  try {
    const body = await req.json();
    const { 
      selectedBrand, 
      selectedModel, 
      customPrompt,
      useMarketData = true,
      useTagData = true,
      useCampaignData = true,
      useRespondedData = false,
      markets: customMarkets,
      tags: customTags,
      dynamicColumns = []
    } = body;

    // 1. 获取联系人统计数据
    const [totalRes]: any = await conn.execute(
      "SELECT COUNT(*) as count FROM Contact WHERE userId = ?",
      [userId]
    );
    const total = totalRes[0].count;

    const [unsentRes]: any = await conn.execute(
      "SELECT COUNT(*) as count FROM Contact WHERE userId = ? AND sent = false",
      [userId]
    );
    const unsent = unsentRes[0].count;
    const sent = total - unsent;
    const unsentPercentage = total > 0 ? ((unsent / total) * 100).toFixed(1) : "0";

    const [marketRes]: any = await conn.execute(
      "SELECT market, COUNT(*) as count FROM Contact WHERE userId = ? GROUP BY market",
      [userId]
    );
    const markets = marketRes.map((r: any) => `${r.market || "未填"}: ${r.count}人`);

    const [relationRes]: any = await conn.execute(
      "SELECT relation FROM Contact WHERE userId = ?",
      [userId]
    );
    const tagCounts: { [key: string]: number } = {};
    relationRes.forEach((row: any) => {
      try {
        const tags = JSON.parse(row.relation || "[]");
        tags.forEach((tag: string) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      } catch (e) {}
    });
    const tags = Object.entries(tagCounts)
      .map(([name, count]) => `${name}: ${count}人`)
      .sort((a, b) => b.localeCompare(a)); // 简单排序

    // 2. 获取活动数据
    const [campaignRes]: any = await conn.execute(
      "SELECT name, status, contactCount FROM Campaign WHERE userId = ?",
      [userId]
    );
    const campaigns = campaignRes.map((c: any) => `${c.name} (状态: ${c.status}, 覆盖: ${c.contactCount}人)`);

    // 🌟 计算动态选择的列 (如果存在)
    const dynamicStats: string[] = [];
    if (dynamicColumns.length > 0) {
      const [propsRes]: any = await conn.execute(
        "SELECT properties FROM Contact WHERE userId = ?",
        [userId]
      );
      
      dynamicColumns.forEach((col: any) => {
        const colName = col.name;
        const allowedValues = col.values || [];
        const counts: { [key: string]: number } = {};
        
        propsRes.forEach((row: any) => {
          try {
            const props = JSON.parse(row.properties || "{}");
            const val = props[colName];
            if (val && (allowedValues.length === 0 || allowedValues.includes(String(val)))) {
              counts[String(val)] = (counts[String(val)] || 0) + 1;
            }
          } catch (e) {}
        });
        
        Object.entries(counts).forEach(([val, count]) => {
          dynamicStats.push(`${colName}-${val}: ${count}人`);
        });
      });
    }

    // 3. 获取 API Keys
    const [userRows]: any = await conn.execute(
      "SELECT apiKeys FROM User WHERE id = ? LIMIT 1",
      [userId]
    );
    const user = userRows[0] || {};
    const apiKeys = typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys || {};
    const apiKey = apiKeys[selectedBrand] || "";

    // 4. 构建发送给 AI 的数据
    const analysisData = {
      userId,
      stats: {
        total,
        unsent,
        sent,
        unsentPercentage,
        markets: customMarkets || (useMarketData ? markets : []),
        tags: [
          ...(customTags || (useTagData ? tags : [])),
          ...dynamicStats
        ]
      },
      campaigns: useCampaignData ? campaigns : [],
      date: new Date().toISOString().split('T')[0],
      brand: selectedBrand,
      model: selectedModel,
      apiKey,
      customPrompt: customPrompt || "" // 👈 传递自定义提示词
    };

    if (!apiKey) {
      return NextResponse.json({ error: `请先在系统设置中配置 ${selectedBrand} 的 API Key` }, { status: 400 });
    }

    // 5. 拼接 Prompt
    let promptText = customPrompt || `你是一位顶期的私域流量与 WhatsApp 营销专家。请帮我分析客户数据并给出营销建议。要求：语言精炼，分点列出，直接给出可执行的建议，适合在仪表盘UI中展示。`;
    const marketStr = analysisData.stats.markets.join('\n');
    const tagStr = analysisData.stats.tags.join('\n');
    const campaignStr = analysisData.campaigns.join('\n');

    promptText += `\n\n=== 以下是我的真实客户数据 ===\n【数据概览】\n总计: ${total}人，已发送: ${sent}人，未发送: ${unsent}人 (${unsentPercentage}%)\n\n【市场分布】\n${marketStr}\n\n【标签/关系构成】\n${tagStr}\n\n【营销活动历史】\n${campaignStr}\n\n请直接输出分析报告！`;

    // 6. 直连 AI 大模型
    let apiUrl = "https://api.deepseek.com/chat/completions";
    if (selectedBrand === "openai") {
      apiUrl = "https://api.openai.com/v1/chat/completions";
    } else if (selectedBrand === "gemini") {
      apiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    }

    const defaultModel = selectedBrand === "deepseek" 
      ? "deepseek-chat" 
      : selectedBrand === "gemini" 
        ? "gemini-2.5-pro" 
        : "gpt-4o";

    const aiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel || defaultModel,
        messages: [
          { role: "user", content: promptText }
        ],
        temperature: 0.7
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      return NextResponse.json({ error: `AI 接口返回错误: ${errorText}` }, { status: aiResponse.status });
    }

    const aiResult = await aiResponse.json();
    const analysis = aiResult.choices?.[0]?.message?.content || "";

    if (!analysis) {
      return NextResponse.json({ error: "AI 接口未返回任何分析内容" }, { status: 500 });
    }
    
    // 🌟 保存到数据库
    await conn.execute(
      "UPDATE AppSettings SET latestAiAnalysis = ?, latestAiAnalysisTime = ?, updatedAt = NOW() WHERE userId = ?",
      [analysis, new Date(), userId]
    );
    
    return NextResponse.json({ analysis });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
