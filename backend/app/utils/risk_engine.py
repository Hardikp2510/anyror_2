def _get_case_insensitive(data: dict, *target_keys: str, default: str = "") -> str:
    """Helper to safely extract string values from a dictionary regardless of key casing or underscores."""
    if not isinstance(data, dict):
        return default
    normalized_map = {k.strip().lower().replace("_", " "): str(v) for k, v in data.items() if v is not None}
    for tk in target_keys:
        norm_tk = tk.strip().lower().replace("_", " ")
        if norm_tk in normalized_map:
            return normalized_map[norm_tk]
    return default

def calculate_risk_flags(extracted_data: dict) -> dict:
    """
    Evaluates the scraped AnyROR JSON data and generates the 4 Core Risk Flags
    adhering strictly to Gujarat Land Revenue Code and Tenancy Acts.
    """
    basic_details = extracted_data.get("Basic Details", extracted_data.get("Basic_Details", {}))
    other_statuses = extracted_data.get("Other Statuses", extracted_data.get("Other_Statuses", {}))
    ownership_data = extracted_data.get("Ownership Details", extracted_data.get("Ownership_Details", []))
    boja_data = extracted_data.get("Boja and Rights", extracted_data.get("Boja_and_Rights", []))
    promolgation = extracted_data.get("Promolgation Details", extracted_data.get("Promolgation_Details", {}))
    
    flags = {
        "A_Ownership": {"status": "🟢 Private", "color": "green", "reason": "No government or communal ownership keywords detected."},
        "B_Tenure": {"status": "🟢 Freehold / Unrestricted", "color": "green", "reason": "Old tenure (Juni Sharat) or standard private title."},
        "C_Encumbrance": {"status": "🟢 Clear", "color": "green", "reason": "No active Boja/Lien entries found."},
        "D_Litigation": {"status": "🟢 Clear", "color": "green", "reason": "No active court cases found."}
    }

    # ==========================================
    # FLAG A: OWNERSHIP TYPE
    # ==========================================
    restricted_keywords = [
        "સરકાર", "સરકારી", "ગૌચર", "પંચાયત", "ટ્રસ્ટ", "દેવસ્થાન", 
        "વકફ", "વન", "જંગલ", "કેનાલ", "નર્મદા", "ખરાબો", "પડતર"
    ]
    
    ownership_text = " ".join([str(val) for row in ownership_data for val in (row.values() if isinstance(row, dict) else [str(row)])])
    
    for word in restricted_keywords:
        if word in ownership_text:
            flags["A_Ownership"] = {
                "status": "🔴 Government / Restricted", 
                "color": "red",
                "reason": f"Detected restricted land keyword in ownership: '{word}'"
            }
            break

    # ==========================================
    # FLAG B: TENURE RISK
    # ==========================================
    tenure_str = _get_case_insensitive(basic_details, "Tenure", "Tenure Type", "TENURE").strip()
    
    if "નવી શરત" in tenure_str or "નવી અવિભાજ્ય" in tenure_str:
        flags["B_Tenure"] = {
            "status": "🔴 Restricted Transfer (Navi Sharat)", 
            "color": "red",
            "reason": "New Tenure (Navi Sharat) requires prior District Collector permission & premium payment."
        }
    elif "પ્રતિબંધિત" in tenure_str or "પ્રતિબંધિત સત્તાપ્રકાર" in tenure_str:
        flags["B_Tenure"] = {
            "status": "🔴 Restricted Rights (Pratibandhit)", 
            "color": "red",
            "reason": "Restricted Tenure (Pratibandhit Satta Prakar) detected. Transfer legally restricted."
        }
    elif "ગણોત" in tenure_str:
        flags["B_Tenure"] = {
            "status": "🔴 Tenancy Act Subject (Ganot)", 
            "color": "red",
            "reason": "Subject to Gujarat Tenancy and Agricultural Lands Act restrictions."
        }
    elif "શરતી" in tenure_str:
        flags["B_Tenure"] = {
            "status": "🟡 Conditional Title (Sharati)", 
            "color": "yellow",
            "reason": "Conditional tenure noted. Terms of original grant must be verified."
        }
    elif "જૂની શરત" in tenure_str:
        flags["B_Tenure"] = {
            "status": "🟢 Freehold / Unrestricted", 
            "color": "green",
            "reason": "Old Tenure (Juni Sharat) detected. Freely transferable."
        }
    elif tenure_str:
        flags["B_Tenure"] = {
            "status": f"⚪ {tenure_str}", 
            "color": "gray",
            "reason": f"Specific tenure status: {tenure_str}"
        }

    # ==========================================
    # FLAG C: ENCUMBRANCE / BOJA
    # ==========================================
    old_survey_boja = promolgation.get("Old_Survey_Encumbrances", [])
    
    # Check if existing Boja table entries are actually active or marked released
    active_boja_entries = []
    release_keywords = ["કમી", "રદ", "મુક્ત", "ચૂકતે", "cancel", "released", "cleared"]
    
    for row in boja_data:
        row_str = " ".join([str(v).lower() for v in (row.values() if isinstance(row, dict) else [str(row)])])
        is_cleared = any(rk in row_str for rk in release_keywords)
        if not is_cleared:
            active_boja_entries.append(row)

    if len(active_boja_entries) > 0:
        flags["C_Encumbrance"] = {
            "status": "🟡 Active Lien / Boja", 
            "color": "yellow",
            "reason": f"Found {len(active_boja_entries)} active Boja/Rights charges. Must be cleared before purchase."
        }
    elif old_survey_boja and len(old_survey_boja) > 0:
        flags["C_Encumbrance"] = {
            "status": "🟡 Historical Lien Carried Over", 
            "color": "yellow",
            "reason": f"Encumbrance #{', '.join(old_survey_boja)} carried over from old survey during promulgation."
        }

    # ==========================================
    # FLAG D: LITIGATION STATUS
    # ==========================================
    litigation_fields = [
        _get_case_insensitive(other_statuses, "High/Civil Court Case", "HIGH/CIVIL COURT CASE", "High Court and Civil Court Case Details"),
        _get_case_insensitive(other_statuses, "iRCMS Revenue Case", "IRCMS REVENUE CASE", "iRCMS Revenue Case Details")
    ]
    
    has_case = False
    is_service_down = False
    
    for field in litigation_fields:
        field_lower = field.lower().strip()
        if not field_lower or field_lower in ["---", "none", "-", "n/a"] or "record not found" in field_lower:
            continue
            
        if "service down" in field_lower or "offline" in field_lower:
            is_service_down = True
        else:
            has_case = True
            break
            
    if has_case:
        flags["D_Litigation"] = {
            "status": "🔴 Active Case Found", 
            "color": "red",
            "reason": "Active legal dispute populated in High Court, Civil Court, or iRCMS records."
        }
    elif is_service_down:
        flags["D_Litigation"] = {
            "status": "⚪ Service Unreachable", 
            "color": "gray",
            "reason": "Government litigation service was temporarily offline during scrape."
        }

    return flags

def calculate_outstanding_dues(extracted_data: dict) -> dict:
    """
    Evaluates Other Statuses to build a clean 3-line Dues Checklist.
    """
    other_statuses = extracted_data.get("Other Statuses", extracted_data.get("Other_Statuses", {}))
    
    def parse_status(val: str) -> dict:
        clean_val = val.strip().lower()
        if not clean_val or clean_val in ["---", "-", "none", "n/a", "paid"]:
            return {"status": "Paid / Clear", "color": "text-green-700 bg-green-100", "icon": "✅"}
        elif "record not found" in clean_val:
            return {"status": "Not Found", "color": "text-slate-600 bg-slate-100", "icon": "⚪"}
        else:
            return {"status": f"Pending ({val})", "color": "text-red-700 bg-red-100", "icon": "⚠️"}

    return {
        "Panchayat Tax": parse_status(_get_case_insensitive(other_statuses, "Panchayat Tax", "PANCHAYAT TAX")),
        "Electricity Bill": parse_status(_get_case_insensitive(other_statuses, "Electricity Bill", "ELECTRICITY BILL")),
        "Water Bill": parse_status(_get_case_insensitive(other_statuses, "Water Bill", "WATER BILL"))
    }