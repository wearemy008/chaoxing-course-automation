# -*- coding: utf-8 -*-
"""教学视频批量合成清单（模板）

用法：复制本文件为 video_manifest.py，按你的课程填写 ITEMS。
每个条目 = (课程名, 段号, 分镜脚本 md 路径, 课件 PDF 路径, 成品文件名, 章节标题)

—— 字段说明 ——
  course : 课程名（会出现在视频标题条上）
  seg    : 分镜脚本里的「第 N 段」
  md     : 分镜脚本文件（表格列须为：镜号|时间|画面|旁白（配音稿）|素材）
  pdf    : 该段对应的课件 PDF（画面源）
  out    : 成品文件名（不含 .mp4），建议「课程名-NN-集名」
  chapter: 标题条上显示的章节全名
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MCP = ROOT

# 示例（请按需替换）
ITEMS = [
    # ('我的课程', 1, ROOT/'视频脚本/我的课程-脚本01-03.md', ROOT/'pdf/ch01.pdf',
    #  '我的课程-01-第一章导学', '第一章 课程概述'),
]


def get(course, seg):
    for it in ITEMS:
        if it[0] == course and it[1] == seg:
            return it
    raise KeyError(f'{course} 段{seg}')
