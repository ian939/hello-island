#!/bin/sh
# 남은 판을 4개씩 동시에 그린다. 이미 그린 판(sheet-NN.png)은 건너뛴다.
cd "$(dirname "$0")/.."
run() { [ -f "tools/sheets/sheet-$(printf %02d $1).png" ] || python -X utf8 tools/gen_art.py --sheet "$1"; }
for batch in "1 2 3 4" "5 6 7 8" "9 10 11 12" "13"; do
  for n in $batch; do run "$n" & done
  wait
done
echo ALL_DONE
