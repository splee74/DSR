#!/bin/sh
# 사용 설명서 PDF 만들기: manual/manual.html → manual.pdf (크롬 필요)
cd "$(dirname "$0")/.." || exit 1
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=8000 --print-to-pdf="$(pwd -W 2>/dev/null || pwd)/manual.pdf" "file:///$(pwd -W 2>/dev/null || pwd)/manual/manual.html"
