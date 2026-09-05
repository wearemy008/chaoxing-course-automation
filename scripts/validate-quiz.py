# -*- coding: utf-8 -*-
"""
校验超星智能导入格式题库：题号连续、标注答案与实际答案一致、选项齐全、解析完备

用法：
    python validate-quiz.py 题库目录
    python validate-quiz.py 单个文件.txt
"""
import os
import re
import sys
import glob
import json

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    target = sys.argv[1]
    files = [target] if os.path.isfile(target) else sorted(glob.glob(os.path.join(target, '*.txt')))
    if not files:
        print('未找到 .txt 文件')
        sys.exit(1)

    bad = []
    stat = {}
    for f in files:
        name = os.path.basename(f)
        txt = open(f, encoding='utf-8').read()
        blocks = [b.strip() for b in txt.split('\n\n') if b.strip()]
        nums = []
        for b in blocks:
            m = re.match(r'^(\d+)\.【(单选题|判断题|多选题|简答题)】', b)
            if not m:
                bad.append((name, '块无题号', b[:60]))
                continue
            nums.append(int(m.group(1)))
            qtype = m.group(2)
            stem = b.split('\n')[0]
            am = re.search(r'（([A-D])）', stem)
            ansm = re.search(r'^答案：(.+)$', b, re.M)
            if not ansm:
                bad.append((name, f'第{m.group(1)}题缺答案行', stem[:60]))
                continue
            ans = ansm.group(1).strip()
            if qtype == '判断题':
                if ans not in ('对', '错'):
                    bad.append((name, f'第{m.group(1)}题判断题答案非对/错', ans))
                if am:
                    bad.append((name, f'第{m.group(1)}题判断题不应标注字母', stem[:60]))
            elif qtype == '单选题':
                if am and am.group(1) != ans:
                    bad.append((name, f'第{m.group(1)}题标注{am.group(1)}但答案{ans}', stem[:60]))
                if ans not in ('A', 'B', 'C', 'D'):
                    bad.append((name, f'第{m.group(1)}题单选答案非 A-D', ans))
                opts = re.findall(r'^([A-D])[.、]', b, re.M)
                if sorted(opts) != ['A', 'B', 'C', 'D']:
                    bad.append((name, f'第{m.group(1)}题选项缺失', str(opts)))
            elif qtype == '多选题':
                if len(ans) < 2 or not set(ans) <= set('ABCD'):
                    bad.append((name, f'第{m.group(1)}题多选答案异常', ans))
                opts = re.findall(r'^([A-D])[.、]', b, re.M)
                if sorted(opts) != ['A', 'B', 'C', 'D']:
                    bad.append((name, f'第{m.group(1)}题选项缺失', str(opts)))
                if not set(ans) <= set(opts):
                    bad.append((name, f'第{m.group(1)}题答案超出选项', ans))
            elif qtype == '简答题':
                if len(ans) < 20:
                    bad.append((name, f'第{m.group(1)}题简答参考答案过短', str(len(ans))))
            if qtype != '简答题' and '解析：' not in b:
                bad.append((name, f'第{m.group(1)}题缺解析', ''))
        if nums != list(range(1, len(nums) + 1)):
            bad.append((name, '题号不连续', str(nums)))
        stat[name] = len(nums)

    print('=== 题库校验结果 ===')
    for k, v in stat.items():
        print(f'  {k}: {v} 题')
    print(f'合计 {sum(stat.values())} 题 / {len(stat)} 个文件\n')
    if bad:
        print(f'发现 {len(bad)} 处问题：')
        for b in bad:
            print('  -', b[0], '|', b[1], '|', b[2])
        sys.exit(1)
    print('全部通过：题号连续、答案一致、选项齐全、解析完备。')


if __name__ == '__main__':
    main()
