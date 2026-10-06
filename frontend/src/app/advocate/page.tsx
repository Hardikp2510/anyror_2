"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TitleNodeLogo from "@/components/TitleNodeLogo";

import { 
  getDashboardStats, 
  scrapeLandRecord, 
  getDistricts,
  getTalukas,
  getIndexedVillages, 
  getIndexedSurveys,
  getHierarchyStats,
  triggerHierarchyCrawl,
  getCrawlStatus
} from "@/lib/api";
import { GUJARAT_DISTRICTS, BAVLA_VILLAGES, HASANNAGAR_SURVEYS } from "@/lib/gujaratData";

export default function AdvocateDashboard() {
  const router = useRouter();
  const [district, setDistrict] = useState("07"); // Default Ahmedabad
  const [taluka, setTaluka] = useState("08");     // Default Bavla
  const [village, setVillage] = useState("001");   // Default Hasannagar
  const [survey, setSurvey] = useState("2");      // Default Survey 2
  
  const [districtList, setDistrictList] = useState<Array<{ code: string; name: string }>>(
    GUJARAT_DISTRICTS.map(d => ({ code: d.code, name: d.name }))
  );
  const [talukaList, setTalukaList] = useState<Array<{ code: string; name: string }>>([]);
  const [villages, setVillages] = useState<Array<{ code: string; name: string; total_surveys?: number }>>(BAVLA_VILLAGES);
  const [surveys, setSurveys] = useState<string[]>(HASANNAGAR_SURVEYS);
  
  const [isManualSurvey, setIsManualSurvey] = useState(false);
  const [isLoadingVillages, setIsLoadingVillages] = useState(false);
  const [isLoadingSurveys, setIsLoadingSurveys] = useState(false);
  const [isLoadingTalukas, setIsLoadingTalukas] = useState(false);
  
  // Hierarchy stats & live sync state
  const [hierarchyStats, setHierarchyStats] = useState<any>(null);
  const [isSyncingLive, setIsSyncingLive] = useState(false);
  const [syncProgress, setSyncProgress] = useState<any>(null);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  
  const [stats, setStats] = useState<any>({
    total_verified_nodes: 0,
    active_cases: [],
    closed_cases: []
  });
  const [activeTab, setActiveTab] = useState<"active" | "closed">("active");
  const [filterBySurvey, setFilterBySurvey] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Establishing secure connection to Revenue Portal...");

  const handleDistrictChange = (dCode: string) => {
    setDistrict(dCode);
  };

  const selectedSurveyClean = survey && survey !== "-1" ? survey.trim() : "";

  const displayedActiveCases = (filterBySurvey && selectedSurveyClean)
    ? stats.active_cases.filter((c: any) => c.survey_no === selectedSurveyClean)
    : stats.active_cases;

  const displayedClosedCases = (filterBySurvey && selectedSurveyClean)
    ? stats.closed_cases.filter((c: any) => c.survey_no === selectedSurveyClean)
    : stats.closed_cases;

  // Load real stats and hierarchy data from PostgreSQL on mount
  useEffect(() => {
    getDashboardStats()
      .then((data) => {
        if (data) setStats(data);
      })
      .catch((err) => {
        console.error("Failed to load dashboard stats:", err);
      });

    // Load indexed districts from PostgreSQL
    getDistricts()
      .then((data) => {
        if (data && data.length > 0) {
          setDistrictList(data);
        }
      })
      .catch((err) => {
        console.warn("Using fallback districts:", err);
      });

    // Load hierarchy stats
    getHierarchyStats()
      .then((data) => {
        if (data) setHierarchyStats(data);
      })
      .catch((err) => {
        console.warn("Failed to load hierarchy stats:", err);
      });
  }, []);

  // Dynamically load talukas when District changes
  useEffect(() => {
    let isMounted = true;
    if (!district) {
      setTalukaList([]);
      return;
    }
    setIsLoadingTalukas(true);
    getTalukas(district)
      .then((data) => {
        if (!isMounted) return;
        if (data && data.length > 0) {
          setTalukaList(data);
          if (!data.some((t) => t.code === taluka)) {
            setTaluka(data[0].code);
          }
        } else {
          // Fallback to static data
          const fallbackDist = GUJARAT_DISTRICTS.find((d) => d.code === district);
          const fallbackTalukas = fallbackDist?.talukas || [];
          setTalukaList(fallbackTalukas);
          if (fallbackTalukas.length > 0 && !fallbackTalukas.some((t) => t.code === taluka)) {
            setTaluka(fallbackTalukas[0].code);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load talukas:", err);
        const fallbackDist = GUJARAT_DISTRICTS.find((d) => d.code === district);
        const fallbackTalukas = fallbackDist?.talukas || [];
        setTalukaList(fallbackTalukas);
      })
      .finally(() => {
        if (isMounted) setIsLoadingTalukas(false);
      });

    return () => {
      isMounted = false;
    };
  }, [district]);

  // Dynamically load villages when District or Taluka changes
  useEffect(() => {
    let isMounted = true;
    if (!district || !taluka) {
      setVillages([]);
      return;
    }
    setIsLoadingVillages(true);
    getIndexedVillages(district, taluka)
      .then((data) => {
        if (!isMounted) return;
        if (data && data.length > 0) {
          setVillages(data);
          if (!data.some((v) => v.code === village)) {
            setVillage(data[0].code);
          }
        } else if (district === "07" && taluka === "08") {
          setVillages(BAVLA_VILLAGES);
        } else {
          setVillages([]);
        }
      })
      .catch((err) => {
        console.error("Failed to load indexed villages:", err);
        if (district === "07" && taluka === "08") setVillages(BAVLA_VILLAGES);
      })
      .finally(() => {
        if (isMounted) setIsLoadingVillages(false);
      });

    return () => {
      isMounted = false;
    };
  }, [district, taluka]);

  // Dynamically load survey numbers when Village changes
  useEffect(() => {
    let isMounted = true;
    if (!district || !taluka || !village) {
      setSurveys([]);
      return;
    }
    setIsLoadingSurveys(true);
    getIndexedSurveys(district, taluka, village)
      .then((res) => {
        if (!isMounted) return;
        if (res && res.data && res.data.length > 0) {
          setSurveys(res.data);
          setIsManualSurvey(false);
          if (!res.data.includes(survey)) {
            setSurvey(res.data[0]);
          }
        } else if (village === "001" && district === "07" && taluka === "08") {
          setSurveys(HASANNAGAR_SURVEYS);
          setIsManualSurvey(false);
        } else {
          setSurveys([]);
          setIsManualSurvey(true);
        }
      })
      .catch((err) => {
        console.error("Failed to load indexed surveys:", err);
        if (village === "001" && district === "07" && taluka === "08") {
          setSurveys(HASANNAGAR_SURVEYS);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingSurveys(false);
      });

    return () => {
      isMounted = false;
    };
  }, [district, taluka, village]);

  // Handle Live Background Crawl Sync
  const handleTriggerLiveSync = async (includeSurveys: boolean = false) => {
    setIsSyncingLive(true);
    try {
      const res = await triggerHierarchyCrawl({
        district_code: district,
        taluka_code: taluka,
        include_surveys: includeSurveys,
        max_villages: 50
      });
      setSyncProgress(res.progress);

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await getCrawlStatus();
          if (statusRes?.progress) {
            setSyncProgress(statusRes.progress);
            if (!statusRes.progress.is_running) {
              clearInterval(pollInterval);
              setIsSyncingLive(false);
              // Refresh dropdowns and stats
              const freshVillages = await getIndexedVillages(district, taluka);
              if (freshVillages.length > 0) setVillages(freshVillages);
              const freshStats = await getHierarchyStats();
              if (freshStats) setHierarchyStats(freshStats);
            }
          }
        } catch (e) {
          console.warn("Polling error:", e);
        }
      }, 2500);
    } catch (err: any) {
      console.error("Failed to start live sync:", err);
      setIsSyncingLive(false);
    }
  };

  useEffect(() => {
    if (!isScraping) return;
    const messages = [
      "Establishing secure connection to AnyRoR Revenue Portal...",
      "Resolving ASP.NET Session Tokens & Dropdown Hierarchy...",
      "Solving 6-digit dynamic CAPTCHA via PyTorch CNN...",
      "Extracting modern digital HTML table entries...",
      "Hunting & downloading historical VF-6 handwritten scans...",
      "Parsing mutation lineage into PostgreSQL review queue..."
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setLoadingText(messages[i]);
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isScraping]);

  const handleStartReview = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSurvey = survey.trim();
    if (!cleanSurvey || cleanSurvey === "-1") return;

    setIsScraping(true);
    setScrapeError(null);
    try {
      const res = await scrapeLandRecord(district, taluka, village, cleanSurvey);
      if (res?.status === "offline" || !res?.data || Object.keys(res.data).length === 0) {
        throw new Error(res?.message || "Could not retrieve land record from AnyRoR portal.");
      }
      router.push(`/advocate/review/${cleanSurvey}?village=${village}`);
    } catch (err: any) {
      console.warn("Live scrape notice:", err);
      const errMsg = err?.response?.data?.detail || err?.message || "AnyRoR portal timed out or session expired";
      setScrapeError(`Portal Notification: ${errMsg}`);
    } finally {
      setIsScraping(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F0E5] font-sans p-8">
      {/* HEADER */}
      <div className="max-w-7xl mx-auto flex justify-between items-center mb-8 border-b border-[#0F2C59]/10 pb-6">
        <TitleNodeLogo mode="light" variant="horizontal" size="md" badge="Advocate OS" />
        <div className="flex items-center gap-4">
          {/* Geographic Index Status Pill */}
          {hierarchyStats && (
            <button
              onClick={() => setShowSyncPanel(!showSyncPanel)}
              className="hidden md:flex items-center gap-2 text-xs font-semibold text-[#0F2C59] bg-white px-3 py-1.5 border border-[#0F2C59]/15 shadow-sm rounded-sm hover:border-[#0F2C59]/40 transition-all cursor-pointer"
              title="Click to manage live AnyRoR geographic database sync"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{hierarchyStats.districts_indexed || 34} Districts</span>
              <span className="text-slate-300">|</span>
              <span>{hierarchyStats.talukas_indexed || 258} Talukas</span>
              <span className="text-slate-300">|</span>
              <span>{hierarchyStats.villages_indexed || 48} Villages</span>
            </button>
          )}

          <button
            onClick={() => setShowSyncPanel(!showSyncPanel)}
            className="text-xs font-bold text-[#0F2C59] uppercase tracking-wider bg-[#DAC0A3]/30 hover:bg-[#DAC0A3]/50 px-3 py-1.5 border border-[#DAC0A3] shadow-sm rounded-sm transition-colors cursor-pointer"
          >
            {showSyncPanel ? "Close Sync" : "Sync AnyRoR"}
          </button>

          <Link href="/" className="text-[#7A5C2E] hover:text-[#0F2C59] text-sm font-bold transition-colors">Sign Out</Link>
        </div>
      </div>

      {/* LIVE ANYROR SYNC ACCORDION PANEL */}
      {showSyncPanel && (
        <div className="max-w-7xl mx-auto mb-8 bg-white border border-[#0F2C59]/15 rounded-sm p-6 shadow-md transition-all">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-[#0F2C59] flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                Live AnyRoR Dropdown Hierarchy Crawler
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Scrapes live administrative dropdowns (Districts, Talukas, Villages & Survey Numbers) directly from <code className="bg-slate-100 px-1 py-0.5 rounded text-[#0F2C59]">anyror.gujarat.gov.in</code> with stealth anti-detection and stores in PostgreSQL.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={isSyncingLive}
                onClick={() => handleTriggerLiveSync(false)}
                className={`px-4 py-2 text-xs font-bold rounded-sm uppercase tracking-wider text-white transition-all ${isSyncingLive ? "bg-slate-400 cursor-not-allowed" : "bg-[#0F2C59] hover:bg-[#1a407e]"}`}
              >
                {isSyncingLive ? "Syncing..." : "Sync Selected Taluka"}
              </button>
              <button
                disabled={isSyncingLive}
                onClick={() => handleTriggerLiveSync(true)}
                className={`px-4 py-2 text-xs font-bold rounded-sm uppercase tracking-wider text-[#0F2C59] border border-[#0F2C59]/30 hover:bg-slate-50 transition-all ${isSyncingLive ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                Sync with Surveys
              </button>
            </div>
          </div>

          {/* Sync Progress Indicator */}
          {syncProgress && (
            <div className="bg-slate-50 border border-slate-200 rounded p-4 text-xs font-mono">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-[#0F2C59]">
                  {syncProgress.is_running ? "🔄 Status: Running" : "✓ Status: Finished"}
                </span>
                <span className="text-slate-500">
                  Villages: {syncProgress.villages_count || 0} | Surveys: {syncProgress.surveys_count || 0}
                </span>
              </div>
              <p className="text-amber-800 font-medium">&gt; {syncProgress.current_action || "Ready"}</p>
              {syncProgress.error && (
                <p className="text-red-600 mt-1">&gt; Error: {syncProgress.error}</p>
              )}
            </div>
          )}

          {/* Coverage Summary Stats */}
          {hierarchyStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100 text-center">
              <div className="bg-slate-50 p-3 rounded">
                <span className="block text-2xl font-bold text-[#0F2C59]">{hierarchyStats.districts_indexed || 34}</span>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Districts Stored</span>
              </div>
              <div className="bg-slate-50 p-3 rounded">
                <span className="block text-2xl font-bold text-[#0F2C59]">{hierarchyStats.talukas_indexed || 258}</span>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Talukas Stored</span>
              </div>
              <div className="bg-slate-50 p-3 rounded">
                <span className="block text-2xl font-bold text-[#0F2C59]">{hierarchyStats.villages_indexed || 48}</span>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Villages Stored</span>
              </div>
              <div className="bg-slate-50 p-3 rounded">
                <span className="block text-2xl font-bold text-[#0F2C59]">{hierarchyStats.surveys_indexed || 212}</span>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Surveys Indexed</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* MAIN WORKSPACE */}
        <div className="lg:col-span-2 space-y-8">
          
          <div className="bg-white border border-[#0F2C59]/10 shadow-sm p-8 rounded-sm min-h-[220px]">
            {scrapeError && (
              <div className="mb-6 p-4 bg-amber-50 border-l-4 border-amber-600 rounded-sm text-sm text-amber-900 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div>
                  <p className="font-bold text-xs uppercase tracking-wider text-amber-900">Portal Notice</p>
                  <p className="text-xs mt-0.5 text-amber-800">{scrapeError}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/advocate/review/${survey.trim()}?village=${village}`)}
                    className="px-3 py-1.5 bg-[#0F2C59] text-white text-xs font-bold rounded-sm uppercase tracking-wider hover:bg-[#1a407e] transition-colors"
                  >
                    Open Review
                  </button>
                  <button
                    type="button"
                    onClick={() => setScrapeError(null)}
                    className="px-2 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-bold"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {!isScraping ? (
              <>
                <h2 className="text-2xl font-bold text-[#0F2C59] mb-6">Initiate Verification Pipeline</h2>
                <form onSubmit={handleStartReview} className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs font-bold text-[#0F2C59] uppercase mb-2">District</label>
                    <select 
                      value={district} 
                      onChange={(e) => handleDistrictChange(e.target.value)} 
                      className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] cursor-pointer"
                    >
                      {districtList.map((d) => (
                        <option key={d.code} value={d.code}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[130px]">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-bold text-[#0F2C59] uppercase">Taluka</label>
                      {isLoadingTalukas && <span className="text-[10px] text-amber-700 font-medium animate-pulse">Loading...</span>}
                    </div>
                    <select 
                      value={taluka} 
                      onChange={(e) => setTaluka(e.target.value)} 
                      className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] cursor-pointer"
                    >
                      {talukaList.map((t) => (
                        <option key={t.code} value={t.code}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-bold text-[#0F2C59] uppercase">Village</label>
                      {isLoadingVillages && <span className="text-[10px] text-amber-700 font-medium animate-pulse">Loading...</span>}
                    </div>
                    {villages.length > 0 ? (
                      <select 
                        value={village} 
                        onChange={(e) => setVillage(e.target.value)} 
                        className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] cursor-pointer"
                      >
                        {villages.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                      </select>
                    ) : (
                      <input 
                        type="text" 
                        value={village} 
                        onChange={(e) => setVillage(e.target.value)} 
                        placeholder="Village Code (e.g. 001)"
                        className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59]" 
                        required 
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-bold text-[#0F2C59] uppercase">
                        Survey No. {surveys.length > 0 && !isManualSurvey ? `(${surveys.length})` : ""}
                      </label>
                      {surveys.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setIsManualSurvey(!isManualSurvey)}
                          className="text-[10px] font-bold text-[#7A5C2E] hover:text-[#0F2C59] underline cursor-pointer"
                        >
                          {isManualSurvey ? "Dropdown" : "Manual"}
                        </button>
                      )}
                    </div>
                    {surveys.length > 0 && !isManualSurvey ? (
                      <select
                        value={survey}
                        onChange={(e) => setSurvey(e.target.value)}
                        className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] font-medium cursor-pointer"
                      >
                        {surveys.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <input 
                        type="text" 
                        value={survey} 
                        onChange={(e) => setSurvey(e.target.value)} 
                        placeholder="e.g. 2, 3, 14, 101" 
                        className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] font-medium" 
                        required 
                      />
                    )}
                  </div>
                  {stats.active_cases.some((c: any) => c.survey_no === selectedSurveyClean) ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/advocate/review/${selectedSurveyClean}?village=${village}`)}
                        className="bg-[#DAC0A3] hover:bg-[#c9af92] text-[#0F2C59] font-bold py-2 px-4 uppercase text-xs rounded-sm h-[40px] transition-colors"
                      >
                        Open Review ({stats.active_cases.find((c: any) => c.survey_no === selectedSurveyClean)?.pending_nodes} Pending)
                      </button>
                      <button
                        type="submit"
                        className="bg-[#0F2C59] text-[#F8F0E5] font-bold py-2 px-4 uppercase text-xs rounded-sm h-[40px] hover:bg-[#1a407e] transition-colors"
                        title="Query AnyRoR live portal for latest updates"
                      >
                        Sync AnyRoR
                      </button>
                    </div>
                  ) : (
                    <button type="submit" className="bg-[#0F2C59] text-[#F8F0E5] font-bold py-2 px-8 uppercase text-sm rounded-sm h-[40px] hover:bg-[#1a407e] transition-colors">
                      Fetch AnyRoR
                    </button>
                  )}
                </form>
              </>
            ) : (
              <div className="w-full h-full flex flex-col justify-center animate-pulse">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-[#0F2C59]">System Processing: Survey {survey}</h2>
                  <span className="text-xs font-bold text-[#DAC0A3] uppercase tracking-widest flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-[#0F2C59]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Live
                  </span>
                </div>
                <p className="text-[#7A5C2E] font-mono text-sm mb-6 h-5 transition-all duration-300">&gt;&amp;_ {loadingText}</p>
                <div className="flex gap-4">
                  <div className="h-10 bg-slate-100 rounded-sm flex-1 border border-slate-200"></div>
                  <div className="h-10 bg-slate-100 rounded-sm flex-1 border border-slate-200"></div>
                  <div className="h-10 bg-slate-100 rounded-sm flex-1 border border-slate-200"></div>
                  <div className="h-10 bg-slate-100 rounded-sm w-32 border border-slate-200"></div>
                </div>
              </div>
            )}
          </div>

          {/* TICKETS */}
          <div className={`bg-white border border-[#0F2C59]/10 shadow-sm rounded-sm overflow-hidden transition-opacity duration-300 ${isScraping ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            <div className="flex border-b border-[#0F2C59]/10">
              <button onClick={() => setActiveTab("active")} className={`flex-1 py-4 font-bold transition-colors ${activeTab === "active" ? "text-[#0F2C59] border-b-4 border-[#DAC0A3] bg-slate-50" : "text-[#7A5C2E] hover:bg-slate-50"}`}>
                Active Cases ({displayedActiveCases.length})
              </button>
              <button onClick={() => setActiveTab("closed")} className={`flex-1 py-4 font-bold transition-colors ${activeTab === "closed" ? "text-[#0F2C59] border-b-4 border-[#DAC0A3] bg-slate-50" : "text-[#7A5C2E] hover:bg-slate-50"}`}>
                Closed & Compiled ({displayedClosedCases.length})
              </button>
            </div>

            {selectedSurveyClean && (
              <div className="bg-amber-50/70 border-b border-amber-200/60 px-6 py-2.5 flex justify-between items-center text-xs">
                <span className="text-[#0F2C59]">
                  {filterBySurvey ? (
                    <>Filtering strictly for <strong>Survey {selectedSurveyClean}</strong></>
                  ) : (
                    <>Showing all surveys</>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setFilterBySurvey(!filterBySurvey)}
                  className="text-[#7A5C2E] hover:text-[#0F2C59] font-bold underline cursor-pointer"
                >
                  {filterBySurvey ? "Show All Surveys" : `Show Only Survey ${selectedSurveyClean}`}
                </button>
              </div>
            )}
            
            <div className="max-h-96 overflow-y-auto">
              {activeTab === "active" && (
                displayedActiveCases.length > 0 ? (
                  displayedActiveCases.map((c: any) => (
                    <div key={c.survey_no} onClick={() => router.push(`/advocate/review/${c.survey_no}?village=${village}`)} className="flex justify-between items-center p-6 border-b border-[#0F2C59]/5 hover:bg-slate-50 cursor-pointer transition-colors group">
                      <div>
                        <h4 className="text-[#0F2C59] font-bold text-lg group-hover:underline">Survey No: {c.survey_no}</h4>
                        <p className="text-xs text-[#7A5C2E] mt-1">Pending verification</p>
                      </div>
                      <span className="bg-amber-100 text-amber-900 px-3 py-1 text-xs font-bold uppercase rounded-sm border border-amber-200">{c.pending_nodes} Nodes Pending</span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    {filterBySurvey && selectedSurveyClean 
                      ? `No pending nodes found for Survey ${selectedSurveyClean}. Click Launch above to query AnyRoR or click "Show All Surveys".`
                      : "No active cases pending verification."}
                  </div>
                )
              )}

              {activeTab === "closed" && (
                displayedClosedCases.length > 0 ? (
                  displayedClosedCases.map((c: any) => (
                    <div key={c.survey_no} onClick={() => router.push(`/advocate/tree/${c.survey_no}?village=${village}`)} className="flex justify-between items-center p-6 border-b border-[#0F2C59]/5 hover:bg-slate-50 cursor-pointer transition-colors group">
                      <div>
                        <h4 className="text-[#0F2C59] font-bold text-lg group-hover:underline">Survey No: {c.survey_no}</h4>
                        <p className="text-xs text-[#7A5C2E] mt-1">Ready for export</p>
                      </div>
                      <span className="bg-emerald-100 text-emerald-900 px-3 py-1 text-xs font-bold uppercase rounded-sm border border-emerald-200">100% Verified ({c.verified_nodes})</span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    {filterBySurvey && selectedSurveyClean
                      ? `No closed cases for Survey ${selectedSurveyClean} yet.`
                      : "No closed cases found."}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className={`bg-[#0F2C59] text-[#F8F0E5] p-8 rounded-sm shadow-xl flex flex-col h-full transition-opacity duration-300 ${isScraping ? "opacity-90" : "opacity-100"}`}>
          <h3 className="text-[#DAC0A3] text-sm font-bold uppercase tracking-widest mb-6 border-b border-[#DAC0A3]/20 pb-3">Your Output Metrics</h3>
          <div className="space-y-8 flex-1">
            <div>
              <span className="block text-5xl font-bold mb-2">{stats.total_verified_nodes}</span>
              <span className="block text-sm opacity-70 uppercase tracking-widest">Total Nodes Verified</span>
            </div>
            <div>
              <span className="block text-5xl font-bold mb-2">{stats.closed_cases.length}</span>
              <span className="block text-sm opacity-70 uppercase tracking-widest">Dossiers Compiled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}