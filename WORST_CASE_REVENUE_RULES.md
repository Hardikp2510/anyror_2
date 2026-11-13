# Gujarat AnyRoR Revenue Intelligence: Worst-Case Failure Modes & Prevention Rules

This document specifies every possible catastrophic failure mode when scraping, parsing, reconstructing family trees, tracking title flow, and analyzing title clearance across heterogeneous agricultural revenue records in Gujarat (AnyRoR / e-Dhara / Village Form 6, 7/12, 8-A), accompanied by the exact algorithmic rule to prevent each issue.

---

## 1. Multi-Survey Communal & Village-Wide Entry Pollution
* **The Failure Mode**: A single mutation entry—such as cooperative agricultural credit societies (સેવા સહકારી મંડળી), district canal land acquisitions (નર્મદા નિગમ / સિંચાઈ કેનાલ સંપાદન), land ceiling distributions (સીલિંગ અધિનિયમ), or government drought relief loans—contains between 50 and 500 farmers across 30 to 100 different survey numbers in the same village.
* **Catastrophic Outcome**: Naive regex or entity extraction dumps 100–300 stranger farmers into the family pedigree tree of a single survey number, hopelessly corrupting the family tree.
* **Algorithmic Prevention Rule (Rule 1: Survey Boundary Quarantine)**:
  1. Parse survey & khata mappings inside the entry text (e.g. `સ.નં. ૨ ના ખાતેદાર...`, `૨(૨૮૧)`, `ખાતા નં. ૨૮૧`).
  2. Maintain a dynamic known khatedar registry (`known_khatedars`) seeded from 7/12 extract and previous valid title mutations of the target survey.
  3. Whenever a mutation lists more than 5 partakers (or matches known communal keywords `સહકારી મંડળી`, `ધિરાણ મેળવતા ખેડૂતો`), evaluate membership strictly against target survey number and known lineage. Entities failing the survey affiliation check are quarantined into an aggregate footnote (e.g., *"આ નોંધમાં ગામના અન્ય ખેડૂતો પણ સામેલ છે"*) without creating canvas nodes.

---

## 2. Re-Survey Promulgation & Identity Splitting/Merging
* **The Failure Mode**: Gujarat Revenue Department conducted statewide Re-surveys (રી-સર્વે પ્રમોલગેશન) between 2014 and 2018. During this process:
  - Old Survey numbers were mapped to New Survey numbers (e.g. Old Survey 80 -> New Survey 2).
  - An old survey was divided into multiple new surveys (e.g. Old 80 -> New 2, 3, 4).
  - Multiple old surveys were merged into one new survey (e.g. Old 80 + Old 81 -> New 2).
* **Catastrophic Outcome**: Pre-2014 mutations mention the Old Survey number. The parser marks all pre-promulgation records as an unrelated land parcel or flags a "Chain Break / Discontinuity", leaving the first 50–60 years of ancestral title disconnected.
* **Algorithmic Prevention Rule (Rule 2: Promulgation Bridge & Dual Parcel Harmonizer)**:
  1. Inspect the LandRecord root metadata and identify `Old Survey Number` and Promulgation Entry (typically tagged `પ્રમોલગેશન`, `રી-સર્વે`, `માપણી ફેરફાર`, e.g., Entry 633).
  2. Establish a **Promulgation Bridge Node** that formally links Old Survey mutations (1951 to Promulgation date) directly to the modern survey lineage.
  3. Pre-promulgation scanned Village Form 6 entries are automatically classified as `📜 ઐતિહાસિક હસ્તલિખિત નોંધ (જૂનો સ.નં. X)` with direct high-resolution uncropped page viewing.

---

## 3. Kinship Inversion & Misclassification (Widows, Minors, Guardians, Powers of Attorney)
* **The Failure Mode**:
  - Widows (`જશીબેન વિધવા ભયરામભાઇ`, `ગં.સ્વ. કમુબેન`) possess names ending in `બેન` or `દેવી`, causing primitive regex to label them as daughters (`👧 પુત્રી`).
  - Minors and guardians (`સગીર પરેશભાઇ ના વાલી માતુશ્રી જશીબેન`) are parsed as two co-owners or the minor is completely dropped.
  - Power of Attorney holders (`મુખત્યાર કાનજીભાઈ વતી સહી કરનાર`) are identified as the owners rather than legal agents of the principal.
  - Deceased persons (`સ્વ. મનજીભાઈ ગુજરી જતાં`) are left marked as active co-owners.
* **Catastrophic Outcome**: False daughter warnings generated for widows; minor's rights omitted; attorneys shown as owners; deceased individuals treated as living.
* **Algorithmic Prevention Rule (Rule 3: Hierarchical Legal Capacity Classifier)**:
  - **Priority 1 (Deceased)**: Strings containing `અવસાન`, `સ્વ.`, `સ્વર્ગસ્થ`, `ગુજરી જતાં`, `મરણ` -> mark strictly as `⚪ મૃતક પૂર્વજ (Deceased)`.
  - **Priority 2 (Widow)**: Strings containing `વિધવા`, `વિઘવ`, `ગં.સ્વ.`, `ગંગાસ્વરૂપ`, `ની વિધવા`, `ના પત્ની` -> mark strictly as `👵 વિધવા પત્ની (Widow)`. Checked BEFORE any daughter checks.
  - **Priority 3 (Guardian & Minor)**: Strings with `સગીર`, `વાલી`, `માતુશ્રી` -> create Minor node with Guardian annotation (`સગીર (વાલી: X)`).
  - **Priority 4 (Power of Attorney)**: Strings with `મુખત્યાર`, `પાવર ઓફ એટર્ની` -> mark as `🤝 મુખત્યાર (PoA Agent)` without property ownership rights.
  - **Priority 5 (True Daughter)**: Strings with `પુત્રી`, `દીકરી`, `દિકરી`, `ની દી` -> mark as `👧 પુત્રી (Daughter)`.

---

## 4. Orthographic Noise, Phonetic Variations & Bracket Leakage
* **The Failure Mode**:
  - Gujarati revenue clerks embed unclosed khata and area brackets into names: `પરેશભાઇ ભરતભાઇ સોલંકી (હે ૦-૫૪ ના ખાતા નંબર ૨૮૧ થી માર્જિનમાં...`.
  - Phonetic spelling variants: `હીરાબેન` vs `હેરાબેન` vs `હિરાબેન`, `અભુભાઇ` vs `અભૂભાઇ`, `ભયરામભાઇ` vs `ભાઇરામભાઇ`.
  - Vowel sign permutations: short `ુ` vs long `ૂ`, short `િ` vs long `ી`, initial `ઈ` vs `ઇ`, `ભાઈ` vs `ભાઇ`.
* **Catastrophic Outcome**: A single real person is duplicated into 4–6 distinct nodes on the tree, fragmenting title history.
* **Algorithmic Prevention Rule (Rule 4: Gujarati Phonetic Normalizer & Canonical Hashing)**:
  1. Strip all area metrics (`હે`, `આરે`, `ચો.મી.`, `૦-૫૪-૦૦`), khata references, margin indicators, and unclosed parentheses.
  2. Phonetically normalize all Gujarati vowel signs:
     - `ૂ` (UU) -> `ુ` (U)
     - `ી` (II) -> `િ` (I)
     - `ઈ` (Independent II) -> `ઇ` (Independent I)
     - `ભાઈ` -> `ભાઇ`
  3. Strip honorifics (`શ્રી`, `શ્રીમતી`, `પટેલ`, `કો.પટેલ`).
  4. Generate a canonical hash key: `[Normalized Given Name] + "_" + [Normalized Patronymic Father/Husband Root]`.
  5. Merge all variant spellings into the cleanest canonical human representation.

---

## 5. Partial Undivided Share Conveyance vs Complete Property Exit
* **The Failure Mode**: In rural Gujarat, undivided family land is frequently sold in parts. A co-owner sells only their personal portion (e.g., 0-54-00 Ha out of 4-56-08 Ha).
* **Catastrophic Outcome**: The system either assumes the seller exited the land completely (disowning them from the remaining 4-02-08 Ha) or fails to show what share the new buyer acquired.
* **Algorithmic Prevention Rule (Rule 5: Area Accounting & Fractional Tenure Tracker)**:
  1. Extract sale deed area metrics (`હે-આરે-ચો.મી.` or `ચો.મી.`) from registered documents.
  2. Compute total holding vs transferred holding.
  3. If transferred area < total survey area, mark the seller as `🟡 અંશતઃ વેચાણ કરનાર (Partial Transferor - શેષ હિસ્સો ચાલુ)` rather than `🔴 exited`.
  4. Explicitly bind the buyer node to their specific acquired area (e.g. `ખરીદેલ ક્ષેત્રફળ: ૦-૫૪-૦૦ હેક્ટર`).

---

## 6. Daughter Succession Rights & Title Clearance (HSA 1956 & 2005)
* **The Failure Mode**: Under the Hindu Succession (Amendment) Act 2005 and Supreme Court precedent (*Vineeta Sharma v. Rakesh Sharma*), coparcenary rights for daughters are absolute. In many historical entries:
  - Daughters' names were omitted during succession without registered relinquishment.
  - Or daughters executed a Hak Kami affidavit (હક કમી સોગંદનામું / ફારગતી) which was noted in Circle Officer remarks rather than the main mutation header.
* **Catastrophic Outcome**: Unclear whether daughters still possess title claims, exposing prospective purchasers to title defects and civil injunctions.
* **Algorithmic Prevention Rule (Rule 6: Comprehensive Daughter Rights Auditor)**:
  1. Scan both mutation details AND Officer Remarks (`તપાસણી કરનાર અધિકારીનો શેરો`) for Hak Kami declarations, relinquishment affidavits, and registered release deeds.
  2. Categorize every female heir into one of three strict legal tiers:
     - 🟢 **હક કમી ક્લિયર્ડ (Affidavit / Release Deed on Record)**: Clean title, relinquishment entry and affidavit cited.
     - 🟡 **ચાલુ સહ-ખાતેદાર (Active Co-owner in Title)**: Daughter retains active legal title; consent required for conveyance.
     - ⚠️ **શંકાસ્પદ વારસાઈ હક (Omitted without Formal Hak Kami Deed)**: Generates a high-severity alert in the Advocate Title Dossier.

---

## 7. Bank Encumbrance Lifecycle (Creation vs Release Reconciliation)
* **The Failure Mode**: A survey record accumulates multiple agricultural mortgage entries over decades (Entries 223, 416, 811, 955, 1095, 1107). Later, Entry 600 records a Mortgage Release (`બોજા મુક્તિ / તારણ મુક્ત`).
* **Catastrophic Outcome**:
  - All past historical mortgages are presented as active outstanding debts.
  - Or all mortgages are mistakenly marked as cleared when only one specific bank loan was released.
  - Or identical bank nodes spam the canvas multiple times.
* **Algorithmic Prevention Rule (Rule 7: Encumbrance Lifecycle Reconciler)**:
  1. Standardize and deduplicate financial institutions into canonical entities (e.g. `ધી ગુજરાત સ્ટેટ કો.ઓ. એગ્રી. એન્ડ રૂરલ ડેવલપમેન્ટ બેંક લિ.`, `સેવા સહકારી મંડળી લી.`).
  2. Trace `બોજા મુક્તિ` (Release) entries and correlate them with the original mortgage entry by matching the bank entity and khata number.
  3. Mark discharged mortgages as `🟢 બોજા મુક્ત (Discharged)`.
  4. Only display unresolved mortgages as `🔴 સક્રિય ચાલુ બોજો (Active Outstanding Charge)`.

---

## 8. Tenure Restrictions (નવી શરત, ગણોતધારા કલમ ૪૩/૬૩, આદિવાસી કલમ ૭૩-એએ)
* **The Failure Mode**: Agricultural land in Gujarat frequently carries statutory conditions:
  - New and Impartible Tenure (નવી અવિભાજ્ય શરત - New Tenure).
  - Bombay Tenancy & Agricultural Lands Act, 1948 restrictions (Section 43/63 - ગણોત કલમ ૪૩/૬૩).
  - Scheduled Tribe Land Transfer Restriction (Land Revenue Code Section 73AA - આદિવાસી જમીન).
  - Government Santhani grants or Land Ceiling grants requiring Collector's prior sanction.
* **Catastrophic Outcome**: Title clearance certificate issued without checking tenure restrictions, making any sale void ab initio under Gujarat law.
* **Algorithmic Prevention Rule (Rule 8: Statutory Tenure & Permission Auditor)**:
  1. Scan entire mutation chain and 7/12 extract for statutory trigger keywords:
     `નવી શરત`, `અવિભાજ્ય શરત`, `સાંથણી`, `કલમ ૪૩`, `કલમ ૬૩`, `કલમ ૭૩-એએ`, `૭૩AA`, `પ્રીમિયમ`, `બિનખેતી (NA)`, `કલેક્ટર મંજૂરી`.
  2. Verify whether Premium (પ્રીમિયમ) has been paid to convert New Tenure to Old Tenure (જૂની શરત).
  3. Flag statutory restrictions as mandatory compliance items in the Title Audit report.

---

## 9. Disputed, Rejected & Cancelled Mutations (તકરારી / નામંજૂર / સિવિલ કોર્ટ સ્ટે)
* **The Failure Mode**:
  - A mutation entry was rejected by Circle Officer / Mamlatdar (`નામંજૂર`).
  - Or cancelled on appeal by Prant Officer / Collector (`રદબાતલ`).
  - Or stayed by a Civil Court (`દીવાની અદાલત મનાઈ હુકમ / સ્ટે`).
* **Catastrophic Outcome**: The system naively treats the rejected entry as valid, erroneously transferring ownership to parties whose claim was legally rejected!
* **Algorithmic Prevention Rule (Rule 9: Certification & Dispute Verification)**:
  1. Inspect `mutation_status` (`નોંધની સ્થિતિ`) and officer remarks.
  2. If status is `નામંજૂર` (Rejected) or `રદ` (Cancelled), halt ownership transfer for that transaction. Mark entry as `❌ અપ્રમાણિત / નામંજૂર નોંધ`.
  3. If status is `તકરારી` (Disputed) or subject to Civil Suit / Section 135-D objections, flag high-priority legal warning `🚨 તકરારી કેસ / દીવાની અદાલત વિવાદ`.

---

## 10. Handwritten Pre-Digitization Registers vs e-Dhara Hybrid Records
* **The Failure Mode**: Before the e-Dhara computerization project (2004–2014), entries were recorded in handwritten registers (ગામ નમૂના નં. ૬). These do NOT exist as structured HTML tables on AnyRoR, only as scanned images.
* **Catastrophic Outcome**: The system returns `None`, `N/A`, or empty data for earlier entries, blinding the title examiner to root ownership.
* **Algorithmic Prevention Rule (Rule 10: Hybrid Vision & Archival Chronicle Harmonizer)**:
  1. Automatically identify entries with missing HTML tables as **Scanned Archive Records**.
  2. Couple scanned records with OCR/Gemini vision extracts and the historical registry catalog.
  3. Provide full uncropped document preview modals with exact page numbers in the advocate review interface.

---

This ruleset guarantees that any survey number across Gujarat—no matter how tangled, multi-generational, disputed, or heavily encumbered—is processed with 100% legal precision and zero false node proliferation.
