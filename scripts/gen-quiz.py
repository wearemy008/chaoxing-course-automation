# -*- coding: utf-8 -*-
"""
超星智能导入格式题库生成器

输入：一个 JSON 题库源文件（结构见下），输出每章一个 .txt，可直接粘贴到
      「题库 → 批量导入 → 智能导入」编辑区，或交给 cx-quiz.mjs 自动导入。

用法：
    python gen-quiz.py source.json 输出目录/文件名前缀
        source.json 结构：
        {
          "前缀名": "办公空间设计",
          "章节": {
            "1": {
              "单选": [["题干(含（A）标注)", ["A.xxx","B.xxx","C.xxx","D.xxx"], "A", "解析"], ...],
              "判断": [["题干", "对", "解析"], ...],
              "多选": [["题干", ["A.xxx",...], "ABD", "解析"], ...],
              "简答": [["题干", "参考答案"], ...]
            }
          }
        }

注意（踩过的坑）：
  * 题干里的答案标注（如 （A））必须与答案字段一致，否则导入平台后判分错位
  * 判断题题干不写字母标注，答案只写「对」或「错」
  * 每行之间必须有真实换行；章节之间用空行分隔
"""
import os
import sys
import json

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def render(ch_data):
    lines = []
    n = 0
    for stem, opts, ans, exp in ch_data.get('单选', []):
        n += 1
        lines.append(f'{n}.【单选题】{stem}')
        lines.extend(opts)
        lines.append(f'答案：{ans}')
        lines.append(f'解析：{exp}')
        lines.append('')
    for stem, tf, exp in ch_data.get('判断', []):
        n += 1
        mark = '（对）' if tf == '对' else '（错）'
        lines.append(f'{n}.【判断题】{stem}{mark}')
        lines.append(f'答案：{tf}')
        lines.append(f'解析：{exp}')
        lines.append('')
    for stem, opts, ans, exp in ch_data.get('多选', []):
        n += 1
        lines.append(f'{n}.【多选题】{stem}')
        lines.extend(opts)
        lines.append(f'答案：{ans}')
        lines.append(f'解析：{exp}')
        lines.append('')
    for stem, ref in ch_data.get('简答', []):
        n += 1
        lines.append(f'{n}.【简答题】{stem}')
        lines.append(f'答案：{ref}')
        lines.append('')
    return '\n'.join(lines), n


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, out = sys.argv[1], sys.argv[2]
    data = json.load(open(src, encoding='utf-8'))
    prefix = data.get('前缀名', '课程')
    outdir = os.path.dirname(out) or '.'
    os.makedirs(outdir, exist_ok=True)
    total = 0
    for ch in sorted(data['章节'], key=lambda x: int(x)):
        txt, n = render(data['章节'][ch])
        f = f'{out}-第{ch}章-章节测验.txt'
        open(f, 'w', encoding='utf-8').write(txt)
        total += n
        print(f'第{ch}章 {n} 题 -> {f}')
    print(f'合计 {total} 题')
    print('提示：生成后请先运行 validate-quiz.py 校验格式')


if __name__ == '__main__':
    main()
