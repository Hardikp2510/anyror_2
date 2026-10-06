import re
from bs4 import BeautifulSoup
from pydantic import BaseModel
from typing import Dict, Any, List
from app.utils.encoding import fix_mojibake

class ParsedRecordResult(BaseModel):
    status: str
    survey_no: str
    extracted_data: Dict[str, Any]
    pdf_postback_value: str | None = None

class IntegratedParser:
    
    @staticmethod
    def _extract_table_data(soup: BeautifulSoup, table_id: str) -> List[Dict[str, str]]:
        """Helper to extract HTML tables into a clean list of dictionaries."""
        table = soup.find('table', id=table_id)
        if not table:
            return []
            
        headers = [th.get_text(strip=True) for th in table.find_all('th')]
        rows = []
        
        # Skip the first row since it contains headers
        for tr in table.find_all('tr')[1:]:
            # separator=" | " ensures text separated by <br> tags doesn't mash together
            cells = [td.get_text(separator=" | ", strip=True) for td in tr.find_all('td')]
            if cells:
                # Map headers to cell values
                row_data = {headers[i] if i < len(headers) else f"Column_{i}": cell for i, cell in enumerate(cells)}
                rows.append(row_data)
                
        return rows

    @staticmethod
    def _extract_span_text(soup: BeautifulSoup, span_id: str) -> str:
        """Helper to extract text from a specific span ID."""
        element = soup.find('span', id=span_id)
        return element.get_text(strip=True) if element else "N/A"

    @classmethod
    def parse_response(cls, html_content: str) -> ParsedRecordResult:
        soup = BeautifulSoup(html_content, 'lxml')

        # Check if CAPTCHA failed
        error_msg = soup.find(id="lblMsg")
        if error_msg and "captcha" in error_msg.text.lower():
            return ParsedRecordResult(status="CAPTCHA_FAILED", survey_no="", extracted_data={})

        # --- 1. EXTRACT BASIC LAND DETAILS ---
        basic_details = {
            "Processing Date": cls._extract_span_text(soup, "ContentPlaceHolder1_lblProc_dt"),
            "District": cls._extract_span_text(soup, "ContentPlaceHolder1_lblDistrict"),
            "Taluka": cls._extract_span_text(soup, "ContentPlaceHolder1_lblTaluka"),
            "Village": cls._extract_span_text(soup, "ContentPlaceHolder1_lblVillage"),
            "Survey Number": cls._extract_span_text(soup, "ContentPlaceHolder1_lblSurveyNo"),
            "UPIN": cls._extract_span_text(soup, "ContentPlaceHolder1_lbl_upin"),
            "Total Area": cls._extract_span_text(soup, "ContentPlaceHolder1_lblTotArea"),
            "Total Assessment": cls._extract_span_text(soup, "ContentPlaceHolder1_lblTotAss"),
            "Tenure": cls._extract_span_text(soup, "ContentPlaceHolder1_lblTenure"),
            "Land Use": cls._extract_span_text(soup, "ContentPlaceHolder1_lblLanduse"),
            "Farm Name": cls._extract_span_text(soup, "ContentPlaceHolder1_lblFarmName"),
            "Remarks": cls._extract_span_text(soup, "ContentPlaceHolder1_lblRemarks")
        }

        # --- 2. EXTRACT ALL TABLES ---
        # Ownership
        ownership_details = cls._extract_table_data(soup, "ContentPlaceHolder1_grdKhata")
        
        # Boja and Loans
        boja_details = cls._extract_table_data(soup, "ContentPlaceHolder1_grdBojaOthr")
        
        # Tenants
        tenant_details = cls._extract_table_data(soup, "ContentPlaceHolder1_gvGanot")
        
        # Crops
        crop_details = cls._extract_table_data(soup, "ContentPlaceHolder1_gvCrop")
        
        # Mutations / Computer Entries (The most important part!)
        mutation_details = cls._extract_table_data(soup, "ContentPlaceHolder1_grdcmputerentry")

        # --- 3. EXTRACT EXTRA STATUS FIELDS ---
        extra_status = {
            "Jantri Detail": cls._extract_span_text(soup, "ContentPlaceHolder1_lblJantri"),
            "Sub Registrar Deed": cls._extract_span_text(soup, "ContentPlaceHolder1_lblGarviProDetail"),
            "iRCMS Revenue Case": cls._extract_span_text(soup, "ContentPlaceHolder1_lblIrcm"),
            "High/Civil Court Case": cls._extract_span_text(soup, "ContentPlaceHolder1_lblHighCourt"),
            "Panchayat Tax": cls._extract_span_text(soup, "ContentPlaceHolder1_lbl_panchayat_tax"),
            "Electricity Bill": cls._extract_span_text(soup, "ContentPlaceHolder1_lbl_electricity_bill"),
            "Water Bill": cls._extract_span_text(soup, "ContentPlaceHolder1_lbl_water_bill")
        }

        # --- 4. EXTRACT PROMOLGATION & OLD SURVEY DETAILS ---
        page_text = soup.get_text()

        # Promolgation Note & Date e.g. (પ્રમોલગેશન નોંધ નં.૬૩૩ તા.૨૦/૧૨/૨૦૧૪)
        prom_note_match = re.search(r'પ્રમોલગેશન\s*નોંધ\s*નં[.:\s]*([^\sતા\)]+)\s*તા[.:\s]*([^\)\n\r]+)', page_text)
        prom_note_no = prom_note_match.group(1).strip() if prom_note_match else cls._extract_span_text(soup, "ContentPlaceHolder1_lblPromolNo")
        prom_date = prom_note_match.group(2).strip() if prom_note_match else cls._extract_span_text(soup, "ContentPlaceHolder1_lblPromolDate")

        # Old Survey / Block Number e.g. Old Survey/Block Number (જુનો સરવે/બ્લોક નંબર) : ૮૨/ખ
        old_survey_match = re.search(r'(?:Old\s*Survey/Block\s*Number|જુનો\s*સરવે/બ્લોક\s*નંબર)\s*[:：]\s*([^\n\r\|]+)', page_text, re.IGNORECASE)
        old_survey_no = old_survey_match.group(1).strip() if old_survey_match else cls._extract_span_text(soup, "ContentPlaceHolder1_lblOldSurveyNo")
        if old_survey_no == "N/A":
            old_survey_span = soup.find('span', id=re.compile(r'OldSurvey|oldsurvey', re.I))
            if old_survey_span:
                old_survey_no = old_survey_span.get_text(strip=True)

        # Old Survey Related Mutation Numbers (જુના સરવે નંબર ને લગત નોંધ નંબરો)
        old_mutations_match = re.search(r'જુના\s*સરવે\s*નંબર\s*ને\s*લગત\s*નોંધ\s*નંબરો\s*[:：]\s*([^\*\n\r\|]+)', page_text)
        old_survey_mutations = [x.strip() for x in old_mutations_match.group(1).split(",") if x.strip()] if old_mutations_match else []

        # Old Survey Encumbrance Numbers (જુના સરવે નંબર ને લગત બીજા હકો અને બોજા ના નોંધ નંબરો)
        old_boja_match = re.search(r'જુના\s*સરવે\s*નંબર\s*ને\s*લગત\s*બીજા\s*હકો\s*અને\s*બોજા\s*ના\s*નોંધ\s*નંબરો\s*[:：]\s*([^\*\n\r\|]+)', page_text)
        old_survey_boja = [x.strip() for x in old_boja_match.group(1).split(",") if x.strip()] if old_boja_match else []

        # Parcel Map / Sketch Image
        sketch_img = soup.find('img', id=re.compile(r'Map|Sketch|FMB', re.I)) or soup.find('img', src=re.compile(r'GetMap|SurveyMap|MapHandler|DrawMap', re.I))
        map_url = sketch_img.get('src') if sketch_img else None

        promolgation_details = {
            "Promolgation_Note_Number": prom_note_no if prom_note_no != "N/A" else None,
            "Promolgation_Date": prom_date if prom_date != "N/A" else None,
            "Old_Survey_Number": old_survey_no if old_survey_no != "N/A" else None,
            "Old_Survey_Mutations": old_survey_mutations,
            "Old_Survey_Encumbrances": old_survey_boja,
            "Parcel_Map_Url": map_url
        }

        # Enrich basic details with Old Survey reference
        if old_survey_no and old_survey_no != "N/A":
            basic_details["Old Survey Number"] = old_survey_no

        # --- 5. COMPILE MASTER JSON ---
        master_data = {
            "Basic_Details": basic_details,
            "Promolgation_Details": promolgation_details,
            "Ownership_Details": ownership_details,
            "Boja_and_Rights": boja_details,
            "Tenant_Details": tenant_details,
            "Crop_Details": crop_details,
            "Mutation_Entries": mutation_details,
            "Other_Statuses": extra_status
        }

        # Extract PDF postback if it exists (for downloading the document)
        pdf_postback = None
        pdf_link = soup.find('a', href=lambda href: href and "DownloadPDF" in href)
        if pdf_link:
            pdf_postback = pdf_link['href']

        # Clean any CP437 mojibake to pure Gujarati UTF-8
        master_data = fix_mojibake(master_data)

        return ParsedRecordResult(
            status="SUCCESS",
            survey_no=basic_details["Survey Number"],
            extracted_data=master_data,
            pdf_postback_value=pdf_postback
        )