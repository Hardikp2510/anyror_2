"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TitleNodeLogo from "@/components/TitleNodeLogo";
import { getRecordsByVillage, scrapeLandRecord, uploadPortfolioCsv, getIndexedVillages, getIndexedSurveys } from "@/lib/api";
import { GUJARAT_DISTRICTS, BAVLA_VILLAGES, HASANNAGAR_SURVEYS } from "@/lib/gujaratData";

export default function DeveloperPortal() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [selectedCsvFile, setSelectedCsvFile] = useState<File | null>(null);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  
  // Search State
  const [district, setDistrict] = useState("07");
  const [taluka, setTaluka] = useState("08");
  const [village, setVillage] = useState("001");
  const [survey, setSurvey] = useState("2");
  
  const [villages, setVillages] = useState<Array<{ code: string; name: string; total_surveys?: number }>>(BAVLA_VILLAGES);
  const [surveys, setSurveys] = useState<string[]>(HASANNAGAR_SURVEYS);
  const [isManualSurvey, setIsManualSurvey] = useState(false);
  const [isLoadingVillages, setIsLoadingVillages] = useState(false);
  const [isLoadingSurveys, setIsLoadingSurveys] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);

  const currentDistrictObj = GUJARAT_DISTRICTS.find(d => d.code === district) || GUJARAT_DISTRICTS[0];
  const talukaList = currentDistrictObj?.talukas || [];

  const handleDistrictChange = (dCode: string) => {
    setDistrict(dCode);
    const dObj = GUJARAT_DISTRICTS.find(d => d.code === dCode);
    if (dObj && dObj.talukas.length > 0) {
      setTaluka(dObj.talukas[0].code);
    } else {
      setTaluka("");
    }
  };

  // Rollup Grid State from Database
  const [parcels, setParcels] = useState<any[]>([]);
  const [isLoadingParcels, setIsLoadingParcels] = useState(true);
  const [filter, setFilter] = useState<"All" | "Clear" | "High Risk" | "Review Needed">("All");

  // Load real parcels for the selected village from PostgreSQL
  const loadVillageParcels = async (vCode: string) => {
    setIsLoadingParcels(true);
    try {
      const res = await getRecordsByVillage(vCode);
      setParcels(res?.data || []);
    } catch (err) {
      console.error("Failed to load village parcels:", err);
      setParcels([]);
    } finally {
      setIsLoadingParcels(false);
    }
  };

  useEffect(() => {
    if (village && village !== "0") {
      loadVillageParcels(village);
    }
  }, [village]);

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

  const filteredData = parcels.filter(parcel => filter === "All" || parcel.status === filter);
  const isCurrentlyProcessed = parcels.some(parcel => parcel.survey_no === survey);

  const handleSearchAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (survey === "-1" || village === "0") return;

    if (isCurrentlyProcessed) {
      router.push(`/advocate/dossier/${survey}?village=${village}`);
    } else {
      setIsSearching(true);
      setRequestStatus(`Querying AnyRoR for Survey ${survey}...`);
      try {
        await scrapeLandRecord(district, taluka, village, survey);
        setRequestStatus(`Survey ${survey} successfully extracted. Loading dossier...`);
        setTimeout(() => {
          router.push(`/advocate/dossier/${survey}?village=${village}`);
        }, 1200);
      } catch (err: any) {
        console.warn("Live search notice:", err);
        setRequestStatus(`Notice: ${err.message || "Scraping failed or portal unreachable. Please retry."}`);
      } finally {
        setIsSearching(false);
      }
    }
  };

  const handleBulkCsvSubmit = async () => {
    if (!selectedCsvFile) {
      alert("Please select a valid CSV file first.");
      return;
    }
    setIsUploadingCsv(true);
    try {
      const res = await uploadPortfolioCsv(selectedCsvFile);
      alert(`Success! ${res.message} (Estimated time: ${res.estimated_completion_time})`);
      setIsCsvModalOpen(false);
      setSelectedCsvFile(null);
    } catch (err: any) {
      alert(`Upload error: ${err.message || "Failed to process CSV"}`);
    } finally {
      setIsUploadingCsv(false);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === "Clear") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (status === "High Risk") return "bg-red-100 text-red-800 border-red-200";
    return "bg-amber-100 text-amber-800 border-amber-200";
  };

  const getLight = (color: string) => {
    if (color === "green") return <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm mx-auto"></div>;
    if (color === "yellow") return <div className="w-3 h-3 rounded-full bg-amber-500 shadow-sm mx-auto"></div>;
    return <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm mx-auto"></div>;
  };

  const selectedVillageName = BAVLA_VILLAGES.find(v => v.code === village)?.name.split(" - ")[0] || village;

  return (
    <div className="min-h-screen bg-[#F8F0E5] font-sans p-8 relative">
      {/* HEADER */}
      <div className="max-w-7xl mx-auto flex justify-between items-center mb-8 border-b border-[#0F2C59]/10 pb-6">
        <TitleNodeLogo mode="light" variant="horizontal" size="md" badge="Executive OS" />
        <div className="flex items-center gap-6">
          <Link href="/" className="text-[#7A5C2E] hover:text-[#0F2C59] text-sm font-bold transition-colors">Sign Out</Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* SINGLE PARCEL LOOKUP & REQUEST */}
        <div className="bg-white border border-[#0F2C59]/10 shadow-sm p-6 rounded-sm relative">
          <h2 className="text-xl font-bold text-[#0F2C59] uppercase tracking-widest mb-4">Target Parcel Lookup</h2>
          
          <form onSubmit={handleSearchAction} className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">District</label>
              <select value={district} onChange={(e) => handleDistrictChange(e.target.value)} className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59]">
                {GUJARAT_DISTRICTS.map((d) => (
                  <option key={d.code} value={d.code}>{d.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider mb-2">Taluka</label>
              <select value={taluka} onChange={(e) => setTaluka(e.target.value)} className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59]">
                {talukaList.map((t) => (
                  <option key={t.code} value={t.code}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[160px]">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider">Village</label>
                {isLoadingVillages && <span className="text-[10px] text-amber-700 font-medium animate-pulse">Loading...</span>}
              </div>
              {villages.length > 0 ? (
                <select value={village} onChange={(e) => setVillage(e.target.value)} className="w-full border-b-2 border-[#0F2C59]/20 px-3 py-2 bg-slate-50 focus:border-[#0F2C59] outline-none text-[#0F2C59] cursor-pointer">
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

            <div className="flex-1 min-w-[150px]">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-bold text-[#0F2C59] uppercase tracking-wider">
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

            <button 
              type="submit" 
              disabled={isSearching}
              className={`font-bold py-2 px-8 uppercase tracking-widest text-xs rounded-sm h-[42px] transition-all flex items-center justify-center min-w-[180px] disabled:opacity-50 ${
                isCurrentlyProcessed 
                  ? "bg-[#0F2C59] hover:bg-[#1a407e] text-[#F8F0E5] shadow-md" 
                  : "bg-white text-[#0F2C59] border-2 border-[#0F2C59] hover:bg-[#0F2C59] hover:text-white"
              }`}
            >
              {isSearching ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Processing...
                </span>
              ) : isCurrentlyProcessed ? "View Dossier →" : "Live Scrape / Verify"}
            </button>
          </form>

          {/* Status Toast */}
          {requestStatus && (
            <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-widest shadow-sm animate-fade-in flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {requestStatus}
            </div>
          )}
        </div>

        {/* VILLAGE ROLLUP CONTROLS */}
        <div className="bg-white border border-[#0F2C59]/10 shadow-sm p-6 rounded-sm flex justify-between items-center mt-6">
          <div>
            <h2 className="text-xl font-bold text-[#0F2C59] uppercase tracking-widest">Village Rollup: {selectedVillageName}</h2>
            <p className="text-sm text-[#7A5C2E] mt-1 font-medium">Ahmedabad District • {parcels.length} Parcels Processed in Database</p>
          </div>
          <div className="flex gap-2">
            {["All", "Clear", "Review Needed", "High Risk"].map((f) => (
              <button 
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm border transition-colors ${filter === f ? "bg-[#0F2C59] text-[#F8F0E5] border-[#0F2C59]" : "bg-white text-[#0F2C59] border-[#0F2C59]/20 hover:bg-slate-50"}`}
              >
                {f}
              </button>
            ))}
            <button 
              onClick={() => setIsCsvModalOpen(true)}
              className="ml-4 bg-[#DAC0A3] text-[#0F2C59] hover:bg-[#c9af92] px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm border border-[#DAC0A3] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Upload Batch CSV
            </button>
          </div>
        </div>

        {/* DYNAMIC DATA GRID */}
        <div className="bg-white border border-[#0F2C59]/10 shadow-sm rounded-sm overflow-hidden">
          {isLoadingParcels ? (
            <div className="p-12 text-center text-[#0F2C59] font-bold text-sm">
              Loading village parcel data from database...
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-[#0F2C59]/10 text-xs font-bold text-[#0F2C59] uppercase tracking-widest">
                  <th className="p-4">Survey No.</th>
                  <th className="p-4">Current Owner (Extracted)</th>
                  <th className="p-4">Parcel Size</th>
                  <th className="p-4 text-center">Ownership</th>
                  <th className="p-4 text-center">Tenure</th>
                  <th className="p-4 text-center">Encumbrance</th>
                  <th className="p-4 text-center">Litigation</th>
                  <th className="p-4 text-center">Master Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0F2C59]/5">
                {filteredData.map((parcel) => (
                  <tr key={parcel.survey_no} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4 font-bold text-[#0F2C59]">{parcel.survey_no}</td>
                    <td className="p-4 text-sm text-[#0F2C59]">{parcel.owner}</td>
                    <td className="p-4 text-sm text-[#7A5C2E] font-medium">{parcel.size}</td>
                    <td className="p-4">{getLight(parcel.flags.ownership)}</td>
                    <td className="p-4">{getLight(parcel.flags.tenure)}</td>
                    <td className="p-4">{getLight(parcel.flags.encumbrance)}</td>
                    <td className="p-4">{getLight(parcel.flags.litigation)}</td>
                    <td className="p-4 text-center">
                      <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-sm border ${getStatusColor(parcel.status)}`}>
                        {parcel.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Link href={`/advocate/dossier/${parcel.survey_no}?village=${parcel.village_code || village}`} className="text-xs font-bold text-[#0F2C59] border border-[#0F2C59]/20 hover:bg-[#0F2C59] hover:text-[#F8F0E5] px-4 py-2 rounded-sm transition-colors uppercase tracking-widest inline-block">
                        View Dossier
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                      </div>
                      <p className="text-[#0F2C59] font-bold text-lg mb-1">No Processed Parcels Found</p>
                      <p className="text-[#7A5C2E] font-medium text-sm">Either adjust your filters or run a live scrape above.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* BULK CSV UPLOAD MODAL */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 bg-[#0F2C59]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F8F0E5] w-full max-w-md rounded-sm shadow-2xl overflow-hidden border border-[#DAC0A3]/50">
            <div className="bg-[#0F2C59] p-4 flex justify-between items-center">
              <h3 className="text-[#F8F0E5] font-bold uppercase tracking-widest text-sm flex items-center gap-2">
                <svg className="w-4 h-4 text-[#DAC0A3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Portfolio Risk Tracker
              </h3>
              <button onClick={() => setIsCsvModalOpen(false)} className="text-[#DAC0A3] hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6">
              <p className="text-sm text-[#0F2C59] font-medium mb-6">
                Upload a CSV containing District, Taluka, Village, and Survey Numbers to automatically queue asynchronous scraping across up to 500 parcels.
              </p>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                accept=".csv" 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedCsvFile(e.target.files[0]);
                  }
                }}
              />

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#0F2C59]/20 bg-white rounded-sm p-8 text-center hover:border-[#0F2C59]/50 transition-colors cursor-pointer group mb-6"
              >
                <svg className="w-10 h-10 text-[#0F2C59]/40 mx-auto mb-3 group-hover:text-[#0F2C59] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <span className="block text-sm font-bold text-[#0F2C59] uppercase tracking-widest">
                  {selectedCsvFile ? selectedCsvFile.name : "Select CSV File"}
                </span>
                <span className="block text-xs text-[#7A5C2E] mt-1">
                  {selectedCsvFile ? `${(selectedCsvFile.size / 1024).toFixed(1)} KB` : "or drag and drop here"}
                </span>
              </div>

              <button 
                onClick={handleBulkCsvSubmit}
                disabled={isUploadingCsv || !selectedCsvFile}
                className="w-full bg-[#0F2C59] text-[#F8F0E5] font-bold py-3 uppercase tracking-widest text-xs rounded-sm hover:bg-[#1a407e] transition-colors shadow-md disabled:opacity-50"
              >
                {isUploadingCsv ? "Queueing Batch Pipeline..." : "Initialize Bulk Analysis"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}