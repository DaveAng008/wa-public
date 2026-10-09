"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/forms/CampaignForm";
import { campaignsApi } from "@/lib/api";
import Link from "next/link";

export default function NewCampaignPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className="max-w-xl pb-16">
      <div className="mb-6">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> 返回活动列表
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">新建活动</h1>
        <p className="text-slate-500 mt-1">创建一个新的 WhatsApp 营销活动</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <CampaignForm
          loading={isSaving}
          onSubmit={async (data) => {
            setIsSaving(true);
            try {
              const campaign = await campaignsApi.create(data);
              router.push(`/campaigns/${campaign.id}`);
            } finally {
              setIsSaving(false);
            }
          }}
        />
      </div>
    </div>
  );
}
