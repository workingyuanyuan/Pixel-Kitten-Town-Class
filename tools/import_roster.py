import argparse
import sys
import json
import os
import uuid
import datetime
import shutil

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description="匯入班級名單")
    parser.add_argument('--input', default='tools/names.txt', help='名單文字檔路徑 (預設: tools/names.txt)')
    parser.add_argument('--class-id', default='class-data', help='班級 ID (預設: class-data)')
    parser.add_argument('--data-dir', default='data/11501', help='資料目錄 (預設: data/11501)')
    parser.add_argument('--dry-run', action='store_true', help='測試執行，不會實際寫入檔案')
    args = parser.parse_args()

    input_path = args.input
    class_id = args.class_id
    data_dir = args.data_dir
    is_dry_run = args.dry_run

    if not os.path.exists(input_path):
        print(f"錯誤：找不到名單檔案 {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f if line.strip()]

    if not lines:
        print("錯誤：名單檔案是空的", file=sys.stderr)
        sys.exit(1)

    parsed_roster = {}
    for i, line in enumerate(lines):
        if ',' in line:
            parts = line.split(',', 1)
            try:
                seat = int(parts[0].strip())
            except ValueError:
                print(f"錯誤：無效的座號格式 '{line}'", file=sys.stderr)
                sys.exit(1)
            name = parts[1].strip()
        else:
            seat = i + 1
            name = line.strip()

        if seat in parsed_roster:
            print(f"錯誤：座號重複 (座號 {seat})", file=sys.stderr)
            sys.exit(1)
        parsed_roster[seat] = name

    data_path = os.path.join(data_dir, f"{class_id}.json")
    
    tz = datetime.timezone(datetime.timedelta(hours=8))
    now = datetime.datetime.now(tz)
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    iso_now = now.isoformat(timespec='seconds')

    existing_data = None
    if os.path.exists(data_path):
        with open(data_path, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)

    if existing_data:
        data = existing_data
    else:
        data = {
            "version": 2,
            "class_id": class_id,
            "updated_at": iso_now,
            "students": [],
            "log": []
        }

    existing_students = {s['seat']: s for s in data.get('students', [])}
    
    added_count = 0
    renamed_count = 0
    kept_count = 0
    missing_count = 0

    new_students = []
    all_seats = set(parsed_roster.keys()) | set(existing_students.keys())
    
    for seat in sorted(all_seats):
        if seat in existing_students and seat in parsed_roster:
            s = existing_students[seat]
            old_name = s['name']
            new_name = parsed_roster[seat]
            if old_name != new_name:
                renamed_count += 1
                prefix = "預計更新" if is_dry_run else "更新"
                print(f"{prefix}: 座號 {seat} - '{old_name}' -> '{new_name}'")
            s['name'] = new_name
            new_students.append(s)
        elif seat in existing_students and seat not in parsed_roster:
            kept_count += 1
            s = existing_students[seat]
            print(f"警告：資料檔中存在座號 {seat} ({s['name']})，但名單中沒有，將予以保留不刪除。")
            new_students.append(s)
        elif seat not in existing_students and seat in parsed_roster:
            added_count += 1
            new_name = parsed_roster[seat]
            prefix = "預計新增" if is_dry_run else "新增"
            print(f"{prefix}: 座號 {seat} - '{new_name}'")
                
            student_id = f"s{uuid.uuid4().hex[:8]}"
            new_students.append({
                "id": student_id,
                "seat": seat,
                "name": new_name,
                "xp": 0,
                "note": ""
            })

    data['students'] = new_students
    data['updated_at'] = iso_now

    if is_dry_run:
        print(f"\n[測試執行結果] 預計新增: {added_count}, 預計更新: {renamed_count}, 警告保留: {kept_count}")
        return

    if existing_data:
        backup_dir = os.path.join(data_dir, "backups")
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, f"{class_id}-import-{timestamp}.json")
        shutil.copy2(data_path, backup_path)
        print(f"已備份原始資料至 {backup_path}")

    os.makedirs(os.path.dirname(os.path.abspath(data_path)), exist_ok=True)
    tmp_path = f"{data_path}.tmp"
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, data_path)

    print(f"\n[匯入完成] 新增: {added_count}, 更新: {renamed_count}, 警告保留: {kept_count}")

if __name__ == '__main__':
    main()
