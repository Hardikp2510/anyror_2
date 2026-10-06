import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

def test():
    url = 'http://localhost:8000/api/v1/mutations/survey/2/pedhinamu-tree?village_code=001'
    data = json.loads(urllib.request.urlopen(url).read())
    print('=== FRESH RELOADED PEDHINAMU TREE ===')
    print('Total Persons in Land:', data.get('total_persons'))
    print('Active Owners Count:', data.get('active_owners_count'))
    print('Exited Persons Count:', data.get('exited_persons_count'))
    print('Daughters Count:', data.get('daughters_count'))
    print('Active Encumbrances:', data.get('active_encumbrances_count'))
    print('Institutions count:', len(data.get('institutions', [])))
    print('\nPersons:')
    for p in data.get('persons', []):
        print(f"  {p.get('name')}  ==>  {p.get('relation_label')}  ==>  {p.get('status_label')}  (Entry: {p.get('entry_no')}, Exit: {p.get('exit_entry_no')})")
    print('\nInstitutions:')
    for inst in data.get('institutions', []):
        print(f"  {inst.get('name')}  ==>  {inst.get('institution_type')}")
    print('\nIntegrity Report:')
    for r in data.get('integrity_report', []):
        print(f"  [{r.get('severity')}] {r.get('title')}: {r.get('description')}")
    print('\nMutation Flow / Timeline Entries Count:', len(data.get('mutation_flow', [])))

if __name__ == '__main__':
    test()

