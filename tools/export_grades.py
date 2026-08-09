import argparse
import json
import csv
import sys
import os
import re
import datetime

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def get_config():
    config_path = 'js/config.js'
    titles = [
        '新來的貓', '好奇的貓', '學徒貓', '認真的貓', '熟練的貓',
        '可靠的貓', '厲害的貓', '資深的貓', '大師貓', '傳說中的貓', '小鎮之光'
    ]
    max_level = 10
    xp_per_level = 3
    
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
            m_max = re.search(r'MAX_LEVEL:\s*(\d+)', content)
            if m_max:
                max_level = int(m_max.group(1))
                
            m_xp = re.search(r'XP_PER_LEVEL:\s*(\d+)', content)
            if m_xp:
                xp_per_level = int(m_xp.group(1))
                
            m_titles = re.search(r'LEVEL_TITLES:\s*\[(.*?)\]', content, re.DOTALL)
            if m_titles:
                titles_str = m_titles.group(1)
                found_titles = re.findall(r"'(.*?)'", titles_str)
                if found_titles:
                    titles = found_titles

    return max_level, xp_per_level, titles

def main():
    parser = argparse.ArgumentParser(description="匯出結算成績")
    parser.add_argument('--class-id', default='class-data', help='班級 ID (預設: class-data)')
    parser.add_argument('--out', help='輸出 CSV 檔案路徑 (預設: data/export-YYYY-MM-DD.csv)')
    args = parser.parse_args()

    class_id = args.class_id
    
    tz = datetime.timezone(datetime.timedelta(hours=8))
    now = datetime.datetime.now(tz)
    date_str = now.strftime("%Y-%m-%d")
    
    out_path = args.out
    if not out_path:
        out_path = f"data/export-{date_str}.csv"
        
    data_path = f"data/{class_id}.json"
    if not os.path.exists(data_path):
        print(f"錯誤：找不到資料檔 {data_path}", file=sys.stderr)
        sys.exit(1)
        
    with open(data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    max_level, xp_per_level, titles = get_config()
    
    students = data.get('students', [])
    students.sort(key=lambda x: x.get('seat', 0))
    
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['座號', '姓名', '累積分數', '等級', '稱號', '平時成績加分'])
        
        for s in students:
            seat = s.get('seat', '')
            name = s.get('name', '')
            if not name:
                name = str(seat)
            xp = s.get('xp', 0)
            
            level = min(max_level, xp // xp_per_level)
            
            if level < len(titles):
                title = titles[level]
            else:
                title = titles[-1] if titles else ""
                
            writer.writerow([seat, name, xp, level, title, level])
            
    print(f"已成功匯出成績至 {out_path}")

if __name__ == '__main__':
    main()
