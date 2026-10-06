import { fixMojibake } from "./encoding";

export const BACKEND_HOST = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE_URL = `${BACKEND_HOST}/api/v1`;

// 1. Live AnyRoR Scrape or Fast DB Retrieval
export async function scrapeLandRecord(district: string, taluka: string, village: string, survey: string) {
  const res = await fetch(`${BASE_URL}/records/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ district, taluka, village, survey }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.detail || "Scraping failed");
    } catch {
      throw new Error(errorText || "Failed to fetch land record");
    }
  }
  const data = await res.json();
  return fixMojibake(data);
}

// 2. Fetch Parent Land Record by Survey Number (with optional Village Code)
export async function getRecordBySurvey(surveyNo: string, villageCode?: string) {
  const url = villageCode 
    ? `${BASE_URL}/records/survey/${surveyNo}?village_code=${villageCode}`
    : `${BASE_URL}/records/survey/${surveyNo}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error("Failed to fetch parcel details");
  }
  const data = await res.json();
  return fixMojibake(data);
}

// 3. Fetch All Processed Parcels in a Village (for Developer Rollup Grid)
export async function getRecordsByVillage(villageCode: string) {
  const res = await fetch(`${BASE_URL}/records/village/${villageCode}`);
  if (!res.ok) throw new Error("Failed to fetch village rollup");
  const data = await res.json();
  return fixMojibake(data);
}

// 4. Fetch Next Unverified Mutation Entry for Advocate Review
export async function getUnverifiedMutation(surveyNo?: string, villageCode?: string) {
  const params = new URLSearchParams();
  if (surveyNo) params.set("survey_no", surveyNo);
  if (villageCode) params.set("village_code", villageCode);
  
  const query = params.toString();
  const url = query ? `${BASE_URL}/mutations/unverified?${query}` : `${BASE_URL}/mutations/unverified`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch unverified mutation");
  const data = await res.json();
  return fixMojibake(data);
}

// 5. Submit Advocate Verification & Corrections
export async function verifyMutation(id: number, finalData: any) {
  const res = await fetch(`${BASE_URL}/mutations/${id}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_verified_data: finalData }),
  });
  if (!res.ok) throw new Error("Failed to verify mutation");
  const data = await res.json();
  return fixMojibake(data);
}

// 6. Fetch Live Dashboard Stats (Active Cases, Closed Cases, Verified Count)
export async function getDashboardStats(villageCode?: string) {
  const url = villageCode 
    ? `${BASE_URL}/mutations/stats?village_code=${villageCode}`
    : `${BASE_URL}/mutations/stats`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch stats");
  const data = await res.json();
  return fixMojibake(data);
}

// 7. Fetch Chronological Timeline for a Survey
export async function getSurveyTimeline(
  surveyNo: string,
  arg2?: string | boolean,
  arg3?: boolean | string
) {
  let villageCode: string | undefined = undefined;
  let includeUnverified = false;

  if (typeof arg2 === "boolean") {
    includeUnverified = arg2;
    if (typeof arg3 === "string") {
      villageCode = arg3;
    }
  } else {
    villageCode = arg2;
    if (typeof arg3 === "boolean") {
      includeUnverified = arg3;
    }
  }

  const params = new URLSearchParams();
  if (villageCode) params.set("village_code", villageCode);
  if (includeUnverified) params.set("include_unverified", "true");
  
  const query = params.toString();
  const url = `${BASE_URL}/mutations/survey/${surveyNo}/timeline${query ? `?${query}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch timeline");
  const data = await res.json();
  return fixMojibake(data);
}

// 8. Reopen a Verified Mutation (Sends it back to the Advocate Queue)
export async function reopenMutation(id: number) {
  const res = await fetch(`${BASE_URL}/mutations/${id}/reopen`, { 
    method: "PATCH" 
  });
  if (!res.ok) throw new Error("Failed to reopen mutation");
  const data = await res.json();
  return fixMojibake(data);
}

// 9. Upload Portfolio Batch CSV
export async function uploadPortfolioCsv(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BASE_URL}/portfolio/upload-csv`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "CSV upload failed");
  }
  const data = await res.json();
  return fixMojibake(data);
}

// 10. Fetch Districts
export async function getDistricts(liveSync: boolean = false): Promise<Array<{ code: string; name: string }>> {
  try {
    const res = await fetch(`${BASE_URL}/hierarchy/districts?live_sync=${liveSync}`);
    if (!res.ok) return [];
    const json = await res.json();
    return fixMojibake(json.data || []);
  } catch (err) {
    console.warn("Failed to fetch districts:", err);
    return [];
  }
}

// 10b. Fetch Talukas for District
export async function getTalukas(districtCode: string, liveSync: boolean = false): Promise<Array<{ code: string; name: string; district_code?: string }>> {
  try {
    const res = await fetch(`${BASE_URL}/hierarchy/talukas?district_code=${districtCode}&live_sync=${liveSync}`);
    if (!res.ok) return [];
    const json = await res.json();
    return fixMojibake(json.data || []);
  } catch (err) {
    console.warn("Failed to fetch talukas:", err);
    return [];
  }
}

// 10c. Fetch Indexed Villages for District and Taluka
export async function getIndexedVillages(districtCode: string, talukaCode: string, liveSync: boolean = false): Promise<Array<{ code: string; name: string; total_surveys: number }>> {
  try {
    const res = await fetch(`${BASE_URL}/hierarchy/villages?district_code=${districtCode}&taluka_code=${talukaCode}&live_sync=${liveSync}`);
    if (!res.ok) return [];
    const json = await res.json();
    return fixMojibake(json.data || []);
  } catch (err) {
    console.warn("Failed to fetch indexed villages:", err);
    return [];
  }
}

// 11. Fetch Indexed Survey Numbers for Village
export async function getIndexedSurveys(districtCode: string, talukaCode: string, villageCode: string): Promise<{ data: string[]; village_name: string | null; total: number }> {
  try {
    const res = await fetch(`${BASE_URL}/hierarchy/surveys?district_code=${districtCode}&taluka_code=${talukaCode}&village_code=${villageCode}`);
    if (!res.ok) return { data: [], village_name: null, total: 0 };
    const json = await res.json();
    return fixMojibake(json);
  } catch (err) {
    console.warn("Failed to fetch indexed surveys:", err);
    return { data: [], village_name: null, total: 0 };
  }
}

// 11b. Trigger Background Hierarchy Crawl
export async function triggerHierarchyCrawl(payload: { district_code?: string; taluka_code?: string; include_surveys?: boolean; max_villages?: number }) {
  const res = await fetch(`${BASE_URL}/hierarchy/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to trigger crawler");
  return await res.json();
}

// 11c. Get Crawler Status & Progress
export async function getCrawlStatus() {
  const res = await fetch(`${BASE_URL}/hierarchy/crawl/status`);
  if (!res.ok) return null;
  return await res.json();
}

// 12. Fetch Geographic Index Stats
export async function getHierarchyStats() {
  try {
    const res = await fetch(`${BASE_URL}/hierarchy/stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch hierarchy stats:", err);
    return null;
  }
}

// 13. Auto-fill Mutation with Gemini AI
export async function aiAutofillMutation(entryId: number, apiKey?: string) {
  const res = await fetch(`${BASE_URL}/mutations/${entryId}/ai-autofill`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Gemini-API-Key": apiKey } : {})
    },
    body: JSON.stringify(apiKey ? { api_key: apiKey } : {}),
  });
  if (!res.ok) throw new Error("AI auto-fill failed");
  const data = await res.json();
  return fixMojibake(data);
}

// 14. Get Gemini API Key Status
export async function getGeminiStatus() {
  try {
    const res = await fetch(`${BASE_URL}/mutations/settings/gemini-status`);
    if (!res.ok) return { has_key: false, masked_key: null, model: "gemini-3.8-flash" };
    return await res.json();
  } catch {
    return { has_key: false, masked_key: null, model: "gemini-3.8-flash" };
  }
}

// 15. Save Gemini API Key
export async function saveGeminiKey(apiKey: string) {
  const res = await fetch(`${BASE_URL}/mutations/settings/gemini-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) throw new Error("Failed to save Gemini key");
  return await res.json();
}

// 16. Fetch Family Pedhinamu & Land Ownership Tree
export async function getPedhinamuTree(surveyNo: string, villageCode?: string) {
  const url = villageCode 
    ? `${BASE_URL}/mutations/survey/${surveyNo}/pedhinamu-tree?village_code=${villageCode}`
    : `${BASE_URL}/mutations/survey/${surveyNo}/pedhinamu-tree`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch pedhinamu tree");
  const data = await res.json();
  return fixMojibake(data);
}