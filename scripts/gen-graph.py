# -*- coding: utf-8 -*-
"""生成《空间数字化表现》知识图谱填充数据
   依据：jiaoan.json（主人教案，11章）+ mapdata-kongjian.json（图谱真实 topicid）
   策略：图谱节点 topicid 连续（243470989+n），章每 6 个一跳，与章节树命名一一对应
"""
import json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ja = json.load(open(os.path.join(BASE, 'jiaoan.json'), encoding='utf-8'))
md = json.load(open(os.path.join(BASE, 'mapdata-kongjian.json'), encoding='utf-8'))

nodes = md['nodes']
lv1 = [n for n in nodes if n.get('level') == 1]
lv2 = [n for n in nodes if n.get('level') == 2]

# 按渲染顺序构建 章 -> [节] 的 topicid 结构
chapters = []          # [{tid, name, secs:[{tid,name}]}]
cur = None
for n in nodes:
    if n.get('level') == 1:
        cur = {'tid': str(n['topicid']), 'name': n['name'].strip(), 'secs': []}
        chapters.append(cur)
    elif n.get('level') == 2 and cur is not None:
        cur['secs'].append({'tid': str(n['topicid']), 'name': n['name'].strip()})

# 剔除残留占位节点「新建课程目录」
BOGUS = '新建课程目录'
for c in chapters:
    c['secs'] = [s for s in c['secs'] if s['name'] != BOGUS]

print('章=%d 有效节=%d' % (len(chapters), sum(len(c['secs']) for c in chapters)))
for i, c in enumerate(chapters, 1):
    print('  %d %s [%s] %d节' % (i, c['name'][:30], c['tid'], len(c['secs'])))

def norm(s):
    return re.sub(r'[\s\u3000（）()·、,，。/／\-—]', '', s or '')

# ---------- 分类判定（1事实 2概念 3程序 4元认知） ----------
def classify(name, key=''):
    n = name
    if any(k in n for k in ['实训', '实战', '上机', '练习', '真题真做', '建模', '输出', '渲染', '漫游', '创建']):
        return '3'
    if any(k in n for k in ['总结', '评价', '汇报', '答辩', '考核', '回顾', '理念', '策略', '叙事', '体验', '优化']):
        return '4'
    if any(k in n for k in ['定义', '概述', '概念', '类型', '体系', '原理', '区别', '参数', '编辑器', '认知', '基础']):
        return '2'
    if any(k in n for k in ['五阶段', '发展', '前沿', '数据', '标准', '规范', '参数', '流程', '方法', '公式']):
        return '1'
    return '2'

# ---------- 章节要点 / 素养目标抽取 ----------
def split_objectives(obj):
    """从教案 objectives 抽出 素质目标（课程思政）段"""
    if not obj:
        return ''
    m = re.search(r'素质目标[（(]课程思政[）)]?：?\s*(.*?)(?=能力目标|知识目标|$)', obj, re.S)
    if m:
        return m.group(1).strip()[:180]
    return ''

def pick_keypoints(kp, want='重点'):
    if not kp:
        return ''
    m = re.search(want + r'：\s*(.*?)(?=\n?难点：|$)', kp, re.S)
    txt = m.group(1).strip() if m else ''
    # 压缩编号
    txt = re.sub(r'\s*\d+\.\s*', '；', txt).strip('；')
    return txt[:200]

def pick_hard(kp):
    if not kp:
        return ''
    m = re.search(r'难点：\s*(.*)$', kp, re.S)
    txt = m.group(1).strip() if m else ''
    txt = re.sub(r'\s*\d+\.\s*', '；', txt).strip('；')
    return txt[:200]

# 教案章标题 -> 图谱 lv1 的对应（按序）
NODES = {}

# ===== 1) 章节点（11）=====
for i, c in enumerate(chapters):
    jz = ja[i] if i < len(ja) else {}
    kp = pick_keypoints(jz.get('keypoints', ''))
    sz = split_objectives(jz.get('objectives', ''))
    tech = (jz.get('summary') or '')[:150]
    desc = ('%s' % kp)[:190] if kp else (jz.get('title') or c['name'])[:190]
    labels = []
    if i in (0, 4, 5, 6, 8):      # 概述 / 材质 / 灯光 / 渲染 / AI 为重点章
        labels.append('zhongdian')
    if i in (3, 5, 6, 8):         # 细部构造 / 灯光 / 渲染 / AI 为难点章
        labels.append('nandian')
    if i in (0, 8, 10):           # 概述 / AI / 商业空间 承载课程思政
        labels.append('sizheng')
    NODES[c['tid']] = dict(desc=desc, teach=tech, labels=labels, depth=1, name=c['name'])

# ===== 2) 节节点（55）=====
# 节级内容来自 kongjian-sec-content.py（严格依据主人教案原文逐节提炼）
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location('kjsec', os.path.join(BASE, 'kongjian-sec-content.py'))
_kjsec = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_kjsec)
SEC = _kjsec.SEC

miss = []
for ci, c in enumerate(chapters):
    for si, s in enumerate(c['secs']):
        no = '%d.%d' % (ci + 1, si + 1)
        row = SEC.get(no)
        if not row:
            miss.append(no + ' ' + s['name'])
            continue
        desc, teach, cls, labels = row
        NODES[s['tid']] = dict(
            classify=cls,
            desc=desc[:200],
            teach=teach[:150],
            labels=labels, depth=2, name=s['name'],
        )
print('未覆盖的节:', miss)

print('节点总数(去占位)=%d 章=%d 节=%d' % (
    len(NODES),
    len([n for n in NODES.values() if n['depth'] == 1]),
    len([n for n in NODES.values() if n['depth'] == 2])))

# ---------- 3) 问题图谱（三层级 + 核心问题） ----------
LEVELS = [
    {'level': '1', 'title': '基础认知层', 'description': '建立认知：数字化表现定义、发展脉络、软件体系与技术栈'},
    {'level': '2', 'title': '技能建构层', 'description': '掌握操作：SketchUp建模、材质贴图、灯光渲染与动画漫游'},
    {'level': '3', 'title': '综合创造层', 'description': '整合创造：AI辅助、居住与商业空间真题真做与汇报答辩'},
]

def sid(ci, si):
    """章内第 si 节的 topicid（ci/si 从 0 起）"""
    c = chapters[ci]
    return c['secs'][si]['tid'] if si < len(c['secs']) else ''

Q_SPEC = [
    ('1', '空间数字化表现的本质是什么？为什么说它是设计思维而非软件操作？',
     '第一章核心问题：从"表现=画图"转向"表现=设计思维与表达"。', (0, 4)),
    ('1', 'SketchUp 的推拉工具为什么被称为"灵魂"？组与组件解决了什么问题？',
     '第二章核心问题：操作熟练度与建模规范性的双重转变。', (1, 3)),
    ('1', 'CAD 图纸如何转化为规范的三维空间模型？墙体六步法为何必要？',
     '第三章核心问题：从二维图纸到三维空间的规范转换。', (2, 1)),
    ('2', '复杂家具与细部构造该如何取舍建模？什么是"选择性建模"？',
     '第四章核心问题：模型精度与效率的平衡智慧。', (3, 4)),
    ('2', '材质参数与贴图比例如何决定空间真实感？',
     '第五章核心问题：材质是空间质感的第一语言。', (4, 0)),
    ('2', '自然光与人工光如何协同营造空间氛围？灯光三层级指什么？',
     '第六章核心问题：光塑造空间的情绪与层次。', (5, 2)),
    ('2', '如何用 Enscape 快速输出有叙事的专业效果图？',
     '第七章核心问题：从渲染参数到画面叙事的表达升级。', (6, 4)),
    ('3', '漫游动画与 VR 如何改变方案汇报与用户体验？',
     '第八章核心问题：从静态图像走向沉浸式体验。', (7, 4)),
    ('3', 'AI 能替代设计师吗？提示词七要素与人机协同如何落地？',
     '第九章核心问题：AIGC 时代设计师的定位与伦理边界。', (8, 2)),
    ('3', '面对 120㎡ 真实户型，如何完成全流程数字化表现？',
     '第十章核心问题：居住空间真题真做的整合实战。', (9, 4)),
    ('3', '商业空间的表现逻辑与居住空间有何不同？如何答辩展示？',
     '第十一章核心问题：商业价值导向的表现与成果表达。', (10, 4)),
]
QUESTIONS = []
for lv, t, d, (ci, si) in Q_SPEC:
    QUESTIONS.append((lv, t, d, sid(ci, si)))

# ---------- 4) 五会能力（绑章/节 topicid） ----------
def cid(ci):
    return chapters[ci]['tid'] if ci < len(chapters) else ''

TARGETS = [
    ('会思考', '重构表现认知·选择性建模判断·人机协同思辨·设计思维迭代。',
     ','.join([cid(0), sid(3, 4), cid(8)])),
    ('会学习', '软件体系与工作流梳理·参数规律迁移·前沿动态追踪。',
     ','.join([sid(0, 2), sid(4, 0), sid(6, 0)])),
    ('会动手', 'SketchUp建模·材质灯光渲染·动画漫游·综合项目实训。',
     ','.join([cid(1), cid(4), cid(6), cid(9)])),
    ('会沟通', '叙事性渲染表达·方案汇报·终结性答辩与六维评价。',
     ','.join([sid(6, 4), sid(9, 3), sid(10, 4)])),
    ('会生活', '绿色环保材料·健康光环境·情境感知照明·沉浸式体验。',
     ','.join([sid(4, 4), sid(5, 4), sid(7, 4)])),
]

out = dict(nodes=NODES, levels=LEVELS, questions=QUESTIONS, targets=TARGETS)
json.dump(out, open(os.path.join(BASE, 'kongjian-graph-fill.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# ---- 自查输出 ----
lines = []
lines.append('章=%d 节=%d 问题=%d 能力=%d' % (
    len([n for n in NODES.values() if n['depth'] == 1]),
    len([n for n in NODES.values() if n['depth'] == 2]),
    len(QUESTIONS), len(TARGETS)))
from collections import Counter
lc = Counter()
for n in NODES.values():
    for l in n['labels']:
        lc[l] += 1
lines.append('标签统计: %s' % dict(lc))
cc = Counter(n.get('classify') for n in NODES.values() if n.get('classify'))
lines.append('分类统计: %s' % dict(cc))
for q in QUESTIONS:
    lines.append('  Q[L%s] %s → %s' % (q[0], q[1][:32], q[3] or 'MISS'))
for t in TARGETS:
    lines.append('  T %s → %s' % (t[0], t[2]))
open(os.path.join(BASE, 'kj-gen-check.txt'), 'w', encoding='utf-8').write('\n'.join(lines))
print('done')
