import re

def normalize_revenue_name(raw: str) -> str:
    """
    Cleans messy real-world AnyRoR Gujarati revenue strings:
    - Strips area phrases: (હે ૦-૫૪-૦૦), (હે ૦-૫૪, હે ૩-૬૭-૪૫ ચો, ચો.મી., etc.
    - Strips unclosed parentheses and trailing delimiters
    - Strips boilerplate: ના ખાતા નંબર... થી માર્જિનમાં, ઉપરોક્ત ના નામે, ખેડૂત ખાતેદાર, શ્રી
    - Normalizes internal whitespace
    """
    if not raw:
        return ""
    text = raw.strip()
    
    # 1. Ignore pure boilerplate phrases
    if re.search(r'^(?:ઉપરોક્ત|ઉપરોકત)\s+ના\s+નામે', text):
        return ""
    if re.search(r'^(?:નામદાર\s+સરકાર|સરકાર|પંચાયત)$', text):
        return text

    # 2. Strip area metric patterns (open or closed brackets)
    text = re.sub(r'\(?\s*હે\s*[૦-૯0-9\.\-]+(?:\s*ચો)?(?:\.મી)?\)?', ' ', text)
    text = re.sub(r'\([0-9\.\-]+\)', ' ', text) # e.g. (0-54-00)
    text = re.sub(r'\b[૦-૯0-9]+-[૦-૯0-9]+-[૦-૯0-9]+\b', ' ', text) # e.g. ૦-૫૪-૦૦
    text = re.sub(r'ચો\.મી\.?|હે\.-આરે-ચો\.મી\.', ' ', text)
    
    # 3. Strip trailing margin & khata boilerplate
    text = re.sub(r',?\s*ના\s+ખાતા\s+નંબર.*', ' ', text)
    text = re.sub(r'થી\s+માર્જિનમાં.*', ' ', text)
    text = re.sub(r'\(ખાતા\s+નં\.?\)', ' ', text)
    text = re.sub(r'ખાતા\s+નં\.?\s*[૦-૯0-9]+', ' ', text)
    text = re.sub(r'\(.*?\)', ' ', text) # any remaining closed parens
    
    # 4. Strip leading prefixes
    text = re.sub(r'^(?:શ્રી|શ્રીમતી|ખેડૂત\s+ખાતેદાર|ખાતેદાર|મોજે\s+.*?\s+ગામના)\s+', '', text)
    text = re.sub(r'^(?:બાવળા\s+તાલુકાના\s+.*?\s+ગામના\s+ખેડૂત\s+ખાતેદાર)\s+', '', text)
    
    # 5. Clean punctuation & orphan brackets
    text = re.sub(r'[\\/()\[\]{}":;,\-\*]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

def classify_revenue_entity(clean_name: str, relation_hint: str = "") -> dict:
    """
    Classifies a Gujarati revenue entity into:
    - bank: Financial institution (મંડળી, બેંક)
    - widow: Deceased owner's widow (વિધવા, પત્ની) -> PRIORITIZED before daughter!
    - daughter: Daughter of owner (દિકરી, દીકરી, પુત્રી, ની દિ)
    - son: Son (પુત્ર, દીકરો)
    - buyer: Transferee (ખરીદનાર)
    - khatedar: Standard co-owner
    """
    full_context = f"{clean_name} {relation_hint}".strip()
    
    # 1. Bank / Cooperative Credit Society
    if any(k in full_context for k in ["મંડળી", "બેંક", "બેન્ક", "બેંક લિ", "બેંક લી", "શાખા"]):
        return {
            "type": "bank",
            "label": "ધિરાણ સંસ્થા / બેંક",
            "is_daughter": False,
            "badge_color": "amber"
        }
        
    # 2. Widow (Must be evaluated BEFORE daughter check to avoid mistaking widows named 'બેન' as daughters!)
    is_widow = any(k in full_context for k in [
        "વિધવા", "વિઘવ", "ની વિધ", "ની વિધવા", "ના વિઘવા", "ના વિધ", "વિઘવા"
    ]) or ("પત્ની" in full_context and not any(d in full_context for d in ["દિકરી", "દીકરી", "પુત્રી"]))
    
    if is_widow:
        return {
            "type": "widow",
            "label": "👵 વિધવા પત્ની (Widow)",
            "is_daughter": False,
            "badge_color": "purple"
        }
        
    # 3. Daughter
    is_daughter = any(k in full_context for k in [
        "દિકરી", "દીકરી", "પુત્રી", "ની દિ", "ના દીકરી", "ની દીકરી", "ની દિકરી", "ની પુત્રી"
    ])
    if is_daughter:
        return {
            "type": "daughter",
            "label": "👧 પુત્રી (Daughter)",
            "is_daughter": True,
            "badge_color": "pink"
        }
        
    # 4. Son
    is_son = any(k in full_context for k in ["પુત્ર", "દીકરો", "દિકરો", "ના પુત્ર", "નો પુત્ર"])
    if is_son:
        return {
            "type": "son",
            "label": "👦 પુત્ર (Son)",
            "is_daughter": False,
            "badge_color": "blue"
        }
        
    # 5. Buyer
    if any(k in full_context for k in ["ખરીદનાર", "વેચાણ લેનાર"]):
        return {
            "type": "buyer",
            "label": "💼 ખરીદનાર (Purchaser)",
            "is_daughter": False,
            "badge_color": "emerald"
        }
        
    # 6. Default Khatedar / Co-owner
    return {
        "type": "khatedar",
        "label": "ખેડૂત ખાતેદાર (Co-owner)",
        "is_daughter": False,
        "badge_color": "slate"
    }

if __name__ == "__main__":
    test_cases = [
        "પરેશભાઇ ભરતભાઇ સોલંકી (હે ૦-૫૪",
        "પરેશભાઇ ભરતભાઇ સોલંકી (હે ૦-૫૪-૦૦",
        "ગોવિંદભાઇ મનજીભાઇ (હે ૦-૩૪-૬૪ ,ના ખાતા નંબર ૨૮૧ થી માર્જિનમાં જણાવેલ જમીન",
        "જશીબેન ભયરામભાઇ અભુભાઇની વિધવા",
        "જશીબેન ભયરામભાઇ અભુભાઇ ની વિઘવ",
        "હીરાબેન તે અભુભાઇ મેરૂભાઇની દિકરી",
        "હેરાબેન તે અભુભાઇ મેરૂભાઇની દિ",
        "વીરીબેન કાશીરામ ગટોરભાઈ ની વિધ",
        "પુરીબેન અભુભાઇ મેરુભાઇ ના દીકરી તે અમરશીભાઇ ના પત્ની",
        "સરી સેવા સહકારી મંડળી લી (0-54-00)",
        "ઘી હસનનગર સેવા સહકારી મંડળી લી.",
        "ઉપરોક્ત ના નામે (હે ૩-૬૭-૪૫ ચો"
    ]
    for tc in test_cases:
        cleaned = normalize_revenue_name(tc)
        cls = classify_revenue_entity(cleaned, tc)
        print(f"RAW: {tc[:35]:35} -> CLEAN: {cleaned:30} -> {cls['label']}")
