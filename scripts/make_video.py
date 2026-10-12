# -*- coding: utf-8 -*-
"""
教学视频合成器：分镜脚本 MD + 课件 PDF → 成品 MP4（1080p，AI 配音 + 字幕 + Ken Burns）

用法：
    python make_video.py --md=视频脚本/我的课程-脚本01-03.md --seg=1 \
                         --pdf=pdf/ch01.pdf \
                         --course=我的课程 --out=视频成品/我的课程-01.mp4 \
                         --chapter="第一章 课程概述"

流程：
  1. 解析脚本中的指定段（镜头：时间/画面/旁白/素材）
  2. PDF 全页渲染 PNG（scale=3，2160x1215，供推拉使用）
  3. 旁白按句切分 → edge-tts 逐句配音（句间 0.35s）→ 镜头音频
  4. 每镜头生成视频片段（zoompan 四种运动轮换 + 首尾淡入淡出）
  5. concat 全部片段 → PIL 标题条 overlay → subtitles 烧录字幕
输出：MP4（H.264/AAC 1080p25）+ 同名 SRT

⚠️ Windows ffmpeg 三大坑（本脚本已处理，改写时务必保留）：
   ① 滤镜参数禁出现盘符冒号 → 设 cwd=工作目录，滤镜里只用相对文件名
   ② 不用 drawtext 写中文 → PIL 渲染 PNG + overlay
   ③ 工作目录必须是纯英文路径
"""
import argparse, asyncio, json, re, subprocess, sys, time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass

import edge_tts
import imageio_ffmpeg
import pypdfium2 as pdfium

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = 'zh-CN-XiaoxiaoNeural'
RATE = '+0%'
SENT_GAP = 0.35          # 句间停顿
TAIL_PAD = 0.7           # 镜头尾气口
FPS = 25
W, H = 1920, 1080
FONT = "'C:/Windows/Fonts/msyh.ttc'"     # 引号包裹+正斜杠，滤镜解析最稳

# ---------------------------------------------------------------- 解析脚本

def parse_segment(md_path: Path, seg_no: int):
    text = md_path.read_text(encoding='utf-8')
    blocks = re.split(r'\n## ', text)
    blk = None
    for b in blocks:
        if re.match(rf'第\s*{seg_no}\s*段', b):
            blk = b
            break
    if not blk:
        raise SystemExit(f'脚本里找不到第 {seg_no} 段')
    mtitle = re.search(r'《(.+?)》', blk.split('\n')[0])
    title = mtitle.group(1) if mtitle else f'第{seg_no}章'
    mchap = re.search(r'\*\*对应章节\*\*：(.+?)\s*[｜|]', blk)
    chapter = mchap.group(1).strip() if mchap else ''
    shots = []
    for line in blk.split('\n'):
        if not line.strip().startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) < 5 or not re.fullmatch(r'\d+', cells[0]):
            continue
        tm = re.match(r'(\d+):(\d+)-(\d+):(\d+)', cells[1])
        shots.append({
            'no': int(cells[0]),
            't': f'{int(tm.group(1))*60+int(tm.group(2))}-{int(tm.group(3))*60+int(tm.group(4))}' if tm else '',
            'visual': cells[2],
            'narr': re.sub(r'\s+', '', cells[3]),
            'material': cells[4],
        })
    if not shots:
        raise SystemExit('没解析到镜头表格')
    return title, chapter, shots

def split_sentences(narr: str):
    parts = [p for p in re.split(r'(?<=[。！？；])', narr) if p.strip()]
    return parts or [narr]

# ---------------------------------------------------------------- PDF 渲染

def render_pages(pdf_path: Path, work: Path, scale=3):
    pdir = work / 'pages'
    if (pdir / '_done.json').exists():
        return json.loads((pdir / '_done.json').read_text())
    pdir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(str(pdf_path))
    n = len(pdf)
    files = []
    for i in range(n):
        f = pdir / f'p{i+1:02d}.png'
        if not f.exists():
            pdf[i].render(scale=scale).to_pil().save(f)
        files.append(str(f))
    (pdir / '_done.json').write_text(json.dumps(files))
    print(f'  课件页渲染完成：{n} 页')
    return files

# ---------------------------------------------------------------- TTS

def probe_dur(fp: Path):
    """PCM wav 时长（标准库精确计算，无需 ffprobe）"""
    import wave, contextlib
    with contextlib.closing(wave.open(str(fp), 'rb')) as w:
        return w.getnframes() / float(w.getframerate())

def concat_audio(inputs, fc, out: Path, tries=3):
    """拼接音频（含重试：TTS 并发写盘偶发截断会导致 Invalid data）"""
    last = None
    for i in range(tries):
        r = subprocess.run([FFMPEG, '-y', '-loglevel', 'error', *inputs,
                            '-filter_complex', fc, '-map', '[a]',
                            '-ar', '48000', '-ac', '2', str(out)],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists() and out.stat().st_size > 1000:
            return
        last = r.stderr
        time.sleep(1.0 * (i + 1))
    raise SystemExit(f'音频拼接失败({out.name}): {(last or "")[-400:]}')

async def tts_one(text: str, wav: Path, sem: asyncio.Semaphore):
    async with sem:
        mp3 = wav.with_suffix('.mp3')
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(mp3))
                break
            except Exception as e:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(mp3),
                        '-ar', '24000', '-ac', '1', str(wav)], check=True)
        try:
            mp3.unlink(missing_ok=True)
        except Exception:
            pass   # 删除守卫拦截无害，mp3 留着即可
        return probe_dur(wav)

# ---------------------------------------------------------------- 镜头片段

def kenburns(idx: int, frames: int):
    """四种运动轮换：推近 / 拉远 / 右移推近 / 左移推近"""
    k = idx % 4
    cx, cy = 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)'
    if k == 0:
        return f"z='min(1+0.13*on/{frames},1.13)':x='{cx}':y='{cy}'"
    if k == 1:
        return f"z='max(1.13-0.13*on/{frames},1.0)':x='{cx}':y='{cy}'"
    if k == 2:
        return f"z='min(1+0.10*on/{frames},1.10)':x='(iw-iw/zoom)*on/{frames}':y='{cy}'"
    return f"z='min(1+0.10*on/{frames},1.10)':x='(iw-iw/zoom)*(1-on/{frames})':y='{cy}'"

def pick_page(shot, shots, npages, last):
    """选页：首镜→封面，末镜→要点页；正文镜优先解析「PPT 第X页」，无标注则沿用上一镜页面"""
    if shot['no'] == shots[0]['no']:
        return 1, 1
    if shot['no'] == shots[-1]['no']:
        return npages, npages
    m = re.search(r'PPT\s*第\s*(\d+)\s*页', shot['visual'] + shot['material'])
    if m:
        pg = min(int(m.group(1)), npages)
        return pg, pg
    return last, last

def fmt_ts(sec: float):
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

# ---------------------------------------------------------------- 主流程

def make_title_png(text: str, path: Path, w=1920):
    """标题条渲染成 PNG（绕开 drawtext 在部分环境的中文编码问题）"""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 30)
    bar_h = 78
    img = Image.new('RGBA', (w, bar_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=font)
    d.rounded_rectangle([0, 14, 40 + tw + 56, bar_h - 14], radius=16, fill=(12, 16, 20, 155))
    d.text((40 + 28, bar_h // 2), text, font=font, fill=(255, 255, 255, 238), anchor='lm')
    img.save(path)
    return path

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--md', required=True)
    ap.add_argument('--seg', required=True, type=int)
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--course', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--chapter', default='')
    args = ap.parse_args()

    md_path, pdf_path, out_path = Path(args.md), Path(args.pdf), Path(args.out)
    # 工作目录走纯英文路径：concat 列表与 subtitles 滤镜不吃中文路径
    work = Path(__file__).parent / '_videowork' / f'seg{args.seg:02d}'
    work.mkdir(parents=True, exist_ok=True)

    title, chapter, shots = parse_segment(md_path, args.seg)
    print(f'* 第{args.seg}段《{title}》 {len(shots)} 个镜头')
    label = args.chapter or chapter

    pages = render_pages(pdf_path, work)
    npages = len(pages)

    # ---- 逐句 TTS
    tdir = work / 'tts'
    tdir.mkdir(exist_ok=True)
    sem = asyncio.Semaphore(4)
    jobs, plan = [], []
    for sh in shots:
        sents = split_sentences(sh['narr'])
        items = []
        for j, s in enumerate(sents):
            wav = tdir / f's{sh["no"]:02d}_{j:02d}.wav'
            jobs.append(tts_one(s, wav, sem))
            items.append({'text': s, 'wav': wav})
        plan.append(items)
    durs = await asyncio.gather(*jobs)
    k = 0
    for items in plan:
        for it in items:
            it['dur'] = durs[k]
            k += 1
    print(f'  配音完成：{k} 句')

    # ---- 每镜头：音频拼接 + 视频片段
    seg_files, srt, cursor = [], [], 0.0
    total_audio = 0.0
    last_page = 1
    for sh, items in zip(shots, plan):
        # 音频时长（含句间停顿）
        audio_dur = sum(it['dur'] for it in items) + SENT_GAP * (len(items) - 1)
        dur = audio_dur + TAIL_PAD
        frames = max(int(round(dur * FPS)), FPS)
        dur = frames / FPS

        # 拼接音频：句子 + 0.35s 静音（filter concat，避开中文路径的 demuxer 列表）
        silence = work / 'sil.wav'
        if not silence.exists():
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-f', 'lavfi',
                            '-i', 'anullsrc=r=24000:cl=mono', '-t', str(SENT_GAP), str(silence)], check=True)
        inputs, fparts = [], []
        for idx, it in enumerate(items):
            inputs += ['-i', str(it['wav'])]
            fparts.append(f'[{len(fparts)//1}:a]' if False else None)
        # 重新按顺序构造：句子 wav 与静音交替
        inputs = []
        for idx, it in enumerate(items):
            inputs += ['-i', str(it['wav'])]
            if idx < len(items) - 1:
                inputs += ['-i', str(silence)]
        n = len(items) + (len(items) - 1 if len(items) > 1 else 0)
        fc = ''.join(f'[{i}:a]' for i in range(n)) + f'concat=n={n}:v=0:a=1[a]'
        shot_wav = work / f'shot_{sh["no"]:02d}.wav'
        concat_audio(inputs, fc, shot_wav)

        # 视频片段
        pg, last_page = pick_page(sh, shots, npages, last_page)
        seg = work / f'seg_{sh["no"]:02d}.mp4'
        if not seg.exists():
            kb = kenburns(sh['no'], frames)
            vf = (f"zoompan={kb}:d={frames}:s={W}x{H}:fps={FPS},"
                  f"format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st={dur-0.3:.3f}:d=0.3")
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error',
                            '-i', pages[pg - 1], '-i', str(shot_wav),
                            '-filter_complex', f'[0:v]{vf}[v]',
                            '-map', '[v]', '-map', '1:a',
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
                            '-c:a', 'aac', '-b:a', '128k', '-shortest', str(seg)], check=True)
        seg_files.append(seg)

        # 字幕
        t0 = cursor
        for it in items:
            s1, s2 = t0, t0 + it['dur']
            srt.append(f'{len(srt)+1}\n{fmt_ts(s1)} --> {fmt_ts(s2)}\n{it["text"]}\n')
            t0 = s2 + SENT_GAP
        cursor += dur
        total_audio += audio_dur
        print(f'  镜头{sh["no"]:02d}  {dur:6.1f}s  页{pg:>2}  {items[0]["text"][:18]}…')

    # ---- concat
    cat = work / 'concat.txt'
    with cat.open('w', encoding='utf-8') as f:
        for s in seg_files:
            f.write(f"file '{s.as_posix()}'\n")
    joined = work / 'joined.mp4'
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                    '-i', str(cat), '-c', 'copy', str(joined)], check=True)

    # ---- 标题条 PNG + 字幕烧录（overlay + subtitles，全程不用 drawtext）
    out_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path = out_path.with_suffix('.srt')
    srt_path.write_text('\n'.join(srt), encoding='utf-8')
    srt_work = work / 'subs.srt'          # 英文路径副本，供 subtitles 滤镜
    srt_work.write_text('\n'.join(srt), encoding='utf-8')
    title_text = f'《{args.course}》· {chapter or title}'
    title_png = make_title_png(title_text, work / 'title.png')
    style = ("FontName=Microsoft YaHei,FontSize=15,PrimaryColour=&H00FFFFFF,"
             "OutlineColour=&HA0000000,BorderStyle=1,Outline=1.1,Shadow=0,MarginV=34")
    fc = (f"[0:v][1:v]overlay=46:38[b];"
          f"[b]subtitles=subs.srt:force_style='{style}'[v]")
    print(f'* 合成成品（{cursor/60:.1f} 分钟，含标题条+字幕）…')
    # 关键：cwd 设为工作目录，滤镜参数全部用相对文件名——绕开 Windows 盘符冒号被滤镜解析器吃掉的问题
    r = subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', 'joined.mp4',
                        '-i', 'title.png',
                        '-filter_complex', fc, '-map', '[v]', '-map', '0:a?',
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                        '-c:a', 'copy', '-movflags', '+faststart', str(out_path.resolve())],
                       cwd=str(work),
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit('ffmpeg 合成失败')
    print(f'✓ 成品：{out_path}  {out_path.stat().st_size/1048576:.1f} MB  时长 {cursor:.0f}s')
    print(f'  字幕：{srt_path}')

if __name__ == '__main__':
    t0 = time.time()
    asyncio.run(main())
    print(f'总耗时 {time.time()-t0:.0f}s')
