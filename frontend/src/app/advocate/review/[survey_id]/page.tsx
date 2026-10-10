"use client";
import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import TitleNodeLogo from "@/components/TitleNodeLogo";

import { 
  getUnverifiedMutation, 
  verifyMutation, 
  getSurveyTimeline, 
  scrapeLandRecord, 
  aiAutofillMutation,
  getGeminiStatus,
  saveGeminiKey,
  BACKEND_HOST 
} from "@/lib/api";
import { fixMojibake } from "@/lib/encoding";

export default function ReviewPipeline() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const surveyId = params.survey_id as string;
  const villageCode = searchParams.get("village") || searchParams.get("village_code") || undefined;
  
  const [task, setTask] = useState<any>(null);
  const [formData, setFormData] = useState<any>({});
  const [prevOwnersInput, setPrevOwnersInput] = useState<string>("");
  const [newOwnersInput, setNewOwnersInput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Gemini AI Auto-Fill State
  const [isAiAutofilling, setIsAiAutofilling] = useState(false);
  const [aiAutofillMsg, setAiAutofillMsg] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<{ has_key: boolean; masked_key: string | null; model: string }>({
    has_key: false,
    masked_key: null,
    model: "gemini-3.8-flash"
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keySaveMsg, setKeySaveMsg] = useState<string | null>(null);

  // Multi-page switcher for authentic uncropped deed scans
  const [currentPageIdx, setCurrentPageIdx] = useState<number>(0);

  // Advanced empty state and in-review scraper
  const [emptyState, setEmptyState] = useState<"checking" | "not_scraped" | "all_verified">("checking");
  const [verifiedCount, setVerifiedCount] = useState<number>(0);
  const [isScrapingLive, setIsScrapingLive] = useState(false);
  const [scrapeLiveStatus, setScrapeLiveStatus] = useState("Establishing secure connection to AnyRoR...");
  const [scrapeLiveError, setScrapeLiveError] = useState<string | null>(null);

  // Layout Mode: 'split' or 'fullscreen_deed' (allows advocate to focus 100% on deed without side fields)
  const [layoutMode, setLayoutMode] = useState<"split" | "fullscreen_deed">("split");

  // Advanced Pan & Zoom Canvas State
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<"official" | "raw">("official");
  const containerRef = useRef<HTMLDivElement>(null);

  // Check Gemini Status on mount
  useEffect(() => {
    getGeminiStatus()
      .then(res => setGeminiStatus(res))
      .catch(e => console.warn("Gemini status check failed:", e));
  }, []);

  // Load real unverified task from PostgreSQL
  const loadNextTask = async () => {
    setLoading(true);
    try {
      const res = await getUnverifiedMutation(surveyId, villageCode);
      if (res && res.data) {
        const cleanTask = fixMojibake(res.data);
        setTask(cleanTask);
        const draft = fixMojibake(cleanTask.final_verified_data || cleanTask.ai_draft_data || {});
        const rawHtmlData = fixMojibake(cleanTask.scraped_html_text || {});
        
        const initialDetails = draft.remarks_summary || rawHtmlData.details || rawHtmlData.Details || "";
        const initialOfficerRemarks = draft.officer_remarks || rawHtmlData.officer_remarks || "";
        const initialDate = draft.entry_date || rawHtmlData.entry_date || cleanTask.entry_date || "";
        const initialType = draft.transaction_type || rawHtmlData.transaction_type || cleanTask.transaction_type || "";
        const initialStatus = draft.status || rawHtmlData.status || cleanTask.status || "પ્રમાણિત";

        // Explicitly lock survey number default to current searched survey
        const cleanSurveyNo = draft.survey_numbers ? String(draft.survey_numbers) : surveyId;
        const targetSurvey = cleanSurveyNo.includes(surveyId) ? surveyId : (cleanSurveyNo || surveyId);

        setFormData({
          ...draft,
          survey_numbers: targetSurvey,
          entry_date: initialDate,
          transaction_type: initialType,
          status: initialStatus,
          remarks_summary: initialDetails,
          officer_remarks: initialOfficerRemarks,
        });

        // Initialize local string inputs for owners
        const pOwners = draft.previous_owners;
        setPrevOwnersInput(Array.isArray(pOwners) ? pOwners.join(", ") : (pOwners || ""));
        const nOwners = draft.new_owners;
        setNewOwnersInput(Array.isArray(nOwners) ? nOwners.join(", ") : (nOwners || ""));

        setCurrentPageIdx(0);
        setZoomLevel(1);
        setPan({ x: 0, y: 0 });
      } else {
        setTask(null);
        try {
          const timelineRes = await getSurveyTimeline(surveyId, true, villageCode);
          const entries = timelineRes?.data || [];
          if (entries.length > 0) {
            setVerifiedCount(entries.length);
            setEmptyState("all_verified");
          } else {
            setEmptyState("not_scraped");
          }
        } catch {
          setEmptyState("not_scraped");
        }
      }
    } catch (err) {
      console.error("Error fetching unverified mutation:", err);
      setTask(null);
      setEmptyState("not_scraped");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNextTask();
  }, [surveyId, villageCode]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  // Run On-Demand AI Auto-Fill via Gemini
  const handleAiAutofill = async () => {
    if (!task) return;
    setIsAiAutofilling(true);
    setAiAutofillMsg("Analyzing with Gemini AI...");
    try {
      const res = await aiAutofillMutation(task.id);
      if (res && res.ai_draft_data) {
        const d = res.ai_draft_data;
        setFormData((prev: any) => ({
          ...prev,
          ...d,
          survey_numbers: prev.survey_numbers || surveyId,
        }));
        const pOwners = d.previous_owners;
        setPrevOwnersInput(Array.isArray(pOwners) ? pOwners.join(", ") : (pOwners || ""));
        const nOwners = d.new_owners;
        setNewOwnersInput(Array.isArray(nOwners) ? nOwners.join(", ") : (nOwners || ""));
        
        const sourceLabel = d.ai_source?.startsWith("gemini") ? "Gemini 3.8 Flash" : "Gujarati Revenue NLP";
        setAiAutofillMsg(`✓ Auto-filled by ${sourceLabel}`);
        setTimeout(() => setAiAutofillMsg(null), 4000);
      }
    } catch (err: any) {
      console.error("AI Auto-fill error:", err);
      setAiAutofillMsg("Auto-fill analysis failed");
      setTimeout(() => setAiAutofillMsg(null), 3000);
    } finally {
      setIsAiAutofilling(false);
    }
  };

  // Save Gemini Key
  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return;
    setSavingKey(true);
    setKeySaveMsg(null);
    try {
      await saveGeminiKey(apiKeyInput.trim());
      const updated = await getGeminiStatus();
      setGeminiStatus(updated);
      setKeySaveMsg("✓ Gemini API Key saved successfully!");
      setApiKeyInput("");
      setTimeout(() => {
        setKeySaveMsg(null);
        setShowKeyModal(false);
      }, 1500);
    } catch (err: any) {
      setKeySaveMsg("Error: " + (err.message || "Failed to save key"));
    } finally {
      setSavingKey(false);
    }
  };

  const handleApprove = async () => {
    if (!task) return;
    setSaving(true);
    try {
      const parsedPrevOwners = prevOwnersInput
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const parsedNewOwners = newOwnersInput
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      const payloadToSave = {
        ...formData,
        survey_numbers: formData.survey_numbers || surveyId,
        previous_owners: parsedPrevOwners,
        new_owners: parsedNewOwners
      };
      await verifyMutation(task.id, payloadToSave);
      await loadNextTask();
    } catch (err) {
      console.error("Error committing mutation verification:", err);
      alert("Failed to commit verification to database.");
    } finally {
      setSaving(false);
    }
  };

  // Zoom & Pan Handlers
  const zoomIn = () => setZoomLevel(prev => Math.min(Number((prev + 0.25).toFixed(2)), 5.0));
  const zoomOut = () => setZoomLevel(prev => Math.max(Number((prev - 0.25).toFixed(2)), 0.4));
  const setZoomPreset = (val: number) => {
    setZoomLevel(val);
    setPan({ x: 0, y: 0 });
  };
  const resetZoom = () => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };
  const fitWidth = () => {
    setZoomLevel(1.5);
    setPan({ x: 0, y: 0 });
  };

  // Double-click to toggle 1x / 2.4x zoom directly at mouse point
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    if (zoomLevel > 1.25) {
      resetZoom();
    } else {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const targetZoom = 2.4;
      const ratio = targetZoom / zoomLevel;
      setPan({
        x: Math.round(mouseX - (mouseX - pan.x) * ratio),
        y: Math.round(mouseY - (mouseY - pan.y) * ratio)
      });
      setZoomLevel(targetZoom);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // NATIVE NON-PASSIVE WHEEL LISTENER:
  // Strictly blocks browser-level page zoom/scroll and zooms ONLY the deed image centered on cursor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onNativeWheel = (e: WheelEvent) => {
      // 100% prevent browser window zoom and page scroll
      e.preventDefault();
      e.stopPropagation();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      // Smooth zoom factor (smooth on both mousewheel steps and trackpad pinch)
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;

      setZoomLevel(prevZoom => {
        const nextZoom = Math.min(Math.max(0.4, Number((prevZoom * zoomFactor).toFixed(2))), 5.0);
        const ratio = nextZoom / prevZoom;

        // Anchor zoom directly at mouse cursor position
        setPan(prevPan => ({
          x: Math.round(mouseX - (mouseX - prevPan.x) * ratio),
          y: Math.round(mouseY - (mouseY - prevPan.y) * ratio)
        }));

        return nextZoom;
      });
    };

    container.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onNativeWheel);
    };
  }, [task?.image_file_path, currentPageIdx]);

  // Window-level guard: Block Ctrl+Wheel / pinch page zoom across review screen
  useEffect(() => {
    const onGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", onGlobalWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onGlobalWheel);
    };
  }, []);

  // Keyboard Shortcuts: +, -, 0, f, Esc
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        fitWidth();
      } else if (e.key === "Escape" && layoutMode === "fullscreen_deed") {
        setLayoutMode("split");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [layoutMode]);

  const handleScrapeFromReview = async () => {
    setIsScrapingLive(true);
    setScrapeLiveError(null);
    setScrapeLiveStatus("Connecting to AnyRoR Revenue Portal...");
    
    const messages = [
      "Connecting to AnyRoR Revenue Portal...",
      "Resolving ASP.NET Session & Cascading Dropdowns...",
      "Solving 6-digit dynamic CAPTCHA via PyTorch CNN...",
      "Downloading VF-7, VF-8A & Historical Deed Scans...",
      "Ingesting mutation lineage into PostgreSQL..."
    ];
    let msgIdx = 0;
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setScrapeLiveStatus(messages[msgIdx]);
    }, 2500);

    try {
      await scrapeLandRecord("07", "08", villageCode || "001", surveyId);
      await loadNextTask();
    } catch (err: any) {
      console.error("Scrape from review failed:", err);
      setScrapeLiveError(err?.message || "Failed to extract land record from AnyRoR.");
    } finally {
      clearInterval(interval);
      setIsScrapingLive(false);
    }
  };

  if (loading) return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#F8F0E5]">
      <svg className="animate-spin h-8 w-8 text-[#0F2C59] mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      <div className="text-[#0F2C59] font-bold tracking-widest uppercase text-sm">Fetching Next Node...</div>
    </div>
  );
  
  if (!task) {
    if (isScrapingLive) {
      return (
        <div className="flex flex-col h-screen items-center justify-center gap-6 bg-[#F8F0E5] p-6 text-center">
          <div className="w-16 h-16 rounded-full border-4 border-[#0F2C59]/20 border-t-[#0F2C59] animate-spin mb-2"></div>
          <h2 className="text-2xl font-bold text-[#0F2C59]">Extracting Survey {surveyId} from AnyRoR</h2>
          <p className="text-[#7A5C2E] font-mono text-sm max-w-md bg-white px-4 py-2 border border-[#0F2C59]/10 rounded shadow-sm">
            &gt;&amp;_ {scrapeLiveStatus}
          </p>
          <span className="text-xs text-slate-500">Government portal query in progress. Please do not close this window.</span>
        </div>
      );
    }

    if (emptyState === "not_scraped") {
      return (
        <div className="flex flex-col h-screen items-center justify-center gap-6 bg-[#F8F0E5] p-6">
          <div className="w-20 h-20 bg-amber-100 rounded-sm flex items-center justify-center text-amber-800 shadow-md border border-amber-300">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <div className="text-center max-w-lg">
            <h2 className="text-2xl font-bold text-[#0F2C59] mb-2">Survey {surveyId} Not Yet Extracted</h2>
            <p className="text-[#7A5C2E] text-sm mb-6">
              No land records or mutation deeds currently exist in the database for <strong>Survey {surveyId}</strong> (Village {villageCode || "Hasannagar - 001"}).
            </p>

            {scrapeLiveError && (
              <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded text-left">
                <strong>Notice:</strong> {scrapeLiveError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleScrapeFromReview}
                className="w-full sm:w-auto bg-[#0F2C59] hover:bg-[#1a407e] text-[#F8F0E5] font-bold py-3 px-8 shadow-md transition-all uppercase tracking-widest text-xs rounded-sm"
              >
                🚀 Extract Live from AnyRoR Now
              </button>
              <Link 
                href="/advocate"
                className="w-full sm:w-auto bg-white hover:bg-slate-100 text-[#0F2C59] border border-[#0F2C59]/30 font-bold py-3 px-6 shadow-sm transition-all uppercase tracking-widest text-xs rounded-sm text-center"
              >
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-screen items-center justify-center gap-6 bg-[#F8F0E5]">
        <div className="w-20 h-20 bg-emerald-600 rounded-sm flex items-center justify-center text-white shadow-lg">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <div className="text-center max-w-lg">
          <h2 className="text-3xl font-bold text-[#0F2C59] mb-2">All Records Verified</h2>
          <p className="text-[#7A5C2E] font-medium mb-6">
            All {verifiedCount > 0 ? verifiedCount : ""} mutation deeds and portal entries for <strong className="text-[#0F2C59]">Survey {surveyId}</strong> have been reviewed and committed to the title ledger.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href={`/advocate/tree/${surveyId}${villageCode ? `?village=${villageCode}` : ""}`}
              className="bg-[#0F2C59] hover:bg-[#1a407e] text-[#F8F0E5] font-bold py-3.5 px-8 shadow-xl transition-all uppercase tracking-widest text-xs rounded-sm inline-block"
            >
              Compile Final Report & Tree →
            </Link>
            <Link 
              href="/advocate"
              className="bg-white hover:bg-slate-50 text-[#0F2C59] border border-[#0F2C59]/20 font-bold py-3.5 px-6 shadow-sm transition-all uppercase tracking-widest text-xs rounded-sm inline-block"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Pages list for authentic uncropped deed scans
  const allPages: string[] = (
    task?.ai_draft_data?.all_page_urls && 
    Array.isArray(task.ai_draft_data.all_page_urls) && 
    task.ai_draft_data.all_page_urls.length > 0
  ) 
    ? task.ai_draft_data.all_page_urls 
    : (task?.image_file_path ? [task.image_file_path] : []);

  const currentImage = allPages[currentPageIdx] || task?.image_file_path || "";
  const activeImageUrl = currentImage.startsWith("http") ? currentImage : `${BACKEND_HOST}${currentImage}`;

  // Extract raw details from scraped HTML text
  const rawHtml = fixMojibake(task.scraped_html_text);
  const rawDetails = fixMojibake(
    rawHtml?.details || rawHtml?.Details || rawHtml?.["વિગત"] || rawHtml?.["નોંધની વિગત"] || 
    (typeof rawHtml === "string" ? rawHtml : "") || 
    task.ai_draft_data?.remarks_summary || 
    "વિગત ઉપલબ્ધ નથી"
  );

  const rawEntryNo = fixMojibake(rawHtml?.entry_number || rawHtml?.["Entry Number"] || rawHtml?.["નોંધ નંબર"] || task.entry_number);
  const rawDate = fixMojibake(rawHtml?.entry_date || rawHtml?.Date || rawHtml?.["તારીખ"] || rawHtml?.["નોંધની તારીખ"] || task.entry_date || formData.entry_date || "તારીખ ઉપલબ્ધ નથી");
  const rawType = fixMojibake(rawHtml?.transaction_type || rawHtml?.Type || rawHtml?.["ફેરફારનો પ્રકાર"] || task.transaction_type || formData.transaction_type || "ફેરફાર નોંધ");
  const rawStatus = fixMojibake(rawHtml?.status || rawHtml?.Status || rawHtml?.["નોંધની સ્થિતિ"] || task.status || formData.status || "પ્રમાણિત");
  const rawOfficerRemarks = fixMojibake(rawHtml?.officer_remarks || rawHtml?.["Officer Remarks"] || rawHtml?.["તપાસણી કરનાર અધિકારીનો શેરો"] || task.officer_remarks || formData.officer_remarks || "શેરો ઉપલબ્ધ નથી");
  const rawSurveyNumbers = fixMojibake(rawHtml?.survey_numbers || rawHtml?.["ફેરફારને સંબંધિત સરવે નંબર"] || task.ai_draft_data?.survey_numbers || surveyId);

  // Parse comma or space separated list of survey numbers in Col 3
  const surveyNumberList = String(rawSurveyNumbers)
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const aiSource = formData.ai_source || task.ai_draft_data?.ai_source || "nlp_fallback";

  return (
    <div className="flex h-screen bg-[#F8F0E5] overflow-hidden font-sans">
      
      {/* LEFT HALF / FULLSCREEN: The Smart Source Viewer */}
      <div className={`${layoutMode === "fullscreen_deed" ? "w-full" : "w-1/2 min-w-0"} p-4 flex flex-col border-r border-[#0F2C59]/10 bg-[#0a192f] relative shadow-2xl z-10 select-none transition-all duration-300 flex-shrink-0`}>
        
        {/* Header Bar */}
        <div className="flex justify-between items-center text-[#F8F0E5] mb-3 px-2">
          <Link href="/advocate" className="text-[#DAC0A3] hover:text-white transition-colors mr-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
            ← Exit
          </Link>
          <div className="flex items-center gap-3 flex-1">
            <TitleNodeLogo mode="reversed" variant="icon-only" size={24} />
            <h2 className="font-bold text-lg tracking-tight">
              Survey <span className="text-[#DAC0A3]">{surveyId}</span> <span className="opacity-50 mx-2">|</span> Entry {task.entry_number}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {task.image_file_path && (
              <button
                onClick={() => setLayoutMode(prev => prev === "split" ? "fullscreen_deed" : "split")}
                className="bg-[#0F2C59] border border-[#DAC0A3]/40 text-[#DAC0A3] hover:text-white px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors flex items-center gap-1.5 shadow-sm"
                title={layoutMode === "split" ? "Expand Deed to Fullscreen" : "Return to Split Screen (Esc)"}
              >
                {layoutMode === "split" ? "⛶ Maximize Deed" : "⇄ Split Screen"}
              </button>
            )}
            <span className="bg-[#DAC0A3] text-[#0F2C59] px-3 py-1 text-xs font-bold uppercase tracking-widest rounded-sm shadow-sm">
              {task.image_file_path ? "Historical Scan (VF-6)" : "Digital Portal Record"}
            </span>
          </div>
        </div>
        
        {task.image_file_path ? (
          <>
            {/* Multi-page Navigation Bar if deed has multiple scanned pages */}
            {allPages.length > 1 && (
              <div className="absolute top-16 left-6 z-20 flex items-center gap-2 bg-[#0F2C59]/95 px-3 py-1.5 rounded-sm backdrop-blur-md border border-[#DAC0A3]/30 shadow-2xl">
                <button
                  disabled={currentPageIdx === 0}
                  onClick={() => {
                    setCurrentPageIdx(prev => Math.max(0, prev - 1));
                    resetZoom();
                  }}
                  className="text-xs text-[#DAC0A3] hover:text-white px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors font-bold uppercase"
                >
                  ◀ Prev
                </button>
                <span className="text-[#F8F0E5] text-xs font-mono font-bold px-1">
                  Page {currentPageIdx + 1} of {allPages.length}
                </span>
                <button
                  disabled={currentPageIdx === allPages.length - 1}
                  onClick={() => {
                    setCurrentPageIdx(prev => Math.min(allPages.length - 1, prev + 1));
                    resetZoom();
                  }}
                  className="text-xs text-[#DAC0A3] hover:text-white px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors font-bold uppercase"
                >
                  Next ▶
                </button>
              </div>
            )}

            {/* Zoom & Pan Floating Controls Bar */}
            <div className="absolute top-16 right-8 z-20 flex items-center gap-1.5 bg-[#0F2C59]/95 px-3 py-1.5 rounded-sm backdrop-blur-md border border-[#DAC0A3]/30 shadow-2xl">
              <button 
                onClick={zoomOut} 
                title="Zoom Out (-)"
                className="text-[#DAC0A3] hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
              </button>
              
              <button 
                onClick={resetZoom} 
                title="Reset to 100% (0)"
                className="text-[#F8F0E5] text-xs font-mono font-bold px-2 py-1 rounded hover:bg-white/10 transition-colors"
              >
                {Math.round(zoomLevel * 100)}%
              </button>

              <button 
                onClick={zoomIn} 
                title="Zoom In (+)"
                className="text-[#DAC0A3] hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>

              <div className="h-4 w-px bg-white/20 mx-1"></div>

              <button 
                onClick={() => setZoomPreset(1.5)} 
                title="150% Zoom"
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded transition-colors ${Math.round(zoomLevel * 100) === 150 ? "bg-[#DAC0A3] text-[#0F2C59] font-bold" : "text-[#DAC0A3] hover:text-white"}`}
              >
                1.5x
              </button>

              <button 
                onClick={() => setZoomPreset(2.5)} 
                title="250% Zoom (Detailed Reading)"
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded transition-colors ${Math.round(zoomLevel * 100) === 250 ? "bg-[#DAC0A3] text-[#0F2C59] font-bold" : "text-[#DAC0A3] hover:text-white"}`}
              >
                2.5x
              </button>

              <button 
                onClick={fitWidth} 
                title="Fit to Viewport (F)"
                className="text-xs text-[#DAC0A3] hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors uppercase font-bold"
              >
                Fit
              </button>

              <div className="h-4 w-px bg-white/20 mx-1"></div>

              <button 
                onClick={() => setLayoutMode(prev => prev === "split" ? "fullscreen_deed" : "split")} 
                title={layoutMode === "split" ? "Expand Deed to Fullscreen" : "Return to Split Screen (Esc)"}
                className="text-xs text-amber-300 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors font-bold flex items-center gap-1"
              >
                {layoutMode === "split" ? "⛶ Maximize" : "⇄ Split"}
              </button>
            </div>

            {/* Hint Badge */}
            <div className="absolute bottom-6 left-8 z-20 bg-black/80 text-[#DAC0A3] px-3 py-1.5 rounded text-[11px] font-mono backdrop-blur-sm pointer-events-none border border-white/10 flex items-center gap-2">
              <span>✋ Drag to pan</span>
              <span>•</span>
              <span className="text-emerald-300 font-semibold">🔍 Scroll wheel zooms ONLY image</span>
              <span>•</span>
              <span>⚡ Double-click to toggle 2.4x</span>
              {allPages.length > 1 && (
                <>
                  <span>•</span>
                  <span>Page {currentPageIdx + 1}/{allPages.length}</span>
                </>
              )}
            </div>

            {/* Infinite Drag & Pan Viewport */}
            <div 
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              style={{
                isolation: "isolate",
                contain: "paint",
                touchAction: "none"
              }}
              className="flex-1 overflow-hidden bg-black/95 border border-[#0F2C59] rounded-sm relative flex items-center justify-center cursor-grab active:cursor-grabbing shadow-inner select-none"
            >
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
                  transformOrigin: "center center",
                  transition: isDragging ? "none" : "transform 0.08s ease-out",
                  willChange: "transform"
                }}
                className="relative inline-block pointer-events-none"
              >
                <img 
                  src={activeImageUrl} 
                  alt={`Mutation Entry ${task.entry_number} (Page ${currentPageIdx + 1})`} 
                  draggable={false}
                  className="max-w-none shadow-2xl rounded-sm pointer-events-none select-none"
                  style={{ maxHeight: layoutMode === "fullscreen_deed" ? "88vh" : "75vh" }}
                />
              </div>
            </div>
          </>
        ) : (
          /* DIGITAL RECORD: Official AnyRoR Government 4-Column Table View */
          <div className="flex-1 flex flex-col bg-[#112240] border border-[#233554] rounded-sm shadow-inner overflow-hidden">
            
            {/* Tab Selector */}
            <div className="bg-[#0a192f] border-b border-[#233554] px-4 py-2.5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#DAC0A3]">AnyRoR Verified Record</span>
              </div>
              <div className="flex gap-1 bg-[#1d2d50] p-1 rounded">
                <button
                  onClick={() => setViewMode("official")}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors ${viewMode === "official" ? "bg-[#0F2C59] text-white shadow" : "text-slate-300 hover:text-white"}`}
                >
                  🏛️ AnyRoR Government Table
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors ${viewMode === "raw" ? "bg-[#0F2C59] text-white shadow" : "text-slate-300 hover:text-white"}`}
                >
                  {"{ }"} Raw JSON
                </button>
              </div>
            </div>

            {viewMode === "official" ? (
              <div className="flex-1 p-6 overflow-auto bg-[#e8ecf3]">
                {/* Government Header Banner */}
                <div className="mb-3 flex items-center justify-between text-[#0F2C59] pb-2 border-b border-[#0F2C59]/20">
                  <div className="text-xs font-bold uppercase tracking-wide">
                    મહેસૂલ વિભાગ, ગુજરાત સરકાર • AnyRoR ગ્રામ્ય મહેસૂલી નોંધ પત્રક (VF-6)
                  </div>
                  <div className="text-xs font-mono font-bold bg-white px-2 py-0.5 border border-[#0F2C59]/20 rounded">
                    સરવે નંબર: {surveyId}
                  </div>
                </div>

                {/* THE AUTHENTIC 4-COLUMN GOVERNMENT TABLE (Replicating AnyRoR grdcmputerentry) */}
                <div className="border-2 border-[#5c8cd6] shadow-md rounded-sm overflow-hidden bg-white text-slate-900">
                  
                  {/* Table Header Row (AnyRoR Classic Blue Gradient) */}
                  <div className="grid grid-cols-12 bg-gradient-to-b from-[#b9d5fd] to-[#92bcf4] border-b-2 border-[#5c8cd6] text-center text-[13px] font-bold text-[#072d63] leading-snug">
                    <div className="col-span-2 p-3 border-r border-[#5c8cd6] flex flex-col justify-center">
                      <span>નોંધ નંબર</span>
                      <span>નોંધની તારીખ</span>
                      <span>ફેરફારનો પ્રકાર</span>
                      <span>નોંધની સ્થિતિ</span>
                    </div>
                    <div className="col-span-5 p-3 border-r border-[#5c8cd6] flex items-center justify-center">
                      <span>નોંધની વિગત</span>
                    </div>
                    <div className="col-span-2 p-3 border-r border-[#5c8cd6] flex items-center justify-center">
                      <span>ફેરફારને સંબંધિત સરવે નંબર</span>
                    </div>
                    <div className="col-span-3 p-3 flex items-center justify-center">
                      <span>તપાસણી કરનાર અધિકારીનો શેરો</span>
                    </div>
                  </div>

                  {/* Table Content Row */}
                  <div className="grid grid-cols-12 bg-[#fdfbf2] text-[13px] leading-relaxed border-b border-[#5c8cd6]">
                    
                    {/* Col 1: Entry No, Date, Type, Status */}
                    <div className="col-span-2 p-3.5 border-r border-[#5c8cd6] space-y-1.5 font-medium">
                      <div className="text-base font-extrabold text-[#072d63] tracking-tight">
                        {rawEntryNo}
                      </div>
                      <div className="text-slate-800 font-mono text-xs">
                        {rawDate}
                      </div>
                      <div className="text-slate-700 text-xs font-semibold">
                        {rawType}
                      </div>
                      <div className="inline-block bg-emerald-100 text-emerald-900 text-[11px] font-bold px-1.5 py-0.5 rounded border border-emerald-300">
                        {rawStatus}
                      </div>
                    </div>

                    {/* Col 2: Complete Transaction Narrative */}
                    <div className="col-span-5 p-4 border-r border-[#5c8cd6] text-slate-900 text-[13px] leading-relaxed font-normal whitespace-pre-wrap">
                      {rawDetails}
                    </div>

                    {/* Col 3: Related Survey Numbers */}
                    <div className="col-span-2 p-3 border-r border-[#5c8cd6] flex flex-wrap gap-1.5 justify-center items-start content-start">
                      {surveyNumberList.length > 0 ? (
                        surveyNumberList.map((sNum: string, idx: number) => {
                          const isCurrent = sNum.startsWith(surveyId + "(") || sNum === surveyId;
                          return (
                            <span
                              key={idx}
                              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                                isCurrent
                                  ? "bg-[#072d63] text-white border-[#072d63] shadow-sm ring-1 ring-amber-400"
                                  : "bg-blue-50 text-blue-900 border-blue-200"
                              }`}
                            >
                              {sNum}
                            </span>
                          );
                        })
                      ) : (
                        <span className="bg-blue-50 text-blue-900 border border-blue-200 px-2 py-0.5 rounded text-xs font-mono font-bold">
                          {surveyId}
                        </span>
                      )}
                    </div>

                    {/* Col 4: Officer Remarks */}
                    <div className="col-span-3 p-3.5 text-xs text-slate-800 leading-relaxed font-medium whitespace-pre-line bg-amber-50/40">
                      {rawOfficerRemarks}
                    </div>
                  </div>
                </div>

                {/* Government Watermark / Disclaimer Footer */}
                <div className="mt-3 text-center text-[11px] text-slate-500 font-serif italic">
                  * આ વિગતો માત્ર ઓનલાઇન ચકાસણી હેતુ માટે છે. કોઈપણ કોર્ટ અથવા કાનૂની વિવાદ માટે પ્રમાણિત નકલ મેળવવી આવશ્યક છે.
                </div>
              </div>
            ) : (
              <div className="flex-1 p-6 overflow-auto bg-[#0a192f] text-slate-200 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {rawHtml ? JSON.stringify(rawHtml, null, 2) : "No raw JSON payload available."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT HALF: Advocate Resolution Editor (isolated layout, hidden in fullscreen deed mode) */}
      {layoutMode === "split" && (
        <div className="w-1/2 min-w-0 flex-1 p-8 overflow-y-auto bg-[#F8F0E5] flex flex-col">
        
        {/* Title & Phase Bar */}
        <div className="mb-4 pb-4 border-b border-[#0F2C59]/10 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-[#0F2C59] tracking-tight">Node Resolution</h1>
            <p className="text-sm text-[#7A5C2E] mt-1 font-medium">
              Verify title integrity for <strong className="text-[#0F2C59]">Survey {surveyId}</strong> before committing to ledger.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`px-3 py-1 rounded-sm text-[11px] font-bold uppercase tracking-widest border shadow-sm ${task.image_file_path ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
              {task.image_file_path ? 'Phase 1: Historical OCR' : 'Phase 2: Digital Entry'}
            </span>
            <span className="text-[10px] font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-[#0F2C59]/10">
              {aiSource.startsWith("gemini") ? "🤖 Gemini 3.8 Flash Active" : "⚡ Gujarati NLP Active"}
            </span>
          </div>
        </div>

        {/* Gemini AI Auto-Fill Action Toolbar */}
        <div className="mb-5 p-3 bg-white rounded-sm border border-[#0F2C59]/15 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleAiAutofill}
              disabled={isAiAutofilling}
              className="bg-[#0F2C59] hover:bg-[#1a407e] text-white text-xs font-bold py-2 px-4 rounded-sm shadow-sm flex items-center gap-2 transition-all disabled:opacity-50 uppercase tracking-wider"
            >
              {isAiAutofilling ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                  Analyzing with Gemini...
                </>
              ) : (
                <>
                  ⚡ Auto-Fill with Gemini AI
                </>
              )}
            </button>

            {aiAutofillMsg && (
              <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 animate-fadeIn">
                {aiAutofillMsg}
              </span>
            )}
          </div>

          <button
            onClick={() => setShowKeyModal(true)}
            className="text-xs text-[#7A5C2E] hover:text-[#0F2C59] font-bold flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-slate-50 border border-slate-200 transition-colors"
          >
            <span>{geminiStatus.has_key ? "🟢 Gemini API Key" : "⚪ Set Gemini Key"}</span>
            <span className="text-[10px] text-slate-400">({geminiStatus.masked_key || "Not Set"})</span>
          </button>
        </div>

        <div className="space-y-5 flex-1">
          {/* Survey Number and Entry Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
                Survey Number (સરવે નંબર)
              </label>
              <input 
                type="text" 
                value={formData.survey_numbers || surveyId} 
                onChange={(e) => handleChange("survey_numbers", e.target.value)} 
                className="w-full border-b-2 border-[#0F2C59]/20 px-4 py-2.5 bg-white outline-none focus:border-[#0F2C59] text-[#0F2C59] font-bold shadow-sm transition-colors" 
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Targeted to active searched parcel</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
                Entry Date (નોંધ તારીખ)
              </label>
              <input 
                type="text" 
                value={formData.entry_date || ""} 
                onChange={(e) => handleChange("entry_date", e.target.value)} 
                placeholder="DD/MM/YYYY"
                className="w-full border-b-2 border-[#0F2C59]/20 px-4 py-2.5 bg-white outline-none focus:border-[#0F2C59] text-[#0F2C59] font-medium shadow-sm transition-colors" 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
                Transaction Type (ફેરફારનો પ્રકાર)
              </label>
              <input 
                type="text" 
                value={formData.transaction_type || ""} 
                onChange={(e) => handleChange("transaction_type", e.target.value)} 
                className="w-full border-b-2 border-[#0F2C59]/20 px-4 py-2.5 bg-white outline-none focus:border-[#0F2C59] text-[#0F2C59] font-medium shadow-sm transition-colors" 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
                Status (નોંધની સ્થિતિ)
              </label>
              <input 
                type="text" 
                value={formData.status || "પ્રમાણિત"} 
                onChange={(e) => handleChange("status", e.target.value)} 
                className="w-full border-b-2 border-[#0F2C59]/20 px-4 py-2.5 bg-white outline-none focus:border-[#0F2C59] text-[#0F2C59] font-medium shadow-sm transition-colors" 
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-xs font-bold text-[#7A5C2E] uppercase tracking-wider">
                Previous Owners / Relinquishing Parties (હક જતો કરનાર / ખાતેદાર)
              </label>
              {prevOwnersInput && (
                <span className="text-[10px] text-[#7A5C2E] bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {prevOwnersInput.split(",").filter(Boolean).length} party/parties extracted
                </span>
              )}
            </div>
            <textarea 
              rows={2} 
              value={prevOwnersInput} 
              onChange={(e) => setPrevOwnersInput(e.target.value)} 
              placeholder="Auto-filled by Gemini AI (e.g. રમેશભાઈ પટેલ, સુરેશભાઈ પટેલ)"
              className="w-full border-l-4 border-[#7A5C2E] px-4 py-2.5 bg-white outline-none focus:ring-1 focus:ring-[#7A5C2E] text-[#0F2C59] shadow-sm resize-none transition-shadow" 
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-xs font-bold text-green-700 uppercase tracking-wider">
                New Owners / Acquiring Parties / Bank (હક મેળવનાર / ધિરાણ આપનાર)
              </label>
              {newOwnersInput && (
                <span className="text-[10px] text-green-800 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                  {newOwnersInput.split(",").filter(Boolean).length} party/parties extracted
                </span>
              )}
            </div>
            <textarea 
              rows={2} 
              value={newOwnersInput} 
              onChange={(e) => setNewOwnersInput(e.target.value)} 
              placeholder="Auto-filled by Gemini AI (e.g. મહેશભાઈ પટેલ અથવા સહકારી બેંક)"
              className="w-full border-l-4 border-green-700 px-4 py-2.5 bg-white outline-none focus:ring-1 focus:ring-green-700 text-[#0F2C59] shadow-sm resize-none transition-shadow" 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
              Summary & Legal Remarks (અધિકૃત વિગત)
            </label>
            <textarea 
              rows={3} 
              value={formData.remarks_summary || ""} 
              onChange={(e) => handleChange("remarks_summary", e.target.value)} 
              className="w-full border-b-2 border-[#0F2C59]/20 px-4 py-2.5 bg-white outline-none focus:border-[#0F2C59] text-[#0F2C59] font-medium shadow-sm resize-none transition-colors leading-relaxed" 
            />
          </div>

          {formData.officer_remarks && (
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Officer Remarks (તપાસણી કરનાર અધિકારીનો શેરો)
              </label>
              <textarea 
                rows={2} 
                value={formData.officer_remarks || ""} 
                onChange={(e) => handleChange("officer_remarks", e.target.value)} 
                className="w-full border-b-2 border-slate-300 px-4 py-2 bg-slate-50 outline-none focus:border-[#0F2C59] text-slate-800 text-xs shadow-sm resize-none" 
              />
            </div>
          )}
        </div>

        {/* Commitment Bar */}
        <div className="mt-6 pt-4 border-t border-[#0F2C59]/10 flex justify-between items-center">
          <span className="text-xs font-semibold text-[#7A5C2E]">
            Node {task.entry_number} for Survey {surveyId}
          </span>
          <button 
            onClick={handleApprove} 
            disabled={saving} 
            className="bg-[#0F2C59] hover:bg-[#1a407e] text-[#F8F0E5] font-bold py-3.5 px-8 shadow-lg disabled:opacity-50 flex items-center gap-3 uppercase tracking-widest text-sm rounded-sm transition-all"
          >
            {saving ? "Committing..." : "Commit Resolution"}
            {!saving && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>}
          </button>
        </div>
      </div>
      )}

      {/* GEMINI API KEY MODAL */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-sm shadow-2xl max-w-md w-full p-6 border border-[#0F2C59]/20 animate-scaleUp">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-[#0F2C59]">Google Gemini AI API Key</h3>
              <button 
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Connect your Google Gemini API Key to enable automated AI OCR on historical deed scans and natural language extraction of parties and mortgagors from AnyRoR Gujarati text records.
            </p>

            <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">Active Model:</span>
                <span className="font-mono text-[#0F2C59] font-bold">{geminiStatus.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">Key Status:</span>
                <span className={`font-bold ${geminiStatus.has_key ? "text-emerald-700" : "text-amber-700"}`}>
                  {geminiStatus.has_key ? `Connected (${geminiStatus.masked_key})` : "Using Gujarati NLP Fallback"}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">
                Enter Gemini API Key
              </label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono focus:border-[#0F2C59] outline-none"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Get a free key at <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">aistudio.google.com</a>
              </span>
            </div>

            {keySaveMsg && (
              <div className={`p-2 mb-4 text-xs rounded ${keySaveMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                {keySaveMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded"
              >
                Close
              </button>
              <button
                onClick={handleSaveKey}
                disabled={savingKey || !apiKeyInput.trim()}
                className="px-5 py-2 text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#1a407e] rounded disabled:opacity-50 uppercase tracking-wider"
              >
                {savingKey ? "Saving..." : "Save Key"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}