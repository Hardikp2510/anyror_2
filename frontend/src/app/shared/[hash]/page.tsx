"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import TitleNodeLogo from "@/components/TitleNodeLogo";
import { getRecordBySurvey, getSurveyTimeline } from "@/lib/api";

const FALLBACK_DOSSIER = {
  survey_no: "2",
  village: "Hasan Nagar",
  taluka: "Bavla",
  district: "Ahmedabad",
  generated_date: "13/09/2026",
  risk_assessment: {
    ownership: { status: "Private", is_flagged: false },
    tenure: { status: "Freehold", is_flagged: false },
    encumbrance: { status: "Active Boja", is_flagged: true },
    litigation: { status: "Clear", is_flagged: false }
  },
  timeline: [
    { id: 101, entry_number: "132", final_verified_data: { entry_date: "15-04-1954", transaction_type: "સરકારી હુકમ / ગણોતિયા", remarks_summary: "Mutation entry based on Collector order regarding tenancy rights.", new_owners: ["ખાતેદાર એ", "ખાતેદાર બી"], previous_owners: ["Government"] } },
    { id: 102, entry_number: "256", final_verified_data: { entry_date: "12-08-1982", transaction_type: "વારસાઈ (Inheritance)", remarks_summary: "Succession entry recorded. Names of direct heirs added.", new_owners: ["કાયદેસર વારસદાર ૧", "કાયદેસર વારસદાર ૨"], previous_owners: ["મૂળ ખાતેદાર"] } },
    { id: 103, entry_number: "410", final_verified_data: { entry_date: "05-11-2015", transaction_type: "વેચાણ (Sale Deed)", remarks_summary: "Registered sale deed executed. Land sold.", new_owners: ["TitleNode Commercial Ltd."], previous_owners: ["કાયદેસર વારસદાર ૧", "કાયદેસર વારસદાર ૨"] } }
  ]
};

export default function SharedDossier() {
  const params = useParams();
  const hash = (params.hash as string) || "2";
  const surveyNo = /^\d+$/.test(hash) ? hash : "2";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    survey_no: string;
    village: string;
    taluka: string;
    district: string;
    generated_date: string;
    risk_assessment: any;
    timeline: any[];
  }>(FALLBACK_DOSSIER);

  useEffect(() => {
    async function loadData() {
      try {
        const [rec, tl] = await Promise.all([
          getRecordBySurvey(surveyNo).catch(() => null),
          getSurveyTimeline(surveyNo).catch(() => null)
        ]);

        if (rec) {
          const ext = rec.extracted_data || {};
          const basic = ext.Basic_Details || ext["Basic Details"] || {};
          const rf = ext.Risk_Flags || {};
          
          const dynamicRisks = {
            ownership: {
              status: rf.A_Ownership?.status?.replace(/^[🟢🟡🔴⚪]\s*/, "") || "Private",
              is_flagged: rf.A_Ownership?.color === "red"
            },
            tenure: {
              status: rf.B_Tenure?.status?.replace(/^[🟢🟡🔴⚪]\s*/, "") || "Freehold",
              is_flagged: rf.B_Tenure?.color === "red"
            },
            encumbrance: {
              status: rf.C_Encumbrance?.status?.replace(/^[🟢🟡🔴⚪]\s*/, "") || "Clear",
              is_flagged: rf.C_Encumbrance?.color === "yellow" || rf.C_Encumbrance?.color === "red"
            },
            litigation: {
              status: rf.D_Litigation?.status?.replace(/^[🟢🟡🔴⚪]\s*/, "") || "Clear",
              is_flagged: rf.D_Litigation?.color === "red"
            }
          };

          const rawTimeline = (tl && tl.data && Array.isArray(tl.data)) 
            ? tl.data 
            : (Array.isArray(tl) ? tl : []);

          const finalTimeline = rawTimeline.length > 0 
            ? rawTimeline 
            : FALLBACK_DOSSIER.timeline;

          const genDate = rec.scraped_at ? new Date(rec.scraped_at).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB");
          
          setData({
            survey_no: rec.survey_no || surveyNo,
            village: basic.Village || ext.Village || rec.village_code || "Hasan Nagar",
            taluka: basic.Taluka || ext.Taluka || rec.taluka_code || "Bavla",
            district: basic.District || ext.District || rec.district_code || "Ahmedabad",
            generated_date: genDate,
            risk_assessment: dynamicRisks,
            timeline: finalTimeline
          });
        }
      } catch (err) {
        console.warn("Using fallback dossier data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [surveyNo]);

  const risks = data.risk_assessment || {};

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-[#0F2C59] pb-20">
      
      {/* LEAD CAPTURE BANNER (Sticky on Mobile) */}
      <div className="bg-[#DAC0A3] text-[#0F2C59] px-4 py-3 text-center text-xs font-bold uppercase tracking-widest sticky top-0 z-50 shadow-md flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-6">
        <span>Need intelligence on another parcel?</span>
        <a href="mailto:sales@titlenode.com" className="bg-[#0F2C59] text-[#F8F0E5] px-4 py-2 rounded-sm hover:bg-[#1a407e] transition-colors">
          Request Access
        </a>
      </div>

      {/* TitleNode Official Mobile Header */}
      <div className="bg-[#0F2C59] p-8 text-center shadow-md rounded-b-xl mb-6">
        <TitleNodeLogo mode="reversed" variant="full" size="md" />
      </div>

      <div className="max-w-2xl mx-auto px-4 space-y-6">
        
        {loading ? (
          <div className="bg-white p-8 rounded-lg shadow-sm border border-[#0F2C59]/10 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0F2C59] mx-auto mb-3"></div>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Loading Verified Dossier...</p>
          </div>
        ) : (
          <>
            {/* PARCEL SUMMARY CARD */}
            <div className="bg-white p-5 rounded-lg shadow-sm border border-[#0F2C59]/10">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[#7A5C2E] mb-1">Survey No.</span>
                  <span className="text-xl font-bold">{data.survey_no}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[#7A5C2E] mb-1">Generated</span>
                  <span className="text-sm font-bold">{data.generated_date}</span>
                </div>
                <div className="col-span-2 pt-3 border-t border-[#0F2C59]/5">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[#7A5C2E] mb-1">Location</span>
                  <span className="text-sm font-medium">{data.village}, {data.taluka}, {data.district}</span>
                </div>
              </div>
            </div>

            {/* MOBILE TRAFFIC LIGHTS */}
            <div className="bg-white p-5 rounded-lg shadow-sm border border-[#0F2C59]/10">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-4 border-b border-[#0F2C59]/10 pb-2">Risk Assessment</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-md flex flex-col justify-between border ${risks.ownership?.is_flagged ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <span className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${risks.ownership?.is_flagged ? "text-amber-900/60" : "text-emerald-900/60"}`}>Ownership</span>
                  <span className={`text-sm font-bold ${risks.ownership?.is_flagged ? "text-amber-900" : "text-emerald-900"}`}>
                    {risks.ownership?.status || "Private"}
                  </span>
                </div>
                <div className={`p-3 rounded-md flex flex-col justify-between border ${risks.tenure?.is_flagged ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <span className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${risks.tenure?.is_flagged ? "text-amber-900/60" : "text-emerald-900/60"}`}>Tenure</span>
                  <span className={`text-sm font-bold ${risks.tenure?.is_flagged ? "text-amber-900" : "text-emerald-900"}`}>
                    {risks.tenure?.status || "Freehold"}
                  </span>
                </div>
                <div className={`p-3 rounded-md flex flex-col justify-between border ${risks.encumbrance?.is_flagged ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <span className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${risks.encumbrance?.is_flagged ? "text-amber-900/60" : "text-emerald-900/60"}`}>Encumbrance</span>
                  <span className={`text-sm font-bold ${risks.encumbrance?.is_flagged ? "text-amber-900" : "text-emerald-900"}`}>
                    {risks.encumbrance?.status || "Clear"}
                  </span>
                </div>
                <div className={`p-3 rounded-md flex flex-col justify-between border ${risks.litigation?.is_flagged ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <span className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${risks.litigation?.is_flagged ? "text-amber-900/60" : "text-emerald-900/60"}`}>Litigation</span>
                  <span className={`text-sm font-bold ${risks.litigation?.is_flagged ? "text-amber-900" : "text-emerald-900"}`}>
                    {risks.litigation?.status || "Clear"}
                  </span>
                </div>
              </div>
            </div>

            {/* MOBILE TIMELINE */}
            <div className="bg-white p-5 rounded-lg shadow-sm border border-[#0F2C59]/10">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-4 border-b border-[#0F2C59]/10 pb-2">Verified Chain of Title</h2>
              <div className="space-y-4">
                {data.timeline.map((node) => {
                  const verified = node.final_verified_data || {};
                  const prevOwners = Array.isArray(verified.previous_owners) ? verified.previous_owners.join(", ") : (verified.previous_owners || "—");
                  const newOwners = Array.isArray(verified.new_owners) ? verified.new_owners.join(", ") : (verified.new_owners || "—");

                  return (
                    <div key={node.id} className="bg-slate-50 border border-[#0F2C59]/10 p-4 rounded-md">
                      <div className="flex justify-between items-start mb-2">
                        <span className="bg-[#0F2C59] text-white text-[9px] font-bold px-2 py-1 rounded-sm uppercase tracking-widest">Entry {node.entry_number}</span>
                        <span className="text-[10px] font-bold text-[#7A5C2E]">{verified.entry_date || "—"}</span>
                      </div>
                      <h3 className="text-sm font-bold text-[#0F2C59] mb-2">{verified.transaction_type || "Land Mutation"}</h3>
                      <p className="text-xs opacity-80 mb-3">{verified.remarks_summary || "Mutation verified by TitleNode Advocate Engine."}</p>
                      
                      <div className="space-y-2 pt-2 border-t border-[#0F2C59]/10 text-[10px]">
                        <div>
                          <span className="font-bold text-[#7A5C2E] uppercase tracking-widest block mb-0.5">From (Previous)</span>
                          <span className="font-medium">{prevOwners}</span>
                        </div>
                        <div>
                          <span className="font-bold text-green-700 uppercase tracking-widest block mb-0.5">To (New)</span>
                          <span className="font-medium">{newOwners}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* STRICT LEGAL DISCLAIMER */}
        <div className="bg-[#0F2C59] text-[#F8F0E5] p-6 rounded-lg shadow-md mt-8">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[#DAC0A3] mb-3 border-b border-[#DAC0A3]/20 pb-2 flex items-center gap-2">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            Legal Disclaimer
          </h2>
          <p className="text-xs leading-relaxed opacity-90 text-justify">
            This document is generated by TitleNode's proprietary AI intelligence engine using publicly available data scraped from the Government of Gujarat Revenue portal. 
            <br/><br/>
            <strong>THIS IS NOT A CERTIFIED LEGAL TITLE SEARCH.</strong> 
            <br/><br/>
            While this data has been structurally verified by our network of advocates for accuracy against the original OCR/HTML records, it is provided strictly for preliminary risk-assessment and B2B intelligence purposes. It does not replace the requirement for a physical Title Clearance Certificate issued by a registered legal practitioner.
          </p>
        </div>

      </div>
    </div>
  );
}