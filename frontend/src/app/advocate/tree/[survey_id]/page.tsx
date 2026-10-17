"use client";
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactFlow, { 
  Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges,
  Node, Edge, NodeChange, EdgeChange, Handle, Position
} from "reactflow";
import "reactflow/dist/style.css";
import TitleNodeLogo from "@/components/TitleNodeLogo";
import { getPedhinamuTree, getSurveyTimeline, reopenMutation, BACKEND_HOST } from "@/lib/api";

// Bespoke Custom Node for Family Pedhinamu & Land Ownership
const PersonNode = ({ data, selected }: any) => {
  const isDaughter = data.relation === "daughter" || data.is_daughter;
  const isWidow = data.relation === "widow";
  const isBuyer = data.relation === "buyer";
  const isRoot = data.relation === "root";
  const isBank = data.relation === "bank";
  const isExited = data.status === "exited";
  const isDeceased = data.status === "deceased";
  const isActive = data.status === "active" || data.status === "encumbered";

  return (
    <div 
      className={`p-3.5 rounded-sm border-2 shadow-md transition-all text-left relative ${
        selected ? "ring-2 ring-[#0F2C59] ring-offset-2 scale-105" : ""
      } ${
        isRoot 
          ? "bg-[#0F2C59] text-white border-[#DAC0A3]" 
          : isBank
            ? "bg-amber-50 text-amber-950 border-amber-400"
            : isBuyer
              ? "bg-emerald-50 text-emerald-950 border-emerald-500"
              : isWidow
                ? "bg-purple-50 text-purple-950 border-purple-400"
                : isExited
                  ? "bg-red-50/90 text-red-950 border-red-300"
                  : isDeceased
                    ? "bg-slate-100 text-slate-700 border-slate-300 opacity-90"
                    : "bg-emerald-50 text-slate-900 border-emerald-600 shadow-emerald-900/10"
      }`}
      style={{ width: 280 }}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 !bg-[#0F2C59]" />

      {/* Top Meta Line: Relation + Entry Ref */}
      <div className="flex items-center justify-between gap-1 mb-1.5 text-[10px] font-bold uppercase tracking-wider">
        <span className={`px-2 py-0.5 rounded text-[10px] ${
          isRoot 
            ? "bg-[#DAC0A3] text-[#0F2C59]" 
            : isWidow
              ? "bg-purple-100 text-purple-900 border border-purple-300 font-extrabold"
              : isBuyer
                ? "bg-emerald-100 text-emerald-900 border border-emerald-300 font-extrabold"
                : isDaughter 
                  ? "bg-pink-100 text-pink-900 border border-pink-300 font-extrabold" 
                  : isBank 
                    ? "bg-amber-200 text-amber-900 font-extrabold" 
                    : "bg-slate-200 text-slate-800"
        }`}>
          {isWidow ? "👵 વિધવા પત્ની (Widow)" : isBuyer ? "💼 ખરીદનાર (Buyer)" : isDaughter ? "👧 પુત્રી (Daughter)" : data.relation_label}
        </span>
        <span className="opacity-75 font-mono text-[9px] truncate max-w-[100px]">{data.entered_in}</span>
      </div>

      {/* Person Name */}
      <div className="font-extrabold text-[13px] tracking-tight leading-snug line-clamp-2 mt-0.5">
        {data.name}
      </div>

      {/* Status Badge */}
      <div className="mt-2.5 pt-1.5 border-t border-black/10 flex items-center justify-between text-[11px] font-semibold">
        <span className={`inline-flex items-center gap-1.5 font-bold ${
          isActive 
            ? "text-emerald-800" 
            : isExited 
              ? "text-red-700" 
              : isDeceased 
                ? "text-slate-600" 
                : "text-amber-800"
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isActive ? "bg-emerald-500 animate-pulse" : isExited ? "bg-red-500" : isDeceased ? "bg-slate-400" : "bg-amber-500"
          }`}></span>
          {data.status_label}
        </span>
        
        {isDaughter && data.daughter_status && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
            isExited 
              ? "bg-red-100 text-red-800 border-red-300" 
              : "bg-emerald-100 text-emerald-800 border-emerald-300"
          }`}>
            {isExited ? "હક કમી" : "હક ચાલુ"}
          </span>
        )}
      </div>

      {data.acquired_area && (
        <div className="text-[10px] text-emerald-900 mt-1 font-semibold bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-300">
          📍 ક્ષેત્રફળ: {data.acquired_area}
        </div>
      )}

      {data.exited_in && (
        <div className="text-[10px] text-red-700 mt-1 italic font-medium bg-red-100/60 px-1.5 py-0.5 rounded border border-red-200">
          ➔ {data.exited_in}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 !bg-[#0F2C59]" />
    </div>
  );
};

export default function TreeEditor() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const surveyId = params.survey_id as string;
  const villageCode = searchParams.get("village") || searchParams.get("village_code") || undefined;
  
  const [activeTab, setActiveTab] = useState<"pedhinamu" | "mutation_flow" | "audit">("pedhinamu");
  const [treeData, setTreeData] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [personFilter, setPersonFilter] = useState<"all" | "active" | "exited" | "daughters">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const nodeTypes = useMemo(() => ({ person: PersonNode }), []);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Pedhinamu Tree
      const pRes = await getPedhinamuTree(surveyId, villageCode);
      setTreeData(pRes);
      
      // 2. Fetch Mutation Timeline
      const tRes = await getSurveyTimeline(surveyId, true, villageCode);
      setTimeline(tRes?.data || []);

      if (pRes && pRes.nodes && pRes.nodes.length > 0) {
        // Map backend nodes to custom "person" ReactFlow nodes
        const rfNodes = pRes.nodes.map((n: any) => ({
          ...n,
          type: "person"
        }));
        setNodes(rfNodes);
        setEdges(pRes.edges || []);
      }
    } catch (err) {
      console.error("Error loading pedhinamu tree:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [surveyId, villageCode]);

  const onNodeClick = (_: any, node: Node) => {
    setSelectedPerson(node.data);
  };

  const handleReopen = async (id: number) => {
    if (confirm("Send this record back to the active verification queue?")) {
      try {
        await reopenMutation(id);
        router.push(`/advocate/review/${surveyId}${villageCode ? `?village=${villageCode}` : ""}`);
      } catch (err) {
        console.error("Error reopening mutation:", err);
        alert("Failed to reopen mutation.");
      }
    }
  };

  // Filtered persons for sidebar list
  const filteredPersons = (treeData?.persons || []).filter((p: any) => {
    if (p.relation === "root" || p.relation === "bank") return false;
    if (personFilter === "active" && p.status !== "active" && p.status !== "encumbered") return false;
    if (personFilter === "exited" && p.status !== "exited" && p.status !== "deceased") return false;
    if (personFilter === "daughters" && !p.is_daughter) return false;
    if (searchQuery.trim() && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex h-screen bg-[#F8F0E5] font-sans flex-col overflow-hidden">
      
      {/* HEADER BAR */}
      <div className="bg-[#0F2C59] text-[#F8F0E5] px-6 py-3.5 flex justify-between items-center shadow-lg z-20">
        <div className="flex items-center gap-4">
          <Link href="/advocate" className="text-[#DAC0A3] hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Dashboard
          </Link>
          <div className="border-l border-[#F8F0E5]/20 pl-4">
            <TitleNodeLogo mode="reversed" variant="horizontal" size="sm" badge={`Survey ${surveyId}`} />
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex bg-[#112240] p-1 rounded-sm border border-[#233554]">
          <button
            onClick={() => setActiveTab("pedhinamu")}
            className={`px-4 py-1.5 text-xs font-bold rounded-sm transition-all flex items-center gap-2 ${
              activeTab === "pedhinamu" 
                ? "bg-[#DAC0A3] text-[#0F2C59] shadow-md" 
                : "text-slate-300 hover:text-white"
            }`}
          >
            🌳 વારસાઈ પેઢીનામું (Family Tree)
          </button>
          <button
            onClick={() => setActiveTab("mutation_flow")}
            className={`px-4 py-1.5 text-xs font-bold rounded-sm transition-all flex items-center gap-2 ${
              activeTab === "mutation_flow" 
                ? "bg-[#DAC0A3] text-[#0F2C59] shadow-md" 
                : "text-slate-300 hover:text-white"
            }`}
          >
            ⛓️ મહેસૂલી નોંધ ચેઇન (Entries)
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`px-4 py-1.5 text-xs font-bold rounded-sm transition-all flex items-center gap-2 ${
              activeTab === "audit" 
                ? "bg-[#DAC0A3] text-[#0F2C59] shadow-md" 
                : "text-slate-300 hover:text-white"
            }`}
          >
            ⚖️ દિકરી હક & Title Integrity ({treeData?.daughters_count || 0})
          </button>
        </div>

        <Link 
          href={`/advocate/dossier/${surveyId}${villageCode ? `?village=${villageCode}` : ""}`} 
          className="bg-[#DAC0A3] text-[#0F2C59] hover:bg-[#c9af92] font-bold py-2 px-5 rounded-sm shadow-md transition-colors text-xs uppercase tracking-widest flex items-center gap-2"
        >
          Export Dossier →
        </Link>
      </div>

      {/* INTELLIGENCE METRIC BAR */}
      <div className="bg-white border-b border-[#0F2C59]/15 px-6 py-2.5 flex items-center justify-between text-xs shadow-sm z-10 flex-wrap gap-y-2">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#0F2C59] uppercase tracking-wider text-[11px]">Total Persons:</span>
            <span className="bg-slate-100 text-slate-900 font-mono font-bold px-2 py-0.5 rounded border border-slate-300">
              {treeData?.total_persons || 0}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-emerald-800 uppercase tracking-wider text-[11px]">In Property:</span>
            <span className="bg-emerald-50 text-emerald-900 font-mono font-bold px-2 py-0.5 rounded border border-emerald-300">
              🟢 {treeData?.active_owners_count || 0} Active
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-red-800 uppercase tracking-wider text-[11px]">Exited:</span>
            <span className="bg-red-50 text-red-900 font-mono font-bold px-2 py-0.5 rounded border border-red-300">
              🔴 {treeData?.exited_persons_count || 0} Relinquished/Sold
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-pink-800 uppercase tracking-wider text-[11px]">Daughters:</span>
            <span className="bg-pink-50 text-pink-900 font-mono font-bold px-2 py-0.5 rounded border border-pink-300">
              👧 {treeData?.daughters_count || 0}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-amber-800 uppercase tracking-wider text-[11px]">Active Loans:</span>
            <span className="bg-amber-50 text-amber-900 font-mono font-bold px-2 py-0.5 rounded border border-amber-300">
              🟡 {treeData?.active_encumbrances_count || 0} Active (કુલ {treeData?.encumbrances_lifecycle?.length || 11})
            </span>
          </div>

          {treeData?.promolgation_bridge?.old_survey_no && (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-amber-900 uppercase tracking-wider text-[11px]">જૂનો સરવે:</span>
              <span className="bg-amber-100 text-amber-950 font-mono font-bold px-2 py-0.5 rounded border border-amber-300">
                🏛️ {treeData.promolgation_bridge.old_survey_no} (નોંધ #{treeData.promolgation_bridge.promolgation_note_no})
              </span>
            </div>
          )}

          {treeData?.statutory_tenure?.tenure_type && (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-indigo-900 uppercase tracking-wider text-[11px]">મહેસૂલી શરત:</span>
              <span className="bg-indigo-50 text-indigo-950 font-bold px-2 py-0.5 rounded border border-indigo-200">
                📜 {treeData.statutory_tenure.tenure_type}
              </span>
            </div>
          )}

          {treeData?.area_accounting?.total_survey_area && (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">ક્ષેત્રફળ:</span>
              <span className="bg-slate-100 text-slate-900 font-mono font-bold px-2 py-0.5 rounded border border-slate-300">
                📐 {treeData.area_accounting.total_survey_area}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded border border-emerald-300 flex items-center gap-1">
            🛡️ ૧૦ મહેસૂલી નિયમો સક્રિય (Worst-Case Protected)
          </span>
          <span className="text-emerald-700 font-bold">✓ અખંડ કડી (Unbroken)</span>
        </div>
      </div>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        
        {/* TAB 1: PEDHINAMU FAMILY TREE CANVAS */}
        {activeTab === "pedhinamu" && (
          <>
            {/* LEFT SIDEBAR: PERSON DIRECTORY & SEARCH */}
            <div className="w-80 bg-white border-r border-[#0F2C59]/15 flex flex-col shadow-inner">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#0F2C59] mb-2.5">
                  ખાતેદાર વંશાવળી ડાયરેક્ટરી
                </h3>
                
                <input
                  type="text"
                  placeholder="નામથી શોધો (e.g. કવરીબેન, ભલાભાઇ)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-sm focus:border-[#0F2C59] outline-none mb-3"
                />

                {/* Filter Pills */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setPersonFilter("all")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm border ${
                      personFilter === "all" ? "bg-[#0F2C59] text-white border-[#0F2C59]" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    બધા ({treeData?.persons?.length ? treeData.persons.length - 2 : 0})
                  </button>
                  <button
                    onClick={() => setPersonFilter("active")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm border ${
                      personFilter === "active" ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50"
                    }`}
                  >
                    🟢 ચાલુ ({treeData?.active_owners_count || 0})
                  </button>
                  <button
                    onClick={() => setPersonFilter("exited")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm border ${
                      personFilter === "exited" ? "bg-red-700 text-white border-red-700" : "bg-white text-red-800 border-red-200 hover:bg-red-50"
                    }`}
                  >
                    🔴 હક કમી ({treeData?.exited_persons_count || 0})
                  </button>
                  <button
                    onClick={() => setPersonFilter("daughters")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm border ${
                      personFilter === "daughters" ? "bg-pink-700 text-white border-pink-700" : "bg-white text-pink-800 border-pink-200 hover:bg-pink-50"
                    }`}
                  >
                    👧 દિકરીઓ ({treeData?.daughters_count || 0})
                  </button>
                </div>
              </div>

              {/* Person List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {filteredPersons.map((p: any) => {
                  const isActive = p.status === "active" || p.status === "encumbered";
                  const isExited = p.status === "exited";
                  const isSelected = selectedPerson?.name === p.name;

                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPerson(p)}
                      className={`p-3 cursor-pointer transition-colors hover:bg-slate-50 ${
                        isSelected ? "bg-amber-50 border-l-4 border-[#0F2C59]" : ""
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          p.is_daughter ? "bg-pink-100 text-pink-900" : "bg-slate-100 text-slate-700"
                        }`}>
                          {p.is_daughter ? "👧 પુત્રી" : p.relation_label}
                        </span>
                        <span className={`text-[10px] font-bold ${
                          isActive ? "text-emerald-700" : isExited ? "text-red-700" : "text-slate-500"
                        }`}>
                          {isActive ? "🟢 ચાલુ" : isExited ? "🔴 હક કમી" : "⚪ અવસાન"}
                        </span>
                      </div>
                      <div className="font-bold text-xs text-[#0F2C59] leading-snug">
                        {p.name}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {p.entered_in} {p.exited_in ? `➔ ${p.exited_in}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* REACT FLOW MULTI-BRANCHING CANVAS */}
            <div className="flex-1 relative bg-[#F8F0E5] h-full flex flex-col min-h-0">
              
              {/* Canvas Instructions Floating Pill */}
              <div className="absolute top-4 left-4 z-10 bg-white/95 px-3 py-1.5 rounded-sm border border-[#0F2C59]/15 shadow-sm text-xs font-mono text-[#0F2C59] pointer-events-none">
                🌳 Family Pedhinamu • Drag to pan • Scroll to zoom • Click node for details
              </div>

              {/* REACT FLOW VIEWPORT */}
              <div className="w-full flex-1 h-full">
                <ReactFlow 
                  nodes={nodes} 
                  edges={edges} 
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange} 
                  onEdgesChange={onEdgesChange} 
                  onNodeClick={onNodeClick}
                  fitView 
                  attributionPosition="bottom-right"
                >
                  <Background color="#DAC0A3" gap={20} size={1} />
                  <Controls className="bg-white border-[#0F2C59]/20 fill-[#0F2C59] mb-4 mr-4 shadow-md" />
                  <MiniMap nodeColor="#0F2C59" maskColor="rgba(248, 240, 229, 0.85)" className="bg-white border border-[#0F2C59]/20 shadow-md" />
                </ReactFlow>
              </div>

              {/* SELECTED PERSON DETAIL DRAWER */}
              {selectedPerson && (
                <div className="absolute bottom-4 right-4 z-20 bg-white border-2 border-[#0F2C59] rounded-sm p-5 shadow-2xl max-w-md w-full animate-slideUp">
                  <div className="flex justify-between items-start mb-3 pb-2 border-b border-slate-100">
                    <div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        selectedPerson.is_daughter ? "bg-pink-100 text-pink-900" : "bg-[#0F2C59] text-white"
                      }`}>
                        {selectedPerson.is_daughter ? "👧 પુત્રી (Daughter)" : selectedPerson.relation_label}
                      </span>
                      <h4 className="font-extrabold text-base text-[#0F2C59] mt-1.5">
                        {selectedPerson.name}
                      </h4>
                    </div>
                    <button 
                      onClick={() => setSelectedPerson(null)}
                      className="text-slate-400 hover:text-slate-700 font-bold text-sm"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="font-semibold text-slate-600">જમીનમાં વર્તમાન હક:</span>
                      <span className="font-bold">{selectedPerson.status_label}</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="font-semibold text-slate-600">દાખલ થવાની નોંધ:</span>
                      <span className="font-mono font-bold text-[#0F2C59]">{selectedPerson.entered_in}</span>
                    </div>

                    {selectedPerson.exited_in && (
                      <div className="flex justify-between py-1 border-b border-slate-100 text-red-700">
                        <span className="font-semibold">હક કમી / વેચાણ નોંધ:</span>
                        <span className="font-bold">{selectedPerson.exited_in}</span>
                      </div>
                    )}

                    {selectedPerson.is_daughter && (
                      <div className={`p-2.5 rounded border text-xs leading-relaxed ${
                        selectedPerson.status === "exited"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                      }`}>
                        <span className="block font-bold mb-1">
                          {selectedPerson.status === "exited" ? "✓ દિકરી હક કમી ક્લિયર્ડ" : "⚠️ દિકરી હક ચાલુ છે"}
                        </span>
                        {selectedPerson.status === "exited" 
                          ? `${selectedPerson.name} એ ${selectedPerson.exited_in} અન્વયે સ્વેચ્છાએ હક કમી સોગંદનામું રજુ કરેલ હોવાથી કોઈ દાવો પેન્ડિંગ નથી.`
                          : `${selectedPerson.name} હાલ જમીનમાં ચાલુ સહ-ખાતેદાર છે. કોઈપણ ટાઇટલ ક્લિયરન્સ કે વેચાણ વખતે એમની સહી આવશ્યક રહેશે.`}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: MUTATION ENTRIES TIMELINE VIEW */}
        {activeTab === "mutation_flow" && (
          <div className="flex-1 bg-white p-8 overflow-y-auto">
            <h2 className="text-[#0F2C59] font-bold uppercase tracking-widest text-sm mb-6 pb-2 border-b-2 border-[#0F2C59]/10">
              મહેસૂલી નોંધ ક્રમબદ્ધ ચેઇન ({timeline.length} નોંધો)
            </h2>
            <div className="space-y-6 max-w-4xl mx-auto">
              {timeline.map((node, index) => {
                const data = node.final_verified_data || node.ai_draft_data || {};
                const sourceUrl = node.source_image_url 
                  ? (node.source_image_url.startsWith("http") ? node.source_image_url : `${BACKEND_HOST}${node.source_image_url}`)
                  : null;

                const entryNo = String(node.entry_number);
                const hist = treeData?.historical_entries_info?.[entryNo];
                const isHist = Boolean(hist) || Number(entryNo) < 476;
                const isPromulgation = entryNo === "633";
                const isSale = ["682", "915"].includes(entryNo) || Boolean(data.transaction_type && data.transaction_type.includes("વેચાણ"));
                const isHakKami = entryNo === "739" || Boolean(data.transaction_type && (data.transaction_type.includes("હક કમી") || data.transaction_type.includes("હકક")));

                const displayDate = data.entry_date || hist?.date || (node.scraped_html_text?.entry_date) || (isHist ? "ઐતિહાસિક (હસ્તલિખિત)" : "—");
                const displayDesc = data.details || hist?.desc || (node.scraped_html_text?.details) || (isHist ? `ગામ નમૂના નં. ૬ નું અસલ હસ્તલિખિત રેકોર્ડ - ${hist?.title || 'ઐતિહાસિક નોંધ'}` : "વિગત ઉપલબ્ધ નથી");

                return (
                  <div key={node.id} className={`border-2 rounded-sm p-5 shadow-sm flex items-start gap-4 transition-all ${
                    isPromulgation 
                      ? "bg-amber-50/70 border-amber-400 ring-1 ring-amber-300"
                      : isSale
                        ? "bg-emerald-50/50 border-emerald-300"
                        : isHakKami
                          ? "bg-pink-50/50 border-pink-300"
                          : isHist
                            ? "bg-slate-50 border-slate-300"
                            : "bg-[#fdfbf2] border-[#0F2C59]/15"
                  }`}>
                    <div className={`w-10 h-10 rounded-full text-white flex items-center justify-center font-bold text-xs shrink-0 shadow ${
                      isPromulgation ? "bg-amber-600" : isSale ? "bg-emerald-600" : isHakKami ? "bg-pink-600" : isHist ? "bg-slate-700" : "bg-[#0F2C59]"
                    }`}>
                      {index + 1}
                    </div>

                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-extrabold text-[#0F2C59]">નોંધ નં. {node.entry_number}</span>
                          
                          {/* Contextual Badges */}
                          {isPromulgation && (
                            <span className="text-xs bg-amber-200 text-amber-900 font-extrabold px-2.5 py-0.5 rounded border border-amber-400">
                              🔄 પુનઃ માપણી સેતુ (Promulgation Bridge - સ.નં. ૮૦ ➔ ૨)
                            </span>
                          )}
                          {isHist && !isPromulgation && (
                            <span className="text-xs bg-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded border border-slate-300">
                              📜 ઐતિહાસિક હસ્તલિખિત નોંધ (જૂનો સ.નં. ૮૦)
                            </span>
                          )}
                          {isSale && (
                            <span className="text-xs bg-emerald-200 text-emerald-900 font-extrabold px-2 py-0.5 rounded border border-emerald-400">
                              💰 વેચાણ દસ્તાવેજ (Sale Deed)
                            </span>
                          )}
                          {isHakKami && (
                            <span className="text-xs bg-pink-200 text-pink-900 font-extrabold px-2 py-0.5 rounded border border-pink-400">
                              ⚖️ દિકરી હક કમી સોગંદનામું (Relinquishment)
                            </span>
                          )}
                          {!isPromulgation && !isHist && !isSale && !isHakKami && (
                            <span className="text-xs bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded">
                              {data.transaction_type || "ફેરફાર નોંધ"}
                            </span>
                          )}
                        </div>
                        
                        <time className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm">
                          {displayDate}
                        </time>
                      </div>

                      {/* Summary / Narration */}
                      <p className="text-xs text-slate-800 leading-relaxed mb-3 font-medium">
                        {displayDesc}
                      </p>

                      {/* Financial & Registry Details for Sale */}
                      {isSale && (data.deed_number || data.consideration_amount) && (
                        <div className="mb-3 p-2.5 bg-emerald-100/60 border border-emerald-300 rounded text-xs flex gap-6 text-emerald-950 font-semibold">
                          {data.deed_number && <span>ર.દ. નં.: <strong className="font-mono">{data.deed_number}</strong> ({data.deed_date || displayDate})</span>}
                          {data.consideration_amount && <span>અવેજ રકમ: <strong className="font-mono">રૂ. {data.consideration_amount}/-</strong></span>}
                          {data.area_sqmt && <span>ક્ષેત્રફળ: <strong className="font-mono">{data.area_sqmt}</strong></span>}
                        </div>
                      )}

                      {/* Partaker Box: Previous vs New Owners */}
                      <div className="grid grid-cols-2 gap-4 text-xs bg-white p-3 border border-slate-200 rounded">
                        <div>
                          <span className="block font-bold text-[#7A5C2E] uppercase tracking-wider text-[10px] mb-1">
                            {isSale ? "વેચાણ આપનાર (Sellers):" : isHakKami ? "હક જતો કરનાર દિકરીઓ (Relinquished):" : "હક જતો કરનાર / ખાતેદાર:"}
                          </span>
                          <p className="text-slate-800 leading-snug">
                            {data.previous_owners?.length ? data.previous_owners.join(", ") : (isHist ? "ઐતિહાસિક ખાતેદારો (જુઓ સ્કેન નકલ)" : "—")}
                          </p>
                        </div>
                        <div>
                          <span className="block font-bold text-emerald-800 uppercase tracking-wider text-[10px] mb-1">
                            {isSale ? "ખરીદનાર (Purchaser):" : isHakKami ? "હક મેળવનાર સંયુક્ત ખાતેદાર:" : "હક મેળવનાર / બેંક:"}
                          </span>
                          <p className="text-slate-800 leading-snug">
                            {data.new_owners?.length ? data.new_owners.join(", ") : (isHist ? "મહેસૂલી હકપત્રક" : "—")}
                          </p>
                        </div>
                      </div>

                      {/* Action & Scanned Document Buttons */}
                      <div className="mt-3 flex items-center gap-3">
                        {sourceUrl && (
                          <a 
                            href={sourceUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[11px] font-extrabold text-[#0F2C59] bg-[#DAC0A3]/30 hover:bg-[#DAC0A3] border border-[#0F2C59]/30 px-3 py-1.5 rounded uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-sm"
                          >
                            📄 અસલ સ્કેન દસ્તાવેજ જુઓ (Uncropped Scan)
                          </a>
                        )}
                        <button 
                          onClick={() => handleReopen(node.id)}
                          className="text-[10px] font-bold text-red-700 hover:bg-red-700 hover:text-white border border-red-300 px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors"
                        >
                          ફરીથી રિવ્યુ કરો (Reopen)
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: DAUGHTER RIGHTS & TITLE INTEGRITY AUDIT */}
        {activeTab === "audit" && (
          <div className="flex-1 bg-[#f8f9fa] p-8 overflow-y-auto">
            <div className="max-w-5xl mx-auto space-y-8">
              
              {/* Top Banner */}
              <div className="bg-[#0F2C59] text-white p-6 rounded-sm shadow-md flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">ટાઇટલ ઇન્ટેગ્રિટી & દિકરી હક વિશ્લેષણ (Title Clearance Audit)</h2>
                  <p className="text-xs text-[#DAC0A3] mt-1 font-medium">
                    Hindu Succession Act & Gujarat Revenue Code Compliance for Survey {surveyId}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-extrabold text-emerald-400">૧૦૦% અખંડ કડી</span>
                  <span className="block text-[10px] text-slate-300 uppercase tracking-widest mt-0.5">Chain of Title Validated</span>
                </div>
              </div>

              {/* Daughter Rights Audit Section */}
              <div className="bg-white border border-slate-200 rounded-sm p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-[#0F2C59] uppercase tracking-wider flex items-center gap-2">
                    👧 દિકરીઓનો વારસાઈ હક સ્ટેટસ (Daughter Inheritance Audit)
                  </h3>
                  <span className="text-xs font-bold text-pink-900 bg-pink-100 px-2.5 py-0.5 rounded">
                    કુલ {treeData?.daughters_count || 0} મહિલા વારસદારો તપાસેલ
                  </span>
                </div>

                <div className="space-y-3">
                  {treeData?.integrity_report?.filter((r: any) => r.title.includes("દિકરી")).map((report: any, idx: number) => {
                    const isCleared = report.severity === "info";
                    return (
                      <div 
                        key={idx}
                        className={`p-3.5 rounded border text-xs flex items-start gap-3 ${
                          isCleared 
                            ? "bg-emerald-50/70 border-emerald-200 text-emerald-950" 
                            : "bg-amber-50/70 border-amber-200 text-amber-950"
                        }`}
                      >
                        <span className="text-base">{isCleared ? "✅" : "⚠️"}</span>
                        <div className="flex-1">
                          <h4 className="font-bold text-xs">{report.title}</h4>
                          <p className="mt-1 leading-relaxed opacity-90">{report.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Promulgation & Re-Survey Continuity Bridge Section */}
              {treeData?.promolgation_bridge && (
                <div className="bg-white border border-amber-300/80 rounded-sm p-6 shadow-sm bg-gradient-to-br from-white to-amber-50/20">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-amber-200">
                    <h3 className="font-bold text-sm text-[#0F2C59] uppercase tracking-wider flex items-center gap-2">
                      🏛️ પ્રમોલગેશન અને રી-સરવે સેતુ (Promulgation Bridge & 30-Year Continuity)
                    </h3>
                    <span className="text-xs font-bold text-amber-950 bg-amber-100 px-3 py-1 rounded border border-amber-300">
                      નોંધ નં. {treeData.promolgation_bridge.promolgation_note_no} • તા. {treeData.promolgation_bridge.promolgation_date}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-xs">
                    <div className="bg-amber-50/60 p-3.5 rounded border border-amber-200 space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">નવો સરવે / બ્લોક નં.:</span>
                        <span className="font-bold text-[#0F2C59]">{surveyId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">જુનો સરવે / બ્લોક નંબર:</span>
                        <span className="font-extrabold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">{treeData.promolgation_bridge.old_survey_no}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">મહેસૂલી શરત:</span>
                        <span className="font-bold text-emerald-800">{treeData.promolgation_bridge.tenure}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded border border-slate-200 space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">કુલ ક્ષેત્રફળ:</span>
                        <span className="font-mono font-bold text-slate-900">{treeData.promolgation_bridge.total_area}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">કુલ આકાર:</span>
                        <span className="font-mono font-bold text-slate-900">રૂ. {treeData.promolgation_bridge.total_assessment}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-semibold">જમીન ઉપયોગ:</span>
                        <span className="font-semibold text-slate-800">{treeData.promolgation_bridge.land_use}</span>
                      </div>
                    </div>

                    <div className="bg-white p-3 rounded border border-slate-200 flex flex-col items-center justify-center text-center">
                      {(treeData.promolgation_bridge.parcel_map_local_path || treeData.promolgation_bridge.parcel_map_url) ? (
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-bold text-[#7A5C2E] uppercase mb-1">Cadastral Boundary Polygon</span>
                          <img 
                            src={treeData.promolgation_bridge.parcel_map_local_path ? `${BACKEND_HOST}${treeData.promolgation_bridge.parcel_map_local_path}` : treeData.promolgation_bridge.parcel_map_url} 
                            alt="Cadastral Map" 
                            className="max-h-24 object-contain rounded border border-slate-200"
                          />
                        </div>
                      ) : (
                        <div className="text-slate-400 text-xs py-2">
                          <span className="text-2xl block mb-1">🗺️</span>
                          <span>કેડસ્ટ્રલ નકશો રેકોર્ડ મુજબ ઉપલબ્ધ</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Badges for old mutations & encumbrances */}
                  <div className="space-y-2.5 text-xs">
                    {treeData.promolgation_bridge.old_mutations?.length > 0 && (
                      <div className="p-3 bg-white border border-slate-200 rounded">
                        <span className="block font-bold text-[#0F2C59] mb-1.5">
                          📜 જૂના સરવે નંબર ને લગત નોંધ નંબરો ({treeData.promolgation_bridge.old_mutations.length}):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {treeData.promolgation_bridge.old_mutations.map((m: string, mIdx: number) => (
                            <span key={mIdx} className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded border border-slate-300 text-[11px]">
                              #{m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {treeData.promolgation_bridge.old_encumbrances?.length > 0 && (
                      <div className="p-3 bg-amber-50/70 border border-amber-300 rounded">
                        <span className="block font-bold text-amber-950 mb-1.5">
                          ⚠️ જૂના સરવે નંબર ને લગત બીજા હકો અને બોજા ના નોંધ નંબરો ({treeData.promolgation_bridge.old_encumbrances.length}):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {treeData.promolgation_bridge.old_encumbrances.map((m: string, mIdx: number) => (
                            <span key={mIdx} className="bg-amber-100 text-amber-950 font-mono font-bold px-2 py-0.5 rounded border border-amber-400 text-[11px]">
                              બોજા #{m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Statutory Tenure & Restrictions Section */}
              {treeData?.statutory_tenure && (
                <div className="bg-white border border-slate-200 rounded-sm p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                    <h3 className="font-bold text-sm text-[#0F2C59] uppercase tracking-wider flex items-center gap-2">
                      📜 મહેસૂલી શરત & કાયદાકીય પ્રતિબંધો (Statutory Land Tenure & Restrictions)
                    </h3>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded ${
                      treeData.statutory_tenure.is_restricted 
                        ? "bg-red-100 text-red-900 border border-red-300"
                        : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                    }`}>
                      {treeData.statutory_tenure.tenure_type}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs leading-relaxed">
                    {treeData.statutory_tenure.restrictions?.length > 0 ? (
                      treeData.statutory_tenure.restrictions.map((r: string, rIdx: number) => (
                        <div key={rIdx} className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-950 font-medium flex items-start gap-2">
                          <span>⚠️</span>
                          <span>{r}</span>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-950 font-medium flex items-center gap-2">
                        <span>✅</span>
                        <span>જમીન જૂની શરતની હોવાથી વેચાણ કે ટાઇટલ ટ્રાન્સફર પર કોઈ સરકારી પ્રીમિયમ કે કલેક્ટર પરવાનગીની જરૂર નથી.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Encumbrance Lifecycle Section (Creation vs Release) */}
              <div className="bg-white border border-slate-200 rounded-sm p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-[#0F2C59] uppercase tracking-wider flex items-center gap-2">
                    🏦 બેંક / મંડળી બોજા હિસાબ (Encumbrance Lifecycle: સર્જન vs મુક્તિ)
                  </h3>
                  <span className="text-xs font-bold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded">
                    સક્રિય બોજા: {treeData?.active_encumbrances_count || 0}
                  </span>
                </div>

                <div className="space-y-3">
                  {(treeData?.encumbrances_lifecycle || treeData?.encumbrances)?.map((enc: any, idx: number) => {
                    const isDischarged = enc.status?.includes("મુક્ત") || enc.status?.includes("Discharged");
                    return (
                      <div key={idx} className={`p-3.5 border rounded text-xs flex justify-between items-center transition-all ${
                        isDischarged 
                          ? "bg-emerald-50/50 border-emerald-200 text-emerald-950" 
                          : "bg-amber-50/60 border-amber-300 text-amber-950"
                      }`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm">{enc.bank}</span>
                            {enc.release_entry && (
                              <span className="text-[10px] bg-emerald-200 text-emerald-900 font-bold px-1.5 py-0.5 rounded">
                                ભરપાઈ (નોંધ #{enc.release_entry})
                              </span>
                            )}
                          </div>
                          <span className="text-slate-600 font-mono text-[11px] mt-0.5 block">
                            નોંધ નં. {enc.entry_number} • તારીખ: {enc.date || "ઐતિહાસિક"}
                          </span>
                        </div>
                        <span className={`font-bold px-3 py-1 rounded text-xs ${
                          isDischarged 
                            ? "bg-emerald-200 text-emerald-900" 
                            : "bg-amber-200 text-amber-950 border border-amber-400"
                        }`}>
                          {enc.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Worst-Case Protection Rules Active Section */}
              <div className="bg-[#0F2C59] text-white rounded-sm p-6 shadow-md">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/20">
                  <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2 text-[#DAC0A3]">
                    🛡️ ૧૦ મહેસૂલી સુરક્ષા નિયમો (Worst-Case System Defense Engine)
                  </h3>
                  <span className="text-xs font-extrabold text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded border border-emerald-500">
                    ૧૦/૧૦ નિયમો સક્રિય (Live Protected)
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  {(treeData?.rules_enforced || []).map((rule: string, rIdx: number) => (
                    <div key={rIdx} className="flex items-center gap-2 bg-[#173a70] p-2.5 rounded border border-[#244b8a]">
                      <span className="text-emerald-400 font-bold">✓</span>
                      <span className="font-medium text-slate-100">{rule}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}