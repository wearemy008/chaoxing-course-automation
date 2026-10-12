# -*- coding: utf-8 -*-
"""批量视频合成（断点续跑）

用法：
    python video_all.py --course bangong            # 办公全部 12 集
    python video_all.py --course kongjian           # 空间全部 13 集
    python video_all.py --course bangong --from 2 --to 4   # 指定区间
    python video_all.py --course bangong --seg 2     # 单集

进度落在 _videowork/_progress.json，已成功的段落跳过（幂等）。
成品输出到 视频成品/<name>.mp4 + .srt
"""
import argparse, asyncio, json, re, subprocess, sys, time
from pathlib import Path

MCP = Path(__file__).parent
sys.path.insert(0, str(MCP))
import video_manifest as M
import make_video as MV

OUT_DIR = M.ROOT / '视频成品'
WORK_ROOT = MCP / '_videowork'
PROG = WORK_ROOT / '_progress.json'


def load_prog():
    if PROG.exists():
        try:
            return json.loads(PROG.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save_prog(p):
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    PROG.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding='utf-8')


async def build_one(course, seg):
    _, _, md, pdf, out_name, chapter = M.get(course, seg)
    out = OUT_DIR / f'{out_name}.mp4'
    if out.exists() and out.stat().st_size > 500_000:
        print(f'[skip] 段{seg:02d} 成品已存在 {out.name}')
        return True
    # 复用 make_video 的主流程：直接调它内部逻辑（改用 argv 注入）
    sys.argv = ['make_video.py', f'--md={md}', f'--seg={seg}', f'--pdf={pdf}',
                f'--course={course}', f'--out={out}', f'--chapter={chapter}']
    t0 = time.time()
    try:
        await MV.main()
    except SystemExit as e:
        print(f'[FAIL] 段{seg:02d} {e}')
        return False
    except Exception as e:
        print(f'[FAIL] 段{seg:02d} {type(e).__name__}: {e}')
        return False
    print(f'[ok] 段{seg:02d} 用时 {time.time()-t0:.0f}s')
    return True


async def run(course, segs):
    prog = load_prog()
    ckey = 'bangong' if course == '办公空间设计' else 'kongjian'
    ok = skip = 0
    for seg in segs:
        key = f'{ckey}-{seg:02d}'
        if prog.get(key, {}).get('done'):
            print(f'[skip] 段{seg:02d} 进度表已标记完成')
            skip += 1
            continue
        print(f'\n=== {course} 段{seg:02d} ===')
        good = await build_one(course, seg)
        prog.setdefault(key, {})
        prog[key].update({'done': good, 'ts': time.strftime('%Y-%m-%d %H:%M:%S')})
        save_prog(prog)
        if good:
            ok += 1
        else:
            print('  中断：保留进度，稍后重跑可续。')
            break
    print(f'\n== SUMMARY {course}: ok={ok} skip={skip}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--course', required=True, choices=['bangong', 'kongjian'])
    ap.add_argument('--from', dest='frm', type=int, default=1)
    ap.add_argument('--to', dest='to', type=int, default=999)
    ap.add_argument('--seg', type=int)
    a = ap.parse_args()
    COURSE = '办公空间设计' if a.course == 'bangong' else '空间数字化表现'
    all_segs = [it[1] for it in M.ITEMS if it[0] == COURSE]
    if a.seg:
        segs = [a.seg]
    else:
        segs = [s for s in all_segs if a.frm <= s <= a.to]
    print(f'课程 {COURSE} → 待处理段 {segs}')
    asyncio.run(run(COURSE, segs))
