import json
import os
import glob

def run():
    with open('/app/scripts/survey_2_db_dump.json', 'r', encoding='utf-8') as f:
        entries = json.load(f)

    print(f"Total entries in DB: {len(entries)}")

    # 1. Sale entries
    print("\n--- 1. SALE (વેચાણ) ENTRIES ---")
    sales = [e for e in entries if e.get('scraped_html') and 'વેચાણ' in (e['scraped_html'].get('transaction_type') or '')]
    for s in sales:
        e_no = s['entry_number']
        date = s['scraped_html'].get('entry_date')
        prev_ai = s['ai_draft'].get('previous_owners', [])
        new_ai = s['ai_draft'].get('new_owners', [])
        print(f"Entry #{e_no} ({date}):")
        print(f"  AI Prev Owners ({len(prev_ai)}): {prev_ai}")
        print(f"  AI New Owners  ({len(new_ai)}): {new_ai}")

    # 2. Hak Kami (હક કમી) entries
    print("\n--- 2. HAK KAMI (હક કમી) ENTRIES ---")
    hak_kami = [e for e in entries if e.get('scraped_html') and 'હક કમી' in (e['scraped_html'].get('transaction_type') or '')]
    for h in hak_kami:
        e_no = h['entry_number']
        date = h['scraped_html'].get('entry_date')
        prev_ai = h['ai_draft'].get('previous_owners', [])
        new_ai = h['ai_draft'].get('new_owners', [])
        print(f"Entry #{e_no} ({date}):")
        print(f"  AI Prev Owners ({len(prev_ai)}): {prev_ai}")
        print(f"  AI New Owners  ({len(new_ai)}): {new_ai}")

    # 3. Boja Dakhal / Mukti entries
    print("\n--- 3. BOJA / MORTGAGE ENTRIES ---")
    boja_d = [e for e in entries if e.get('scraped_html') and 'બોજો દાખલ' in (e['scraped_html'].get('transaction_type') or '')]
    boja_m = [e for e in entries if e.get('scraped_html') and 'બોજા મુક્તિ' in (e['scraped_html'].get('transaction_type') or '')]
    print(f"Boja Dakhal (Loan Entered): {len(boja_d)} entries -> {[e['entry_number'] for e in boja_d]}")
    print(f"Boja Mukti (Loan Cleared):  {len(boja_m)} entries -> {[e['entry_number'] for e in boja_m]}")

    # 4. Old scanned historical entries
    print("\n--- 4. OLD SCANNED HISTORICAL ENTRIES ---")
    old_entries = [e for e in entries if not e.get('scraped_html')]
    print(f"Total old scanned entries: {len(old_entries)} -> {[e['entry_number'] for e in old_entries]}")
    
    # 5. Image files on disk
    print("\n--- 5. IMAGE FILES IN backend/output/survey_2 ---")
    img_files = glob.glob('/app/output/survey_2/*.jpg')
    print(f"Total JPG files on disk: {len(img_files)}")
    
    # Group by entry number
    entry_imgs = {}
    for img in img_files:
        bn = os.path.basename(img)
        # e.g. mutation_entry_1_p0.jpg, mutation_entry_123.jpg, mutation_entry_123_crop_0.jpg
        parts = bn.replace('mutation_entry_', '').split('.')[0].split('_')
        entry_num = parts[0]
        entry_imgs.setdefault(entry_num, []).append(bn)
    
    # 6. Final verified data check
    print("\n--- 6. FINAL VERIFIED DATA & AI DRAFT COMPARISON ---")
    for e in entries:
        e_no = e['entry_number']
        fin = e.get('final_verified') or {}
        ai = e.get('ai_draft') or {}
        t_type = fin.get('transaction_type') or ai.get('transaction_type')
        p_owners = fin.get('previous_owners') or ai.get('previous_owners')
        n_owners = fin.get('new_owners') or ai.get('new_owners')
        print(f"Entry #{e_no:>4} | Type: {t_type:<25} | Prev: {len(p_owners or [])} | New: {len(n_owners or [])} | Img: {'YES' if e.get('image_file_path') else 'NO'}")

if __name__ == '__main__':
    run()
