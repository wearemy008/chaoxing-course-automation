# -*- coding: utf-8 -*-
"""知识图谱填充数据生成器（通用模板）

把「课程大纲 / 章节数据」+「图谱节点树」两份输入，合成为 cx-graph-fill.mjs 所需的
<course>-graph-fill.json，结构为 { nodes, levels, questions, targets }。

—— 输入 ——
1. graph-data-<course>.json   课程内容数据，形如：
     { "sections": [
         { "no": "1.1", "name": "办公空间的概念", "key": "核心要点…",
           "goal": "教学目标…", "hard": "难点…" }, ... ] }
   来源建议：从主人自己的**大纲/教案/PPT**里抽取（不要杜撰）。
2. mapdata-<course>.json      从图谱页面抓的节点树，形如：
     { "nodes": [ { "topicid": "243470989", "name": "第一章…", "level": 1 }, ... ] }
   抓法：打开课程知识图谱页面，在控制台 dump 节点树（level=1 章 / level=2 节）。

—— 用法 ——
    python gen-graph.py --course bangong
输出 <course>-graph-fill.json 到脚本同目录，再跑 `node cx-graph-fill.mjs <course>` 写入平台。

⚠️ 所有文案必须来自教师自己的教学材料，本脚本只做「归类/拼接/映射」，不做内容创作。
"""
import argparse, json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))

# 标签键 → 平台标签 id（不同机构可能不同，用 --labels 覆盖或改这里）
LABELS = {'zhongdian': '24283664', 'nandian': '24283665', 'kaodian': '24283666', 'sizheng': '24283667'}

# classify 分类规则（可按学科调整）
def classify(name: str) -> str:
    if any(k in name for k in ['实训', '上机', '练习', '答辩', '实操']):
        return '3'          # 实践
    if any(k in name for k in ['概念', '定义', '类型', '分类', '基础', '要点', '方法', '原则', '原理', '要素', '关系', '模型']):
        return '2'          # 理论
    if any(k in name for k in ['总结', '评价', '复盘', '反思', '考核', '汇报', '表达', '赏析', '解析', '对比']):
        return '4'          # 素养
    if any(k in name for k in ['历程', '演变', '发展', '标准', '规范', '数据', '流程', '程序']):
        return '1'          # 事实
    return '2'


def norm(s: str) -> str:
    return (s or '').replace(' ', '').replace('\u3000', '').replace('（', '(').replace('）', ')')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--course', required=True, help='课程别名（如 bangong）')
    ap.add_argument('--data', help='课程内容 JSON，默认 graph-data-<course>.json')
    ap.add_argument('--map', dest='mapfile', help='图谱节点树 JSON，默认 mapdata-<course>.json')
    ap.add_argument('--out', help='输出文件，默认 <course>-graph-fill.json')
    ap.add_argument('--set-title', default=None, help='能力集标题（≤10 字符）')
    ap.add_argument('--sizheng', default='', help='思政节点编号，逗号分隔，如 1.2,1.3,4.4')
    a = ap.parse_args()

    datafile = a.data or os.path.join(BASE, f'graph-data-{a.course}.json')
    mapfile = a.mapfile or os.path.join(BASE, f'mapdata-{a.course}.json')
    outfile = a.out or os.path.join(BASE, f'{a.course}-graph-fill.json')
    if not os.path.exists(datafile) or not os.path.exists(mapfile):
        raise SystemExit(f'缺少输入：\n  {datafile}\n  {mapfile}\n请先准备这两份数据（见本文件顶部说明）。')

    secs = json.load(open(datafile, encoding='utf-8'))['sections']
    nodes = json.load(open(mapfile, encoding='utf-8'))['nodes']

    lv1 = [n for n in nodes if n.get('level') == 1]
    lv2 = [n for n in nodes if n.get('level') == 2]

    # 名称 → topicid 映射（图谱节点名与 section 名一致）
    name2id = {norm(n['name']): str(n['topicid']) for n in nodes if n.get('name') and n.get('topicid')}
    SIZHENG = {x.strip() for x in a.sizheng.split(',') if x.strip()}

    def find_id(sec_name):
        key = norm(sec_name)
        if key in name2id:
            return name2id[key]
        for k, v in name2id.items():
            if k and (key in k or k in key):
                return v
        return ''

    NODES = {}

    # 章节点（level=1）：逐章聚合描述/目标
    chapters = {}
    for s in secs:
        chapters.setdefault(s['no'].split('.')[0], []).append(s)
    for ch, csecs in sorted(chapters.items(), key=lambda x: int(x[0])):
        idx = int(ch) - 1
        if idx >= len(lv1):
            continue
        cid = str(lv1[idx]['topicid'])
        kk = '；'.join([(s.get('key') or '')[:60] for s in csecs[:3] if s.get('key')])
        teach = '；'.join([(s.get('goal') or '')[:50] for s in csecs[:2] if s.get('goal')])[:150]
        labels = [k for k, no in [('zhongdian', None)] if False]
        labels = []
        if any((s['no'] in SIZHENG) for s in csecs):
            labels.append('sizheng')
        NODES[cid] = dict(classify=None, desc=f'本章核心：{kk}'[:170], teach=teach,
                          labels=labels, depth=1, name=lv1[idx]['name'])

    # 叶节点（level=2）
    missed = []
    for s in secs:
        tid = find_id(s['name'])
        if not tid:
            missed.append(s['no'] + ' ' + s['name'])
            continue
        labels = []
        if s['no'].endswith('.1'):
            labels.append('zhongdian')
        h = s.get('hard') or ''
        if any(w in h for w in ['难点', '抽象', '提炼', '转化', '平衡', '综合', '研判', '判断']):
            labels.append('nandian')
        if s['no'] in SIZHENG:
            labels.append('sizheng')
        NODES[tid] = dict(classify=classify(s['name']), desc=(s.get('key') or s['name'])[:160],
                          teach=(s.get('goal') or '')[:150], labels=labels, depth=2, name=s['name'])

    print('章节点:', sum(1 for n in NODES.values() if n['depth'] == 1),
          '叶节点:', sum(1 for n in NODES.values() if n['depth'] == 2))
    if missed:
        print('未匹配（请检查名称是否与图谱节点一致）:')
        for m in missed:
            print('  MISS:', m)

    # 问题图谱三层骨架 + 每章一核心问题（题干请按自己课程的实际问题填写）
    LEVELS = [
        {'level': '1', 'title': '基础认知层', 'description': '认识本课程的基本概念、类型与发展脉络'},
        {'level': '2', 'title': '方法建构层', 'description': '掌握核心方法与流程，能完成方案设计'},
        {'level': '3', 'title': '综合创造层', 'description': '整合创造，完成真实项目与成果表达'},
    ]
    QUESTIONS = []   # [(level, 标题, 描述, topicIds)] —— 请按自己课程填写

    # 五会能力（绑章/叶 topicid）
    def cid(ch):
        i = int(ch) - 1
        return str(lv1[i]['topicid']) if i < len(lv1) else ''
    TARGETS = []     # [(名称, 描述, '逗号分隔的 topicid')] —— 请按自己课程填写

    out = dict(nodes=NODES, levels=LEVELS, questions=QUESTIONS, targets=TARGETS)
    json.dump(out, open(outfile, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'已生成 {outfile}')
    print(f'  nodes={len(NODES)} levels={len(LEVELS)} questions={len(QUESTIONS)} targets={len(TARGETS)}')
    if not QUESTIONS or not TARGETS:
        print('⚠️ questions / targets 为空：请在本脚本 QUESTIONS / TARGETS 处按自己课程填写后再生成。')


if __name__ == '__main__':
    main()
