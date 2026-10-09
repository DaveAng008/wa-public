import { NextResponse } from "next/server";
import { auth } from "@/auth";
import mysql from "mysql2/promise";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  try {
    const data = await req.json();
    const { content, prompt, date, type, selectedBrand, selectedModel } = data;

    // 从数据库获取用户的 API Keys
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    
    const [userRows]: any = await conn.execute(
      "SELECT apiKeys FROM User WHERE id = ? LIMIT 1",
      [userId]
    );
    
    await conn.end();
 
    const user = userRows[0] || {};
    const apiKeys = typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys || {};
    const apiKey = apiKeys[selectedBrand] || "";

    if (!apiKey) {
      return NextResponse.json({ error: `请先在系统设置中配置 ${selectedBrand} 的 API Key` }, { status: 400 });
    }

    // 1. 构建 Prompt
    const systemPrompt = `你是一位顶级的私域流量与文案高手。请根据用户的要求改写文案。请直接输出改写后的内容，不要有多余的解释或问候。`;
    let userPromptContent = `原案内容：\n${content}\n\n改写要求：\n${prompt}\n\n`;
    
    if (type === "RANDOM_GROUP") {
      userPromptContent += `请生成 5 个完全不同的改写版本，每个版本自成一行，不要输出行号、不要有多余的解释或问候，直接输出改写后的 5 条文案。`;
    } else {
      userPromptContent += `请直接输出改写后的文案，不要有任何多余的解释。`;
    }

    // 2. 直连 AI 大模型
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

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel || defaultModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPromptContent }
        ],
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `AI 接口返回错误: ${errorText}` }, { status: response.status });
    }

    const result = await response.json();
    const rawText = result.choices?.[0]?.message?.content || "";

    if (!rawText) {
      return NextResponse.json({ error: "AI 未返回任何改写文案" }, { status: 500 });
    }

    // 3. 解析结果，如果是随机文本组则按行拆分为 5 个版本
    let results: string[] = [];
    if (type === "RANDOM_GROUP") {
      results = rawText.split('\n')
        .map((l: string) => l.trim().replace(/^\d+[\.\s、\-\:]+/, "")) // 过滤 "1.", "1 -", "1、" 等前缀
        .filter((l: string) => l.length > 0);
    } else {
      results = [rawText.trim()];
    }

    return NextResponse.json({ results });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
