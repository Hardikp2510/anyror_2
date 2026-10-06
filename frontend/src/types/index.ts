export interface ExtractedData {
    [tableKey: string]: {
        [rowKey: string]: any;
    };
}

export interface RiskCategory {
    status?: string;
    classification?: string;
    reason?: string;
    risk_score?: number;
    details?: string[];
}

export interface RiskFlags {
    A_Ownership?: RiskCategory;
    B_Tenure?: RiskCategory;
    C_Encumbrance?: RiskCategory;
    D_Litigation?: RiskCategory;
    Overall_Status?: "Clear" | "High Risk" | "Review Needed";
}

export interface LandRecord {
    id: number;
    district_code: string;
    taluka_code: string;
    village_code: string;
    survey_no: string;
    extracted_data: ExtractedData & { Risk_Flags?: RiskFlags };
    status: "Clear" | "High Risk" | "Review Needed";
    pdf_path: string | null;
    fetched_at: string;
}

export interface MutationDraftData {
    survey_numbers?: string;
    entry_date?: string;
    transaction_type?: string;
    previous_owners?: string[];
    new_owners?: string[];
    remarks_summary?: string;
}

export interface MutationEntry {
    id: number;
    land_record_id: number;
    entry_number: string;
    entry_date?: string;
    transaction_type?: string;
    status: string;
    officer_remarks?: string;
    source_image_url?: string;
    scraped_html_text?: any;
    ai_draft_data?: MutationDraftData;
    final_verified_data?: MutationDraftData;
    is_verified: boolean;
    created_at?: string;
}

export interface TalukaOption {
    code: string;
    name: string;
}

export interface DistrictOption {
    code: string;
    name: string;
    talukas: TalukaOption[];
}

export interface VillageOption {
    code: string;
    name: string;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data: T;
    message?: string;
}

export interface ApiError {
    detail: string;
}