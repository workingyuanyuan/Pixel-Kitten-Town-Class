import os
import glob
import json
import uuid
import datetime
import zipfile
import xml.etree.ElementTree as ET
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

DOCX_DIR = r'C:\Users\YYuan\Documents\Edu\Sources\115\班級成績登記表'
OUTPUT_DIR = r'data\11501'

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def parse_docx(fpath):
    students = {}
    with zipfile.ZipFile(fpath) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        for table in root.findall('.//w:tbl', NS):
            for row in table.findall('.//w:tr', NS):
                cells = row.findall('.//w:tc', NS)
                if len(cells) >= 2:
                    c0 = ''.join([e.text for e in cells[0].findall('.//w:t', NS) if e.text]).strip()
                    c1 = ''.join([e.text for e in cells[1].findall('.//w:t', NS) if e.text]).strip()
                    if c0.isdigit() and c1:
                        seat = int(c0)
                        students[seat] = c1
    return students

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    docx_files = sorted(glob.glob(os.path.join(DOCX_DIR, '*.docx')))
    
    tz = datetime.timezone(datetime.timedelta(hours=8))
    now = datetime.datetime.now(tz)
    iso_now = now.isoformat(timespec='seconds')
    
    summary = []
    
    for fpath in docx_files:
        base_name = os.path.basename(fpath)
        raw_class_name = base_name.replace('成績登記表.docx', '').strip()
        class_name = f"11501-{raw_class_name}"
        
        roster = parse_docx(fpath)
        if not roster:
            print(f"警告：{base_name} 沒有解析到任何學生名單！", file=sys.stderr)
            continue
            
        json_path = os.path.join(OUTPUT_DIR, f"{class_name}.json")
        
        # 檢查是否已存在既有檔案（保留既有的 student id, xp 與 log）
        existing_data = None
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
                
        existing_students = {s['seat']: s for s in existing_data.get('students', [])} if existing_data else {}
        
        students_list = []
        for seat in sorted(roster.keys()):
            name = roster[seat]
            if seat in existing_students:
                s = existing_students[seat]
                s['name'] = name
                students_list.append(s)
            else:
                student_id = f"s{uuid.uuid4().hex[:8]}"
                students_list.append({
                    "id": student_id,
                    "seat": seat,
                    "name": name,
                    "xp": 0,
                    "note": ""
                })
                
        class_data = {
            "version": 2,
            "class_id": class_name,
            "updated_at": iso_now,
            "students": students_list,
            "log": existing_data.get('log', []) if existing_data else []
        }
        
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(class_data, f, ensure_ascii=False, indent=2)
            
        summary.append((class_name, len(students_list), json_path))
        print(f"已建立 {class_name} 資料檔 ({len(students_list)} 位學生) -> {json_path}")

    print("\n--- 匯入總結 ---")
    for cname, count, path in summary:
        print(f"• 班級：{cname}，人數：{count} 人，檔案：{path}")

if __name__ == '__main__':
    main()
