import os
import re
import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from google import genai
from google.genai import types
from dotenv import load_dotenv

from app.schemas.mutation_schema import PageExtraction, MutationEntryExtraction
from app.core.logging import logger

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env_path = BASE_DIR / ".env"
load_dotenv(dotenv_path=env_path)

def get_gemini_client(custom_api_key: Optional[str] = None) -> Optional[genai.Client]:
    """Dynamically get an active Gemini Client instance if a valid key is provided."""
    key = (
        custom_api_key or 
        os.getenv("GEMINI_API_KEY") or 
        ""
    ).strip()

    if not key or key == "your_gemini_api_key_here" or len(key) < 10:
        return None
    try:
        return genai.Client(api_key=key)
    except Exception as e:
        logger.warning(f"Could not initialize Gemini Client: {e}")
        return None

def parse_gujarati_mutation_nlp(
    text: str, 
    trans_type: str = "", 
    officer_remarks: str = "", 
    survey_no: str = ""
) -> Dict[str, Any]:
    """
    Intelligent Gujarati revenue NLP fallback. 
    Guarantees previous_owners and new_owners are never blank even if Gemini API key is missing.
    """
    if not text:
        return {
            "previous_owners": [],
            "new_owners": [],
            "transaction_type": trans_type or "ફેરફાર નોંધ",
            "remarks_summary": "વિગત ઉપલબ્ધ નથી",
            "source": "nlp_fallback"
        }

    clean_text = " ".join(text.split())
    prev_owners = []
    new_owners = []
    inferred_type = trans_type or "ફેરફાર નોંધ"

    # 1. Bojo / Mortgage (બોજો દાખલ / ખેડૂત ધિરાણ)
    if "બોજો" in trans_type or "ધિરાણ" in clean_text or "બોજા" in clean_text or "તારણ" in clean_text:
        inferred_type = trans_type or "બોજો દાખલ"
        # Extract Khatedars
        khatedar_match = re.search(
            r'ખેડૂત\s+ખાતેદાર\s+([^,]+(?:,\s*[^,]+)*?)(?:\s+ના\s+ખાતા|\s+ખાતા\s+નંબર|\s+નાઓ|\s+ના\s+નામે|\s+તેઓના|\s+ના\s+હિસ્સા|\s*\(|\s+ખાતા\s+નં|\s+થી\s+માર્જિનમાં)', 
            clean_text
        )
        if khatedar_match:
            raw_names = khatedar_match.group(1)
            clean_names_block = re.split(r'\s+ના\s+ખાતા|\s+ખાતા\s+નંબર|\s+થી\s+માર્જિનમાં|\s+તેઓના\s+ખાતે', raw_names)[0]
            names = [re.sub(r'\(.*?\)', '', n).strip() for n in re.split(r'[,/]| અને ', clean_names_block) if n.strip()]
            prev_owners.extend([n for n in names if len(n) > 2 and 'તાલુકા' not in n and 'ગામ' not in n])
            
        # Extract Bank / Cooperative Society
        bank_match = re.search(r'(?:આ\s+જમીન\s+ઉપર\s+|જમીન\s+પર\s+)(.*?)(?:માંથી\s+ધિરાણ|તરફથી\s+ધિરાણ|પાસેથી\s+ધિરાણ|ની\s+તરફેણમાં|માં\s+તારણ)', clean_text)
        if bank_match:
            new_owners.append(bank_match.group(1).strip())
        else:
            m = re.search(r'([^\s,]+(?:\s+[^\s,]+)*?\s+(?:મંડળી|બેંક|બેન્ક)(?:\s+લી\.|\s+શાખા|\s+લિ\.)?)', clean_text)
            if m:
                new_owners.append(m.group(1).strip())

    # 2. Vechan / Sale Deed (વેચાણ દસ્તાવેજ)
    elif "વેચાણ" in trans_type or "દસ્તાવેજ" in clean_text or "વેચાણ" in clean_text:
        inferred_type = trans_type or "વેચાણ"
        seller_match = re.search(r'(?:ખાતેદાર\s+|વેચનાર\s+)(.*?)(?:\s+નાઓએ|\s+એ\s+આ\s+જમીન|\s+તરફથી|\s+નાઓ\s+તરફથી)', clean_text)
        buyer_match = re.search(r'(?:ખરીદનાર\s+|તરફેણમાં\s+|આ\s+જમીન\s+)(.*?)(?:\s+ને\s+વેચાણ|\s+નાઓને\s+વેચાણ|\s+તરફેણ)', clean_text)
        if seller_match:
            prev_owners.extend([n.strip() for n in re.split(r'[,/]| અને ', seller_match.group(1)) if len(n.strip()) > 2])
        if buyer_match:
            new_owners.extend([n.strip() for n in re.split(r'[,/]| અને ', buyer_match.group(1)) if len(n.strip()) > 2])

    # 3. Varsai / Succession (વારસાઈ / હક દાખલ)
    elif "વારસાઈ" in trans_type or "અવસાન" in clean_text or "ગુજરી" in clean_text:
        inferred_type = trans_type or "વારસાઈ"
        dec_match = re.search(r'(?:ખાતેદાર\s+|સ્વર્ગસ્થ\s+|સ્વ\.\s*)(.*?)(?:\s+નું\s+અવસાન|\s+ગુજરી\s+જતાં|\s+ના\s+અવસાન)', clean_text)
        heirs_match = re.search(r'(?:વારસદાર\s+તરીકે\s+|વારસો\s+|વારસદારો\s+)(.*?)(?:\s+ના\s+નામ|\s+દાખલ\s+કરવા|\s+નાઓ)', clean_text)
        if dec_match:
            prev_owners.append(dec_match.group(1).strip())
        if heirs_match:
            new_owners.extend([n.strip() for n in re.split(r'[,/]| અને ', heirs_match.group(1)) if len(n.strip()) > 2])

    # 4. Hukam / Government Order (હુકમથી / જૂની શરત / સત્તા પ્રકાર)
    elif "હુકમ" in trans_type or "ઠરાવ" in clean_text:
        inferred_type = trans_type or "હુકમથી"
        order_match = re.search(r'(મામલતદાર[^\s,]+|કલેક્ટર[^\s,]+|સરકારશ્રી[^\s,]+|\b[^\s,]+\s+સત્તા\s+મંડળ)', clean_text)
        if order_match:
            prev_owners.append(order_match.group(1).strip())
        new_owners.append(f"સરવે {survey_no} હિતધારકો / ખાતેદારો")

    # Clean & Deduplicate
    clean_prev = list(dict.fromkeys([p for p in prev_owners if p and len(p) > 2]))
    clean_new = list(dict.fromkeys([n for n in new_owners if n and len(n) > 2]))

    summary = clean_text[:220] + ("..." if len(clean_text) > 220 else "")

    return {
        "previous_owners": clean_prev,
        "new_owners": clean_new,
        "transaction_type": inferred_type,
        "remarks_summary": summary,
        "source": "nlp_fallback"
    }

async def extract_mutation_from_text(
    details_text: str,
    trans_type: str = "",
    officer_remarks: str = "",
    survey_no: str = "",
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extracts structured legal entities from Gujarati AnyRoR table narrative using Gemini API,
    falling back to Gujarati revenue NLP if no API key is set or on rate limit.
    """
    nlp_result = parse_gujarati_mutation_nlp(details_text, trans_type, officer_remarks, survey_no)
    client = get_gemini_client(api_key)

    if not client:
        logger.info("No active Gemini API key configured. Utilizing local Gujarati revenue NLP extractor.")
        return nlp_result

    prompt = f"""
    You are an expert Gujarat Revenue Law title examiner and legal data extraction engine.
    Analyze the following official Gujarati AnyRoR Village Form 6 (VF-6) mutation entry narrative.
    
    Extract the following structured facts into strict JSON:
    1. 'previous_owners': List of individuals or entities giving up, mortgaging, or losing title rights (e.g. Mortgagor khatedars, Sellers, Deceased person, relinquishing parties).
    2. 'new_owners': List of individuals or entities acquiring title rights or security interest (e.g. Lending Bank, Purchasing buyers, Legal heirs, Government authority).
    3. 'transaction_type': Precise core legal event in Gujarati (e.g. 'બોજો દાખલ', 'વેચાણ', 'વારસાઈ', 'હુકમથી').
    4. 'entry_date': Date if mentioned in text (DD/MM/YYYY).
    5. 'remarks_summary': A clear, professional 1-2 sentence legal synopsis in Gujarati.

    NARRATIVE TEXT:
    {details_text}

    OFFICER REMARKS:
    {officer_remarks}
    """

    candidate_models = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-1.5-flash"]
    for model_name in candidate_models:
        try:
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=[prompt],
                config={
                    "response_mime_type": "application/json",
                    "response_schema": MutationEntryExtraction,
                    "temperature": 0.1,
                }
            )
            parsed = response.parsed.model_dump() if hasattr(response, "parsed") and response.parsed else None
            if not parsed and response.text:
                parsed = json.loads(response.text)

            if parsed:
                return {
                    "previous_owners": parsed.get("previous_owners") or nlp_result["previous_owners"],
                    "new_owners": parsed.get("new_owners") or nlp_result["new_owners"],
                    "transaction_type": parsed.get("transaction_type") or nlp_result["transaction_type"],
                    "entry_date": parsed.get("entry_date") or "",
                    "remarks_summary": parsed.get("remarks_summary") or nlp_result["remarks_summary"],
                    "source": f"gemini_{model_name}"
                }
        except Exception as e:
            logger.warning(f"Gemini model {model_name} failed on text extraction: {e}")
            continue

    logger.warning("All Gemini candidate models failed for text extraction. Falling back to NLP parser.")
    return nlp_result

async def extract_mutation_data(image_path: str, api_key: Optional[str] = None) -> dict:
    """
    Extracts mutation facts from a scanned VF-6 handwritten deed image using Gemini Vision API.
    """
    client = get_gemini_client(api_key)
    if not client:
        logger.info(f"GEMINI_API_KEY not configured or client unavailable. Skipping AI OCR for {image_path}")
        return {"entries": [], "warning": "AI OCR skipped (no API key configured)"}

    img_file = Path(image_path)
    if not img_file.exists():
        logger.error(f"Deed image file not found for OCR: {image_path}")
        return {"entries": [], "error": "Image file not found"}

    prompt = """
    You are an expert legal data extraction engine specializing in historical Gujarati land records (AnyRoR mutation entries). 
    Your sole function is to read the provided image of an authentic handwritten land mutation page (VF-6) and extract all legal facts into strict JSON.

    CRITICAL RULES:
    1. LIST FORMATTING: You MUST separate multiple names and survey numbers with a comma and space. Example: "રતુભાઈ, જેસંગભાઈ, ગોપાલભાઈ".
    2. GUJARATI SCRIPT: Keep all names, survey numbers, and transaction types in native Gujarati script.
    3. NODE IDENTIFICATION:
       - 'previous_owners': Parties giving up rights (sellers, deceased ancestor, mortgagor).
       - 'new_owners': Parties acquiring rights (buyers, legal heirs, cooperative bank/society).
    4. TRANSACTION TYPE: Identify the primary legal event (e.g. વારસાઈ, વેચાણ, બોજો, હક કમી).
    5. REMARKS: Provide a single concise sentence in Gujarati summarizing the deed.
    """

    with open(img_file, "rb") as f:
        image_bytes = f.read()

    candidate_models = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-1.5-flash"]
    for model_name in candidate_models:
        try:
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=[
                    prompt, 
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg") 
                ],
                config={
                    "response_mime_type": "application/json",
                    "response_schema": PageExtraction,
                    "temperature": 0.1, 
                }
            )
            parsed = response.parsed.model_dump() if hasattr(response, "parsed") and response.parsed else None
            if not parsed and response.text:
                parsed = json.loads(response.text)

            if parsed and parsed.get("entries"):
                for entry in parsed["entries"]:
                    entry["source"] = f"gemini_{model_name}"
                return parsed
        except Exception as e:
            logger.warning(f"Gemini model {model_name} failed for image OCR {image_path}: {e}")
            continue

    return {"entries": [], "error": "OCR extraction failed across candidate models"}